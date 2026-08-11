import "server-only";

import type { OrganizationOnboarding } from "@prisma/client";

import type { SafeUser } from "@/lib/auth/users";
import { recordOrganizationAuditEvent } from "@/lib/orgs/audit";
import {
  OrganizationAuthError,
  requireOrganizationPermission,
} from "@/lib/orgs/authorization";
import {
  acquireOrganizationReadinessLock,
  computeConfigurationReadiness,
  ConflictError,
  initializeBusinessDefaults,
  mapAuthError,
  requireActiveActorInTx,
  type AuthFailure,
  type ReadinessMutationTestHooks,
} from "@/lib/orgs/business-access";
import {
  ONBOARDING_STEPS,
  parseCompletedSteps,
  requireExpectedVersion,
  type OnboardingStepValue,
} from "@/lib/orgs/business-validation";
import { prisma } from "@/lib/prisma";

export type OnboardingView = {
  status: OrganizationOnboarding["status"];
  currentStep: OrganizationOnboarding["currentStep"];
  completedSteps: OnboardingStepValue[];
  isConfigurationReady: boolean;
  completedAt: Date | null;
  completedByUserId: string | null;
  reopenedAt: Date | null;
  reopenedByUserId: string | null;
  version: number;
  readiness: {
    ready: boolean;
    missing: string[];
  };
};

export type GetOnboardingResult =
  | { ok: true; onboarding: OnboardingView }
  | { ok: false; reason: "not_started"; message: string }
  | AuthFailure;

/**
 * Read-only onboarding retrieval. Never creates rows or audit events.
 */
export async function getOrganizationOnboarding(input: {
  actor: SafeUser;
  organizationId: string;
}): Promise<GetOnboardingResult> {
  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.onboarding.view",
    });

    const onboarding = await prisma.organizationOnboarding.findUnique({
      where: { organizationId: input.organizationId },
    });
    if (!onboarding) {
      return {
        ok: false,
        reason: "not_started",
        message: "Onboarding has not been started for this organization.",
      };
    }

    const readiness = await computeConfigurationReadiness(
      prisma,
      input.organizationId,
    );

    return {
      ok: true,
      onboarding: toView(onboarding, readiness),
    };
  } catch (error) {
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not load onboarding.",
      }
    );
  }
}

/**
 * Intentional onboarding initialization (POST/mutation only).
 * Idempotent: creates defaults + onboarding once; ONBOARDING_STARTED only on create.
 */
export async function startOrganizationOnboarding(
  input: {
    actor: SafeUser;
    organizationId: string;
  },
  hooks: ReadinessMutationTestHooks = {},
): Promise<GetOnboardingResult> {
  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.onboarding.manage",
    });

    const onboarding = await prisma.$transaction(async (tx) => {
      await acquireOrganizationReadinessLock(tx, input.organizationId, hooks);
      await requireActiveActorInTx(tx, {
        organizationId: input.organizationId,
        userId: input.actor.id,
        permission: "org.onboarding.manage",
      });

      await initializeBusinessDefaults(tx, input.organizationId);

      const existing = await tx.organizationOnboarding.findUnique({
        where: { organizationId: input.organizationId },
      });
      if (existing) {
        return { row: existing, created: false as const };
      }

      try {
        const created = await tx.organizationOnboarding.create({
          data: {
            organizationId: input.organizationId,
            status: "NOT_STARTED",
            currentStep: "BUSINESS_BASICS",
            completedSteps: [],
          },
        });

        await recordOrganizationAuditEvent(tx, {
          organizationId: input.organizationId,
          actorUserId: input.actor.id,
          action: "ONBOARDING_STARTED",
        });

        return { row: created, created: true as const };
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          (error as { code?: string }).code === "P2002"
        ) {
          const raced = await tx.organizationOnboarding.findUnique({
            where: { organizationId: input.organizationId },
          });
          if (raced) return { row: raced, created: false as const };
        }
        throw error;
      }
    });

    const readiness = await computeConfigurationReadiness(
      prisma,
      input.organizationId,
    );

    return {
      ok: true,
      onboarding: toView(onboarding.row, readiness),
    };
  } catch (error) {
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not start onboarding.",
      }
    );
  }
}

/**
 * Advance onboarding progress. Mutates OrganizationOnboarding under the shared
 * readiness lock so it cannot race with completion/reopening.
 *
 * Contract: every writer of status/currentStep/completedSteps/isConfigurationReady/
 * completion metadata/version must hold `organization-readiness:<organizationId>`
 * (or be nested in a transaction that already holds it).
 *
 * expectedVersion is required for optimistic concurrency.
 */
export async function advanceOnboardingStep(
  input: {
    actor: SafeUser;
    organizationId: string;
    step: OnboardingStepValue;
    nextStep?: OnboardingStepValue;
    expectedVersion: number;
  },
  hooks: ReadinessMutationTestHooks = {},
): Promise<GetOnboardingResult> {
  const versionParsed = requireExpectedVersion(input.expectedVersion);
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
      permission: "org.onboarding.manage",
    });

    const onboarding = await prisma.$transaction(async (tx) => {
      await acquireOrganizationReadinessLock(tx, input.organizationId, hooks);
      await requireActiveActorInTx(tx, {
        organizationId: input.organizationId,
        userId: input.actor.id,
        permission: "org.onboarding.manage",
      });

      const existing = await tx.organizationOnboarding.findUnique({
        where: { organizationId: input.organizationId },
      });
      if (!existing) {
        throw new OrganizationAuthError("organization_not_found");
      }

      // After completion, progress markers may still be updated but must not
      // revert status away from COMPLETED.
      const completed = parseCompletedSteps(existing.completedSteps);
      if (!completed.includes(input.step)) {
        completed.push(input.step);
      }

      const next =
        input.nextStep && ONBOARDING_STEPS.includes(input.nextStep)
          ? input.nextStep
          : existing.currentStep;

      const status =
        existing.status === "COMPLETED"
          ? "COMPLETED"
          : existing.status === "NOT_STARTED"
            ? "IN_PROGRESS"
            : "IN_PROGRESS";

      const updated = await tx.organizationOnboarding.updateMany({
        where: {
          organizationId: input.organizationId,
          version: versionParsed.version,
        },
        data: {
          status,
          currentStep: next,
          completedSteps: completed,
          version: { increment: 1 },
        },
      });

      if (updated.count !== 1) {
        throw new ConflictError();
      }

      return tx.organizationOnboarding.findUniqueOrThrow({
        where: { organizationId: input.organizationId },
      });
    });

    const readiness = await computeConfigurationReadiness(
      prisma,
      input.organizationId,
    );
    return { ok: true, onboarding: toView(onboarding, readiness) };
  } catch (error) {
    if (error instanceof ConflictError) {
      return {
        ok: false,
        reason: "conflict",
        message: "Onboarding was updated elsewhere. Reload and try again.",
      };
    }
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not update onboarding progress.",
      }
    );
  }
}

export type CompleteOnboardingResult =
  { ok: true; onboarding: OnboardingView } | AuthFailure;

/**
 * Intentional completion. Server computes readiness under the shared readiness lock.
 *
 * Optimistic expectedVersion is intentionally omitted: completion always reads
 * authoritative configuration after acquiring the readiness lock and applies an
 * unconditional organization-scoped transition from that locked snapshot.
 * Serialization with every readiness/onboarding mutation is via the shared lock.
 */
export async function completeOrganizationOnboarding(
  input: {
    actor: SafeUser;
    organizationId: string;
  },
  hooks: ReadinessMutationTestHooks = {},
): Promise<CompleteOnboardingResult> {
  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.onboarding.complete",
    });

    const result = await prisma.$transaction(async (tx) => {
      await acquireOrganizationReadinessLock(tx, input.organizationId, hooks);
      await requireActiveActorInTx(tx, {
        organizationId: input.organizationId,
        userId: input.actor.id,
        permission: "org.onboarding.complete",
      });

      const existing = await tx.organizationOnboarding.findUnique({
        where: { organizationId: input.organizationId },
      });
      if (!existing) {
        throw new OrganizationAuthError("organization_not_found");
      }

      const readiness = await computeConfigurationReadiness(
        tx,
        input.organizationId,
      );
      if (!readiness.ready) {
        return {
          kind: "not_ready" as const,
          missing: readiness.missing,
          onboarding: existing,
          readiness,
        };
      }

      if (existing.status === "COMPLETED" && existing.isConfigurationReady) {
        return {
          kind: "completed" as const,
          onboarding: existing,
          readiness,
          alreadyComplete: true as const,
        };
      }

      const updatedCount = await tx.organizationOnboarding.updateMany({
        where: { organizationId: input.organizationId },
        data: {
          status: "COMPLETED",
          currentStep: "REVIEW",
          completedSteps: [...ONBOARDING_STEPS],
          isConfigurationReady: true,
          completedAt: new Date(),
          completedByUserId: input.actor.id,
          version: { increment: 1 },
        },
      });

      if (updatedCount.count !== 1) {
        throw new ConflictError();
      }

      const updated = await tx.organizationOnboarding.findUniqueOrThrow({
        where: { organizationId: input.organizationId },
      });

      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "ONBOARDING_COMPLETED",
      });

      return {
        kind: "completed" as const,
        onboarding: updated,
        readiness,
        alreadyComplete: false as const,
      };
    });

    if (result.kind === "not_ready") {
      return {
        ok: false,
        reason: "not_ready",
        message: "Complete the required configuration before finishing.",
        missingRequirements: result.missing,
      };
    }

    return {
      ok: true,
      onboarding: toView(result.onboarding, result.readiness),
    };
  } catch (error) {
    if (error instanceof ConflictError) {
      return {
        ok: false,
        reason: "conflict",
        message: "Onboarding was updated elsewhere. Reload and try again.",
      };
    }
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not complete onboarding.",
      }
    );
  }
}

export async function reopenOrganizationOnboarding(
  input: {
    actor: SafeUser;
    organizationId: string;
    expectedVersion: number;
  },
  hooks: ReadinessMutationTestHooks = {},
): Promise<CompleteOnboardingResult> {
  const versionParsed = requireExpectedVersion(input.expectedVersion);
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
      permission: "org.onboarding.reopen",
    });

    const updated = await prisma.$transaction(async (tx) => {
      await acquireOrganizationReadinessLock(tx, input.organizationId, hooks);
      await requireActiveActorInTx(tx, {
        organizationId: input.organizationId,
        userId: input.actor.id,
        permission: "org.onboarding.reopen",
      });

      const existing = await tx.organizationOnboarding.findUnique({
        where: { organizationId: input.organizationId },
      });
      if (!existing) {
        throw new OrganizationAuthError("organization_not_found");
      }

      const updatedCount = await tx.organizationOnboarding.updateMany({
        where: {
          organizationId: input.organizationId,
          version: versionParsed.version,
        },
        data: {
          status: "IN_PROGRESS",
          isConfigurationReady: false,
          reopenedAt: new Date(),
          reopenedByUserId: input.actor.id,
          currentStep: "REVIEW",
          version: { increment: 1 },
        },
      });

      if (updatedCount.count !== 1) {
        throw new ConflictError();
      }

      const next = await tx.organizationOnboarding.findUniqueOrThrow({
        where: { organizationId: input.organizationId },
      });

      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "ONBOARDING_REOPENED",
      });

      return next;
    });

    const readiness = await computeConfigurationReadiness(
      prisma,
      input.organizationId,
    );
    return { ok: true, onboarding: toView(updated, readiness) };
  } catch (error) {
    if (error instanceof ConflictError) {
      return {
        ok: false,
        reason: "conflict",
        message: "Onboarding was updated elsewhere. Reload and try again.",
      };
    }
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not reopen onboarding.",
      }
    );
  }
}

function toView(
  row: OrganizationOnboarding,
  readiness: { ready: boolean; missing: string[] },
): OnboardingView {
  return {
    status: row.status,
    currentStep: row.currentStep,
    completedSteps: parseCompletedSteps(row.completedSteps),
    isConfigurationReady: row.isConfigurationReady,
    completedAt: row.completedAt,
    completedByUserId: row.completedByUserId,
    reopenedAt: row.reopenedAt,
    reopenedByUserId: row.reopenedByUserId,
    version: row.version,
    readiness: {
      ready: readiness.ready,
      missing: readiness.missing,
    },
  };
}
