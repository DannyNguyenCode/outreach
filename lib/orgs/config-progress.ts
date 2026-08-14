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
  callbackPolicyInputSchema,
  callDispositionItemSchema,
  CONFIG_SECTIONS,
  leadStageItemSchema,
  localeSettingsInputSchema,
  notificationDefaultsInputSchema,
  recordingConsentPolicyInputSchema,
  requireExpectedVersion,
  zodFieldErrors,
  type ConfigSectionValue,
} from "@/lib/orgs/config-3b-validation";
import { getApplicableConfigSections } from "@/lib/orgs/business-templates-registry";
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
  const present = new Set(
    raw.filter(
      (value): value is ConfigSectionValue =>
        typeof value === "string" && allowed.has(value),
    ),
  );
  return CONFIG_SECTIONS.filter((section) => present.has(section));
}

class ProgressValidationError extends Error {
  constructor(
    message: string,
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "ProgressValidationError";
  }
}

const finishMessage = (section: ConfigSectionValue) =>
  `Finish the required ${section.toLowerCase().replaceAll("_", " ")} section before continuing.`;

function rawCompletedSections(raw: unknown): ConfigSectionValue[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (value): value is ConfigSectionValue =>
      typeof value === "string" &&
      CONFIG_SECTIONS.includes(value as ConfigSectionValue),
  );
}

function arraysEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

async function validateSectionRequirements(
  tx: Prisma.TransactionClient,
  organizationId: string,
  section: ConfigSectionValue,
  completedSections: ConfigSectionValue[],
  applicableSections: ConfigSectionValue[],
): Promise<void> {
  let valid = true;

  switch (section) {
    case "BUSINESS_TEMPLATE":
      valid = Boolean(
        await tx.organizationTemplateAssignment.findUnique({
          where: { organizationId },
          select: { id: true },
        }),
      );
      break;
    case "LOCALE": {
      const row = await tx.organizationLocaleSettings.findUnique({
        where: { organizationId },
      });
      valid =
        row !== null &&
        localeSettingsInputSchema.safeParse({
          locale: row.locale,
          defaultLanguage: row.defaultLanguage,
          dateDisplayPreference: row.dateDisplayPreference,
          timeDisplayPreference: row.timeDisplayPreference,
          numberDisplayPreference: row.numberDisplayPreference,
        }).success;
      break;
    }
    case "LEAD_STAGES": {
      const rows = await tx.leadStageDefault.findMany({
        where: { organizationId },
        orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
      });
      valid =
        rows.filter((row) => row.isActive).length > 0 &&
        rows.filter((row) => row.isActive && row.isDefault).length === 1 &&
        rows.every(
          (row) =>
            leadStageItemSchema.safeParse({
              key: row.key,
              label: row.label,
              isActive: row.isActive,
              displayOrder: row.displayOrder,
              classification: row.classification,
              isDefault: row.isDefault,
            }).success,
        );
      break;
    }
    case "CALL_DISPOSITIONS": {
      const rows = await tx.callDispositionDefault.findMany({
        where: { organizationId },
        orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
      });
      valid =
        rows.some((row) => row.isActive) &&
        rows.every(
          (row) =>
            callDispositionItemSchema.safeParse({
              key: row.key,
              label: row.label,
              isActive: row.isActive,
              displayOrder: row.displayOrder,
              expectsFollowUp: row.expectsFollowUp,
              isTerminal: row.isTerminal,
            }).success,
        );
      break;
    }
    case "CALLBACK_POLICY": {
      const row = await tx.organizationCallbackPolicy.findUnique({
        where: { organizationId },
      });
      valid =
        row !== null &&
        callbackPolicyInputSchema.safeParse({
          defaultWindowMinutes: row.defaultWindowMinutes,
          maxSuggestedAttempts: row.maxSuggestedAttempts,
          minSpacingMinutes: row.minSpacingMinutes,
          businessHoursOnly: row.businessHoursOnly,
          defaultAssignmentBehavior: row.defaultAssignmentBehavior,
        }).success;
      break;
    }
    case "RECORDING_CONSENT": {
      const row = await tx.organizationRecordingConsentPolicy.findUnique({
        where: { organizationId },
      });
      valid =
        row !== null &&
        recordingConsentPolicyInputSchema.safeParse({
          recordingEnabled: row.recordingEnabled,
          transcriptionEnabled: row.transcriptionEnabled,
          consentCaptureRequired: row.consentCaptureRequired,
          disclosureTextPlaceholder: row.disclosureTextPlaceholder,
          retentionDays: row.retentionDays,
          accessDefault: row.accessDefault,
          reviewRequired: row.reviewRequired,
        }).success;
      break;
    }
    case "NOTIFICATIONS": {
      const row = await tx.organizationNotificationDefaults.findUnique({
        where: { organizationId },
      });
      valid =
        row !== null &&
        notificationDefaultsInputSchema.safeParse({
          escalationContactLabel: row.escalationContactLabel,
          escalationContactEmail: row.escalationContactEmail,
          notificationCategories: row.notificationCategories,
          enabledChannels: row.enabledChannels,
          thresholdPlaceholders: row.thresholdPlaceholders,
        }).success;
      break;
    }
    case "REVIEW":
      valid = arraysEqual(completedSections, applicableSections.slice(0, -1));
      break;
    case "SERVICE_AREAS":
    case "AVAILABILITY":
    case "CUSTOM_FIELDS":
      // Submitting the current section is the explicit empty confirmation.
      valid = true;
      break;
  }

  if (!valid) {
    throw new ProgressValidationError(finishMessage(section), {
      section: [finishMessage(section)],
    });
  }
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

      // Check OCC before lifecycle validation so a repeated final submission
      // with its stale form version is always a conflict and never a duplicate.
      if (existing.version !== versionParsed.version) {
        throw new ConflictError();
      }

      if (
        existing.status !== "IN_PROGRESS" ||
        parsed.data.section !== existing.currentSection
      ) {
        throw new ProgressValidationError(
          existing.status === "COMPLETED"
            ? "Configuration is already complete."
            : "Only the current configuration section can be completed.",
          {
            section: [
              existing.status === "COMPLETED"
                ? "Configuration is already complete."
                : `Current section is ${existing.currentSection}.`,
            ],
          },
        );
      }

      const assignment = await tx.organizationTemplateAssignment.findUnique({
        where: { organizationId: input.organizationId },
        select: { templateKey: true },
      });
      const applicableSections = assignment
        ? getApplicableConfigSections(assignment.templateKey)
        : (["BUSINESS_TEMPLATE"] satisfies ConfigSectionValue[]);

      if (!applicableSections.includes(existing.currentSection)) {
        throw new ProgressValidationError(
          "The persisted configuration section is not applicable to the selected template.",
        );
      }

      const currentIndex = applicableSections.indexOf(existing.currentSection);
      const persistedCompleted = rawCompletedSections(
        existing.completedSections,
      );
      const expectedCompleted = applicableSections.slice(0, currentIndex);
      if (!arraysEqual(persistedCompleted, expectedCompleted)) {
        throw new ProgressValidationError(
          "Configuration progress is inconsistent. Reload and finish sections in order.",
        );
      }

      await validateSectionRequirements(
        tx,
        input.organizationId,
        parsed.data.section,
        persistedCompleted,
        applicableSections,
      );
      if (hooks.testAfterProgressRequirements) {
        await hooks.testAfterProgressRequirements();
      }

      const completed = [...expectedCompleted, parsed.data.section];
      const isFinal = parsed.data.section === "REVIEW";
      const nextSection = isFinal
        ? "REVIEW"
        : applicableSections[currentIndex + 1];
      if (!nextSection) {
        throw new ProgressValidationError(
          "Configuration progress has no valid next section.",
        );
      }
      const nextStatus = isFinal ? "COMPLETED" : "IN_PROGRESS";
      const canonicalCurrentIndex = CONFIG_SECTIONS.indexOf(
        parsed.data.section,
      );
      const canonicalNextIndex = CONFIG_SECTIONS.indexOf(nextSection);
      const skippedSections = CONFIG_SECTIONS.slice(
        canonicalCurrentIndex + 1,
        canonicalNextIndex,
      ).filter((section) => !applicableSections.includes(section));

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
          ...(skippedSections.length > 0
            ? { skippedSectionCount: skippedSections.length }
            : {}),
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
    if (error instanceof ProgressValidationError) {
      return {
        ok: false,
        reason: "validation",
        message: error.message,
        fieldErrors: error.fieldErrors,
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
