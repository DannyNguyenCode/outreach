import "server-only";

import type {
  BusinessType,
  DayOfWeek,
  OrganizationRole,
  Prisma,
  PrismaClient,
} from "@prisma/client";

import type { SafeUser } from "@/lib/auth/users";
import {
  OrganizationAuthError,
  requireOrganizationPermission,
} from "@/lib/orgs/authorization";
import { DAYS_OF_WEEK } from "@/lib/orgs/business-validation";
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
 * Test-only seams for deterministic concurrency tests.
 * Production callers must omit these hooks.
 *
 * Global lock order for sensitive Phase 3A mutations:
 * 1. Organization readiness advisory lock (when required)
 * 2. Actor membership row lock (`SELECT … FOR UPDATE`)
 * 3. Specialized configuration locks (`hours:`, `services-order:`, …)
 * 4. Other rows in a stable deterministic order
 *
 * Membership demotion/offboarding lock the target membership row with the same
 * `FOR UPDATE` protocol so authorization races linearize on that row.
 */
export type ReadinessMutationTestHooks = {
  /** Invoked immediately before acquiring the shared readiness lock. */
  testBeforeReadinessLock?: () => Promise<void>;
  /**
   * Invoked after the shared readiness lock is held and before the
   * membership row lock / permission recheck.
   */
  testAfterReadinessLock?: () => Promise<void>;
  /** Invoked immediately before locking the actor membership row. */
  testBeforeMembershipLock?: () => Promise<void>;
  /** Invoked after the actor membership row lock is held. */
  testAfterMembershipLock?: () => Promise<void>;
};

/** Test seams for membership role/status mutations (demotion / offboarding). */
export type MembershipMutationTestHooks = {
  testBeforeTargetMembershipLock?: () => Promise<void>;
  testAfterTargetMembershipLock?: () => Promise<void>;
};

export class ConflictError extends Error {
  constructor(message = "conflict") {
    super(message);
    this.name = "ConflictError";
  }
}

/** Completed onboarding cannot accept ordinary progress mutations. */
export class OnboardingLifecycleError extends Error {
  readonly code = "already_completed" as const;

  constructor(
    message = "Onboarding is complete. Reopen it before changing progress.",
  ) {
    super(message);
    this.name = "OnboardingLifecycleError";
  }
}

/**
 * Lock key namespace for all readiness-affecting Phase 3A mutations.
 *
 * Ordering rule (prevents deadlocks):
 * 1. Always acquire `organization-readiness:<organizationId>` first.
 * 2. Lock the actor's membership row with `FOR UPDATE`.
 * 3. Only then acquire any specialized locks (`hours:`, `services-order:`,
 *    `products-order:`) if still needed for that operation.
 * 4. Never acquire specialized locks before the readiness lock when both are used.
 * 5. Reorder-only operations that do not affect completion readiness may use
 *    their specialized locks alone (still recheck membership under `FOR UPDATE`).
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
  if (error instanceof OnboardingLifecycleError) {
    return {
      ok: false,
      reason: error.code,
      message: error.message,
    };
  }
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

type LockedMembershipRow = {
  id: string;
  role: OrganizationRole;
  status: "ACTIVE" | "INACTIVE";
};

/**
 * Lock a membership row by organization + user with `SELECT … FOR UPDATE`.
 * Call only inside an open transaction. Read role/status only after the lock.
 */
export async function lockMembershipByUserForUpdate(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; userId: string },
  hooks: Pick<
    ReadinessMutationTestHooks,
    "testBeforeMembershipLock" | "testAfterMembershipLock"
  > = {},
): Promise<LockedMembershipRow | null> {
  if (hooks.testBeforeMembershipLock) {
    await hooks.testBeforeMembershipLock();
  }
  const rows = await tx.$queryRaw<LockedMembershipRow[]>`
    SELECT id, role, status
    FROM "Membership"
    WHERE "organizationId" = ${input.organizationId}
      AND "userId" = ${input.userId}
    FOR UPDATE
  `;
  if (hooks.testAfterMembershipLock) {
    await hooks.testAfterMembershipLock();
  }
  return rows[0] ?? null;
}

/**
 * Lock a membership row by id (tenant-scoped) with `SELECT … FOR UPDATE`.
 * Used by demotion/offboarding so authorization races share the same row lock
 * as sensitive Phase 3A mutations that lock the actor membership.
 */
export async function lockMembershipByIdForUpdate(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; membershipId: string },
  hooks: MembershipMutationTestHooks = {},
): Promise<
  (LockedMembershipRow & { userId: string; organizationId: string }) | null
> {
  if (hooks.testBeforeTargetMembershipLock) {
    await hooks.testBeforeTargetMembershipLock();
  }
  const rows = await tx.$queryRaw<
    Array<LockedMembershipRow & { userId: string; organizationId: string }>
  >`
    SELECT id, role, status, "userId", "organizationId"
    FROM "Membership"
    WHERE id = ${input.membershipId}
      AND "organizationId" = ${input.organizationId}
    FOR UPDATE
  `;
  if (hooks.testAfterTargetMembershipLock) {
    await hooks.testAfterTargetMembershipLock();
  }
  return rows[0] ?? null;
}

/**
 * Recheck active membership + permission after locks are held.
 * Always locks the actor membership row before reading authorization state.
 */
export async function requireActiveActorInTx(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    userId: string;
    permission: Parameters<typeof roleHasPermission>[1];
  },
  hooks: Pick<
    ReadinessMutationTestHooks,
    "testBeforeMembershipLock" | "testAfterMembershipLock"
  > = {},
): Promise<{ role: OrganizationRole; membershipId: string }> {
  const membership = await lockMembershipByUserForUpdate(
    tx,
    {
      organizationId: input.organizationId,
      userId: input.userId,
    },
    hooks,
  );
  if (!membership) {
    throw new OrganizationAuthError("not_a_member");
  }
  if (membership.status !== "ACTIVE") {
    throw new OrganizationAuthError("inactive_membership");
  }
  if (!roleHasPermission(membership.role, input.permission)) {
    throw new OrganizationAuthError("forbidden");
  }
  return { role: membership.role, membershipId: membership.id };
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
 * Only writes (and bumps version) when status or readiness actually change.
 */
export async function refreshConfigurationReadiness(
  db: DbClient,
  organizationId: string,
): Promise<ReadinessResult> {
  const readiness = await computeConfigurationReadiness(db, organizationId);
  const onboarding = await db.organizationOnboarding.findUnique({
    where: { organizationId },
  });
  if (!onboarding) {
    return readiness;
  }

  const nextStatus =
    onboarding.status === "COMPLETED" && !readiness.ready
      ? "IN_PROGRESS"
      : onboarding.status;
  const nextReady = readiness.ready && nextStatus === "COMPLETED";
  const clearingCompletion =
    nextStatus === "IN_PROGRESS" && onboarding.status === "COMPLETED";

  if (
    onboarding.status === nextStatus &&
    onboarding.isConfigurationReady === nextReady &&
    !clearingCompletion
  ) {
    return readiness;
  }

  await db.organizationOnboarding.update({
    where: { organizationId },
    data: {
      isConfigurationReady: nextReady,
      status: nextStatus,
      ...(clearingCompletion
        ? {
            completedAt: null,
            completedByUserId: null,
          }
        : {}),
      version: { increment: 1 },
    },
  });
  return readiness;
}

/**
 * Mutating initializer for Phase 3A defaults.
 * Must not be called from GET/read paths.
 * Only `startOrganizationOnboarding` should create the initial Phase 3A rows.
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
