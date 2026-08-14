import "server-only";

import type { Prisma } from "@prisma/client";

import {
  ConflictError,
  mapAuthError,
  requireActiveActorInTx,
  type AuthFailure,
  type DbClient,
} from "@/lib/orgs/business-access";

export { ConflictError, mapAuthError, requireActiveActorInTx };
export type { AuthFailure, DbClient };

/**
 * Test-only seams for deterministic Phase 3B concurrency tests.
 * Production callers must omit these hooks.
 *
 * Global lock order for Phase 3B writers (documented protocol):
 * 1. `organization-config-3b:<organizationId>` advisory lock
 * 2. Actor membership `FOR UPDATE` + permission recheck
 * 3. Specialized section locks when needed
 *    (`service-areas-order:`, `custom-fields-order:`, `closures:`,
 *    `lead-stages:`, `dispositions:`)
 * 4. Tenant rows in a stable deterministic order
 *
 * NEVER acquire the Phase 3A readiness lock (`organization-readiness:`) from
 * Phase 3B writers — keeps readiness semantics decoupled. Deadlock-safe vs
 * Phase 3A because both families only share membership row locks.
 */
export type Config3bMutationTestHooks = {
  /** Invoked immediately before acquiring the shared Phase 3B config lock. */
  testBeforeConfig3bLock?: () => Promise<void>;
  /**
   * Invoked after the Phase 3B config lock is held and before the
   * membership row lock / permission recheck.
   */
  testAfterConfig3bLock?: () => Promise<void>;
  /** Invoked immediately before locking the actor membership row. */
  testBeforeMembershipLock?: () => Promise<void>;
  /** Invoked after the actor membership row lock is held. */
  testAfterMembershipLock?: () => Promise<void>;
  /**
   * Invoked immediately before acquiring a specialized Phase 3B section lock.
   * Production must omit.
   */
  testBeforeSectionLock?: () => Promise<void>;
  /**
   * Invoked after a specialized Phase 3B section advisory lock is held.
   * Production must omit.
   */
  testAfterSectionLock?: () => Promise<void>;
  /**
   * Invoked after the mutation transaction commits successfully and before the
   * service returns its success payload.
   */
  testAfterTransactionCommit?: () => Promise<void>;
};

export function organizationConfig3bLockKey(organizationId: string): string {
  return `organization-config-3b:${organizationId}`;
}

/**
 * Acquire the shared Phase 3B organization-config advisory lock inside a
 * transaction. Must be called before reading or mutating Phase 3B configuration
 * in writers. Never use the Phase 3A readiness lock from here.
 */
export async function acquireOrganizationConfig3bLock(
  tx: Prisma.TransactionClient,
  organizationId: string,
  hooks: Config3bMutationTestHooks = {},
): Promise<void> {
  if (hooks.testBeforeConfig3bLock) {
    await hooks.testBeforeConfig3bLock();
  }
  const lockKey = organizationConfig3bLockKey(organizationId);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
  if (hooks.testAfterConfig3bLock) {
    await hooks.testAfterConfig3bLock();
  }
}

/** Specialized section lock key helpers (Phase 3B only). */
export function serviceAreasOrderLockKey(organizationId: string): string {
  return `service-areas-order:${organizationId}`;
}

export function customFieldsOrderLockKey(organizationId: string): string {
  return `custom-fields-order:${organizationId}`;
}

export function closuresLockKey(organizationId: string): string {
  return `closures:${organizationId}`;
}

export function leadStagesLockKey(organizationId: string): string {
  return `lead-stages:${organizationId}`;
}

export function dispositionsLockKey(organizationId: string): string {
  return `dispositions:${organizationId}`;
}

/**
 * Acquire a specialized Phase 3B section advisory lock.
 * Caller must already hold `organization-config-3b` and the actor membership lock.
 */
export async function acquireConfig3bSectionLock(
  tx: Prisma.TransactionClient,
  lockKey: string,
  hooks: Config3bMutationTestHooks = {},
): Promise<void> {
  if (hooks.testBeforeSectionLock) {
    await hooks.testBeforeSectionLock();
  }
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
  if (hooks.testAfterSectionLock) {
    await hooks.testAfterSectionLock();
  }
}

/**
 * Mutating initializer for Phase 3B safe defaults.
 * Must not be called from GET/read paths — only from explicit mutations such as
 * `startConfigProgress`.
 *
 * Creates empty locale / callback / recording / notification / progress rows
 * with SAFE defaults (recording and transcription OFF). Never creates template
 * assignment, custom fields, service areas, stages, dispositions, or closures.
 * Does not touch OrganizationOnboarding or isConfigurationReady.
 */
export async function initializeOrganizationConfig3bDefaults(
  db: DbClient,
  organizationId: string,
): Promise<void> {
  await db.organizationLocaleSettings.upsert({
    where: { organizationId },
    create: { organizationId },
    update: {},
  });
  await db.organizationCallbackPolicy.upsert({
    where: { organizationId },
    create: { organizationId },
    update: {},
  });
  await db.organizationRecordingConsentPolicy.upsert({
    where: { organizationId },
    create: {
      organizationId,
      recordingEnabled: false,
      transcriptionEnabled: false,
      consentCaptureRequired: true,
    },
    update: {},
  });
  await db.organizationNotificationDefaults.upsert({
    where: { organizationId },
    create: { organizationId },
    update: {},
  });
  await db.organizationConfigProgress.upsert({
    where: { organizationId },
    create: { organizationId },
    update: {},
  });
}
