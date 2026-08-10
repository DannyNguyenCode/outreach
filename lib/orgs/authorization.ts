import "server-only";

import type {
  Membership,
  Organization,
  OrganizationRole,
  Prisma,
} from "@prisma/client";

import type { SafeUser } from "@/lib/auth/users";
import {
  roleHasPermission,
  type OrganizationPermission,
} from "@/lib/orgs/permissions";
import { prisma } from "@/lib/prisma";

export type ActiveMembership = Membership & {
  organization: Organization;
};

export type OrganizationAuthErrorCode =
  | "unauthenticated"
  | "unverified"
  | "not_a_member"
  | "inactive_membership"
  | "forbidden"
  | "organization_not_found";

export class OrganizationAuthError extends Error {
  readonly code: OrganizationAuthErrorCode;

  constructor(code: OrganizationAuthErrorCode, message?: string) {
    super(message ?? code);
    this.name = "OrganizationAuthError";
    this.code = code;
  }
}

export const activeMembershipSelect = {
  id: true,
  organizationId: true,
  userId: true,
  role: true,
  status: true,
  deactivatedAt: true,
  deactivatedByUserId: true,
  createdAt: true,
  updatedAt: true,
  organization: {
    select: {
      id: true,
      name: true,
      slug: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.MembershipSelect;

export type MembershipWithOrganization = Prisma.MembershipGetPayload<{
  select: typeof activeMembershipSelect;
}>;

/**
 * Load the actor's current membership for an organization by id.
 * Always queries the database — never trust JWT/role claims for org auth.
 */
export async function findActiveMembership(input: {
  userId: string;
  organizationId: string;
}): Promise<MembershipWithOrganization | null> {
  return prisma.membership.findUnique({
    where: {
      organizationId_userId: {
        organizationId: input.organizationId,
        userId: input.userId,
      },
    },
    select: activeMembershipSelect,
  });
}

export async function findActiveMembershipBySlug(input: {
  userId: string;
  slug: string;
}): Promise<MembershipWithOrganization | null> {
  const organization = await prisma.organization.findUnique({
    where: { slug: input.slug },
    select: { id: true },
  });
  if (!organization) {
    return null;
  }
  return findActiveMembership({
    userId: input.userId,
    organizationId: organization.id,
  });
}

export async function requireOrganizationMember(input: {
  user: SafeUser;
  organizationId: string;
}): Promise<MembershipWithOrganization> {
  if (!input.user.emailVerifiedAt) {
    throw new OrganizationAuthError("unverified");
  }

  const membership = await findActiveMembership({
    userId: input.user.id,
    organizationId: input.organizationId,
  });

  if (!membership) {
    throw new OrganizationAuthError("not_a_member");
  }
  if (membership.status !== "ACTIVE") {
    throw new OrganizationAuthError("inactive_membership");
  }
  return membership;
}

export async function requireOrganizationMemberBySlug(input: {
  user: SafeUser;
  slug: string;
}): Promise<MembershipWithOrganization> {
  if (!input.user.emailVerifiedAt) {
    throw new OrganizationAuthError("unverified");
  }

  const membership = await findActiveMembershipBySlug({
    userId: input.user.id,
    slug: input.slug,
  });

  if (!membership) {
    // Do not distinguish missing org vs missing membership for cross-tenant reads.
    throw new OrganizationAuthError("not_a_member");
  }
  if (membership.status !== "ACTIVE") {
    throw new OrganizationAuthError("inactive_membership");
  }
  return membership;
}

export async function requireOrganizationPermission(input: {
  user: SafeUser;
  organizationId: string;
  permission: OrganizationPermission;
}): Promise<MembershipWithOrganization> {
  const membership = await requireOrganizationMember({
    user: input.user,
    organizationId: input.organizationId,
  });
  if (!roleHasPermission(membership.role, input.permission)) {
    throw new OrganizationAuthError("forbidden");
  }
  return membership;
}

export async function requireOrganizationRole(input: {
  user: SafeUser;
  organizationId: string;
  roles: readonly OrganizationRole[];
}): Promise<MembershipWithOrganization> {
  const membership = await requireOrganizationMember({
    user: input.user,
    organizationId: input.organizationId,
  });
  if (!input.roles.includes(membership.role)) {
    throw new OrganizationAuthError("forbidden");
  }
  return membership;
}

/**
 * Confirm a target membership belongs to the authorized organization.
 * Never mutate by client-supplied membership id alone.
 */
export async function requireScopedMembership(input: {
  organizationId: string;
  membershipId: string;
}): Promise<Membership> {
  const membership = await prisma.membership.findFirst({
    where: {
      id: input.membershipId,
      organizationId: input.organizationId,
    },
  });
  if (!membership) {
    throw new OrganizationAuthError("not_a_member");
  }
  return membership;
}

export async function requireScopedInvitation(input: {
  organizationId: string;
  invitationId: string;
}) {
  const invitation = await prisma.organizationInvitation.findFirst({
    where: {
      id: input.invitationId,
      organizationId: input.organizationId,
    },
  });
  if (!invitation) {
    throw new OrganizationAuthError("organization_not_found");
  }
  return invitation;
}
