import "server-only";

import type { SafeUser } from "@/lib/auth/users";
import { recordOrganizationAuditEvent } from "@/lib/orgs/audit";
import {
  OrganizationAuthError,
  requireOrganizationMember,
  requireOrganizationPermission,
  requireScopedMembership,
} from "@/lib/orgs/authorization";
import {
  lockMembershipByIdForUpdate,
  lockMembershipByUserForUpdate,
  type MembershipMutationTestHooks,
} from "@/lib/orgs/business-access";
import {
  canChangeMemberRole,
  canDeactivateMember,
} from "@/lib/orgs/permissions";
import { prisma } from "@/lib/prisma";
import type { OrganizationRole } from "@prisma/client";

export type ChangeRoleResult =
  | { ok: true }
  | {
      ok: false;
      reason: string;
      message: string;
    };

export type DeactivateResult =
  | { ok: true }
  | {
      ok: false;
      reason: string;
      message: string;
    };

const ROLE_CHANGE_MESSAGES: Record<string, string> = {
  forbidden: "You do not have permission to change this role.",
  cannot_change_owner: "Owner roles cannot be changed in this phase.",
  cannot_assign_owner: "Ownership cannot be assigned this way.",
  cannot_demote_admin: "Only an owner can demote an admin.",
  cannot_change_self: "You cannot change your own role.",
  noop: "The member already has that role.",
};

const DEACTIVATE_MESSAGES: Record<string, string> = {
  forbidden: "You do not have permission to offboard this member.",
  cannot_deactivate_owner:
    "The organization owner cannot be offboarded. Transfer ownership first in a later phase.",
  cannot_deactivate_self: "You cannot offboard yourself.",
  cannot_deactivate_admin: "Only an owner can offboard an admin.",
  already_inactive: "This member is already inactive.",
};

/**
 * Change a member's role within an organization.
 *
 * Lock order (deadlock prevention with Phase 3A actor membership locks):
 * 1. Target membership row `FOR UPDATE` — the contested row Phase 3A also locks
 *    when that user is the actor in a sensitive mutation.
 * 2. Actor membership row `FOR UPDATE` — authorization recheck under lock.
 */
export async function changeMemberRole(
  input: {
    actor: SafeUser;
    organizationId: string;
    membershipId: string;
    nextRole: OrganizationRole;
  },
  hooks: MembershipMutationTestHooks = {},
): Promise<ChangeRoleResult> {
  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.members.change_member_role",
    });
  } catch (error) {
    if (error instanceof OrganizationAuthError) {
      return {
        ok: false,
        reason: error.code,
        message: "You do not have permission to change this role.",
      };
    }
    throw error;
  }

  try {
    await prisma.$transaction(async (tx) => {
      const target = await lockMembershipByIdForUpdate(
        tx,
        {
          organizationId: input.organizationId,
          membershipId: input.membershipId,
        },
        hooks,
      );
      if (!target) {
        throw new OrganizationAuthError("not_a_member");
      }

      const actorMembership = await lockMembershipByUserForUpdate(tx, {
        organizationId: input.organizationId,
        userId: input.actor.id,
      });
      if (!actorMembership || actorMembership.status !== "ACTIVE") {
        throw new OrganizationAuthError("inactive_membership");
      }

      const decision = canChangeMemberRole({
        actorRole: actorMembership.role,
        actorUserId: input.actor.id,
        targetUserId: target.userId,
        targetCurrentRole: target.role,
        nextRole: input.nextRole,
      });
      if (!decision.ok) {
        const err = new Error(decision.reason) as Error & {
          code: string;
        };
        err.code = decision.reason;
        throw err;
      }

      // Protect against removing the last active owner even if policy drifts.
      if (target.role === "OWNER") {
        throw Object.assign(new Error("cannot_change_owner"), {
          code: "cannot_change_owner",
        });
      }

      await tx.membership.update({
        where: { id: target.id },
        data: { role: input.nextRole },
      });

      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "MEMBER_ROLE_CHANGED",
        metadata: {
          membershipId: target.id,
          fromRole: target.role,
          toRole: input.nextRole,
        },
      });
    });

    return { ok: true };
  } catch (error) {
    const code =
      error instanceof OrganizationAuthError
        ? error.code
        : typeof error === "object" &&
            error &&
            "code" in error &&
            typeof (error as { code: unknown }).code === "string"
          ? (error as { code: string }).code
          : "failed";
    return {
      ok: false,
      reason: code,
      message:
        ROLE_CHANGE_MESSAGES[code] ??
        "Unable to change the member role. Please try again.",
    };
  }
}

/**
 * Offboard a member by deactivating their membership.
 * Does not delete the global User or credentials. Access is revoked immediately
 * because every org authorization path re-queries membership status.
 *
 * Lock order matches {@link changeMemberRole}: target membership first, then actor.
 */
export async function deactivateMember(
  input: {
    actor: SafeUser;
    organizationId: string;
    membershipId: string;
  },
  hooks: MembershipMutationTestHooks = {},
): Promise<DeactivateResult> {
  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.members.deactivate",
    });
  } catch (error) {
    if (error instanceof OrganizationAuthError) {
      return {
        ok: false,
        reason: error.code,
        message: "You do not have permission to offboard this member.",
      };
    }
    throw error;
  }

  try {
    await prisma.$transaction(async (tx) => {
      const target = await lockMembershipByIdForUpdate(
        tx,
        {
          organizationId: input.organizationId,
          membershipId: input.membershipId,
        },
        hooks,
      );
      if (!target) {
        throw new OrganizationAuthError("not_a_member");
      }

      const actorMembership = await lockMembershipByUserForUpdate(tx, {
        organizationId: input.organizationId,
        userId: input.actor.id,
      });
      if (!actorMembership || actorMembership.status !== "ACTIVE") {
        throw new OrganizationAuthError("inactive_membership");
      }

      const decision = canDeactivateMember({
        actorRole: actorMembership.role,
        actorUserId: input.actor.id,
        targetUserId: target.userId,
        targetRole: target.role,
        targetStatus: target.status,
      });
      if (!decision.ok) {
        throw Object.assign(new Error(decision.reason), {
          code: decision.reason,
        });
      }

      // Extra guard: never deactivate the last (or any) active owner.
      if (target.role === "OWNER") {
        throw Object.assign(new Error("cannot_deactivate_owner"), {
          code: "cannot_deactivate_owner",
        });
      }

      await tx.membership.update({
        where: { id: target.id },
        data: {
          status: "INACTIVE",
          deactivatedAt: new Date(),
          deactivatedByUserId: input.actor.id,
        },
      });

      // Clear active-org preference if it pointed at this organization.
      await tx.user.updateMany({
        where: {
          id: target.userId,
          activeOrganizationId: input.organizationId,
        },
        data: { activeOrganizationId: null },
      });

      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "MEMBER_DEACTIVATED",
        metadata: {
          membershipId: target.id,
          targetRole: target.role,
        },
      });
    });

    return { ok: true };
  } catch (error) {
    const code =
      error instanceof OrganizationAuthError
        ? error.code
        : typeof error === "object" &&
            error &&
            "code" in error &&
            typeof (error as { code: unknown }).code === "string"
          ? (error as { code: string }).code
          : "failed";
    return {
      ok: false,
      reason: code,
      message:
        DEACTIVATE_MESSAGES[code] ??
        "Unable to offboard this member. Please try again.",
    };
  }
}

export async function listOrganizationMembers(input: {
  actor: SafeUser;
  organizationId: string;
}) {
  await requireOrganizationMember({
    user: input.actor,
    organizationId: input.organizationId,
  });

  const members = await prisma.membership.findMany({
    where: { organizationId: input.organizationId },
    select: {
      id: true,
      role: true,
      status: true,
      createdAt: true,
      deactivatedAt: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
    orderBy: [{ status: "asc" }, { role: "asc" }, { createdAt: "asc" }],
  });

  return members;
}

/** Re-export for callers that already validated organization scope. */
export { requireScopedMembership };
