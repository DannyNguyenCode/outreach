import "server-only";

import type { HolidayClosure, Prisma } from "@prisma/client";

import type { SafeUser } from "@/lib/auth/users";
import { recordOrganizationAuditEvent } from "@/lib/orgs/audit";
import {
  OrganizationAuthError,
  requireOrganizationPermission,
} from "@/lib/orgs/authorization";
import {
  acquireConfig3bSectionLock,
  acquireOrganizationConfig3bLock,
  closuresLockKey,
  ConflictError,
  mapAuthError,
  requireActiveActorInTx,
  type AuthFailure,
  type Config3bMutationTestHooks,
} from "@/lib/orgs/config-3b-access";
import {
  holidayClosureInputSchema,
  holidayDateRangesOverlap,
  replaceHolidayClosuresSchema,
  requireExpectedVersion,
  zodFieldErrors,
} from "@/lib/orgs/config-3b-validation";
import { prisma } from "@/lib/prisma";

export type HolidayClosuresResult =
  | {
      ok: true;
      closures: HolidayClosure[];
      organizationTimeZone: string | null;
    }
  | AuthFailure;

export type HolidayClosureResult =
  { ok: true; closure: HolidayClosure } | AuthFailure;

/**
 * Dates are stored as local calendar strings (YYYY-MM-DD) interpreted in the
 * organization's BusinessProfile.timeZone. This module never mutates
 * OperatingHourInterval rows.
 */
async function assertNoActiveOverlap(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    localDateStart: string;
    localDateEnd: string | null;
    excludeId?: string;
  },
): Promise<void> {
  const active = await tx.holidayClosure.findMany({
    where: {
      organizationId: input.organizationId,
      isActive: true,
      ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
    },
    select: {
      id: true,
      localDateStart: true,
      localDateEnd: true,
    },
  });

  for (const other of active) {
    if (
      holidayDateRangesOverlap(
        input.localDateStart,
        input.localDateEnd,
        other.localDateStart,
        other.localDateEnd,
      )
    ) {
      throw new ConflictError("holiday_overlap");
    }
  }
}

export async function listHolidayClosures(input: {
  actor: SafeUser;
  organizationId: string;
}): Promise<HolidayClosuresResult> {
  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.config.read",
    });

    const [closures, profile] = await Promise.all([
      prisma.holidayClosure.findMany({
        where: { organizationId: input.organizationId },
        orderBy: [{ localDateStart: "asc" }, { createdAt: "asc" }],
      }),
      prisma.businessProfile.findUnique({
        where: { organizationId: input.organizationId },
        select: { timeZone: true },
      }),
    ]);

    return {
      ok: true,
      closures,
      organizationTimeZone: profile?.timeZone ?? null,
    };
  } catch (error) {
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not load holiday closures.",
      }
    );
  }
}

export async function createHolidayClosure(
  input: {
    actor: SafeUser;
    organizationId: string;
    raw: unknown;
  },
  hooks: Config3bMutationTestHooks = {},
): Promise<HolidayClosureResult> {
  const parsed = holidayClosureInputSchema.safeParse(input.raw);
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

    const closure = await prisma.$transaction(async (tx) => {
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
        closuresLockKey(input.organizationId),
        hooks,
      );

      const isActive = parsed.data.isActive ?? true;
      if (isActive) {
        await assertNoActiveOverlap(tx, {
          organizationId: input.organizationId,
          localDateStart: parsed.data.localDateStart,
          localDateEnd: parsed.data.localDateEnd ?? null,
        });
      }

      const created = await tx.holidayClosure.create({
        data: {
          organizationId: input.organizationId,
          localDateStart: parsed.data.localDateStart,
          localDateEnd: parsed.data.localDateEnd ?? null,
          isClosedAllDay: parsed.data.isClosedAllDay,
          replacementIntervals: (parsed.data.replacementIntervals ??
            null) as Prisma.InputJsonValue,
          customerNote: parsed.data.customerNote ?? null,
          internalLabel: parsed.data.internalLabel ?? null,
          isActive,
        },
      });

      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "HOLIDAY_CLOSURE_CREATED",
        metadata: { closureId: created.id },
      });

      return created;
    });

    if (hooks.testAfterTransactionCommit) {
      await hooks.testAfterTransactionCommit();
    }

    return { ok: true, closure };
  } catch (error) {
    if (error instanceof ConflictError) {
      return {
        ok: false,
        reason: "conflict",
        message: "Active holiday closures cannot overlap.",
      };
    }
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not create holiday closure.",
      }
    );
  }
}

export async function updateHolidayClosure(
  input: {
    actor: SafeUser;
    organizationId: string;
    closureId: string;
    raw: unknown;
    expectedVersion: number;
  },
  hooks: Config3bMutationTestHooks = {},
): Promise<HolidayClosureResult> {
  const versionParsed = requireExpectedVersion(input.expectedVersion);
  if (!versionParsed.ok) {
    return {
      ok: false,
      reason: "validation",
      message: versionParsed.message,
      fieldErrors: { expectedVersion: [versionParsed.message] },
    };
  }

  const parsed = holidayClosureInputSchema.safeParse(input.raw);
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

    const closure = await prisma.$transaction(async (tx) => {
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
        closuresLockKey(input.organizationId),
        hooks,
      );

      const existing = await tx.holidayClosure.findFirst({
        where: {
          id: input.closureId,
          organizationId: input.organizationId,
        },
      });
      if (!existing) {
        throw new OrganizationAuthError("organization_not_found");
      }

      const isActive = parsed.data.isActive ?? existing.isActive;
      if (isActive) {
        await assertNoActiveOverlap(tx, {
          organizationId: input.organizationId,
          localDateStart: parsed.data.localDateStart,
          localDateEnd: parsed.data.localDateEnd ?? null,
          excludeId: existing.id,
        });
      }

      const updatedCount = await tx.holidayClosure.updateMany({
        where: {
          id: existing.id,
          organizationId: input.organizationId,
          version: versionParsed.version,
        },
        data: {
          localDateStart: parsed.data.localDateStart,
          localDateEnd: parsed.data.localDateEnd ?? null,
          isClosedAllDay: parsed.data.isClosedAllDay,
          replacementIntervals: (parsed.data.replacementIntervals ??
            null) as Prisma.InputJsonValue,
          customerNote: parsed.data.customerNote ?? null,
          internalLabel: parsed.data.internalLabel ?? null,
          isActive,
          version: { increment: 1 },
        },
      });

      if (updatedCount.count !== 1) {
        throw new ConflictError();
      }

      const updated = await tx.holidayClosure.findUniqueOrThrow({
        where: { id: existing.id },
      });

      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "HOLIDAY_CLOSURE_UPDATED",
        metadata: { closureId: updated.id },
      });

      return updated;
    });

    if (hooks.testAfterTransactionCommit) {
      await hooks.testAfterTransactionCommit();
    }

    return { ok: true, closure };
  } catch (error) {
    if (error instanceof ConflictError) {
      return {
        ok: false,
        reason: "conflict",
        message:
          error.message === "holiday_overlap"
            ? "Active holiday closures cannot overlap."
            : "Holiday closure was updated elsewhere. Reload and try again.",
      };
    }
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not update holiday closure.",
      }
    );
  }
}

export async function deactivateHolidayClosure(
  input: {
    actor: SafeUser;
    organizationId: string;
    closureId: string;
    expectedVersion: number;
  },
  hooks: Config3bMutationTestHooks = {},
): Promise<HolidayClosureResult> {
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
      permission: "org.config.manage",
    });

    const closure = await prisma.$transaction(async (tx) => {
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
        closuresLockKey(input.organizationId),
        hooks,
      );

      const existing = await tx.holidayClosure.findFirst({
        where: {
          id: input.closureId,
          organizationId: input.organizationId,
        },
      });
      if (!existing) {
        throw new OrganizationAuthError("organization_not_found");
      }

      const updatedCount = await tx.holidayClosure.updateMany({
        where: {
          id: existing.id,
          organizationId: input.organizationId,
          isActive: true,
          version: versionParsed.version,
        },
        data: { isActive: false, version: { increment: 1 } },
      });

      if (updatedCount.count !== 1) {
        throw new ConflictError();
      }

      const updated = await tx.holidayClosure.findFirstOrThrow({
        where: {
          id: existing.id,
          organizationId: input.organizationId,
        },
      });

      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "HOLIDAY_CLOSURE_DEACTIVATED",
        metadata: { closureId: updated.id },
      });

      return updated;
    });

    if (hooks.testAfterTransactionCommit) {
      await hooks.testAfterTransactionCommit();
    }

    return { ok: true, closure };
  } catch (error) {
    if (error instanceof ConflictError) {
      return {
        ok: false,
        reason: "conflict",
        message:
          "Holiday closure was updated or deactivated elsewhere. Reload and try again.",
      };
    }
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not deactivate holiday closure.",
      }
    );
  }
}

/**
 * Optional replace-set helper. Never touches OperatingHourInterval.
 * Rejects overlapping active closures in the replacement set.
 */
export async function replaceHolidayClosures(
  input: {
    actor: SafeUser;
    organizationId: string;
    raw: unknown;
  },
  hooks: Config3bMutationTestHooks = {},
): Promise<HolidayClosuresResult> {
  const parsed = replaceHolidayClosuresSchema.safeParse(
    Array.isArray(input.raw) ? { closures: input.raw } : input.raw,
  );
  if (!parsed.success) {
    return {
      ok: false,
      reason: "validation",
      message: "Please correct the holiday closures.",
      fieldErrors: zodFieldErrors(parsed.error),
    };
  }

  for (let i = 0; i < parsed.data.closures.length; i++) {
    for (let j = i + 1; j < parsed.data.closures.length; j++) {
      const a = parsed.data.closures[i]!;
      const b = parsed.data.closures[j]!;
      if (!(a.isActive ?? true) || !(b.isActive ?? true)) continue;
      if (
        holidayDateRangesOverlap(
          a.localDateStart,
          a.localDateEnd ?? null,
          b.localDateStart,
          b.localDateEnd ?? null,
        )
      ) {
        return {
          ok: false,
          reason: "validation",
          message: "Active holiday closures cannot overlap.",
          fieldErrors: {
            closures: ["Active holiday closures cannot overlap."],
          },
        };
      }
    }
  }

  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.config.manage",
    });

    const result = await prisma.$transaction(async (tx) => {
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
        closuresLockKey(input.organizationId),
        hooks,
      );

      await tx.holidayClosure.deleteMany({
        where: { organizationId: input.organizationId },
      });

      if (parsed.data.closures.length > 0) {
        await tx.holidayClosure.createMany({
          data: parsed.data.closures.map((closure) => ({
            organizationId: input.organizationId,
            localDateStart: closure.localDateStart,
            localDateEnd: closure.localDateEnd ?? null,
            isClosedAllDay: closure.isClosedAllDay,
            replacementIntervals: (closure.replacementIntervals ??
              null) as Prisma.InputJsonValue,
            customerNote: closure.customerNote ?? null,
            internalLabel: closure.internalLabel ?? null,
            isActive: closure.isActive ?? true,
          })),
        });
      }

      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "HOLIDAY_CLOSURE_UPDATED",
        metadata: { replaceSet: true, count: parsed.data.closures.length },
      });

      const [closures, profile] = await Promise.all([
        tx.holidayClosure.findMany({
          where: { organizationId: input.organizationId },
          orderBy: [{ localDateStart: "asc" }, { createdAt: "asc" }],
        }),
        tx.businessProfile.findUnique({
          where: { organizationId: input.organizationId },
          select: { timeZone: true },
        }),
      ]);

      return {
        closures,
        organizationTimeZone: profile?.timeZone ?? null,
      };
    });

    if (hooks.testAfterTransactionCommit) {
      await hooks.testAfterTransactionCommit();
    }

    return { ok: true, ...result };
  } catch (error) {
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not replace holiday closures.",
      }
    );
  }
}
