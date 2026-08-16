import { NextResponse } from "next/server";

import {
  buildRateLimitBucketKey,
  enforceRateLimit,
  resolveClientIp,
} from "@/lib/auth/rate-limit";
import { getCurrentUser } from "@/lib/auth/session";
import { getServerEnv } from "@/lib/env/server";
import {
  OrganizationAuthError,
  requireOrganizationMemberBySlug,
  requireOrganizationPermission,
} from "@/lib/orgs/authorization";
import { stageCsvImport } from "@/lib/orgs/csv-import";
import {
  previewCsvImportFile,
  validateCsvImportMapping,
} from "@/lib/orgs/csv-import-preview";
import {
  assertCsvImportContentLength,
  CsvImportRequestError,
  getCsvImportFile,
  parseBoundedCsvImportFormData,
  parseCsvImportFamily,
  parseCsvImportIntent,
} from "@/lib/orgs/csv-import-request";
import { TABULAR_MIME_BY_KIND } from "@/lib/orgs/tabular-types";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const MANAGE_PERMISSION = "org.knowledge.manage" as const;

/**
 * CSV preview/validate/stage. Authentication, membership, permission, and
 * rate limiting run before the multipart body is read so an unauthenticated
 * or already-limited caller cannot force Outreach to allocate up to ~5 MiB.
 *
 * Content-Length is a cheap declared-size gate only. The streaming reader in
 * `parseBoundedCsvImportFormData` is the authoritative bound.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  try {
    assertCsvImportContentLength(request);

    const user = await getCurrentUser();
    if (!user || !user.emailVerifiedAt) {
      return NextResponse.json(
        {
          ok: false,
          reason: "unauthenticated",
          message: "Authentication is required.",
        },
        { status: 401 },
      );
    }

    const { slug } = await context.params;
    let membership;
    try {
      membership = await requireOrganizationMemberBySlug({ user, slug });
      await requireOrganizationPermission({
        user,
        organizationId: membership.organizationId,
        permission: MANAGE_PERMISSION,
      });
    } catch (error) {
      if (error instanceof OrganizationAuthError) {
        return NextResponse.json(
          {
            ok: false,
            reason: "not_found",
            message: "You do not have access to this organization.",
          },
          { status: 404 },
        );
      }
      throw error;
    }

    const env = getServerEnv();
    const trustedProxy =
      env.NODE_ENV === "production" || Boolean(env.AUTH_TRUST_HOST);
    const ip = resolveClientIp(request.headers, trustedProxy);
    const limited = await enforceRateLimit(prisma, {
      route: "csv-import",
      bucketKey: buildRateLimitBucketKey({
        route: "csv-import",
        emailNormalized: null,
        ip,
        missingIpSalt: `user:${user.id}:org:${membership.organizationId}`,
      }),
    });
    if (!limited.ok) {
      return NextResponse.json(
        {
          ok: false,
          reason: "rate_limited",
          message: "Too many requests. Please try again later.",
        },
        { status: 429 },
      );
    }

    const formData = await parseBoundedCsvImportFormData(request);
    const file = getCsvImportFile(formData);
    const intent = parseCsvImportIntent(String(formData.get("intent") ?? ""));
    const family = parseCsvImportFamily(String(formData.get("family") ?? ""));
    const bytes = new Uint8Array(await file.arrayBuffer());
    const declaredMimeType = declaredCsvMime(file);

    if (intent === "preview") {
      const result = await previewCsvImportFile({
        actor: user,
        organizationId: membership.organizationId,
        bytes,
        filename: file.name,
        declaredMimeType,
        family,
      });
      if (!result.ok) {
        return failure(result.reason, result.message);
      }
      return NextResponse.json({ ok: true, preview: result.preview });
    }

    let mapping: unknown = null;
    const mappingRaw = String(formData.get("mapping") ?? "");
    try {
      mapping = JSON.parse(mappingRaw) as unknown;
    } catch {
      return failure("invalid_mapping", "The CSV mapping contract is invalid.");
    }

    if (intent === "validate") {
      const result = await validateCsvImportMapping({
        actor: user,
        organizationId: membership.organizationId,
        bytes,
        filename: file.name,
        declaredMimeType,
        mapping,
      });
      if (!result.ok) {
        return failure(result.reason, result.message);
      }
      return NextResponse.json({
        ok: true,
        validationComplete: result.result.validationComplete,
        persistenceEligible: result.result.persistenceEligible,
        family: result.result.family,
        filename: result.result.filename,
        totalRowCount: result.result.totalRowCount,
        validRowCount: result.result.validRowCount,
        invalidRowCount: result.result.invalidRowCount,
        skippedBlankRowCount: result.result.skippedBlankRowCount,
        processedRowCount: result.result.processedRowCount,
        issueCount: result.result.issueCount,
        hasMoreIssues: result.result.hasMoreIssues,
        issues: result.result.issues,
      });
    }

    const result = await stageCsvImport({
      actor: user,
      organizationId: membership.organizationId,
      bytes,
      filename: file.name,
      declaredMimeType,
      mapping,
    });
    if (!result.ok) {
      return failure(result.reason, result.message);
    }
    return NextResponse.json({
      ok: true,
      created: result.created,
      importId: result.import.id,
      status: result.import.status,
      family: result.import.family,
      totalRowCount: result.import.totalRowCount,
      validRowCount: result.import.validRowCount,
      invalidRowCount: result.import.invalidRowCount,
      issueCount: result.import.issueCount,
    });
  } catch (error) {
    if (error instanceof CsvImportRequestError) {
      return NextResponse.json(
        { ok: false, reason: error.code, message: error.message },
        { status: error.status },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        reason: "failed",
        message: "The CSV file could not be processed.",
      },
      { status: 400 },
    );
  }
}

function failure(reason: string, message: string) {
  const status =
    reason === "unauthenticated"
      ? 401
      : reason === "forbidden" || reason === "not_found"
        ? 404
        : 400;
  return NextResponse.json({ ok: false, reason, message }, { status });
}

function declaredCsvMime(file: File): string {
  const declared = file.type.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (declared) return declared;
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "csv") return TABULAR_MIME_BY_KIND.csv;
  if (extension === "xlsx") return TABULAR_MIME_BY_KIND.xlsx;
  return declared;
}
