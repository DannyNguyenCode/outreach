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
  archiveKnowledgeSource,
  confirmKnowledgeVersion,
  createManualKnowledgeSource,
  createReplacementDraft,
  restoreKnowledgeVersion,
  updateKnowledgeDraft,
} from "@/lib/orgs/knowledge";
import {
  acknowledgeDocumentDuplicateWarning,
  requestKnowledgeDocumentRetry,
  restoreKnowledgeDocumentVersion,
} from "@/lib/orgs/knowledge-documents";
import { getPrivateDocumentStorage } from "@/lib/orgs/document-runtime";
import { parseContentJson } from "@/lib/orgs/knowledge-validation";
import { prisma } from "@/lib/prisma";

function revalidateKnowledgePaths(slug: string, sourceId?: string) {
  revalidatePath(`/app/orgs/${slug}`);
  revalidatePath(`/app/orgs/${slug}/knowledge`);
  if (sourceId) {
    revalidatePath(`/app/orgs/${slug}/knowledge/${sourceId}`);
  }
}

function failureFromService(result: {
  message: string;
  fieldErrors?: Record<string, string[]>;
}): ActionState {
  return {
    status: "error",
    message: result.message,
    fieldErrors: result.fieldErrors,
  };
}

async function rateLimitOrReject(
  missingIpSalt: string,
): Promise<ActionState | null> {
  const headerStore = await headers();
  const env = getServerEnv();
  const trustedProxy =
    env.NODE_ENV === "production" || Boolean(env.AUTH_TRUST_HOST);
  const ip = resolveClientIp(headerStore, trustedProxy);

  const bucketKey = buildRateLimitBucketKey({
    route: "knowledge-update",
    emailNormalized: null,
    ip,
    missingIpSalt,
  });

  const decision = await enforceRateLimit(prisma, {
    route: "knowledge-update",
    bucketKey,
  });
  if (!decision.ok) {
    return {
      status: "rate_limited",
      message: "Too many requests. Please try again later.",
    };
  }
  return null;
}

async function resolveOrgFromForm(formData: FormData) {
  const slug = String(formData.get("organizationSlug") ?? "");
  const user = await requireVerifiedUser({
    returnTo: slug ? `/app/orgs/${slug}/knowledge` : "/app",
  });

  let membership;
  try {
    membership = await requireOrganizationMemberBySlug({ user, slug });
  } catch (error) {
    if (error instanceof OrganizationAuthError) {
      return {
        user,
        slug,
        error: {
          status: "error" as const,
          message: "You do not have access to this organization.",
        },
      };
    }
    throw error;
  }

  return { user, slug, membership, error: null };
}

async function guardMutation(formData: FormData): Promise<
  | {
      ok: true;
      user: Awaited<ReturnType<typeof requireVerifiedUser>>;
      slug: string;
      membership: NonNullable<
        Awaited<ReturnType<typeof resolveOrgFromForm>>["membership"]
      >;
    }
  | { ok: false; state: ActionState }
> {
  const resolved = await resolveOrgFromForm(formData);
  if (resolved.error || !resolved.membership) {
    return { ok: false, state: resolved.error! };
  }

  const limited = await rateLimitOrReject(
    `user:${resolved.user.id}:org:${resolved.membership.organizationId}`,
  );
  if (limited) return { ok: false, state: limited };

  return {
    ok: true,
    user: resolved.user,
    slug: resolved.slug,
    membership: resolved.membership,
  };
}

function draftPayloadFromForm(formData: FormData) {
  const parsed = parseContentJson(formData.get("contentJson"));
  const content =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  if ("_invalidJson" in content) {
    return {
      ok: false as const,
      state: {
        status: "error" as const,
        message: "Knowledge content is invalid.",
      },
    };
  }
  return {
    ok: true as const,
    raw: {
      title: String(formData.get("title") ?? content.title ?? ""),
      effectiveFrom: String(formData.get("effectiveFrom") ?? "") || null,
      effectiveUntil: String(formData.get("effectiveUntil") ?? "") || null,
      effectiveFromDisambiguation:
        String(formData.get("effectiveFromDisambiguation") ?? "") || null,
      effectiveUntilDisambiguation:
        String(formData.get("effectiveUntilDisambiguation") ?? "") || null,
      sections: content.sections,
      sourceId: String(formData.get("sourceId") ?? ""),
      versionId: String(formData.get("versionId") ?? ""),
      expectedDraftRevision: formData.get("expectedDraftRevision"),
    },
  };
}

export async function createManualKnowledgeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guarded = await guardMutation(formData);
  if (!guarded.ok) return guarded.state;

  const payload = draftPayloadFromForm(formData);
  if (!payload.ok) return payload.state;

  const result = await createManualKnowledgeSource({
    actor: guarded.user,
    organizationId: guarded.membership.organizationId,
    raw: payload.raw,
  });
  if (!result.ok) return failureFromService(result);

  revalidateKnowledgePaths(guarded.slug, result.source.id);
  return {
    status: "success",
    message: "Draft knowledge saved. Preview and confirm it to activate.",
    data: { sourceId: result.source.id, versionId: result.version.id },
  };
}

export async function updateKnowledgeDraftAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guarded = await guardMutation(formData);
  if (!guarded.ok) return guarded.state;

  const payload = draftPayloadFromForm(formData);
  if (!payload.ok) return payload.state;

  const result = await updateKnowledgeDraft({
    actor: guarded.user,
    organizationId: guarded.membership.organizationId,
    raw: payload.raw,
  });
  if (!result.ok) return failureFromService(result);

  revalidateKnowledgePaths(guarded.slug, result.version.sourceId);
  return {
    status: "success",
    message: "Draft updated. Preview the exact version before confirming.",
    data: { sourceId: result.version.sourceId, versionId: result.version.id },
  };
}

export async function confirmKnowledgeVersionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guarded = await guardMutation(formData);
  if (!guarded.ok) return guarded.state;

  const result = await confirmKnowledgeVersion({
    actor: guarded.user,
    organizationId: guarded.membership.organizationId,
    raw: {
      sourceId: String(formData.get("sourceId") ?? ""),
      versionId: String(formData.get("versionId") ?? ""),
      expectedDraftRevision: formData.get("expectedDraftRevision"),
      expectedChecksum: String(formData.get("expectedChecksum") ?? ""),
      confirmAccuracy: formData.get("confirmAccuracy"),
    },
  });
  if (!result.ok) return failureFromService(result);

  revalidateKnowledgePaths(guarded.slug, result.version.sourceId);
  return {
    status: "success",
    message: "Knowledge confirmed and activated for this organization.",
  };
}

export async function archiveKnowledgeSourceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guarded = await guardMutation(formData);
  if (!guarded.ok) return guarded.state;

  const result = await archiveKnowledgeSource({
    actor: guarded.user,
    organizationId: guarded.membership.organizationId,
    raw: {
      sourceId: String(formData.get("sourceId") ?? ""),
      expectedVersion: formData.get("expectedVersion"),
    },
  });
  if (!result.ok) return failureFromService(result);

  revalidateKnowledgePaths(guarded.slug, result.source.id);
  return {
    status: "success",
    message: "Knowledge archived. It is no longer available for retrieval.",
  };
}

export async function restoreKnowledgeVersionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guarded = await guardMutation(formData);
  if (!guarded.ok) return guarded.state;

  const result = await restoreKnowledgeVersion({
    actor: guarded.user,
    organizationId: guarded.membership.organizationId,
    raw: {
      sourceId: String(formData.get("sourceId") ?? ""),
      versionId: String(formData.get("versionId") ?? ""),
      expectedVersion: formData.get("expectedVersion"),
    },
  });
  if (!result.ok) return failureFromService(result);

  revalidateKnowledgePaths(guarded.slug, result.version.sourceId);
  return {
    status: "success",
    message: "Restored as a new draft. Preview and confirm it to activate.",
    data: { sourceId: result.version.sourceId, versionId: result.version.id },
  };
}

export async function createReplacementDraftAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guarded = await guardMutation(formData);
  if (!guarded.ok) return guarded.state;

  const result = await createReplacementDraft({
    actor: guarded.user,
    organizationId: guarded.membership.organizationId,
    raw: {
      sourceId: String(formData.get("sourceId") ?? ""),
      expectedVersion: formData.get("expectedVersion"),
    },
  });
  if (!result.ok) return failureFromService(result);

  revalidateKnowledgePaths(guarded.slug, result.version.sourceId);
  return {
    status: "success",
    message:
      "Replacement draft created. Edit, preview, then confirm to activate.",
    data: { sourceId: result.version.sourceId, versionId: result.version.id },
  };
}

export async function retryKnowledgeDocumentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guarded = await guardMutation(formData);
  if (!guarded.ok) return guarded.state;
  const result = await requestKnowledgeDocumentRetry({
    actor: guarded.user,
    organizationId: guarded.membership.organizationId,
    sourceId: String(formData.get("sourceId") ?? ""),
    versionId: String(formData.get("versionId") ?? ""),
  });
  if (!result.ok) return failureFromService(result);
  revalidateKnowledgePaths(
    guarded.slug,
    String(formData.get("sourceId") ?? ""),
  );
  return {
    status: "success",
    message: "Document processing was queued for a safe retry.",
  };
}

export async function acknowledgeDocumentDuplicateAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guarded = await guardMutation(formData);
  if (!guarded.ok) return guarded.state;
  const result = await acknowledgeDocumentDuplicateWarning({
    actor: guarded.user,
    organizationId: guarded.membership.organizationId,
    sourceId: String(formData.get("sourceId") ?? ""),
    versionId: String(formData.get("versionId") ?? ""),
  });
  if (!result.ok) return failureFromService(result);
  revalidateKnowledgePaths(
    guarded.slug,
    String(formData.get("sourceId") ?? ""),
  );
  return { status: "success", message: "Duplicate warning acknowledged." };
}

export async function restoreKnowledgeDocumentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guarded = await guardMutation(formData);
  if (!guarded.ok) return guarded.state;
  const result = await restoreKnowledgeDocumentVersion({
    actor: guarded.user,
    organizationId: guarded.membership.organizationId,
    sourceId: String(formData.get("sourceId") ?? ""),
    versionId: String(formData.get("versionId") ?? ""),
    expectedSourceVersion: Number(formData.get("expectedVersion")),
    storage: getPrivateDocumentStorage(),
  });
  if (!result.ok) return failureFromService(result);
  const sourceId = String(formData.get("sourceId") ?? "");
  revalidateKnowledgePaths(guarded.slug, sourceId);
  return {
    status: "success",
    message: "Restored as a new unconfirmed document draft.",
    data: { sourceId, versionId: result.versionId },
  };
}
