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

export type CsvImportActivationTestHooks = CsvImportMutationTestHooks & {
  testBeforeDomainLock?: () => Promise<void>;
  testAfterDomainLock?: () => Promise<void>;
  testAfterExistingConfirmationLookup?: () => Promise<void>;
  testBeforeDomainWrites?: () => Promise<void>;
  testBeforeActivateRow?: (index: number) => Promise<void>;
  testBeforeConfirmationInsert?: () => Promise<void>;
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

export class CsvImportCorruptSnapshotError extends Error {
  readonly code = "corrupt_snapshot" as const;

  constructor(
    message = "This import snapshot is inconsistent and cannot be confirmed.",
  ) {
    super(message);
    this.name = "CsvImportCorruptSnapshotError";
  }
}

export class CsvImportNotConfirmableError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CsvImportNotConfirmableError";
    this.code = code;
  }
}

export async function lockCsvImportForUpdate(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; importId: string },
): Promise<{
  id: string;
  importIdentity: string;
  status: string;
  sourceChecksum: string;
  targetFamily: string;
  mappingJson: string;
  mappingIdentity: string;
  validationContractVersion: string;
  validRowCount: number;
  invalidRowCount: number;
  issueCount: number;
  totalRowCount: number;
} | null> {
  const rows = await tx.$queryRaw<
    Array<{
      id: string;
      importIdentity: string;
      status: string;
      sourceChecksum: string;
      targetFamily: string;
      mappingJson: string;
      mappingIdentity: string;
      validationContractVersion: string;
      validRowCount: number;
      invalidRowCount: number;
      issueCount: number;
      totalRowCount: number;
    }>
  >`
    SELECT
      id,
      "importIdentity",
      status::text AS status,
      "sourceChecksum",
      "targetFamily"::text AS "targetFamily",
      "mappingJson",
      "mappingIdentity",
      "validationContractVersion",
      "validRowCount",
      "invalidRowCount",
      "issueCount",
      "totalRowCount"
    FROM "CsvImport"
    WHERE id = ${input.importId}
      AND "organizationId" = ${input.organizationId}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}
