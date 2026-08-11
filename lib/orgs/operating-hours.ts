import "server-only";

import type { DayOfWeek, OperatingHourInterval } from "@prisma/client";

import type { SafeUser } from "@/lib/auth/users";
import { recordOrganizationAuditEvent } from "@/lib/orgs/audit";
import { requireOrganizationPermission } from "@/lib/orgs/authorization";
import {
  acquireOrganizationReadinessLock,
  ConflictError,
  mapAuthError,
  refreshConfigurationReadiness,
  requireActiveActorInTx,
  type AuthFailure,
  type ReadinessMutationTestHooks,
} from "@/lib/orgs/business-access";
import {
  DAYS_OF_WEEK,
  replaceOperatingHoursSchema,
  requireExpectedVersion,
  timeStringToMinutes,
  validateWeeklySchedule,
  type DayOfWeekValue,
  type OnboardingStepValue,
} from "@/lib/orgs/business-validation";
import { advanceOnboardingStepInTx } from "@/lib/orgs/onboarding";
import { prisma } from "@/lib/prisma";

export type GetHoursResult =
  | {
      ok: true;
      intervals: OperatingHourInterval[];
      customerNote: string | null;
    }
  | AuthFailure;

type ProgressInput = {
  step: OnboardingStepValue;
  nextStep?: OnboardingStepValue;
  expectedVersion: number;
};

export async function getOperatingHours(input: {
  actor: SafeUser;
  organizationId: string;
}): Promise<GetHoursResult> {
  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.hours.read",
    });

    const intervals = await prisma.operatingHourInterval.findMany({
      where: { organizationId: input.organizationId },
      orderBy: [{ dayOfWeek: "asc" }, { sortOrder: "asc" }],
    });

    const customerNote =
      intervals.find((i) => i.customerNote)?.customerNote ?? null;

    return { ok: true, intervals, customerNote };
  } catch (error) {
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not load operating hours.",
      }
    );
  }
}

/**
 * Replace the full weekly schedule atomically.
 * Semantics: start inclusive, end exclusive; overnight rejected; no partial weeks.
 */
export async function replaceOperatingHours(
  input: {
    actor: SafeUser;
    organizationId: string;
    raw: unknown;
    progress?: ProgressInput;
  },
  hooks: ReadinessMutationTestHooks = {},
): Promise<GetHoursResult> {
  let progressVersion: number | undefined;
  if (input.progress) {
    const progressParsed = requireExpectedVersion(
      input.progress.expectedVersion,
    );
    if (!progressParsed.ok) {
      return {
        ok: false,
        reason: "validation",
        message: progressParsed.message,
        fieldErrors: { onboardingExpectedVersion: [progressParsed.message] },
      };
    }
    progressVersion = progressParsed.version;
  }

  const parsed = replaceOperatingHoursSchema.safeParse(input.raw);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "validation",
      message: "Please correct the operating hours.",
      fieldErrors: { intervals: ["Invalid weekly schedule."] },
    };
  }

  const normalized: Array<{
    dayOfWeek: DayOfWeekValue;
    isClosed: boolean;
    startMinute: number | null;
    endMinute: number | null;
    sortOrder: number;
  }> = [];

  for (const interval of parsed.data.intervals) {
    if (interval.isClosed) {
      normalized.push({
        dayOfWeek: interval.dayOfWeek,
        isClosed: true,
        startMinute: null,
        endMinute: null,
        sortOrder: 0,
      });
      continue;
    }

    if (!interval.startTime || !interval.endTime) {
      return {
        ok: false,
        reason: "validation",
        message: "Open days require start and end times.",
      };
    }

    const startMinute = timeStringToMinutes(interval.startTime);
    const endMinute =
      interval.endTime === "24:00"
        ? 1440
        : timeStringToMinutes(interval.endTime);

    if (endMinute <= startMinute) {
      return {
        ok: false,
        reason: "validation",
        message:
          "Ending time must be after starting time. Overnight hours are not supported.",
      };
    }

    normalized.push({
      dayOfWeek: interval.dayOfWeek,
      isClosed: false,
      startMinute,
      endMinute,
      sortOrder: interval.sortOrder,
    });
  }

  // Ensure every day is represented (fill closed if missing).
  for (const day of DAYS_OF_WEEK) {
    if (!normalized.some((n) => n.dayOfWeek === day)) {
      normalized.push({
        dayOfWeek: day,
        isClosed: true,
        startMinute: null,
        endMinute: null,
        sortOrder: 0,
      });
    }
  }

  const scheduleCheck = validateWeeklySchedule(normalized);
  if (!scheduleCheck.ok) {
    return {
      ok: false,
      reason: "validation",
      message: scheduleCheck.message,
    };
  }

  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.hours.update",
    });

    const intervals = await prisma.$transaction(async (tx) => {
      // Lock order: readiness first, then membership, then hours-specific schedule lock.
      await acquireOrganizationReadinessLock(tx, input.organizationId, hooks);
      await requireActiveActorInTx(
        tx,
        {
          organizationId: input.organizationId,
          userId: input.actor.id,
          permission: "org.hours.update",
        },
        hooks,
      );

      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`hours:${input.organizationId}`}))`;

      await tx.operatingHourInterval.deleteMany({
        where: { organizationId: input.organizationId },
      });

      await tx.operatingHourInterval.createMany({
        data: normalized.map((interval) => ({
          organizationId: input.organizationId,
          dayOfWeek: interval.dayOfWeek as DayOfWeek,
          isClosed: interval.isClosed,
          startMinute: interval.startMinute,
          endMinute: interval.endMinute,
          sortOrder: interval.sortOrder,
          customerNote: parsed.data.customerNote ?? null,
        })),
      });

      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "OPERATING_HOURS_UPDATED",
        metadata: { intervalCount: normalized.length },
      });

      if (input.progress && progressVersion !== undefined) {
        await advanceOnboardingStepInTx(tx, {
          organizationId: input.organizationId,
          step: input.progress.step,
          nextStep: input.progress.nextStep,
          expectedVersion: progressVersion,
        });
      }

      await refreshConfigurationReadiness(tx, input.organizationId);

      return tx.operatingHourInterval.findMany({
        where: { organizationId: input.organizationId },
        orderBy: [{ dayOfWeek: "asc" }, { sortOrder: "asc" }],
      });
    });

    return {
      ok: true,
      intervals,
      customerNote: parsed.data.customerNote ?? null,
    };
  } catch (error) {
    if (error instanceof ConflictError) {
      return {
        ok: false,
        reason: "conflict",
        message:
          "Operating hours or onboarding were updated elsewhere. Reload and try again.",
      };
    }
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not update operating hours.",
      }
    );
  }
}
