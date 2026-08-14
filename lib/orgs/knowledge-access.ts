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
 * Test-only seams for deterministic Phase 4A concurrency tests.
 * Production callers must omit these hooks.
 *
 * Global lock order for Phase 4A writers (documented protocol):
 * 1. `organization-knowledge:<organizationId>` advisory lock
 * 2. Actor membership `FOR UPDATE` + permission recheck
 * 3. Logical source row `FOR UPDATE` (when mutating an existing source)
 * 4. Version row(s) `FOR UPDATE` in stable id order (confirm: the target
 *    version; archive: ACTIVE and DRAFT versions for that source)
 * 5. Tenant-scoped section/passage rows in stable order
 *
 * NEVER acquire the Phase 3A readiness lock (`organization-readiness:`) or the
 * Phase 3B config lock (`organization-config-3b:`) from Phase 4A writers.
 * Deadlock-safe vs Phase 3A/3B because the families share only membership
 * row locks. If a future writer must take multiple advisory families, acquire
 * Phase 3A readiness, then Phase 3B config, then Phase 4A knowledge.
 */
export type KnowledgeMutationTestHooks = {
  /** Invoked immediately before acquiring the shared Phase 4A knowledge lock. */
  testBeforeKnowledgeLock?: () => Promise<void>;
  /**
   * Invoked after the Phase 4A knowledge lock is held and before the
   * membership row lock / permission recheck.
   */
  testAfterKnowledgeLock?: () => Promise<void>;
  /** Invoked immediately before locking the actor membership row. */
  testBeforeMembershipLock?: () => Promise<void>;
  /** Invoked after the actor membership row lock is held. */
  testAfterMembershipLock?: () => Promise<void>;
  /** Invoked immediately before locking the logical source row. */
  testBeforeSourceLock?: () => Promise<void>;
  /** Invoked after the logical source row lock is held. */
  testAfterSourceLock?: () => Promise<void>;
  /**
   * Invoked after the mutation transaction commits successfully and before the
   * service returns its success payload.
   */
  testAfterTransactionCommit?: () => Promise<void>;
};

export function organizationKnowledgeLockKey(organizationId: string): string {
  return `organization-knowledge:${organizationId}`;
}

/**
 * Acquire the shared Phase 4A knowledge advisory lock inside a transaction.
 * Must be called before reading or mutating knowledge in writers.
 */
export async function acquireOrganizationKnowledgeLock(
  tx: Prisma.TransactionClient,
  organizationId: string,
  hooks: KnowledgeMutationTestHooks = {},
): Promise<void> {
  if (hooks.testBeforeKnowledgeLock) {
    await hooks.testBeforeKnowledgeLock();
  }
  const lockKey = organizationKnowledgeLockKey(organizationId);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
  if (hooks.testAfterKnowledgeLock) {
    await hooks.testAfterKnowledgeLock();
  }
}

export async function lockKnowledgeSourceForUpdate(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; sourceId: string },
  hooks: KnowledgeMutationTestHooks = {},
): Promise<{ id: string; version: number; archivedAt: Date | null } | null> {
  if (hooks.testBeforeSourceLock) {
    await hooks.testBeforeSourceLock();
  }
  const rows = await tx.$queryRaw<
    Array<{ id: string; version: number; archivedAt: Date | null }>
  >`
    SELECT id, version, "archivedAt"
    FROM "KnowledgeSource"
    WHERE id = ${input.sourceId}
      AND "organizationId" = ${input.organizationId}
    FOR UPDATE
  `;
  if (hooks.testAfterSourceLock) {
    await hooks.testAfterSourceLock();
  }
  return rows[0] ?? null;
}

export async function lockKnowledgeVersionForUpdate(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; sourceId: string; versionId: string },
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
    SELECT id, state, "draftRevision", "contentChecksum"
    FROM "KnowledgeVersion"
    WHERE id = ${input.versionId}
      AND "sourceId" = ${input.sourceId}
      AND "organizationId" = ${input.organizationId}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

/**
 * Lock ACTIVE and DRAFT versions for a source in stable id order. Used by
 * archive so the documented version `FOR UPDATE` step is literal.
 */
export async function lockActiveAndDraftKnowledgeVersionsForUpdate(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; sourceId: string },
): Promise<Array<{ id: string; state: string }>> {
  return tx.$queryRaw<Array<{ id: string; state: string }>>`
    SELECT id, state
    FROM "KnowledgeVersion"
    WHERE "sourceId" = ${input.sourceId}
      AND "organizationId" = ${input.organizationId}
      AND state IN ('ACTIVE', 'DRAFT')
    ORDER BY id ASC
    FOR UPDATE
  `;
}

export class KnowledgeLifecycleError extends Error {
  readonly code:
    | "not_draft"
    | "already_archived"
    | "not_restorable"
    | "draft_exists"
    | "checksum_mismatch"
    | "not_confirmable";

  constructor(
    code:
      | "not_draft"
      | "already_archived"
      | "not_restorable"
      | "draft_exists"
      | "checksum_mismatch"
      | "not_confirmable",
    message: string,
  ) {
    super(message);
    this.name = "KnowledgeLifecycleError";
    this.code = code;
  }
}

export class KnowledgeNotFoundError extends Error {
  constructor(message = "Knowledge was not found.") {
    super(message);
    this.name = "KnowledgeNotFoundError";
  }
}

export function mapKnowledgeError(error: unknown): AuthFailure | null {
  if (error instanceof KnowledgeNotFoundError) {
    return {
      ok: false,
      reason: "not_found",
      message: error.message,
    };
  }
  if (error instanceof KnowledgeLifecycleError) {
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
      message: "This knowledge changed. Reload the page, then try again.",
    };
  }
  return mapAuthError(error);
}
