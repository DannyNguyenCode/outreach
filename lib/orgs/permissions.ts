import type { OrganizationRole } from "@prisma/client";

/**
 * Centralized organization permission policy (Phase 2 + Phase 3A + Phase 3B + Phase 4A).
 * UI visibility is not authorization — every mutation must call these helpers.
 *
 * Phase 3A employee-default settings may further restrict MEMBER reads for
 * business info / catalogues. Settings never grant manage permissions.
 *
 * Phase 3B: OWNER/ADMIN get org.config.* and org.templates.*; MEMBER gets
 * org.config.read and org.templates.read only.
 *
 * Phase 4A: OWNER/ADMIN get org.knowledge.manage / confirm / archive.
 * MEMBER gets org.knowledge.read (active confirmed knowledge only).
 */

export type OrganizationPermission =
  | "org.view"
  | "org.members.view"
  | "org.members.invite"
  | "org.invitations.revoke"
  | "org.invitations.view"
  | "org.members.change_member_role"
  | "org.members.promote_admin"
  | "org.members.demote_admin"
  | "org.members.deactivate"
  | "org.owner.manage"
  | "org.business.read"
  | "org.business.update"
  | "org.hours.read"
  | "org.hours.update"
  | "org.services.read"
  | "org.services.manage"
  | "org.products.read"
  | "org.products.manage"
  | "org.onboarding.view"
  | "org.onboarding.manage"
  | "org.onboarding.complete"
  | "org.onboarding.reopen"
  | "org.settings.manage"
  | "org.config.read"
  | "org.config.manage"
  | "org.templates.read"
  | "org.templates.manage"
  | "org.knowledge.read"
  | "org.knowledge.manage"
  | "org.knowledge.confirm"
  | "org.knowledge.archive";

const ROLE_PERMISSIONS: Record<
  OrganizationRole,
  ReadonlySet<OrganizationPermission>
> = {
  OWNER: new Set([
    "org.view",
    "org.members.view",
    "org.members.invite",
    "org.invitations.revoke",
    "org.invitations.view",
    "org.members.change_member_role",
    "org.members.promote_admin",
    "org.members.demote_admin",
    "org.members.deactivate",
    "org.owner.manage",
    "org.business.read",
    "org.business.update",
    "org.hours.read",
    "org.hours.update",
    "org.services.read",
    "org.services.manage",
    "org.products.read",
    "org.products.manage",
    "org.onboarding.view",
    "org.onboarding.manage",
    "org.onboarding.complete",
    "org.onboarding.reopen",
    "org.settings.manage",
    "org.config.read",
    "org.config.manage",
    "org.templates.read",
    "org.templates.manage",
    "org.knowledge.read",
    "org.knowledge.manage",
    "org.knowledge.confirm",
    "org.knowledge.archive",
  ]),
  ADMIN: new Set([
    "org.view",
    "org.members.view",
    "org.members.invite",
    "org.invitations.revoke",
    "org.invitations.view",
    "org.members.change_member_role",
    "org.members.promote_admin",
    // Demoting an admin is conditional — see canChangeMemberRole.
    "org.members.deactivate",
    "org.business.read",
    "org.business.update",
    "org.hours.read",
    "org.hours.update",
    "org.services.read",
    "org.services.manage",
    "org.products.read",
    "org.products.manage",
    "org.onboarding.view",
    "org.onboarding.manage",
    "org.onboarding.complete",
    "org.onboarding.reopen",
    "org.settings.manage",
    "org.config.read",
    "org.config.manage",
    "org.templates.read",
    "org.templates.manage",
    "org.knowledge.read",
    "org.knowledge.manage",
    "org.knowledge.confirm",
    "org.knowledge.archive",
  ]),
  MEMBER: new Set([
    "org.view",
    "org.members.view",
    "org.business.read",
    "org.hours.read",
    "org.services.read",
    "org.products.read",
    "org.config.read",
    "org.templates.read",
    "org.knowledge.read",
  ]),
};

export function roleHasPermission(
  role: OrganizationRole,
  permission: OrganizationPermission,
): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export type RoleChangeDecision =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "forbidden"
        | "cannot_change_owner"
        | "cannot_assign_owner"
        | "cannot_demote_admin"
        | "cannot_change_self"
        | "noop";
    };

/**
 * Whether an actor may change a target membership's role.
 *
 * Ownership transfer is deferred; OWNER cannot be assigned or changed here.
 * Admins may change MEMBER roles and promote MEMBER→ADMIN, but cannot demote
 * other ADMINs (only OWNER may demote ADMIN→MEMBER).
 */
export function canChangeMemberRole(input: {
  actorRole: OrganizationRole;
  actorUserId: string;
  targetUserId: string;
  targetCurrentRole: OrganizationRole;
  nextRole: OrganizationRole;
}): RoleChangeDecision {
  if (input.actorUserId === input.targetUserId) {
    return { ok: false, reason: "cannot_change_self" };
  }
  if (input.targetCurrentRole === input.nextRole) {
    return { ok: false, reason: "noop" };
  }
  if (input.nextRole === "OWNER" || input.targetCurrentRole === "OWNER") {
    return {
      ok: false,
      reason:
        input.nextRole === "OWNER"
          ? "cannot_assign_owner"
          : "cannot_change_owner",
    };
  }

  if (input.actorRole === "OWNER") {
    if (!roleHasPermission(input.actorRole, "org.members.change_member_role")) {
      return { ok: false, reason: "forbidden" };
    }
    return { ok: true };
  }

  if (input.actorRole === "ADMIN") {
    if (input.targetCurrentRole === "ADMIN") {
      return { ok: false, reason: "cannot_demote_admin" };
    }
    if (input.nextRole === "ADMIN") {
      return roleHasPermission(input.actorRole, "org.members.promote_admin")
        ? { ok: true }
        : { ok: false, reason: "forbidden" };
    }
    if (input.nextRole === "MEMBER") {
      return roleHasPermission(
        input.actorRole,
        "org.members.change_member_role",
      )
        ? { ok: true }
        : { ok: false, reason: "forbidden" };
    }
    return { ok: false, reason: "forbidden" };
  }

  return { ok: false, reason: "forbidden" };
}

export type DeactivateDecision =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "forbidden"
        | "cannot_deactivate_owner"
        | "cannot_deactivate_self"
        | "cannot_deactivate_admin"
        | "already_inactive";
    };

/**
 * Whether an actor may deactivate (offboard) a target membership.
 * Owners cannot be offboarded in Phase 2 (no ownership transfer).
 */
export function canDeactivateMember(input: {
  actorRole: OrganizationRole;
  actorUserId: string;
  targetUserId: string;
  targetRole: OrganizationRole;
  targetStatus: "ACTIVE" | "INACTIVE";
}): DeactivateDecision {
  if (input.targetStatus === "INACTIVE") {
    return { ok: false, reason: "already_inactive" };
  }
  if (input.actorUserId === input.targetUserId) {
    return { ok: false, reason: "cannot_deactivate_self" };
  }
  if (input.targetRole === "OWNER") {
    return { ok: false, reason: "cannot_deactivate_owner" };
  }
  if (!roleHasPermission(input.actorRole, "org.members.deactivate")) {
    return { ok: false, reason: "forbidden" };
  }
  if (input.actorRole === "ADMIN" && input.targetRole === "ADMIN") {
    return { ok: false, reason: "cannot_deactivate_admin" };
  }
  return { ok: true };
}

/** Roles that may be assigned via invitation (never OWNER). */
export const INVITABLE_ROLES = ["ADMIN", "MEMBER"] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export function isInvitableRole(role: string): role is InvitableRole {
  return (INVITABLE_ROLES as readonly string[]).includes(role);
}
