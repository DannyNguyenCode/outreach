import "server-only";

import { Prisma, type OrganizationRole } from "@prisma/client";

import { normalizeEmail } from "@/lib/auth/email";
import { generateRawToken, hashToken } from "@/lib/auth/tokens";
import type { SafeUser } from "@/lib/auth/users";
import {
  getMailer,
  sendOrganizationInvitationEmail,
  type EmailSender,
} from "@/lib/email/mailer";
import { recordOrganizationAuditEvent } from "@/lib/orgs/audit";
import {
  OrganizationAuthError,
  requireOrganizationPermission,
} from "@/lib/orgs/authorization";
import {
  isInvitableRole,
  roleHasPermission,
  type InvitableRole,
} from "@/lib/orgs/permissions";
import { prisma } from "@/lib/prisma";

/** Invitation links expire after 7 days. */
export const ORGANIZATION_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type InvitationPublicStatus =
  "pending" | "expired" | "accepted" | "revoked";

export function invitationPublicStatus(invitation: {
  acceptedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
  now?: Date;
}): InvitationPublicStatus {
  if (invitation.acceptedAt) return "accepted";
  if (invitation.revokedAt) return "revoked";
  const now = invitation.now ?? new Date();
  if (invitation.expiresAt.getTime() <= now.getTime()) return "expired";
  return "pending";
}

/** Serializes concurrent issuers for the same organization + email. */
export function invitationIssuanceLockKey(
  organizationId: string,
  emailNormalized: string,
): string {
  return `org-invite:${organizationId}:${emailNormalized}`;
}

/**
 * Serializes terminal transitions (accept ↔ revoke) for one invitation.
 * Uses the invitation id only — never a raw token.
 */
export function invitationTerminalLockKey(invitationId: string): string {
  return `org-invite-terminal:${invitationId}`;
}

export type InvitationMutationTestHooks = {
  /**
   * Test-only seam invoked after any advisory lock is held and before the
   * authoritative transactional membership/permission recheck.
   */
  testBeforeTransactionalAuth?: () => Promise<void>;
  /**
   * Test-only seam invoked after the terminal lock is held and the invitation
   * has been reloaded as still pending, immediately before the conditional
   * terminal mutation (accept or revoke).
   */
  testBeforeTerminalMutation?: () => Promise<void>;
};

export type CreateInvitationResult =
  | {
      ok: true;
      invitationId: string;
      expiresAt: Date;
      replaced: boolean;
    }
  | {
      ok: false;
      reason:
        | "forbidden"
        | "validation"
        | "already_member"
        | "invalid_role"
        | "failed";
      message: string;
      fieldErrors?: Record<string, string[]>;
    };

/**
 * Issue (or replace) an organization invitation.
 *
 * Concurrency:
 * - `pg_advisory_xact_lock(hashtext(orgId:email))` serializes issuers
 * - Actor membership + `org.members.invite` are rechecked inside the transaction
 * - Active invitations for the same org+email are revoked, then a replacement
 *   row is created in the same transaction
 * - Partial unique index enforces at most one usable invitation per org+email
 *
 * Email is sent only after a successful commit.
 */
export async function createOrganizationInvitation(
  input: {
    actor: SafeUser;
    organizationId: string;
    email: string;
    role: OrganizationRole | string;
  },
  deps: { mailer?: EmailSender } & InvitationMutationTestHooks = {},
): Promise<CreateInvitationResult> {
  // Fast rejection only — not authoritative for the mutation.
  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.members.invite",
    });
  } catch (error) {
    if (error instanceof OrganizationAuthError) {
      return {
        ok: false,
        reason: "forbidden",
        message: "You do not have permission to invite members.",
      };
    }
    throw error;
  }

  const emailNormalized = normalizeEmail(input.email);
  if (!emailNormalized || !emailNormalized.includes("@")) {
    return {
      ok: false,
      reason: "validation",
      message: "Please correct the highlighted fields.",
      fieldErrors: { email: ["Enter a valid email address."] },
    };
  }

  if (!isInvitableRole(input.role)) {
    return {
      ok: false,
      reason: "invalid_role",
      message: "Please correct the highlighted fields.",
      fieldErrors: {
        role: ["Invitations may only assign Admin or Member."],
      },
    };
  }
  const role: InvitableRole = input.role;

  const existingMembership = await prisma.membership.findFirst({
    where: {
      organizationId: input.organizationId,
      status: "ACTIVE",
      user: { email: emailNormalized },
    },
    select: { id: true },
  });
  if (existingMembership) {
    return {
      ok: false,
      reason: "already_member",
      message: "That person is already an active member of this organization.",
      fieldErrors: { email: ["Already an active member."] },
    };
  }

  const organization = await prisma.organization.findUnique({
    where: { id: input.organizationId },
    select: { id: true, name: true, slug: true },
  });
  if (!organization) {
    return {
      ok: false,
      reason: "failed",
      message: "Unable to send the invitation. Please try again.",
    };
  }

  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + ORGANIZATION_INVITATION_TTL_MS);
  const lockKey = invitationIssuanceLockKey(
    input.organizationId,
    emailNormalized,
  );

  let invitationId = "";
  let replaced = false;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

      if (deps.testBeforeTransactionalAuth) {
        await deps.testBeforeTransactionalAuth();
      }

      const actorMembership = await tx.membership.findUnique({
        where: {
          organizationId_userId: {
            organizationId: input.organizationId,
            userId: input.actor.id,
          },
        },
      });
      if (!actorMembership || actorMembership.status !== "ACTIVE") {
        throw new OrganizationAuthError("inactive_membership");
      }
      if (!roleHasPermission(actorMembership.role, "org.members.invite")) {
        throw new OrganizationAuthError("forbidden");
      }

      const revoked = await tx.organizationInvitation.updateMany({
        where: {
          organizationId: input.organizationId,
          emailNormalized,
          acceptedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
      replaced = revoked.count > 0;

      const created = await tx.organizationInvitation.create({
        data: {
          organizationId: input.organizationId,
          emailNormalized,
          role,
          tokenHash,
          expiresAt,
          invitedByUserId: input.actor.id,
        },
        select: { id: true },
      });
      invitationId = created.id;

      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: replaced ? "INVITATION_REPLACED" : "INVITATION_CREATED",
        metadata: {
          invitationId: created.id,
          role,
          emailDomain: emailNormalized.split("@")[1] ?? null,
        },
      });
    });
  } catch (error) {
    if (error instanceof OrganizationAuthError) {
      return {
        ok: false,
        reason: "forbidden",
        message: "You do not have permission to invite members.",
      };
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return {
        ok: false,
        reason: "failed",
        message: "Unable to send the invitation. Please try again.",
      };
    }
    console.error(
      JSON.stringify({
        event: "org.invitation_create_failed",
        code:
          error instanceof Prisma.PrismaClientKnownRequestError
            ? error.code
            : "unknown",
      }),
    );
    return {
      ok: false,
      reason: "failed",
      message: "Unable to send the invitation. Please try again.",
    };
  }

  const mailer = deps.mailer ?? getMailer();
  try {
    await sendOrganizationInvitationEmail(mailer, {
      to: emailNormalized,
      organizationName: organization.name,
      role,
      expiresAt,
      rawToken,
      inviterName: input.actor.name,
    });
  } catch {
    // Invitation row exists; delivery failure is reported without leaking tokens.
    return {
      ok: false,
      reason: "failed",
      message:
        "The invitation was created but email delivery failed. You can resend it.",
    };
  }

  return { ok: true, invitationId, expiresAt, replaced };
}

export type AcceptInvitationResult =
  | {
      ok: true;
      organization: { id: string; name: string; slug: string };
      membershipId: string;
      alreadyMember: boolean;
    }
  | {
      ok: false;
      reason:
        | "unauthenticated"
        | "unverified"
        | "email_mismatch"
        | "invalid"
        | "expired"
        | "revoked"
        | "accepted"
        | "failed";
      message: string;
    };

/**
 * Intentionally accept an invitation. GET preview must never call this.
 * Role always comes from the stored invitation row — never from the client.
 */
export async function acceptOrganizationInvitation(
  input: {
    actor: SafeUser | null;
    rawToken: string;
  },
  deps: InvitationMutationTestHooks = {},
): Promise<AcceptInvitationResult> {
  if (!input.actor) {
    return {
      ok: false,
      reason: "unauthenticated",
      message: "Sign in to accept this invitation.",
    };
  }
  if (!input.actor.emailVerifiedAt) {
    return {
      ok: false,
      reason: "unverified",
      message: "Verify your email before accepting an invitation.",
    };
  }
  if (!input.rawToken || input.rawToken.length > 256) {
    return {
      ok: false,
      reason: "invalid",
      message: "This invitation link is invalid.",
    };
  }

  const tokenHash = hashToken(input.rawToken);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const invitation = await tx.organizationInvitation.findUnique({
        where: { tokenHash },
        include: {
          organization: {
            select: { id: true, name: true, slug: true },
          },
        },
      });

      if (!invitation) {
        return { kind: "invalid" as const };
      }
      if (invitation.acceptedAt) {
        const existing = await tx.membership.findUnique({
          where: {
            organizationId_userId: {
              organizationId: invitation.organizationId,
              userId: input.actor!.id,
            },
          },
        });
        if (
          existing &&
          existing.status === "ACTIVE" &&
          invitation.emailNormalized === input.actor!.email
        ) {
          return {
            kind: "already" as const,
            organization: invitation.organization,
            membershipId: existing.id,
          };
        }
        return { kind: "accepted" as const };
      }
      if (invitation.revokedAt) {
        return { kind: "revoked" as const };
      }
      if (invitation.expiresAt.getTime() <= Date.now()) {
        return { kind: "expired" as const };
      }
      if (invitation.emailNormalized !== input.actor!.email) {
        return { kind: "email_mismatch" as const };
      }

      const terminalLock = invitationTerminalLockKey(invitation.id);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${terminalLock}))`;

      if (deps.testBeforeTransactionalAuth) {
        await deps.testBeforeTransactionalAuth();
      }

      const fresh = await tx.organizationInvitation.findUnique({
        where: { id: invitation.id },
      });
      if (!fresh || fresh.acceptedAt || fresh.revokedAt) {
        const existing = await tx.membership.findUnique({
          where: {
            organizationId_userId: {
              organizationId: invitation.organizationId,
              userId: input.actor!.id,
            },
          },
        });
        if (existing?.status === "ACTIVE") {
          return {
            kind: "already" as const,
            organization: invitation.organization,
            membershipId: existing.id,
          };
        }
        return {
          kind: fresh?.acceptedAt
            ? ("accepted" as const)
            : ("revoked" as const),
        };
      }
      if (fresh.expiresAt.getTime() <= Date.now()) {
        return { kind: "expired" as const };
      }

      if (deps.testBeforeTerminalMutation) {
        await deps.testBeforeTerminalMutation();
      }

      // Claim acceptance first so a concurrent revoke cannot leave membership
      // without a matching accepted invitation (or vice versa).
      const consumed = await tx.organizationInvitation.updateMany({
        where: {
          id: invitation.id,
          organizationId: invitation.organizationId,
          acceptedAt: null,
          revokedAt: null,
        },
        data: { acceptedAt: new Date() },
      });
      if (consumed.count !== 1) {
        const after = await tx.organizationInvitation.findUnique({
          where: { id: invitation.id },
        });
        return {
          kind: after?.acceptedAt
            ? ("accepted" as const)
            : ("revoked" as const),
        };
      }

      const existingMembership = await tx.membership.findUnique({
        where: {
          organizationId_userId: {
            organizationId: invitation.organizationId,
            userId: input.actor!.id,
          },
        },
      });

      let membershipId: string;
      if (existingMembership) {
        if (existingMembership.status === "ACTIVE") {
          membershipId = existingMembership.id;
        } else {
          const reactivated = await tx.membership.update({
            where: { id: existingMembership.id },
            data: {
              status: "ACTIVE",
              role: invitation.role,
              deactivatedAt: null,
              deactivatedByUserId: null,
            },
            select: { id: true },
          });
          membershipId = reactivated.id;
        }
      } else {
        const created = await tx.membership.create({
          data: {
            organizationId: invitation.organizationId,
            userId: input.actor!.id,
            role: invitation.role,
            status: "ACTIVE",
          },
          select: { id: true },
        });
        membershipId = created.id;
      }

      await recordOrganizationAuditEvent(tx, {
        organizationId: invitation.organizationId,
        actorUserId: input.actor!.id,
        action: "INVITATION_ACCEPTED",
        metadata: {
          invitationId: invitation.id,
          role: invitation.role,
        },
      });

      await tx.user.update({
        where: { id: input.actor!.id },
        data: { activeOrganizationId: invitation.organizationId },
      });

      return {
        kind: "ok" as const,
        organization: invitation.organization,
        membershipId,
      };
    });

    if (result.kind === "ok" || result.kind === "already") {
      return {
        ok: true,
        organization: result.organization,
        membershipId: result.membershipId,
        alreadyMember: result.kind === "already",
      };
    }

    const messages: Record<string, AcceptInvitationResult> = {
      invalid: {
        ok: false,
        reason: "invalid",
        message: "This invitation link is invalid.",
      },
      expired: {
        ok: false,
        reason: "expired",
        message: "This invitation has expired.",
      },
      revoked: {
        ok: false,
        reason: "revoked",
        message: "This invitation is no longer valid.",
      },
      accepted: {
        ok: false,
        reason: "accepted",
        message: "This invitation has already been used.",
      },
      email_mismatch: {
        ok: false,
        reason: "email_mismatch",
        message:
          "Sign in with the email address that received this invitation.",
      },
    };
    return (
      messages[result.kind] ?? {
        ok: false,
        reason: "failed",
        message: "Unable to accept this invitation. Please try again.",
      }
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "org.invitation_accept_failed",
        code:
          error instanceof Prisma.PrismaClientKnownRequestError
            ? error.code
            : "unknown",
      }),
    );
    return {
      ok: false,
      reason: "failed",
      message: "Unable to accept this invitation. Please try again.",
    };
  }
}

export type PreviewInvitationResult =
  | {
      ok: true;
      status: InvitationPublicStatus;
      organizationName: string;
      role: OrganizationRole;
      expiresAt: Date;
      emailDomain: string;
    }
  | { ok: false; reason: "invalid" };

/**
 * Safe preview for GET requests. Never consumes the invitation.
 */
export async function previewOrganizationInvitation(
  rawToken: string,
): Promise<PreviewInvitationResult> {
  if (!rawToken || rawToken.length > 256) {
    return { ok: false, reason: "invalid" };
  }
  const tokenHash = hashToken(rawToken);
  const invitation = await prisma.organizationInvitation.findUnique({
    where: { tokenHash },
    select: {
      role: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      emailNormalized: true,
      organization: { select: { name: true } },
    },
  });
  if (!invitation) {
    return { ok: false, reason: "invalid" };
  }

  const domain = invitation.emailNormalized.split("@")[1] ?? "";
  return {
    ok: true,
    status: invitationPublicStatus(invitation),
    organizationName: invitation.organization.name,
    role: invitation.role,
    expiresAt: invitation.expiresAt,
    emailDomain: domain,
  };
}

export type RevokeInvitationResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "forbidden"
        | "not_found"
        | "not_pending"
        | "accepted"
        | "revoked"
        | "failed";
      message: string;
    };

/**
 * Revoke a pending invitation.
 *
 * Uses the same invitation-terminal advisory lock as acceptance and a
 * conditional update requiring `acceptedAt` and `revokedAt` remain null.
 * Actor membership + `org.invitations.revoke` are rechecked inside the txn.
 */
export async function revokeOrganizationInvitation(
  input: {
    actor: SafeUser;
    organizationId: string;
    invitationId: string;
  },
  deps: InvitationMutationTestHooks = {},
): Promise<RevokeInvitationResult> {
  // Fast rejection only — not authoritative for the mutation.
  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.invitations.revoke",
    });
  } catch (error) {
    if (error instanceof OrganizationAuthError) {
      return {
        ok: false,
        reason: "forbidden",
        message: "You do not have permission to revoke invitations.",
      };
    }
    throw error;
  }

  try {
    const outcome = await prisma.$transaction(async (tx) => {
      const terminalLock = invitationTerminalLockKey(input.invitationId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${terminalLock}))`;

      if (deps.testBeforeTransactionalAuth) {
        await deps.testBeforeTransactionalAuth();
      }

      const actorMembership = await tx.membership.findUnique({
        where: {
          organizationId_userId: {
            organizationId: input.organizationId,
            userId: input.actor.id,
          },
        },
      });
      if (!actorMembership || actorMembership.status !== "ACTIVE") {
        throw new OrganizationAuthError("inactive_membership");
      }
      if (!roleHasPermission(actorMembership.role, "org.invitations.revoke")) {
        throw new OrganizationAuthError("forbidden");
      }

      const invitation = await tx.organizationInvitation.findFirst({
        where: {
          id: input.invitationId,
          organizationId: input.organizationId,
        },
      });
      if (!invitation) {
        return { kind: "not_found" as const };
      }
      if (invitation.acceptedAt) {
        return { kind: "accepted" as const };
      }
      if (invitation.revokedAt) {
        return { kind: "revoked" as const };
      }

      if (deps.testBeforeTerminalMutation) {
        await deps.testBeforeTerminalMutation();
      }

      const revoked = await tx.organizationInvitation.updateMany({
        where: {
          id: invitation.id,
          organizationId: input.organizationId,
          acceptedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
      if (revoked.count !== 1) {
        const after = await tx.organizationInvitation.findFirst({
          where: {
            id: invitation.id,
            organizationId: input.organizationId,
          },
        });
        if (after?.acceptedAt) {
          return { kind: "accepted" as const };
        }
        if (after?.revokedAt) {
          return { kind: "revoked" as const };
        }
        return { kind: "not_pending" as const };
      }

      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "INVITATION_REVOKED",
        metadata: { invitationId: invitation.id },
      });

      return { kind: "ok" as const };
    });

    if (outcome.kind === "ok") {
      return { ok: true };
    }

    const messages: Record<string, RevokeInvitationResult> = {
      not_found: {
        ok: false,
        reason: "not_found",
        message: "Invitation not found.",
      },
      accepted: {
        ok: false,
        reason: "accepted",
        message: "This invitation has already been accepted.",
      },
      revoked: {
        ok: false,
        reason: "revoked",
        message: "This invitation has already been revoked.",
      },
      not_pending: {
        ok: false,
        reason: "not_pending",
        message: "Only pending invitations can be revoked.",
      },
    };
    return (
      messages[outcome.kind] ?? {
        ok: false,
        reason: "failed",
        message: "Unable to revoke this invitation. Please try again.",
      }
    );
  } catch (error) {
    if (error instanceof OrganizationAuthError) {
      return {
        ok: false,
        reason: "forbidden",
        message: "You do not have permission to revoke invitations.",
      };
    }
    console.error(
      JSON.stringify({
        event: "org.invitation_revoke_failed",
        code:
          error instanceof Prisma.PrismaClientKnownRequestError
            ? error.code
            : "unknown",
      }),
    );
    return {
      ok: false,
      reason: "failed",
      message: "Unable to revoke this invitation. Please try again.",
    };
  }
}

export async function listOrganizationInvitations(input: {
  actor: SafeUser;
  organizationId: string;
}) {
  await requireOrganizationPermission({
    user: input.actor,
    organizationId: input.organizationId,
    permission: "org.invitations.view",
  });

  const invitations = await prisma.organizationInvitation.findMany({
    where: { organizationId: input.organizationId },
    select: {
      id: true,
      emailNormalized: true,
      role: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return invitations.map((invitation) => ({
    id: invitation.id,
    emailNormalized: invitation.emailNormalized,
    role: invitation.role,
    expiresAt: invitation.expiresAt,
    createdAt: invitation.createdAt,
    status: invitationPublicStatus(invitation),
  }));
}
