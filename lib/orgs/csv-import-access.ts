import "server-only";

import type { Prisma } from "@prisma/client";

import {
  mapAuthError,
  requireActiveActorInTx,
  type AuthFailure,
  type DbClient,
} from "@/lib/orgs/business-access";

export { mapAuthError, requireActiveActorInTx };
export type { AuthFailure, DbClient };

/**
 * Test-only seams for deterministic Phase 4D CSV import concurrency tests.
 * Production callers must omit these hooks.
 *
 * Lock order for CSV import writers:
 * 1. `organization-csv-import:<organizationId>` advisory lock
 * 2. Actor membership `FOR UPDATE` + permission recheck
 * 3. Unique identity lookup / insert
 *
 * NEVER acquire Phase 3A readiness, Phase 3B config, Phase 4A/4B knowledge,
 * or Phase 4C offerings locks from CSV import writers.
 */
export type CsvImportMutationTestHooks = {
  testBeforeCsvImportLock?: () => Promise<void>;
  testAfterCsvImportLock?: () => Promise<void>;
  testBeforeMembershipLock?: () => Promise<void>;
  testAfterMembershipLock?: () => Promise<void>;
  testAfterExistingLookup?: () => Promise<void>;
  testBeforeRowsInsert?: () => Promise<void>;
  testAfterTransactionCommit?: () => Promise<void>;
};

export function organizationCsvImportLockKey(organizationId: string): string {
  return `organization-csv-import:${organizationId}`;
}

export async function acquireOrganizationCsvImportLock(
  tx: Prisma.TransactionClient,
  organizationId: string,
  hooks: CsvImportMutationTestHooks = {},
): Promise<void> {
  if (hooks.testBeforeCsvImportLock) {
    await hooks.testBeforeCsvImportLock();
  }
  const lockKey = organizationCsvImportLockKey(organizationId);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
  if (hooks.testAfterCsvImportLock) {
    await hooks.testAfterCsvImportLock();
  }
}

export class CsvImportNotFoundError extends Error {
  constructor(message = "Import not found.") {
    super(message);
    this.name = "CsvImportNotFoundError";
  }
}

export class CsvImportIncompleteError extends Error {
  readonly code = "incomplete" as const;

  constructor(
    message = "Incomplete CSV validation cannot be staged for review.",
  ) {
    super(message);
    this.name = "CsvImportIncompleteError";
  }
}
