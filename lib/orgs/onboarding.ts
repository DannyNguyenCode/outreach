import "server-only";

import type { OrganizationOnboarding } from "@prisma/client";

import type { SafeUser } from "@/lib/auth/users";
import { recordOrganizationAuditEvent } from "@/lib/orgs/audit";
import {
  OrganizationAuthError,
  requireOrganizationPermission,
} from "@/lib/orgs/authorization";
import {
  computeConfigurationReadiness,
  ensureBusinessDefaults,
  mapAuthError,
  requireActiveActorInTx,
  type AuthFailure,
} from "@/lib/orgs/business-access";
import {
  ONBOARDING_STEPS,
  parseCompletedSteps,
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
  { ok: true; onboarding: OnboardingView } | AuthFailure;

/**
 * Idempotently create onboarding + defaults for an organization.
 * Concurrent callers converge on a single OrganizationOnboarding row.
 * Requires org.onboarding.manage (create/start) or returns existing for viewers.
 */
export async function ensureOrganizationOnboarding(input: {
  actor: SafeUser;
  organizationId: string;
  recordStartAudit?: boolean;
}): Promise<GetOnboardingResult> {
  let canManage = false;
  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.onboarding.manage",
    });
    canManage = true;
  } catch (error) {
    try {
      await requireOrganizationPermission({
        user: input.actor,
        organizationId: input.organizationId,
        permission: "org.onboarding.view",
      });
    } catch (viewError) {
      return (
        mapAuthError(viewError) ??
        mapAuthError(error) ?? {
          ok: false,
          reason: "forbidden",
          message: "You do not have permission to view onboarding.",
        }
      );
    }
  }

  try {
    const onboarding = await prisma.$transaction(async (tx) => {
      await ensureBusinessDefaults(tx, input.organizationId);

      const existing = await tx.organizationOnboarding.findUnique({
        where: { organizationId: input.organizationId },
      });
      if (existing) {
        return existing;
      }

      if (!canManage) {
        throw new OrganizationAuthError("organization_not_found");
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

        if (input.recordStartAudit !== false) {
          await recordOrganizationAuditEvent(tx, {
            organizationId: input.organizationId,
            actorUserId: input.actor.id,
            action: "ONBOARDING_STARTED",
          });
        }

        return created;
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          (error as { code?: string }).code === "P2002"
        ) {
          const raced = await tx.organizationOnboarding.findUnique({
            where: { organizationId: input.organizationId },
          });
          if (raced) return raced;
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
      onboarding: toView(onboarding, readiness),
    };
  } catch (error) {
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not initialize onboarding.",
      }
    );
  }
}

export async function getOrganizationOnboarding(input: {
  actor: SafeUser;
  organizationId: string;
}): Promise<GetOnboardingResult> {
  return ensureOrganizationOnboarding({
    ...input,
    recordStartAudit: true,
  });
}

export async function advanceOnboardingStep(input: {
  actor: SafeUser;
  organizationId: string;
  step: OnboardingStepValue;
  nextStep?: OnboardingStepValue;
  expectedVersion?: number;
}): Promise<GetOnboardingResult> {
  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.onboarding.manage",
    });

    const onboarding = await prisma.$transaction(async (tx) => {
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
      if (
        input.expectedVersion !== undefined &&
        existing.version !== input.expectedVersion
      ) {
        throw new ConcurrencyError();
      }

      const completed = parseCompletedSteps(existing.completedSteps);
      if (!completed.includes(input.step)) {
        completed.push(input.step);
      }

      const next =
        input.nextStep && ONBOARDING_STEPS.includes(input.nextStep)
          ? input.nextStep
          : existing.currentStep;

      return tx.organizationOnboarding.update({
        where: { organizationId: input.organizationId },
        data: {
          status:
            existing.status === "NOT_STARTED"
              ? "IN_PROGRESS"
              : existing.status === "COMPLETED"
                ? "COMPLETED"
                : "IN_PROGRESS",
          currentStep: next,
          completedSteps: completed,
          version: { increment: 1 },
        },
      });
    });

    const readiness = await computeConfigurationReadiness(
      prisma,
      input.organizationId,
    );
    return { ok: true, onboarding: toView(onboarding, readiness) };
  } catch (error) {
    if (error instanceof ConcurrencyError) {
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
 * Intentional completion. Server computes readiness; client cannot force complete.
 */
export async function completeOrganizationOnboarding(input: {
  actor: SafeUser;
  organizationId: string;
  expectedVersion?: number;
}): Promise<CompleteOnboardingResult> {
  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.onboarding.complete",
    });

    const result = await prisma.$transaction(async (tx) => {
      await requireActiveActorInTx(tx, {
        organizationId: input.organizationId,
        userId: input.actor.id,
        permission: "org.onboarding.complete",
      });

      // Serialize completion against concurrent catalogue/profile edits.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`onboarding:${input.organizationId}`}))`;

      const existing = await tx.organizationOnboarding.findUnique({
        where: { organizationId: input.organizationId },
      });
      if (!existing) {
        throw new OrganizationAuthError("organization_not_found");
      }
      if (
        input.expectedVersion !== undefined &&
        existing.version !== input.expectedVersion
      ) {
        throw new ConcurrencyError();
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

      const updated = await tx.organizationOnboarding.update({
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

      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "ONBOARDING_COMPLETED",
      });

      return {
        kind: "completed" as const,
        onboarding: updated,
        readiness,
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
    if (error instanceof ConcurrencyError) {
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

export async function reopenOrganizationOnboarding(input: {
  actor: SafeUser;
  organizationId: string;
  expectedVersion?: number;
}): Promise<CompleteOnboardingResult> {
  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.onboarding.reopen",
    });

    const updated = await prisma.$transaction(async (tx) => {
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
      if (
        input.expectedVersion !== undefined &&
        existing.version !== input.expectedVersion
      ) {
        throw new ConcurrencyError();
      }

      const next = await tx.organizationOnboarding.update({
        where: { organizationId: input.organizationId },
        data: {
          status: "IN_PROGRESS",
          isConfigurationReady: false,
          reopenedAt: new Date(),
          reopenedByUserId: input.actor.id,
          currentStep: "REVIEW",
          version: { increment: 1 },
        },
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
    if (error instanceof ConcurrencyError) {
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

class ConcurrencyError extends Error {
  constructor() {
    super("conflict");
    this.name = "ConcurrencyError";
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
