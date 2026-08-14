import "server-only";

import type {
  CallDispositionDefault,
  LeadStageDefault,
  OrganizationCallbackPolicy,
  OrganizationNotificationDefaults,
  OrganizationRecordingConsentPolicy,
  Prisma,
} from "@prisma/client";

import type { SafeUser } from "@/lib/auth/users";
import { recordOrganizationAuditEvent } from "@/lib/orgs/audit";
import {
  OrganizationAuthError,
  requireOrganizationPermission,
} from "@/lib/orgs/authorization";
import {
  acquireConfig3bSectionLock,
  acquireOrganizationConfig3bLock,
  ConflictError,
  dispositionsLockKey,
  leadStagesLockKey,
  mapAuthError,
  requireActiveActorInTx,
  type AuthFailure,
  type Config3bMutationTestHooks,
} from "@/lib/orgs/config-3b-access";
import {
  callbackPolicyInputSchema,
  notificationDefaultsInputSchema,
  recordingConsentPolicyInputSchema,
  replaceCallDispositionsSchema,
  replaceLeadStagesSchema,
  requireExpectedVersion,
  zodFieldErrors,
} from "@/lib/orgs/config-3b-validation";
import { prisma } from "@/lib/prisma";

export type LeadStagesResult =
  { ok: true; stages: LeadStageDefault[] } | AuthFailure;

export type CallDispositionsResult =
  { ok: true; dispositions: CallDispositionDefault[] } | AuthFailure;

export type CallbackPolicyResult =
  | { ok: true; policy: OrganizationCallbackPolicy }
  | { ok: false; reason: "not_initialized"; message: string }
  | AuthFailure;

export type RecordingConsentPolicyResult =
  | { ok: true; policy: OrganizationRecordingConsentPolicy }
  | { ok: false; reason: "not_initialized"; message: string }
  | AuthFailure;

export type NotificationDefaultsResult =
  | { ok: true; defaults: OrganizationNotificationDefaults }
  | { ok: false; reason: "not_initialized"; message: string }
  | AuthFailure;

export async function listLeadStages(input: {
  actor: SafeUser;
  organizationId: string;
}): Promise<LeadStagesResult> {
  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.config.read",
    });
    const stages = await prisma.leadStageDefault.findMany({
      where: { organizationId: input.organizationId },
      orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
    });
    return { ok: true, stages };
  } catch (error) {
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not load lead stages.",
      }
    );
  }
}

export async function replaceLeadStages(
  input: {
    actor: SafeUser;
    organizationId: string;
    raw: unknown;
  },
  hooks: Config3bMutationTestHooks = {},
): Promise<LeadStagesResult> {
  const parsed = replaceLeadStagesSchema.safeParse(input.raw);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "validation",
      message: "Please correct the lead stages.",
      fieldErrors: zodFieldErrors(parsed.error),
    };
  }

  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.config.manage",
    });

    const stages = await prisma.$transaction(async (tx) => {
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
      await acquireConfig3bSectionLock(
        tx,
        leadStagesLockKey(input.organizationId),
        hooks,
      );

      await tx.leadStageDefault.deleteMany({
        where: { organizationId: input.organizationId },
      });

      await tx.leadStageDefault.createMany({
        data: parsed.data.stages.map((stage, index) => ({
          organizationId: input.organizationId,
          key: stage.key,
          label: stage.label,
          isActive: stage.isActive,
          displayOrder: stage.displayOrder ?? index,
          classification: stage.classification,
          isDefault: stage.isDefault,
        })),
      });

      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "LEAD_STAGES_UPDATED",
        metadata: { count: parsed.data.stages.length },
      });

      return tx.leadStageDefault.findMany({
        where: { organizationId: input.organizationId },
        orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
      });
    });

    if (hooks.testAfterTransactionCommit) {
      await hooks.testAfterTransactionCommit();
    }

    return { ok: true, stages };
  } catch (error) {
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not update lead stages.",
      }
    );
  }
}

export async function listCallDispositions(input: {
  actor: SafeUser;
  organizationId: string;
}): Promise<CallDispositionsResult> {
  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.config.read",
    });
    const dispositions = await prisma.callDispositionDefault.findMany({
      where: { organizationId: input.organizationId },
      orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
    });
    return { ok: true, dispositions };
  } catch (error) {
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not load call dispositions.",
      }
    );
  }
}

export async function replaceCallDispositions(
  input: {
    actor: SafeUser;
    organizationId: string;
    raw: unknown;
  },
  hooks: Config3bMutationTestHooks = {},
): Promise<CallDispositionsResult> {
  const parsed = replaceCallDispositionsSchema.safeParse(input.raw);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "validation",
      message: "Please correct the call dispositions.",
      fieldErrors: zodFieldErrors(parsed.error),
    };
  }

  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.config.manage",
    });

    const dispositions = await prisma.$transaction(async (tx) => {
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
      await acquireConfig3bSectionLock(
        tx,
        dispositionsLockKey(input.organizationId),
        hooks,
      );

      await tx.callDispositionDefault.deleteMany({
        where: { organizationId: input.organizationId },
      });

      await tx.callDispositionDefault.createMany({
        data: parsed.data.dispositions.map((disposition, index) => ({
          organizationId: input.organizationId,
          key: disposition.key,
          label: disposition.label,
          isActive: disposition.isActive,
          displayOrder: disposition.displayOrder ?? index,
          expectsFollowUp: disposition.expectsFollowUp,
          isTerminal: disposition.isTerminal,
        })),
      });

      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "CALL_DISPOSITIONS_UPDATED",
        metadata: { count: parsed.data.dispositions.length },
      });

      return tx.callDispositionDefault.findMany({
        where: { organizationId: input.organizationId },
        orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
      });
    });

    if (hooks.testAfterTransactionCommit) {
      await hooks.testAfterTransactionCommit();
    }

    return { ok: true, dispositions };
  } catch (error) {
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not update call dispositions.",
      }
    );
  }
}

export async function getCallbackPolicy(input: {
  actor: SafeUser;
  organizationId: string;
}): Promise<CallbackPolicyResult> {
  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.config.read",
    });
    const policy = await prisma.organizationCallbackPolicy.findUnique({
      where: { organizationId: input.organizationId },
    });
    if (!policy) {
      return {
        ok: false,
        reason: "not_initialized",
        message:
          "Callback policy has not been initialized. Start configuration first.",
      };
    }
    return { ok: true, policy };
  } catch (error) {
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not load callback policy.",
      }
    );
  }
}

export async function updateCallbackPolicy(
  input: {
    actor: SafeUser;
    organizationId: string;
    raw: unknown;
    expectedVersion: number;
  },
  hooks: Config3bMutationTestHooks = {},
): Promise<CallbackPolicyResult> {
  const versionParsed = requireExpectedVersion(input.expectedVersion);
  if (!versionParsed.ok) {
    return {
      ok: false,
      reason: "validation",
      message: versionParsed.message,
      fieldErrors: { expectedVersion: [versionParsed.message] },
    };
  }

  const parsed = callbackPolicyInputSchema.safeParse(input.raw);
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

    const policy = await prisma.$transaction(async (tx) => {
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

      const exists = await tx.organizationCallbackPolicy.findUnique({
        where: { organizationId: input.organizationId },
      });
      if (!exists) {
        throw new OrganizationAuthError("organization_not_found");
      }

      const updatedCount = await tx.organizationCallbackPolicy.updateMany({
        where: {
          organizationId: input.organizationId,
          version: versionParsed.version,
        },
        data: {
          ...parsed.data,
          version: { increment: 1 },
        },
      });

      if (updatedCount.count !== 1) {
        throw new ConflictError();
      }

      const updated = await tx.organizationCallbackPolicy.findUniqueOrThrow({
        where: { organizationId: input.organizationId },
      });

      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "OPERATIONAL_DEFAULTS_UPDATED",
        metadata: { section: "callback_policy" },
      });

      return updated;
    });

    if (hooks.testAfterTransactionCommit) {
      await hooks.testAfterTransactionCommit();
    }

    return { ok: true, policy };
  } catch (error) {
    if (error instanceof ConflictError) {
      return {
        ok: false,
        reason: "conflict",
        message: "Callback policy was updated elsewhere. Reload and try again.",
      };
    }
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not update callback policy.",
      }
    );
  }
}

export async function getRecordingConsentPolicy(input: {
  actor: SafeUser;
  organizationId: string;
}): Promise<RecordingConsentPolicyResult> {
  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.config.read",
    });
    const policy = await prisma.organizationRecordingConsentPolicy.findUnique({
      where: { organizationId: input.organizationId },
    });
    if (!policy) {
      return {
        ok: false,
        reason: "not_initialized",
        message:
          "Recording consent policy has not been initialized. Start configuration first.",
      };
    }
    return { ok: true, policy };
  } catch (error) {
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not load recording consent policy.",
      }
    );
  }
}

export async function updateRecordingConsentPolicy(
  input: {
    actor: SafeUser;
    organizationId: string;
    raw: unknown;
    expectedVersion: number;
  },
  hooks: Config3bMutationTestHooks = {},
): Promise<RecordingConsentPolicyResult> {
  const versionParsed = requireExpectedVersion(input.expectedVersion);
  if (!versionParsed.ok) {
    return {
      ok: false,
      reason: "validation",
      message: versionParsed.message,
      fieldErrors: { expectedVersion: [versionParsed.message] },
    };
  }

  const parsed = recordingConsentPolicyInputSchema.safeParse(input.raw);
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

    const policy = await prisma.$transaction(async (tx) => {
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

      const exists = await tx.organizationRecordingConsentPolicy.findUnique({
        where: { organizationId: input.organizationId },
      });
      if (!exists) {
        throw new OrganizationAuthError("organization_not_found");
      }

      const updatedCount =
        await tx.organizationRecordingConsentPolicy.updateMany({
          where: {
            organizationId: input.organizationId,
            version: versionParsed.version,
          },
          data: {
            recordingEnabled: parsed.data.recordingEnabled,
            transcriptionEnabled: parsed.data.transcriptionEnabled,
            consentCaptureRequired: parsed.data.consentCaptureRequired,
            disclosureTextPlaceholder:
              parsed.data.disclosureTextPlaceholder ?? null,
            retentionDays: parsed.data.retentionDays,
            accessDefault: parsed.data.accessDefault,
            reviewRequired: parsed.data.reviewRequired,
            version: { increment: 1 },
          },
        });

      if (updatedCount.count !== 1) {
        throw new ConflictError();
      }

      const updated =
        await tx.organizationRecordingConsentPolicy.findUniqueOrThrow({
          where: { organizationId: input.organizationId },
        });

      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "OPERATIONAL_DEFAULTS_UPDATED",
        metadata: {
          section: "recording_consent",
          recordingEnabled: updated.recordingEnabled,
          transcriptionEnabled: updated.transcriptionEnabled,
        },
      });

      return updated;
    });

    if (hooks.testAfterTransactionCommit) {
      await hooks.testAfterTransactionCommit();
    }

    return { ok: true, policy };
  } catch (error) {
    if (error instanceof ConflictError) {
      return {
        ok: false,
        reason: "conflict",
        message:
          "Recording consent policy was updated elsewhere. Reload and try again.",
      };
    }
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not update recording consent policy.",
      }
    );
  }
}

export async function getNotificationDefaults(input: {
  actor: SafeUser;
  organizationId: string;
}): Promise<NotificationDefaultsResult> {
  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.config.read",
    });
    const defaults = await prisma.organizationNotificationDefaults.findUnique({
      where: { organizationId: input.organizationId },
    });
    if (!defaults) {
      return {
        ok: false,
        reason: "not_initialized",
        message:
          "Notification defaults have not been initialized. Start configuration first.",
      };
    }
    return { ok: true, defaults };
  } catch (error) {
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not load notification defaults.",
      }
    );
  }
}

export async function updateNotificationDefaults(
  input: {
    actor: SafeUser;
    organizationId: string;
    raw: unknown;
    expectedVersion: number;
  },
  hooks: Config3bMutationTestHooks = {},
): Promise<NotificationDefaultsResult> {
  const versionParsed = requireExpectedVersion(input.expectedVersion);
  if (!versionParsed.ok) {
    return {
      ok: false,
      reason: "validation",
      message: versionParsed.message,
      fieldErrors: { expectedVersion: [versionParsed.message] },
    };
  }

  const parsed = notificationDefaultsInputSchema.safeParse(input.raw);
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

    const defaults = await prisma.$transaction(async (tx) => {
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

      const exists = await tx.organizationNotificationDefaults.findUnique({
        where: { organizationId: input.organizationId },
      });
      if (!exists) {
        throw new OrganizationAuthError("organization_not_found");
      }

      const updatedCount = await tx.organizationNotificationDefaults.updateMany(
        {
          where: {
            organizationId: input.organizationId,
            version: versionParsed.version,
          },
          data: {
            escalationContactLabel: parsed.data.escalationContactLabel ?? null,
            escalationContactEmail: parsed.data.escalationContactEmail ?? null,
            notificationCategories: parsed.data
              .notificationCategories as Prisma.InputJsonValue,
            enabledChannels: parsed.data
              .enabledChannels as Prisma.InputJsonValue,
            thresholdPlaceholders: parsed.data
              .thresholdPlaceholders as Prisma.InputJsonValue,
            version: { increment: 1 },
          },
        },
      );

      if (updatedCount.count !== 1) {
        throw new ConflictError();
      }

      const updated =
        await tx.organizationNotificationDefaults.findUniqueOrThrow({
          where: { organizationId: input.organizationId },
        });

      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "OPERATIONAL_DEFAULTS_UPDATED",
        metadata: { section: "notifications" },
      });

      return updated;
    });

    if (hooks.testAfterTransactionCommit) {
      await hooks.testAfterTransactionCommit();
    }

    return { ok: true, defaults };
  } catch (error) {
    if (error instanceof ConflictError) {
      return {
        ok: false,
        reason: "conflict",
        message:
          "Notification defaults were updated elsewhere. Reload and try again.",
      };
    }
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not update notification defaults.",
      }
    );
  }
}
