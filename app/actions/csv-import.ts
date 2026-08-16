"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import type { ActionState } from "@/app/actions/auth-state";
import {
  buildRateLimitBucketKey,
  enforceRateLimit,
  resolveClientIp,
} from "@/lib/auth/rate-limit";
import { requireVerifiedUser } from "@/lib/auth/session";
import { getServerEnv } from "@/lib/env/server";
import {
  OrganizationAuthError,
  requireOrganizationMemberBySlug,
} from "@/lib/orgs/authorization";
import { confirmCsvImport } from "@/lib/orgs/csv-import-activation";
import { prisma } from "@/lib/prisma";

function revalidateCsvImportPaths(slug: string, importId?: string) {
  revalidatePath(`/app/orgs/${slug}/knowledge`);
  revalidatePath(`/app/orgs/${slug}/knowledge/import`);
  revalidatePath(`/app/orgs/${slug}/knowledge/offerings`);
  if (importId) {
    revalidatePath(`/app/orgs/${slug}/knowledge/import/${importId}`);
  }
}

async function rateLimitOrReject(
  missingIpSalt: string,
): Promise<ActionState | null> {
  const headerStore = await headers();
  const env = getServerEnv();
  const trustedProxy =
    env.NODE_ENV === "production" || Boolean(env.AUTH_TRUST_HOST);
  const ip = resolveClientIp(headerStore, trustedProxy);
  const decision = await enforceRateLimit(prisma, {
    route: "csv-import",
    bucketKey: buildRateLimitBucketKey({
      route: "csv-import",
      emailNormalized: null,
      ip,
      missingIpSalt,
    }),
  });
  if (!decision.ok) {
    return {
      status: "rate_limited",
      message: "Too many requests. Please try again later.",
    };
  }
  return null;
}

export async function confirmCsvImportAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const slug = String(formData.get("organizationSlug") ?? "");
  const user = await requireVerifiedUser({
    returnTo: slug ? `/app/orgs/${slug}/knowledge/import` : "/app",
  });

  let membership;
  try {
    membership = await requireOrganizationMemberBySlug({ user, slug });
  } catch (error) {
    if (error instanceof OrganizationAuthError) {
      return {
        status: "error",
        message: "You do not have access to this organization.",
      };
    }
    throw error;
  }

  const limited = await rateLimitOrReject(
    `user:${user.id}:org:${membership.organizationId}`,
  );
  if (limited) return limited;

  const importId = String(formData.get("importId") ?? "");
  const expectedImportIdentity = String(
    formData.get("expectedImportIdentity") ?? "",
  );
  const acknowledged =
    String(formData.get("acknowledgeAccuracy") ?? "") === "on";

  const result = await confirmCsvImport({
    actor: user,
    organizationId: membership.organizationId,
    importId,
    expectedImportIdentity,
    acknowledged,
  });
  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
      fieldErrors: result.fieldErrors,
    };
  }

  revalidateCsvImportPaths(slug, importId);
  return {
    status: "success",
    message: result.created
      ? "The CSV import was confirmed and activated."
      : "This CSV import was already confirmed. The original activation result is unchanged.",
    data: {
      confirmationId: result.confirmation.id,
      created: result.created,
      createdRowCount: result.confirmation.createdRowCount,
      family: result.confirmation.family,
    },
  };
}
