"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import type { ActionState } from "@/app/actions/auth-state";
import {
  buildRateLimitBucketKey,
  enforceRateLimit,
  resolveClientIp,
  type RateLimitRoute,
} from "@/lib/auth/rate-limit";
import { requireVerifiedUser } from "@/lib/auth/session";
import { getServerEnv } from "@/lib/env/server";
import { setActiveOrganization } from "@/lib/orgs/active-organization";
import {
  OrganizationAuthError,
  requireOrganizationMemberBySlug,
} from "@/lib/orgs/authorization";
import {
  acceptOrganizationInvitation,
  createOrganizationInvitation,
  revokeOrganizationInvitation,
} from "@/lib/orgs/invitations";
import { changeMemberRole, deactivateMember } from "@/lib/orgs/memberships";
import { createOrganization } from "@/lib/orgs/organizations";
import {
  acceptInvitationSchema,
  changeMemberRoleSchema,
  createOrganizationSchema,
  deactivateMemberSchema,
  inviteMemberSchema,
  revokeInvitationSchema,
  selectOrganizationSchema,
} from "@/lib/orgs/validation";
import { prisma } from "@/lib/prisma";

function fieldErrorsFromZod(
  error: import("zod").ZodError,
): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key !== "string") continue;
    fieldErrors[key] ??= [];
    fieldErrors[key].push(issue.message);
  }
  return fieldErrors;
}

async function rateLimitOrReject(
  route: RateLimitRoute,
  emailNormalized: string | null,
  missingIpSalt?: string,
): Promise<ActionState | null> {
  const headerStore = await headers();
  const env = getServerEnv();
  const trustedProxy =
    env.NODE_ENV === "production" || Boolean(env.AUTH_TRUST_HOST);
  const ip = resolveClientIp(headerStore, trustedProxy);

  if (ip.kind === "missing" && !emailNormalized && !missingIpSalt) {
    return {
      status: "rate_limited",
      message: "Too many requests. Please try again later.",
    };
  }

  const bucketKey = buildRateLimitBucketKey({
    route,
    emailNormalized,
    ip,
    missingIpSalt: missingIpSalt ?? emailNormalized ?? undefined,
  });

  const decision = await enforceRateLimit(prisma, { route, bucketKey });
  if (!decision.ok) {
    return {
      status: "rate_limited",
      message: "Too many requests. Please try again later.",
    };
  }
  return null;
}

export async function createOrganizationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireVerifiedUser({
    returnTo: "/app/organizations/new",
  });

  const parsed = createOrganizationSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug") || undefined,
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Please correct the highlighted fields.",
      fieldErrors: fieldErrorsFromZod(parsed.error),
    };
  }

  const limited = await rateLimitOrReject(
    "create-organization",
    user.email,
    `user:${user.id}`,
  );
  if (limited) return limited;

  const result = await createOrganization(user, parsed.data);
  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
      fieldErrors: result.fieldErrors,
    };
  }

  revalidatePath("/app");
  redirect(`/app/orgs/${result.organization.slug}`);
}

export async function inviteMemberAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const slug = String(formData.get("organizationSlug") ?? "");
  const user = await requireVerifiedUser({
    returnTo: slug ? `/app/orgs/${slug}/members` : "/app",
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

  const parsed = inviteMemberSchema.safeParse({
    email: formData.get("email"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please correct the highlighted fields.",
      fieldErrors: fieldErrorsFromZod(parsed.error),
    };
  }

  const limited = await rateLimitOrReject(
    "invite-member",
    parsed.data.email,
    `user:${user.id}`,
  );
  if (limited) return limited;

  const result = await createOrganizationInvitation({
    actor: user,
    organizationId: membership.organizationId,
    email: parsed.data.email,
    role: parsed.data.role,
  });

  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
      fieldErrors: result.fieldErrors,
    };
  }

  revalidatePath(`/app/orgs/${slug}/members`);
  return {
    status: "success",
    message: result.replaced
      ? "Invitation replaced and sent."
      : "Invitation sent.",
  };
}

export async function revokeInvitationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const slug = String(formData.get("organizationSlug") ?? "");
  const user = await requireVerifiedUser({
    returnTo: slug ? `/app/orgs/${slug}/members` : "/app",
  });

  let membership;
  try {
    membership = await requireOrganizationMemberBySlug({ user, slug });
  } catch {
    return {
      status: "error",
      message: "You do not have access to this organization.",
    };
  }

  const parsed = revokeInvitationSchema.safeParse({
    invitationId: formData.get("invitationId"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Invalid invitation.",
    };
  }

  const result = await revokeOrganizationInvitation({
    actor: user,
    organizationId: membership.organizationId,
    invitationId: parsed.data.invitationId,
  });

  if (!result.ok) {
    return { status: "error", message: result.message };
  }

  revalidatePath(`/app/orgs/${slug}/members`);
  return { status: "success", message: "Invitation revoked." };
}

export async function changeMemberRoleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const slug = String(formData.get("organizationSlug") ?? "");
  const user = await requireVerifiedUser({
    returnTo: slug ? `/app/orgs/${slug}/members` : "/app",
  });

  let membership;
  try {
    membership = await requireOrganizationMemberBySlug({ user, slug });
  } catch {
    return {
      status: "error",
      message: "You do not have access to this organization.",
    };
  }

  const parsed = changeMemberRoleSchema.safeParse({
    membershipId: formData.get("membershipId"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please correct the highlighted fields.",
      fieldErrors: fieldErrorsFromZod(parsed.error),
    };
  }

  const result = await changeMemberRole({
    actor: user,
    organizationId: membership.organizationId,
    membershipId: parsed.data.membershipId,
    nextRole: parsed.data.role,
  });

  if (!result.ok) {
    return { status: "error", message: result.message };
  }

  revalidatePath(`/app/orgs/${slug}/members`);
  return { status: "success", message: "Role updated." };
}

export async function deactivateMemberAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const slug = String(formData.get("organizationSlug") ?? "");
  const user = await requireVerifiedUser({
    returnTo: slug ? `/app/orgs/${slug}/members` : "/app",
  });

  let membership;
  try {
    membership = await requireOrganizationMemberBySlug({ user, slug });
  } catch {
    return {
      status: "error",
      message: "You do not have access to this organization.",
    };
  }

  const parsed = deactivateMemberSchema.safeParse({
    membershipId: formData.get("membershipId"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Invalid membership.",
    };
  }

  const result = await deactivateMember({
    actor: user,
    organizationId: membership.organizationId,
    membershipId: parsed.data.membershipId,
  });

  if (!result.ok) {
    return { status: "error", message: result.message };
  }

  revalidatePath(`/app/orgs/${slug}/members`);
  return { status: "success", message: "Member offboarded." };
}

export async function selectOrganizationAction(
  formData: FormData,
): Promise<void> {
  const user = await requireVerifiedUser({ returnTo: "/app" });
  const parsed = selectOrganizationSchema.safeParse({
    organizationId: formData.get("organizationId"),
  });
  if (!parsed.success) {
    redirect("/app");
  }

  const result = await setActiveOrganization({
    user,
    organizationId: parsed.data.organizationId,
  });
  if (!result.ok) {
    redirect("/app");
  }

  revalidatePath("/app");
  redirect(`/app/orgs/${result.membership.organization.slug}`);
}

export async function acceptInvitationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = acceptInvitationSchema.safeParse({
    token: formData.get("token"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "This invitation link is invalid.",
    };
  }

  const limited = await rateLimitOrReject(
    "accept-invitation",
    null,
    `token:${parsed.data.token.slice(0, 16)}`,
  );
  if (limited) return limited;

  const user = await requireVerifiedUser({
    returnTo: `/invitations/accept?token=${encodeURIComponent(parsed.data.token)}`,
  });

  const result = await acceptOrganizationInvitation({
    actor: user,
    rawToken: parsed.data.token,
  });

  if (!result.ok) {
    if (result.reason === "unverified") {
      return { status: "unverified", message: result.message };
    }
    return { status: "error", message: result.message };
  }

  revalidatePath("/app");
  redirect(`/app/orgs/${result.organization.slug}`);
}
