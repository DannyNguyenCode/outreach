import "server-only";

import type { Prisma } from "@prisma/client";

import {
  ConflictError,
  mapAuthError,
  requireActiveActorInTx,
  type AuthFailure,
} from "@/lib/orgs/business-access";

export { ConflictError, mapAuthError, requireActiveActorInTx };
export type { AuthFailure };

/**
 * Test-only seams for deterministic Phase 5A concurrency tests.
 * Production callers must omit these hooks.
 *
 * Global lock order for Phase 5A writers:
 * 1. `organization-prospects:<organizationId>` advisory lock
 * 2. Actor membership `FOR UPDATE` + permission recheck
 * 3. Prospect row(s) `FOR UPDATE` in stable id order
 * 4. Contact / channel / custom-value rows in stable id order
 *
 * NEVER acquire Phase 3A readiness, Phase 3B config, Phase 4 knowledge,
 * offerings, or CSV-import advisory locks from Phase 5A writers.
 * If a future writer must take multiple advisory families, acquire
 * Phase 3A readiness, then Phase 3B config, then Phase 4A knowledge,
 * then Phase 4C offerings, then Phase 4D CSV, then Phase 5A prospects.
 */
export type ProspectMutationTestHooks = {
  testBeforeProspectLock?: () => Promise<void>;
  testAfterProspectLock?: () => Promise<void>;
  testBeforeMembershipLock?: () => Promise<void>;
  testAfterMembershipLock?: () => Promise<void>;
  testBeforeProspectRowLock?: () => Promise<void>;
  testAfterProspectRowLock?: () => Promise<void>;
  testBeforeCommit?: () => Promise<void>;
  testAfterTransactionCommit?: () => Promise<void>;
};

export function organizationProspectsLockKey(organizationId: string): string {
  return `organization-prospects:${organizationId}`;
}

export async function acquireOrganizationProspectsLock(
  tx: Prisma.TransactionClient,
  organizationId: string,
  hooks: ProspectMutationTestHooks = {},
): Promise<void> {
  if (hooks.testBeforeProspectLock) {
    await hooks.testBeforeProspectLock();
  }
  const lockKey = organizationProspectsLockKey(organizationId);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
  if (hooks.testAfterProspectLock) {
    await hooks.testAfterProspectLock();
  }
}

export type LockedProspectRow = {
  id: string;
  organizationId: string;
  version: number;
  lifecycle: "ACTIVE" | "ARCHIVED" | "MERGED";
  mergedIntoProspectId: string | null;
  displayName: string;
};

export async function lockProspectsForUpdate(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; prospectIds: string[] },
  hooks: ProspectMutationTestHooks = {},
): Promise<LockedProspectRow[]> {
  const ids = [...new Set(input.prospectIds)].sort();
  if (ids.length === 0) {
    return [];
  }
  if (hooks.testBeforeProspectRowLock) {
    await hooks.testBeforeProspectRowLock();
  }
  const rows = await tx.$queryRaw<LockedProspectRow[]>`
    SELECT id, "organizationId", version, lifecycle::text AS lifecycle,
           "mergedIntoProspectId", "displayName"
    FROM "Prospect"
    WHERE "organizationId" = ${input.organizationId}
      AND id = ANY(${ids})
    ORDER BY id ASC
    FOR UPDATE
  `;
  if (hooks.testAfterProspectRowLock) {
    await hooks.testAfterProspectRowLock();
  }
  return rows;
}

export class ProspectNotFoundError extends Error {
  constructor(message = "Prospect was not found.") {
    super(message);
    this.name = "ProspectNotFoundError";
  }
}

export class ProspectLifecycleError extends Error {
  readonly code:
    "archived" | "merged" | "not_archived" | "self_merge" | "circular_merge";

  constructor(
    code:
      "archived" | "merged" | "not_archived" | "self_merge" | "circular_merge",
    message: string,
  ) {
    super(message);
    this.name = "ProspectLifecycleError";
    this.code = code;
  }
}

export function mapProspectError(error: unknown): AuthFailure | null {
  if (error instanceof ProspectNotFoundError) {
    return {
      ok: false,
      reason: "not_found",
      message: error.message,
    };
  }
  if (error instanceof ProspectLifecycleError) {
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
      message: "This prospect changed. Reload the page, then try again.",
    };
  }
  return mapAuthError(error);
}

export function assertMutableProspect(row: LockedProspectRow): void {
  if (row.lifecycle === "MERGED") {
    throw new ProspectLifecycleError(
      "merged",
      "Merged prospects cannot be edited. Open the surviving prospect instead.",
    );
  }
}

export function assertActiveProspect(row: LockedProspectRow): void {
  assertMutableProspect(row);
  if (row.lifecycle === "ARCHIVED") {
    throw new ProspectLifecycleError(
      "archived",
      "Archived prospects cannot be edited until they are restored.",
    );
  }
}
