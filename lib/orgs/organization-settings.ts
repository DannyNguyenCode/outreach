import "server-only";

import type { OrganizationSettings } from "@prisma/client";

import type { SafeUser } from "@/lib/auth/users";
import { recordOrganizationAuditEvent } from "@/lib/orgs/audit";
import {
  OrganizationAuthError,
  requireOrganizationPermission,
} from "@/lib/orgs/authorization";
import {
  acquireOrganizationReadinessLock,
  ConflictError,
  mapAuthError,
  requireActiveActorInTx,
  type AuthFailure,
  type ReadinessMutationTestHooks,
} from "@/lib/orgs/business-access";
import {
  employeeDefaultsSchema,
  requireExpectedVersion,
} from "@/lib/orgs/business-validation";
import { prisma } from "@/lib/prisma";

export type SettingsResult =
  | { ok: true; settings: OrganizationSettings }
  | { ok: false; reason: "not_initialized"; message: string }
  | AuthFailure;

/**
 * Read-only settings retrieval. Never creates defaults.
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
    const settings = await prisma.organizationSettings.findUnique({
      where: { organizationId: input.organizationId },
    });
    if (!settings) {
      return {
        ok: false,
        reason: "not_initialized",
        message: "Organization settings have not been initialized.",
      };
    }
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

/**
 * Settings updates take the shared readiness lock so optimistic-concurrency
 * races can be coordinated deterministically with other org writers.
 * Settings do not themselves change completion readiness.
 */
export async function updateOrganizationSettings(
  input: {
    actor: SafeUser;
    organizationId: string;
    raw: unknown;
    expectedVersion: number;
  },
  hooks: ReadinessMutationTestHooks = {},
): Promise<SettingsResult> {
  const versionParsed = requireExpectedVersion(input.expectedVersion);
  if (!versionParsed.ok) {
    return {
      ok: false,
      reason: "validation",
      message: versionParsed.message,
      fieldErrors: { expectedVersion: [versionParsed.message] },
    };
  }

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
      await acquireOrganizationReadinessLock(tx, input.organizationId, hooks);
      await requireActiveActorInTx(tx, {
        organizationId: input.organizationId,
        userId: input.actor.id,
        permission: "org.settings.manage",
      });

      const exists = await tx.organizationSettings.findUnique({
        where: { organizationId: input.organizationId },
      });
      if (!exists) {
        throw new OrganizationAuthError("organization_not_found");
      }

      const updatedCount = await tx.organizationSettings.updateMany({
        where: {
          organizationId: input.organizationId,
          version: versionParsed.version,
        },
        data: {
          membersCanViewServices: parsed.data.membersCanViewServices,
          membersCanViewProducts: parsed.data.membersCanViewProducts,
          membersCanViewBusinessInfo: parsed.data.membersCanViewBusinessInfo,
          futureCallingAccessDefault: parsed.data.futureCallingAccessDefault,
          version: { increment: 1 },
        },
      });

      if (updatedCount.count !== 1) {
        throw new ConflictError();
      }

      const updated = await tx.organizationSettings.findUniqueOrThrow({
        where: { organizationId: input.organizationId },
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
