import "server-only";

import type {
  BusinessType,
  DayOfWeek,
  OnboardingStep,
  OrganizationRole,
  Prisma,
  PrismaClient,
} from "@prisma/client";

import type { SafeUser } from "@/lib/auth/users";
import {
  OrganizationAuthError,
  requireOrganizationPermission,
} from "@/lib/orgs/authorization";
import {
  DAYS_OF_WEEK,
  parseCompletedSteps,
  type OnboardingStepValue,
} from "@/lib/orgs/business-validation";
import { roleHasPermission } from "@/lib/orgs/permissions";

export type DbClient = PrismaClient | Prisma.TransactionClient;

export type AuthFailure = {
  ok: false;
  reason: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
  missingRequirements?: string[];
};

/**
 * Test-only seams for deterministic readiness-lock concurrency tests.
 * Production callers must omit these hooks.
 */
export type ReadinessMutationTestHooks = {
  /** Invoked immediately before acquiring the shared readiness lock. */
  testBeforeReadinessLock?: () => Promise<void>;
  /**
   * Invoked after the shared readiness lock is held and before the
   * authoritative transactional membership/permission recheck.
   */
  testAfterReadinessLock?: () => Promise<void>;
};

export class ConflictError extends Error {
  constructor(message = "conflict") {
    super(message);
    this.name = "ConflictError";
  }
}

/**
 * Lock key namespace for all readiness-affecting Phase 3A mutations.
 *
 * Ordering rule (prevents deadlocks):
 * 1. Always acquire `organization-readiness:<organizationId>` first.
 * 2. Only then acquire any specialized locks (`hours:`, `services-order:`,
 *    `products-order:`) if still needed for that operation.
 * 3. Never acquire specialized locks before the readiness lock when both are used.
 * 4. Reorder-only operations that do not affect completion readiness may use
 *    their specialized locks alone.
 */
export function organizationReadinessLockKey(organizationId: string): string {
  return `organization-readiness:${organizationId}`;
}

/**
 * Acquire the shared organization readiness advisory lock inside a transaction.
 * Must be called before reading or mutating readiness-affecting configuration.
 */
export async function acquireOrganizationReadinessLock(
  tx: Prisma.TransactionClient,
  organizationId: string,
  hooks: ReadinessMutationTestHooks = {},
): Promise<void> {
  if (hooks.testBeforeReadinessLock) {
    await hooks.testBeforeReadinessLock();
  }
  const lockKey = organizationReadinessLockKey(organizationId);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
  if (hooks.testAfterReadinessLock) {
    await hooks.testAfterReadinessLock();
  }
}

export function mapAuthError(error: unknown): AuthFailure | null {
  if (!(error instanceof OrganizationAuthError)) {
    return null;
  }
  const messages: Record<string, string> = {
    unauthenticated: "Sign in to continue.",
    unverified: "Verify your email to continue.",
    not_a_member: "You do not have access to this organization.",
    inactive_membership: "Your membership is no longer active.",
    forbidden: "You do not have permission to perform this action.",
    organization_not_found: "Organization not found.",
  };
  return {
    ok: false,
    reason: error.code,
    message: messages[error.code] ?? "Request denied.",
  };
}

export async function requireActiveActorInTx(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    userId: string;
    permission: Parameters<typeof roleHasPermission>[1];
  },
): Promise<{ role: OrganizationRole }> {
  const membership = await tx.membership.findUnique({
    where: {
      organizationId_userId: {
        organizationId: input.organizationId,
        userId: input.userId,
      },
    },
    select: { role: true, status: true },
  });
  if (!membership) {
    throw new OrganizationAuthError("not_a_member");
  }
  if (membership.status !== "ACTIVE") {
    throw new OrganizationAuthError("inactive_membership");
  }
  if (!roleHasPermission(membership.role, input.permission)) {
    throw new OrganizationAuthError("forbidden");
  }
  return { role: membership.role };
}

export type ReadinessResult = {
  ready: boolean;
  missing: string[];
  businessType: BusinessType | null;
};

/**
 * Server-side completion readiness. Never trust client isComplete flags.
 * Caller must hold the shared readiness lock when used for completion decisions.
 */
export async function computeConfigurationReadiness(
  db: DbClient,
  organizationId: string,
): Promise<ReadinessResult> {
  const [profile, location, hours, serviceCount, productCount] =
    await Promise.all([
      db.businessProfile.findUnique({ where: { organizationId } }),
      db.businessLocation.findFirst({
        where: { organizationId, isPrimary: true },
      }),
      db.operatingHourInterval.findMany({ where: { organizationId } }),
      db.businessService.count({
        where: { organizationId, isActive: true },
      }),
      db.businessProduct.count({
        where: { organizationId, isActive: true },
      }),
    ]);

  const missing: string[] = [];

  if (!profile?.displayName?.trim()) {
    missing.push("Customer-facing business name");
  }
  if (!profile?.industry?.trim()) {
    missing.push("Business category or industry");
  }
  if (!profile?.businessType) {
    missing.push("Business type");
  }
  if (!profile?.primaryEmail?.trim()) {
    missing.push("Primary business email");
  }
  if (!profile?.primaryPhoneE164?.trim()) {
    missing.push("Primary business phone");
  }
  if (!profile?.timeZone?.trim()) {
    missing.push("Organization time zone");
  }
  if (!location?.countryCode?.trim()) {
    missing.push("Country");
  }

  const daysPresent = new Set(hours.map((h) => h.dayOfWeek));
  for (const day of DAYS_OF_WEEK) {
    if (!daysPresent.has(day as DayOfWeek)) {
      missing.push("Complete weekly operating hours");
      break;
    }
  }
  if (hours.length === 0) {
    if (!missing.includes("Complete weekly operating hours")) {
      missing.push("Complete weekly operating hours");
    }
  }

  const businessType = profile?.businessType ?? null;
  if (businessType === "SERVICES" || businessType === "BOTH") {
    if (serviceCount < 1) {
      missing.push("At least one active service");
    }
  }
  if (businessType === "PRODUCTS" || businessType === "BOTH") {
    if (productCount < 1) {
      missing.push("At least one active product");
    }
  }

  return {
    ready: missing.length === 0,
    missing,
    businessType,
  };
}

/**
 * Recompute readiness and apply invalidation policy.
 * Caller must already hold the shared readiness lock.
 */
export async function refreshConfigurationReadiness(
  db: DbClient,
  organizationId: string,
): Promise<ReadinessResult> {
  const readiness = await computeConfigurationReadiness(db, organizationId);
  const onboarding = await db.organizationOnboarding.findUnique({
    where: { organizationId },
  });
  if (onboarding) {
    const nextStatus =
      onboarding.status === "COMPLETED" && !readiness.ready
        ? "IN_PROGRESS"
        : onboarding.status;

    await db.organizationOnboarding.update({
      where: { organizationId },
      data: {
        isConfigurationReady: readiness.ready && nextStatus === "COMPLETED",
        status: nextStatus,
        ...(nextStatus === "IN_PROGRESS" && onboarding.status === "COMPLETED"
          ? {
              completedAt: null,
              completedByUserId: null,
            }
          : {}),
        version: { increment: 1 },
      },
    });
  }
  return readiness;
}

/**
 * Mutating initializer for Phase 3A defaults. Must not be called from GET/read paths.
 * Intended for intentional start and write mutations that need rows to exist.
 */
export async function initializeBusinessDefaults(
  db: DbClient,
  organizationId: string,
): Promise<void> {
  await db.organizationSettings.upsert({
    where: { organizationId },
    create: { organizationId },
    update: {},
  });
  await db.businessProfile.upsert({
    where: { organizationId },
    create: { organizationId },
    update: {},
  });
  const primary = await db.businessLocation.findFirst({
    where: { organizationId, isPrimary: true },
  });
  if (!primary) {
    try {
      await db.businessLocation.create({
        data: {
          organizationId,
          label: "Primary",
          isPrimary: true,
        },
      });
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        (error as { code?: string }).code === "P2002"
      )) {
        throw error;
      }
    }
  }
}

/** @deprecated Use initializeBusinessDefaults — alias kept briefly for migration of call sites. */
export const ensureBusinessDefaults = initializeBusinessDefaults;

export async function markOnboardingStep(
  db: DbClient,
  input: {
    organizationId: string;
    step: OnboardingStepValue;
    nextStep?: OnboardingStepValue;
  },
): Promise<void> {
  const existing = await db.organizationOnboarding.findUnique({
    where: { organizationId: input.organizationId },
  });
  if (!existing) return;

  const completed = parseCompletedSteps(existing.completedSteps);
  if (!completed.includes(input.step)) {
    completed.push(input.step);
  }

  await db.organizationOnboarding.update({
    where: { organizationId: input.organizationId },
    data: {
      status: existing.status === "COMPLETED" ? "COMPLETED" : "IN_PROGRESS",
      currentStep: (input.nextStep ?? existing.currentStep) as OnboardingStep,
      completedSteps: completed,
      version: { increment: 1 },
    },
  });
}

/**
 * Read-only authorization for business info. Does not create settings/profile rows.
 * Missing settings default to allowing member reads (same as schema defaults).
 */
export async function assertCanReadBusinessInfo(input: {
  actor: SafeUser;
  organizationId: string;
  db: DbClient;
}): Promise<{ role: OrganizationRole }> {
  const membership = await requireOrganizationPermission({
    user: input.actor,
    organizationId: input.organizationId,
    permission: "org.business.read",
  });

  if (membership.role === "MEMBER") {
    const settings = await input.db.organizationSettings.findUnique({
      where: { organizationId: input.organizationId },
    });
    if (settings && !settings.membersCanViewBusinessInfo) {
      throw new OrganizationAuthError("forbidden");
    }
  }

  return { role: membership.role };
}

export async function assertCanReadServices(input: {
  actor: SafeUser;
  organizationId: string;
  db: DbClient;
}): Promise<{ role: OrganizationRole }> {
  const membership = await requireOrganizationPermission({
    user: input.actor,
    organizationId: input.organizationId,
    permission: "org.services.read",
  });
  if (membership.role === "MEMBER") {
    const settings = await input.db.organizationSettings.findUnique({
      where: { organizationId: input.organizationId },
    });
    if (settings && !settings.membersCanViewServices) {
      throw new OrganizationAuthError("forbidden");
    }
  }
  return { role: membership.role };
}

export async function assertCanReadProducts(input: {
  actor: SafeUser;
  organizationId: string;
  db: DbClient;
}): Promise<{ role: OrganizationRole }> {
  const membership = await requireOrganizationPermission({
    user: input.actor,
    organizationId: input.organizationId,
    permission: "org.products.read",
  });
  if (membership.role === "MEMBER") {
    const settings = await input.db.organizationSettings.findUnique({
      where: { organizationId: input.organizationId },
    });
    if (settings && !settings.membersCanViewProducts) {
      throw new OrganizationAuthError("forbidden");
    }
  }
  return { role: membership.role };
}

export function parseExpectedVersion(
  value: unknown,
): number | undefined | "invalid" {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0 ? value : "invalid";
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const n = Number(value);
    return Number.isInteger(n) && n >= 0 ? n : "invalid";
  }
  return "invalid";
}
