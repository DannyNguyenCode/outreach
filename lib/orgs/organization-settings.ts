import "server-only";

import type { OrganizationSettings } from "@prisma/client";

import type { SafeUser } from "@/lib/auth/users";
import { recordOrganizationAuditEvent } from "@/lib/orgs/audit";
import {
  OrganizationAuthError,
  requireOrganizationPermission,
} from "@/lib/orgs/authorization";
import {
  ensureBusinessDefaults,
  mapAuthError,
  requireActiveActorInTx,
  type AuthFailure,
} from "@/lib/orgs/business-access";
import { employeeDefaultsSchema } from "@/lib/orgs/business-validation";
import { prisma } from "@/lib/prisma";

export type SettingsResult =
  { ok: true; settings: OrganizationSettings } | AuthFailure;

/**
 * Owners/admins may manage settings. Members cannot read employee-default
 * settings (they are organization policy, not member-facing catalogue data).
 */
export async function getOrganizationSettings(input: {
  actor: SafeUser;
  organizationId: string;
}): Promise<SettingsResult> {
  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.settings.manage",
    });
    await ensureBusinessDefaults(prisma, input.organizationId);
    const settings = await prisma.organizationSettings.findUniqueOrThrow({
      where: { organizationId: input.organizationId },
    });
    return { ok: true, settings };
  } catch (error) {
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not load organization settings.",
      }
    );
  }
}

export async function updateOrganizationSettings(input: {
  actor: SafeUser;
  organizationId: string;
  raw: unknown;
  expectedVersion?: number;
}): Promise<SettingsResult> {
  const parsed = employeeDefaultsSchema.safeParse(input.raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "membersCanViewServices");
      fieldErrors[key] ??= [];
      fieldErrors[key].push(issue.message);
    }
    return {
      ok: false,
      reason: "validation",
      message: "Please correct the highlighted fields.",
      fieldErrors,
    };
  }

  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.settings.manage",
    });

    const settings = await prisma.$transaction(async (tx) => {
      await requireActiveActorInTx(tx, {
        organizationId: input.organizationId,
        userId: input.actor.id,
        permission: "org.settings.manage",
      });
      await ensureBusinessDefaults(tx, input.organizationId);

      const current = await tx.organizationSettings.findUnique({
        where: { organizationId: input.organizationId },
      });
      if (!current) {
        throw new OrganizationAuthError("organization_not_found");
      }
      if (
        input.expectedVersion !== undefined &&
        current.version !== input.expectedVersion
      ) {
        throw new ConflictError();
      }

      const updated = await tx.organizationSettings.update({
        where: { organizationId: input.organizationId },
        data: {
          membersCanViewServices: parsed.data.membersCanViewServices,
          membersCanViewProducts: parsed.data.membersCanViewProducts,
          membersCanViewBusinessInfo: parsed.data.membersCanViewBusinessInfo,
          futureCallingAccessDefault: parsed.data.futureCallingAccessDefault,
          version: { increment: 1 },
        },
      });

      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "ORGANIZATION_SETTINGS_UPDATED",
        metadata: {
          membersCanViewServices: updated.membersCanViewServices,
          membersCanViewProducts: updated.membersCanViewProducts,
          membersCanViewBusinessInfo: updated.membersCanViewBusinessInfo,
          futureCallingAccessDefault: updated.futureCallingAccessDefault,
        },
      });

      return updated;
    });

    return { ok: true, settings };
  } catch (error) {
    if (error instanceof ConflictError) {
      return {
        ok: false,
        reason: "conflict",
        message: "Settings were updated elsewhere. Reload and try again.",
      };
    }
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not update organization settings.",
      }
    );
  }
}

class ConflictError extends Error {
  constructor() {
    super("conflict");
    this.name = "ConflictError";
  }
}
