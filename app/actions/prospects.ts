"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

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
import { mergeProspects } from "@/lib/orgs/prospect-merge";
import {
  addProspectChannel,
  addProspectContact,
  archiveProspect,
  createProspect,
  restoreProspect,
  updateProspect,
  updateProspectContact,
} from "@/lib/orgs/prospects";
import { prisma } from "@/lib/prisma";

function revalidateProspectPaths(slug: string, prospectId?: string) {
  revalidatePath(`/app/orgs/${slug}`);
  revalidatePath(`/app/orgs/${slug}/prospects`);
  if (prospectId) {
    revalidatePath(`/app/orgs/${slug}/prospects/${prospectId}`);
    revalidatePath(`/app/orgs/${slug}/prospects/${prospectId}/edit`);
    revalidatePath(`/app/orgs/${slug}/prospects/${prospectId}/merge`);
  }
}

function parseJsonObject(raw: FormDataEntryValue | null): unknown {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    return { __invalidJson: true };
  }
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
    returnTo: slug ? `/app/orgs/${slug}/prospects` : "/app",
  });
  try {
    const membership = await requireOrganizationMemberBySlug({ user, slug });
    const headerStore = await headers();
    const env = getServerEnv();
    const ip = resolveClientIp(
      headerStore,
      env.NODE_ENV === "production" || Boolean(env.AUTH_TRUST_HOST),
    );
    const decision = await enforceRateLimit(prisma, {
      route: "prospect-update",
      bucketKey: buildRateLimitBucketKey({
        route: "prospect-update",
        emailNormalized: null,
        ip,
        missingIpSalt: `user:${user.id}:org:${membership.organizationId}:prospects`,
      }),
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

export async function createProspectAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guarded = await guardMutation(formData);
  if (!guarded.ok) return guarded.state;
  const payload = parseJsonObject(formData.get("payload"));
  if (payload && typeof payload === "object" && "__invalidJson" in payload) {
    return {
      status: "error",
      message: "The form could not be read. Try again.",
    };
  }
  const result = await createProspect({
    actor: guarded.user,
    organizationId: guarded.organizationId,
    raw: payload,
  });
  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
      fieldErrors: result.fieldErrors,
      data:
        result.reason === "duplicate_candidates"
          ? { candidates: result.candidates }
          : undefined,
    };
  }
  revalidateProspectPaths(guarded.slug, result.prospectId);
  redirect(`/app/orgs/${guarded.slug}/prospects/${result.prospectId}`);
}

export async function updateProspectAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guarded = await guardMutation(formData);
  if (!guarded.ok) return guarded.state;
  const prospectId = String(formData.get("prospectId") ?? "");
  const payload = parseJsonObject(formData.get("payload"));
  const result = await updateProspect({
    actor: guarded.user,
    organizationId: guarded.organizationId,
    prospectId,
    raw: {
      ...(typeof payload === "object" && payload ? payload : {}),
      expectedVersion: formData.get("expectedVersion"),
    },
  });
  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
      fieldErrors: result.fieldErrors,
    };
  }
  revalidateProspectPaths(guarded.slug, prospectId);
  redirect(`/app/orgs/${guarded.slug}/prospects/${prospectId}`);
}

export async function archiveProspectAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guarded = await guardMutation(formData);
  if (!guarded.ok) return guarded.state;
  const prospectId = String(formData.get("prospectId") ?? "");
  const result = await archiveProspect({
    actor: guarded.user,
    organizationId: guarded.organizationId,
    prospectId,
    expectedVersion: formData.get("expectedVersion"),
  });
  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
      fieldErrors: result.fieldErrors,
    };
  }
  revalidateProspectPaths(guarded.slug, prospectId);
  redirect(`/app/orgs/${guarded.slug}/prospects/${prospectId}`);
}

export async function restoreProspectAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guarded = await guardMutation(formData);
  if (!guarded.ok) return guarded.state;
  const prospectId = String(formData.get("prospectId") ?? "");
  const result = await restoreProspect({
    actor: guarded.user,
    organizationId: guarded.organizationId,
    prospectId,
    expectedVersion: formData.get("expectedVersion"),
  });
  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
      fieldErrors: result.fieldErrors,
    };
  }
  revalidateProspectPaths(guarded.slug, prospectId);
  redirect(`/app/orgs/${guarded.slug}/prospects/${prospectId}`);
}

export async function addProspectContactAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guarded = await guardMutation(formData);
  if (!guarded.ok) return guarded.state;
  const prospectId = String(formData.get("prospectId") ?? "");
  const payload = parseJsonObject(formData.get("payload"));
  const result = await addProspectContact({
    actor: guarded.user,
    organizationId: guarded.organizationId,
    prospectId,
    expectedVersion: formData.get("expectedVersion"),
    raw: payload,
  });
  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
      fieldErrors: result.fieldErrors,
    };
  }
  revalidateProspectPaths(guarded.slug, prospectId);
  return { status: "success", message: "Contact added." };
}

export async function updateProspectContactAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guarded = await guardMutation(formData);
  if (!guarded.ok) return guarded.state;
  const prospectId = String(formData.get("prospectId") ?? "");
  const contactId = String(formData.get("contactId") ?? "");
  const payload = parseJsonObject(formData.get("payload"));
  const result = await updateProspectContact({
    actor: guarded.user,
    organizationId: guarded.organizationId,
    prospectId,
    contactId,
    raw: {
      ...(typeof payload === "object" && payload ? payload : {}),
      expectedVersion: formData.get("expectedVersion"),
    },
  });
  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
      fieldErrors: result.fieldErrors,
    };
  }
  revalidateProspectPaths(guarded.slug, prospectId);
  return { status: "success", message: "Contact updated." };
}

export async function addProspectChannelAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guarded = await guardMutation(formData);
  if (!guarded.ok) return guarded.state;
  const prospectId = String(formData.get("prospectId") ?? "");
  const contactId = String(formData.get("contactId") ?? "");
  const payload = parseJsonObject(formData.get("payload"));
  const result = await addProspectChannel({
    actor: guarded.user,
    organizationId: guarded.organizationId,
    prospectId,
    contactId: contactId.length > 0 ? contactId : undefined,
    expectedVersion: formData.get("expectedVersion"),
    raw: payload,
  });
  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
      fieldErrors: result.fieldErrors,
    };
  }
  revalidateProspectPaths(guarded.slug, prospectId);
  return { status: "success", message: "Communication point added." };
}

export async function mergeProspectsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guarded = await guardMutation(formData);
  if (!guarded.ok) return guarded.state;
  const survivorProspectId = String(formData.get("survivorProspectId") ?? "");
  const duplicateProspectId = String(formData.get("duplicateProspectId") ?? "");
  const resolutions = parseJsonObject(formData.get("resolutions"));
  const confirmed = formData.get("confirmMerge") === "on";
  if (!confirmed) {
    return {
      status: "error",
      message: "Confirm the merge before continuing.",
    };
  }
  const result = await mergeProspects({
    actor: guarded.user,
    organizationId: guarded.organizationId,
    survivorProspectId,
    duplicateProspectId,
    expectedSurvivorVersion: formData.get("expectedSurvivorVersion"),
    expectedDuplicateVersion: formData.get("expectedDuplicateVersion"),
    resolutions,
  });
  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
      fieldErrors: result.fieldErrors,
    };
  }
  revalidateProspectPaths(guarded.slug, result.survivorProspectId);
  revalidateProspectPaths(guarded.slug, duplicateProspectId);
  redirect(`/app/orgs/${guarded.slug}/prospects/${result.survivorProspectId}`);
}
