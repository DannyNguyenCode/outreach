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
import {
  archiveOffering,
  confirmOfferingVersion,
  createOfferingDraft,
  createOfferingReplacementDraft,
  restoreOfferingVersion,
  updateOfferingDraft,
} from "@/lib/orgs/offerings";
import { parseContentJson } from "@/lib/orgs/offering-validation";
import { prisma } from "@/lib/prisma";

function revalidateOfferingPaths(slug: string, offeringId?: string) {
  revalidatePath(`/app/orgs/${slug}`);
  revalidatePath(`/app/orgs/${slug}/knowledge`);
  revalidatePath(`/app/orgs/${slug}/knowledge/offerings`);
  revalidatePath(`/app/orgs/${slug}/knowledge/offerings/compare`);
  if (offeringId) {
    revalidatePath(`/app/orgs/${slug}/knowledge/offerings/${offeringId}`);
  }
}

function serviceFailure(result: {
  message: string;
  fieldErrors?: Record<string, string[]>;
}): ActionState {
  return {
    status: "error",
    message: result.message,
    fieldErrors: result.fieldErrors,
  };
}

async function guardMutation(formData: FormData): Promise<
  | {
      ok: true;
      user: Awaited<ReturnType<typeof requireVerifiedUser>>;
      slug: string;
      organizationId: string;
    }
  | { ok: false; state: ActionState }
> {
  const slug = String(formData.get("organizationSlug") ?? "");
  const user = await requireVerifiedUser({
    returnTo: slug ? `/app/orgs/${slug}/knowledge/offerings` : "/app",
  });
  try {
    const membership = await requireOrganizationMemberBySlug({ user, slug });
    const headerStore = await headers();
    const env = getServerEnv();
    const ip = resolveClientIp(
      headerStore,
      env.NODE_ENV === "production" || Boolean(env.AUTH_TRUST_HOST),
    );
    const bucketKey = buildRateLimitBucketKey({
      route: "knowledge-update",
      emailNormalized: null,
      ip,
      missingIpSalt: `user:${user.id}:org:${membership.organizationId}:offerings`,
    });
    const decision = await enforceRateLimit(prisma, {
      route: "knowledge-update",
      bucketKey,
    });
    if (!decision.ok) {
      return {
        ok: false,
        state: {
          status: "rate_limited",
          message: "Too many requests. Please try again later.",
        },
      };
    }
    return {
      ok: true,
      user,
      slug,
      organizationId: membership.organizationId,
    };
  } catch (error) {
    if (error instanceof OrganizationAuthError) {
      return {
        ok: false,
        state: {
          status: "error",
          message: "You do not have access to this organization.",
        },
      };
    }
    throw error;
  }
}

function draftPayload(
  formData: FormData,
):
  | { ok: true; raw: Record<string, unknown> }
  | { ok: false; state: ActionState } {
  const parsed = parseContentJson(formData.get("contentJson"));
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    "_invalidJson" in parsed
  ) {
    return {
      ok: false,
      state: { status: "error", message: "Offering content is invalid." },
    };
  }
  return {
    ok: true,
    raw: {
      ...(parsed as Record<string, unknown>),
      name: String(formData.get("name") ?? ""),
      offeringType: String(formData.get("offeringType") ?? ""),
      pricingModel: String(formData.get("pricingModel") ?? ""),
      quoteRequired: formData.get("quoteRequired") === "on",
      effectiveFrom: String(formData.get("effectiveFrom") ?? "") || null,
      effectiveUntil: String(formData.get("effectiveUntil") ?? "") || null,
      effectiveFromDisambiguation:
        String(formData.get("effectiveFromDisambiguation") ?? "") || null,
      effectiveUntilDisambiguation:
        String(formData.get("effectiveUntilDisambiguation") ?? "") || null,
      offeringId: String(formData.get("offeringId") ?? ""),
      versionId: String(formData.get("versionId") ?? ""),
      expectedDraftRevision: formData.get("expectedDraftRevision"),
    },
  };
}

export async function createOfferingDraftAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guard = await guardMutation(formData);
  if (!guard.ok) return guard.state;
  const payload = draftPayload(formData);
  if (!payload.ok) return payload.state;
  const result = await createOfferingDraft({
    actor: guard.user,
    organizationId: guard.organizationId,
    raw: payload.raw,
  });
  if (!result.ok) return serviceFailure(result);
  revalidateOfferingPaths(guard.slug, result.offering.id);
  return {
    status: "success",
    message: "Offering draft saved. Preview and confirm it to activate.",
    data: { offeringId: result.offering.id, versionId: result.version.id },
  };
}

export async function updateOfferingDraftAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guard = await guardMutation(formData);
  if (!guard.ok) return guard.state;
  const payload = draftPayload(formData);
  if (!payload.ok) return payload.state;
  const result = await updateOfferingDraft({
    actor: guard.user,
    organizationId: guard.organizationId,
    raw: payload.raw,
  });
  if (!result.ok) return serviceFailure(result);
  revalidateOfferingPaths(guard.slug, result.version.offeringId);
  return {
    status: "success",
    message: "Offering draft updated.",
    data: {
      offeringId: result.version.offeringId,
      versionId: result.version.id,
    },
  };
}

export async function confirmOfferingVersionAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guard = await guardMutation(formData);
  if (!guard.ok) return guard.state;
  const result = await confirmOfferingVersion({
    actor: guard.user,
    organizationId: guard.organizationId,
    raw: {
      offeringId: String(formData.get("offeringId") ?? ""),
      versionId: String(formData.get("versionId") ?? ""),
      expectedDraftRevision: formData.get("expectedDraftRevision"),
      expectedChecksum: String(formData.get("expectedChecksum") ?? ""),
      confirmAccuracy: formData.get("confirmAccuracy"),
    },
  });
  if (!result.ok) return serviceFailure(result);
  revalidateOfferingPaths(guard.slug, result.version.offeringId);
  return {
    status: "success",
    message: "Offering confirmed and activated.",
  };
}

export async function archiveOfferingAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guard = await guardMutation(formData);
  if (!guard.ok) return guard.state;
  const result = await archiveOffering({
    actor: guard.user,
    organizationId: guard.organizationId,
    raw: {
      offeringId: String(formData.get("offeringId") ?? ""),
      expectedVersion: formData.get("expectedVersion"),
    },
  });
  if (!result.ok) return serviceFailure(result);
  revalidateOfferingPaths(guard.slug, result.offering.id);
  return {
    status: "success",
    message: "Offering archived and excluded from retrieval.",
  };
}

export async function restoreOfferingVersionAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guard = await guardMutation(formData);
  if (!guard.ok) return guard.state;
  const result = await restoreOfferingVersion({
    actor: guard.user,
    organizationId: guard.organizationId,
    raw: {
      offeringId: String(formData.get("offeringId") ?? ""),
      versionId: String(formData.get("versionId") ?? ""),
      expectedVersion: formData.get("expectedVersion"),
    },
  });
  if (!result.ok) return serviceFailure(result);
  revalidateOfferingPaths(guard.slug, result.version.offeringId);
  return {
    status: "success",
    message: "Offering restored as a new draft.",
    data: {
      offeringId: result.version.offeringId,
      versionId: result.version.id,
    },
  };
}

export async function createOfferingReplacementDraftAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guard = await guardMutation(formData);
  if (!guard.ok) return guard.state;
  const result = await createOfferingReplacementDraft({
    actor: guard.user,
    organizationId: guard.organizationId,
    raw: {
      offeringId: String(formData.get("offeringId") ?? ""),
      expectedVersion: formData.get("expectedVersion"),
    },
  });
  if (!result.ok) return serviceFailure(result);
  revalidateOfferingPaths(guard.slug, result.version.offeringId);
  return {
    status: "success",
    message: "Replacement offering draft created.",
    data: {
      offeringId: result.version.offeringId,
      versionId: result.version.id,
    },
  };
}
