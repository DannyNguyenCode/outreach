import "server-only";

import type { OrganizationLocaleSettings } from "@prisma/client";

import type { SafeUser } from "@/lib/auth/users";
import { recordOrganizationAuditEvent } from "@/lib/orgs/audit";
import {
  OrganizationAuthError,
  requireOrganizationPermission,
} from "@/lib/orgs/authorization";
import {
  acquireOrganizationConfig3bLock,
  ConflictError,
  mapAuthError,
  requireActiveActorInTx,
  type AuthFailure,
  type Config3bMutationTestHooks,
} from "@/lib/orgs/config-3b-access";
import {
  localeSettingsInputSchema,
  requireExpectedVersion,
  zodFieldErrors,
} from "@/lib/orgs/config-3b-validation";
import { prisma } from "@/lib/prisma";

export type LocaleSettingsResult =
  | { ok: true; settings: OrganizationLocaleSettings }
  | { ok: false; reason: "not_initialized"; message: string }
  | AuthFailure;

/**
 * Read-only locale settings. Never creates rows.
 * Rows are created by `startConfigProgress` / initialize defaults.
 */
export async function getLocaleSettings(input: {
  actor: SafeUser;
  organizationId: string;
}): Promise<LocaleSettingsResult> {
  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.config.read",
    });
    const settings = await prisma.organizationLocaleSettings.findUnique({
      where: { organizationId: input.organizationId },
    });
    if (!settings) {
      return {
        ok: false,
        reason: "not_initialized",
        message:
          "Locale settings have not been initialized. Start configuration first.",
      };
    }
    return { ok: true, settings };
  } catch (error) {
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not load locale settings.",
      }
    );
  }
}

/**
 * Update requires an existing row (created by startConfigProgress).
 * Never auto-initializes from GET or from this update path.
 */
export async function updateLocaleSettings(
  input: {
    actor: SafeUser;
    organizationId: string;
    raw: unknown;
    expectedVersion: number;
  },
  hooks: Config3bMutationTestHooks = {},
): Promise<LocaleSettingsResult> {
  const versionParsed = requireExpectedVersion(input.expectedVersion);
  if (!versionParsed.ok) {
    return {
      ok: false,
      reason: "validation",
      message: versionParsed.message,
      fieldErrors: { expectedVersion: [versionParsed.message] },
    };
  }

  const parsed = localeSettingsInputSchema.safeParse(input.raw);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "validation",
      message: "Please correct the highlighted fields.",
      fieldErrors: zodFieldErrors(parsed.error),
    };
  }

  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.config.manage",
    });

    const settings = await prisma.$transaction(async (tx) => {
      await acquireOrganizationConfig3bLock(tx, input.organizationId, hooks);
      await requireActiveActorInTx(
        tx,
        {
          organizationId: input.organizationId,
          userId: input.actor.id,
          permission: "org.config.manage",
        },
        hooks,
      );

      const exists = await tx.organizationLocaleSettings.findUnique({
        where: { organizationId: input.organizationId },
      });
      if (!exists) {
        throw new OrganizationAuthError("organization_not_found");
      }

      const updatedCount = await tx.organizationLocaleSettings.updateMany({
        where: {
          organizationId: input.organizationId,
          version: versionParsed.version,
        },
        data: {
          locale: parsed.data.locale,
          defaultLanguage: parsed.data.defaultLanguage,
          dateDisplayPreference: parsed.data.dateDisplayPreference,
          timeDisplayPreference: parsed.data.timeDisplayPreference,
          numberDisplayPreference: parsed.data.numberDisplayPreference,
          version: { increment: 1 },
        },
      });

      if (updatedCount.count !== 1) {
        throw new ConflictError();
      }

      const updated = await tx.organizationLocaleSettings.findUniqueOrThrow({
        where: { organizationId: input.organizationId },
      });

      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "ORGANIZATION_LOCALE_UPDATED",
        metadata: {
          locale: updated.locale,
          defaultLanguage: updated.defaultLanguage,
        },
      });

      return updated;
    });

    if (hooks.testAfterTransactionCommit) {
      await hooks.testAfterTransactionCommit();
    }

    return { ok: true, settings };
  } catch (error) {
    if (error instanceof ConflictError) {
      return {
        ok: false,
        reason: "conflict",
        message:
          "Locale settings were updated elsewhere. Reload and try again.",
      };
    }
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not update locale settings.",
      }
    );
  }
}
