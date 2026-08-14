import "server-only";

import type { OrganizationConfigProgress, Prisma } from "@prisma/client";

import type { SafeUser } from "@/lib/auth/users";
import { recordOrganizationAuditEvent } from "@/lib/orgs/audit";
import {
  OrganizationAuthError,
  requireOrganizationPermission,
} from "@/lib/orgs/authorization";
import {
  acquireOrganizationConfig3bLock,
  ConflictError,
  initializeOrganizationConfig3bDefaults,
  mapAuthError,
  requireActiveActorInTx,
  type AuthFailure,
  type Config3bMutationTestHooks,
} from "@/lib/orgs/config-3b-access";
import {
  advanceConfigSectionSchema,
  CONFIG_SECTIONS,
  requireExpectedVersion,
  zodFieldErrors,
  type ConfigSectionValue,
} from "@/lib/orgs/config-3b-validation";
import { prisma } from "@/lib/prisma";

export type ConfigProgressView = {
  status: OrganizationConfigProgress["status"];
  currentSection: OrganizationConfigProgress["currentSection"];
  completedSections: ConfigSectionValue[];
  version: number;
  updatedByUserId: string | null;
  updatedAt: Date;
};

export type ConfigProgressResult =
  | { ok: true; progress: ConfigProgressView }
  | { ok: false; reason: "not_started"; message: string }
  | AuthFailure;

function parseCompletedSections(raw: unknown): ConfigSectionValue[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const allowed = new Set<string>(CONFIG_SECTIONS);
  const result: ConfigSectionValue[] = [];
  for (const value of raw) {
    if (typeof value === "string" && allowed.has(value)) {
      result.push(value as ConfigSectionValue);
    }
  }
  return result;
}

function toView(row: OrganizationConfigProgress): ConfigProgressView {
  return {
    status: row.status,
    currentSection: row.currentSection,
    completedSections: parseCompletedSections(row.completedSections),
    version: row.version,
    updatedByUserId: row.updatedByUserId,
    updatedAt: row.updatedAt,
  };
}

/**
 * Read-only Phase 3B config progress. Never initializes rows.
 * Independent of OrganizationOnboarding / isConfigurationReady.
 */
export async function getConfigProgress(input: {
  actor: SafeUser;
  organizationId: string;
}): Promise<ConfigProgressResult> {
  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.config.read",
    });

    const progress = await prisma.organizationConfigProgress.findUnique({
      where: { organizationId: input.organizationId },
    });
    if (!progress) {
      return {
        ok: false,
        reason: "not_started",
        message: "Configuration progress has not been started.",
      };
    }
    return { ok: true, progress: toView(progress) };
  } catch (error) {
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not load configuration progress.",
      }
    );
  }
}

/**
 * Explicit POST start for Phase 3B configuration.
 * Creates progress + locale/callback/recording/notification defaults if missing.
 * Does NOT touch OrganizationOnboarding or isConfigurationReady.
 */
export async function startConfigProgress(
  input: {
    actor: SafeUser;
    organizationId: string;
  },
  hooks: Config3bMutationTestHooks = {},
): Promise<ConfigProgressResult> {
  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.config.manage",
    });

    const progress = await prisma.$transaction(async (tx) => {
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

      await initializeOrganizationConfig3bDefaults(tx, input.organizationId);

      const existing = await tx.organizationConfigProgress.findUnique({
        where: { organizationId: input.organizationId },
      });
      if (!existing) {
        throw new OrganizationAuthError("organization_not_found");
      }

      if (existing.status === "NOT_STARTED") {
        const updated = await tx.organizationConfigProgress.update({
          where: { organizationId: input.organizationId },
          data: {
            status: "IN_PROGRESS",
            updatedByUserId: input.actor.id,
            version: { increment: 1 },
          },
        });

        await recordOrganizationAuditEvent(tx, {
          organizationId: input.organizationId,
          actorUserId: input.actor.id,
          action: "CONFIG_PROGRESS_UPDATED",
          metadata: { started: true, status: updated.status },
        });

        return updated;
      }

      return existing;
    });

    if (hooks.testAfterTransactionCommit) {
      await hooks.testAfterTransactionCommit();
    }

    return { ok: true, progress: toView(progress) };
  } catch (error) {
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not start configuration progress.",
      }
    );
  }
}

/**
 * Advance / complete a Phase 3B config section.
 * Never changes Phase 3A isConfigurationReady.
 */
export async function advanceConfigSection(
  input: {
    actor: SafeUser;
    organizationId: string;
    raw: unknown;
  },
  hooks: Config3bMutationTestHooks = {},
): Promise<ConfigProgressResult> {
  const parsed = advanceConfigSectionSchema.safeParse(input.raw);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "validation",
      message: "Please correct the highlighted fields.",
      fieldErrors: zodFieldErrors(parsed.error),
    };
  }

  const versionParsed = requireExpectedVersion(parsed.data.expectedVersion);
  if (!versionParsed.ok) {
    return {
      ok: false,
      reason: "validation",
      message: versionParsed.message,
      fieldErrors: { expectedVersion: [versionParsed.message] },
    };
  }

  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.config.manage",
    });

    const progress = await prisma.$transaction(async (tx) => {
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

      const existing = await tx.organizationConfigProgress.findUnique({
        where: { organizationId: input.organizationId },
      });
      if (!existing) {
        throw new OrganizationAuthError("organization_not_found");
      }

      const completed = new Set(
        parseCompletedSections(existing.completedSections),
      );
      if (parsed.data.markCompleted) {
        completed.add(parsed.data.section);
      }

      const nextSection =
        parsed.data.nextSection ??
        (() => {
          const index = CONFIG_SECTIONS.indexOf(parsed.data.section);
          if (index >= 0 && index < CONFIG_SECTIONS.length - 1) {
            return CONFIG_SECTIONS[index + 1]!;
          }
          return parsed.data.section;
        })();

      const reviewDone = completed.has("REVIEW");
      const nextStatus = reviewDone ? "COMPLETED" : "IN_PROGRESS";

      const updatedCount = await tx.organizationConfigProgress.updateMany({
        where: {
          organizationId: input.organizationId,
          version: versionParsed.version,
        },
        data: {
          currentSection: nextSection,
          completedSections: [...completed] as Prisma.InputJsonValue,
          status: nextStatus,
          updatedByUserId: input.actor.id,
          version: { increment: 1 },
        },
      });

      if (updatedCount.count !== 1) {
        throw new ConflictError();
      }

      const updated = await tx.organizationConfigProgress.findUniqueOrThrow({
        where: { organizationId: input.organizationId },
      });

      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "CONFIG_PROGRESS_UPDATED",
        metadata: {
          section: parsed.data.section,
          nextSection,
          status: updated.status,
        },
      });

      return updated;
    });

    if (hooks.testAfterTransactionCommit) {
      await hooks.testAfterTransactionCommit();
    }

    return { ok: true, progress: toView(progress) };
  } catch (error) {
    if (error instanceof ConflictError) {
      return {
        ok: false,
        reason: "conflict",
        message:
          "Configuration progress was updated elsewhere. Reload and try again.",
      };
    }
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not advance configuration section.",
      }
    );
  }
}
