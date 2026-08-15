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
 * Test-only seams for deterministic Phase 4C concurrency tests.
 *
 * Lock order for offering writers:
 * 1. `organization-offerings:<organizationId>` advisory lock
 * 2. Actor membership `FOR UPDATE` + permission recheck
 * 3. Offering row `FOR UPDATE`
 * 4. Version row(s) `FOR UPDATE` in stable id order
 * 5. Child rows in stable order
 *
 * NEVER acquire Phase 3A readiness, Phase 3B config, or Phase 4A/4B knowledge
 * locks from Phase 4C writers.
 */
export type OfferingMutationTestHooks = {
  testBeforeOfferingsLock?: () => Promise<void>;
  testAfterOfferingsLock?: () => Promise<void>;
  testBeforeMembershipLock?: () => Promise<void>;
  testAfterMembershipLock?: () => Promise<void>;
  testBeforeOfferingLock?: () => Promise<void>;
  testAfterOfferingLock?: () => Promise<void>;
  testAfterTransactionCommit?: () => Promise<void>;
};

export function organizationOfferingsLockKey(organizationId: string): string {
  return `organization-offerings:${organizationId}`;
}

export async function acquireOrganizationOfferingsLock(
  tx: Prisma.TransactionClient,
  organizationId: string,
  hooks: OfferingMutationTestHooks = {},
): Promise<void> {
  if (hooks.testBeforeOfferingsLock) {
    await hooks.testBeforeOfferingsLock();
  }
  const lockKey = organizationOfferingsLockKey(organizationId);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
  if (hooks.testAfterOfferingsLock) {
    await hooks.testAfterOfferingsLock();
  }
}

export async function lockOfferingForUpdate(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; offeringId: string },
  hooks: OfferingMutationTestHooks = {},
): Promise<{
  id: string;
  version: number;
  archivedAt: Date | null;
  offeringType: string;
} | null> {
  if (hooks.testBeforeOfferingLock) {
    await hooks.testBeforeOfferingLock();
  }
  const rows = await tx.$queryRaw<
    Array<{
      id: string;
      version: number;
      archivedAt: Date | null;
      offeringType: string;
    }>
  >`
    SELECT id, version, "archivedAt", "offeringType"::text AS "offeringType"
    FROM "Offering"
    WHERE id = ${input.offeringId}
      AND "organizationId" = ${input.organizationId}
    FOR UPDATE
  `;
  if (hooks.testAfterOfferingLock) {
    await hooks.testAfterOfferingLock();
  }
  return rows[0] ?? null;
}

export async function lockOfferingVersionForUpdate(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; offeringId: string; versionId: string },
): Promise<{
  id: string;
  state: string;
  draftRevision: number;
  contentChecksum: string;
} | null> {
  const rows = await tx.$queryRaw<
    Array<{
      id: string;
      state: string;
      draftRevision: number;
      contentChecksum: string;
    }>
  >`
    SELECT id, state::text AS state, "draftRevision", "contentChecksum"
    FROM "OfferingVersion"
    WHERE id = ${input.versionId}
      AND "offeringId" = ${input.offeringId}
      AND "organizationId" = ${input.organizationId}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

export async function lockActiveAndDraftOfferingVersionsForUpdate(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; offeringId: string },
): Promise<Array<{ id: string; state: string }>> {
  return tx.$queryRaw<Array<{ id: string; state: string }>>`
    SELECT id, state::text AS state
    FROM "OfferingVersion"
    WHERE "offeringId" = ${input.offeringId}
      AND "organizationId" = ${input.organizationId}
      AND state IN ('ACTIVE', 'DRAFT')
    ORDER BY id ASC
    FOR UPDATE
  `;
}

export class OfferingLifecycleError extends Error {
  readonly code:
    | "not_draft"
    | "already_archived"
    | "not_restorable"
    | "draft_exists"
    | "checksum_mismatch"
    | "not_confirmable"
    | "conflicting_prices";

  constructor(
    code:
      | "not_draft"
      | "already_archived"
      | "not_restorable"
      | "draft_exists"
      | "checksum_mismatch"
      | "not_confirmable"
      | "conflicting_prices",
    message: string,
  ) {
    super(message);
    this.name = "OfferingLifecycleError";
    this.code = code;
  }
}

export class OfferingNotFoundError extends Error {
  constructor(message = "Offering was not found.") {
    super(message);
    this.name = "OfferingNotFoundError";
  }
}

export function mapOfferingError(error: unknown): AuthFailure | null {
  if (error instanceof OfferingNotFoundError) {
    return {
      ok: false,
      reason: "not_found",
      message: error.message,
    };
  }
  if (error instanceof OfferingLifecycleError) {
    return {
      ok: false,
      reason: error.code,
      message: error.message,
    };
  }
  if (error instanceof ConflictError) {
    return {
      ok: false,
      reason: "conflict",
      message: "This offering changed. Reload the page, then try again.",
    };
  }
  return mapAuthError(error);
}
