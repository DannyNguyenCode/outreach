import "server-only";

import type {
  CsvImport as CsvImportRowModel,
  CsvImportStatus,
  CsvImportTargetFamily,
  Prisma,
} from "@prisma/client";
import { Prisma as PrismaNamespace } from "@prisma/client";

import type { SafeUser } from "@/lib/auth/users";
import { recordOrganizationAuditEvent } from "@/lib/orgs/audit";
import {
  OrganizationAuthError,
  requireOrganizationPermission,
} from "@/lib/orgs/authorization";
import {
  acquireOrganizationCsvImportLock,
  CsvImportIncompleteError,
  CsvImportNotFoundError,
  mapAuthError,
  requireActiveActorInTx,
  type CsvImportMutationTestHooks,
} from "@/lib/orgs/csv-import-access";
import {
  CSV_IMPORT_VALIDATION_CONTRACT_VERSION,
  deriveCsvImportIdentity,
  identityPrefix,
  parseStoredCanonicalMapping,
  parseStoredMappedIssues,
  parseStoredMappedValues,
  serializeCanonicalMapping,
  serializeMappedRow,
} from "@/lib/orgs/csv-import-identity";
import { CSV_IMPORT_RECENT_LIMIT } from "@/lib/orgs/csv-import-confirmation";
import {
  validateMappedCsvFile,
  type CsvMappedFileResult,
  type ValidateMappedCsvFileInput,
} from "@/lib/orgs/tabular-csv-file";
import { TabularValidationError } from "@/lib/orgs/tabular-helpers";
import {
  CsvMappingError,
  type CsvMappedPreviewRow,
  type CsvMappedRowIssue,
  type CsvMappingInput,
  type CsvMappingTargetFamily,
} from "@/lib/orgs/tabular-mapping";
import { prisma } from "@/lib/prisma";

export {
  CSV_IMPORT_VALIDATION_CONTRACT_VERSION,
  deriveCsvImportIdentity,
} from "@/lib/orgs/csv-import-identity";
export type { CsvImportMutationTestHooks } from "@/lib/orgs/csv-import-access";

const MANAGE_PERMISSION = "org.knowledge.manage" as const;

export type CsvImportFailure = {
  ok: false;
  reason: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
};

export type CsvImportRowView = CsvMappedPreviewRow & {
  id: string;
  displayOrder: number;
};

export type CsvImportListItem = {
  id: string;
  filename: string;
  family: CsvMappingTargetFamily;
  status: CsvImportStatus;
  createdAt: Date;
  totalRowCount: number;
  validRowCount: number;
  invalidRowCount: number;
  issueCount: number;
  confirmed: boolean;
};

export type CsvImportView = {
  id: string;
  organizationId: string;
  importIdentity: string;
  family: CsvMappingTargetFamily;
  status: CsvImportStatus;
  filename: string;
  mimeType: string;
  byteLength: number;
  sourceChecksum: string;
  mapping: CsvMappingInput;
  mappingIdentity: string;
  validationContractVersion: string;
  totalRowCount: number;
  nonblankRowCount: number;
  validRowCount: number;
  invalidRowCount: number;
  skippedBlankRowCount: number;
  processedRowCount: number;
  issueCount: number;
  createdByUserId: string;
  createdAt: Date;
  rows: CsvImportRowView[];
  issues: CsvMappedRowIssue[];
};

export type StageCsvImportInput = {
  actor: SafeUser | null;
  organizationId: string;
  bytes: Uint8Array;
  filename: string;
  declaredMimeType: string;
  mapping: unknown;
  now?: ValidateMappedCsvFileInput["now"];
  shouldTimeout?: ValidateMappedCsvFileInput["shouldTimeout"];
};

export type GetCsvImportInput = {
  actor: SafeUser | null;
  organizationId: string;
  importId: string;
};

function requireActor(actor: SafeUser | null): SafeUser {
  if (!actor) {
    throw new OrganizationAuthError("unauthenticated");
  }
  return actor;
}

function toMappingFamily(
  family: CsvImportTargetFamily,
): CsvMappingTargetFamily {
  return family === "KNOWLEDGE" ? "knowledge" : "offering";
}

function toDbFamily(family: CsvMappingTargetFamily): CsvImportTargetFamily {
  return family === "knowledge" ? "KNOWLEDGE" : "OFFERING";
}

function statusFromCompleteResult(
  result: CsvMappedFileResult,
): CsvImportStatus {
  return result.invalidRowCount === 0 && result.issueCount === 0
    ? "READY_TO_CONFIRM"
    : "NEEDS_ATTENTION";
}

function toView(
  record: CsvImportRowModel,
  rowRecords: Array<{
    id: string;
    displayOrder: number;
    sourceRowNumber: number;
    valuesJson: string;
    issuesJson: string;
  }>,
): CsvImportView {
  const mapping = parseStoredCanonicalMapping(record.mappingJson);
  const mappingIdentity = serializeCanonicalMapping(mapping);
  const rows = [...rowRecords]
    .sort((left, right) => left.displayOrder - right.displayOrder)
    .map((row) => ({
      id: row.id,
      displayOrder: row.displayOrder,
      sourceRowNumber: row.sourceRowNumber,
      values: parseStoredMappedValues(row.valuesJson, mapping),
      issues: parseStoredMappedIssues(row.issuesJson),
    }));
  const issues = rows.flatMap((row) => row.issues);
  return {
    id: record.id,
    organizationId: record.organizationId,
    importIdentity: record.importIdentity,
    family: toMappingFamily(record.targetFamily),
    status: record.status,
    filename: record.filename,
    mimeType: record.mimeType,
    byteLength: record.byteLength,
    sourceChecksum: record.sourceChecksum,
    mapping,
    mappingIdentity,
    validationContractVersion: record.validationContractVersion,
    totalRowCount: record.totalRowCount,
    nonblankRowCount: record.nonblankRowCount,
    validRowCount: record.validRowCount,
    invalidRowCount: record.invalidRowCount,
    skippedBlankRowCount: record.skippedBlankRowCount,
    processedRowCount: record.processedRowCount,
    issueCount: record.issueCount,
    createdByUserId: record.createdByUserId,
    createdAt: record.createdAt,
    rows,
    issues,
  };
}

async function loadImportView(
  db: Prisma.TransactionClient | typeof prisma,
  input: { organizationId: string; importId: string },
): Promise<CsvImportView | null> {
  const record = await db.csvImport.findFirst({
    where: {
      id: input.importId,
      organizationId: input.organizationId,
    },
  });
  if (!record) {
    return null;
  }
  const rows = await db.csvImportRow.findMany({
    where: {
      importId: record.id,
      organizationId: input.organizationId,
    },
    orderBy: { displayOrder: "asc" },
    select: {
      id: true,
      displayOrder: true,
      sourceRowNumber: true,
      valuesJson: true,
      issuesJson: true,
    },
  });
  return toView(record, rows);
}

function mapCsvImportError(error: unknown): CsvImportFailure | null {
  const auth = mapAuthError(error);
  if (auth) {
    return auth;
  }
  if (error instanceof CsvImportNotFoundError) {
    return {
      ok: false,
      reason: "not_found",
      message: "Import not found.",
    };
  }
  if (error instanceof CsvImportIncompleteError) {
    return {
      ok: false,
      reason: "incomplete",
      message: error.message,
    };
  }
  if (error instanceof TabularValidationError) {
    return {
      ok: false,
      reason: error.code,
      message: error.message,
    };
  }
  if (error instanceof CsvMappingError) {
    return {
      ok: false,
      reason: error.code,
      message: error.message,
    };
  }
  return null;
}

async function persistNewImport(
  tx: Prisma.TransactionClient,
  input: {
    actor: SafeUser;
    organizationId: string;
    importIdentity: string;
    validated: CsvMappedFileResult;
    hooks: CsvImportMutationTestHooks;
  },
): Promise<CsvImportView> {
  const status = statusFromCompleteResult(input.validated);
  const mappingJson = serializeCanonicalMapping(input.validated.mapping);
  const created = await tx.csvImport.create({
    data: {
      organizationId: input.organizationId,
      importIdentity: input.importIdentity,
      targetFamily: toDbFamily(input.validated.family),
      status,
      filename: input.validated.filename,
      mimeType: input.validated.mimeType,
      byteLength: input.validated.byteLength,
      sourceChecksum: input.validated.sourceChecksum,
      mappingJson,
      mappingIdentity: input.validated.mappingIdentity,
      validationContractVersion: CSV_IMPORT_VALIDATION_CONTRACT_VERSION,
      totalRowCount: input.validated.totalRowCount,
      nonblankRowCount: input.validated.nonblankRowCount,
      validRowCount: input.validated.validRowCount,
      invalidRowCount: input.validated.invalidRowCount,
      skippedBlankRowCount: input.validated.skippedBlankRowCount,
      processedRowCount: input.validated.processedRowCount,
      issueCount: input.validated.issueCount,
      createdByUserId: input.actor.id,
    },
  });

  if (input.hooks.testBeforeRowsInsert) {
    await input.hooks.testBeforeRowsInsert();
  }

  if (input.validated.rows.length > 0) {
    await tx.csvImportRow.createMany({
      data: input.validated.rows.map((row, index) => {
        const serialized = serializeMappedRow(row, input.validated.mapping);
        return {
          organizationId: input.organizationId,
          importId: created.id,
          displayOrder: index,
          sourceRowNumber: row.sourceRowNumber,
          valuesJson: serialized.valuesJson,
          issuesJson: serialized.issuesJson,
        };
      }),
    });
  }

  await recordOrganizationAuditEvent(tx, {
    organizationId: input.organizationId,
    actorUserId: input.actor.id,
    action: "CSV_IMPORT_STAGED",
    metadata: {
      importId: created.id,
      family: input.validated.family,
      status,
      totalRowCount: input.validated.totalRowCount,
      validRowCount: input.validated.validRowCount,
      invalidRowCount: input.validated.invalidRowCount,
      issueCount: input.validated.issueCount,
      sourceChecksumPrefix: identityPrefix(input.validated.sourceChecksum),
      importIdentityPrefix: identityPrefix(input.importIdentity),
      validationContractVersion: CSV_IMPORT_VALIDATION_CONTRACT_VERSION,
    },
  });

  const view = await loadImportView(tx, {
    organizationId: input.organizationId,
    importId: created.id,
  });
  if (!view) {
    throw new Error("staged import could not be reloaded");
  }
  return view;
}

/**
 * Revalidate original CSV bytes and stage one complete mapped snapshot.
 * Never trusts caller-supplied preview, checksum, identity, counts, rows,
 * status, or persistenceEligible values.
 */
export async function stageCsvImport(
  input: StageCsvImportInput,
  hooks: CsvImportMutationTestHooks = {},
): Promise<
  { ok: true; created: boolean; import: CsvImportView } | CsvImportFailure
> {
  try {
    const actor = requireActor(input.actor);
    await requireOrganizationPermission({
      user: actor,
      organizationId: input.organizationId,
      permission: MANAGE_PERMISSION,
    });

    const validated = await validateMappedCsvFile({
      bytes: input.bytes,
      filename: input.filename,
      declaredMimeType: input.declaredMimeType,
      mapping: input.mapping,
      now: input.now,
      shouldTimeout: input.shouldTimeout,
    });

    if (!validated.validationComplete || validated.hasMoreIssues) {
      throw new CsvImportIncompleteError();
    }

    const importIdentity = deriveCsvImportIdentity({
      organizationId: input.organizationId,
      family: validated.family,
      sourceChecksum: validated.sourceChecksum,
      mappingIdentity: validated.mappingIdentity,
    });

    const staged = await prisma.$transaction(async (tx) => {
      await acquireOrganizationCsvImportLock(tx, input.organizationId, hooks);
      await requireActiveActorInTx(
        tx,
        {
          organizationId: input.organizationId,
          userId: actor.id,
          permission: MANAGE_PERMISSION,
        },
        hooks,
      );

      const existing = await tx.csvImport.findUnique({
        where: {
          organizationId_importIdentity: {
            organizationId: input.organizationId,
            importIdentity,
          },
        },
      });
      if (hooks.testAfterExistingLookup) {
        await hooks.testAfterExistingLookup();
      }
      if (existing) {
        const view = await loadImportView(tx, {
          organizationId: input.organizationId,
          importId: existing.id,
        });
        if (!view) {
          throw new CsvImportNotFoundError();
        }
        return { created: false, view };
      }

      const view = await persistNewImport(tx, {
        actor,
        organizationId: input.organizationId,
        importIdentity,
        validated,
        hooks,
      });
      return { created: true, view };
    });

    if (hooks.testAfterTransactionCommit) {
      await hooks.testAfterTransactionCommit();
    }
    return { ok: true, created: staged.created, import: staged.view };
  } catch (error) {
    if (
      error instanceof PrismaNamespace.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      try {
        const actor = requireActor(input.actor);
        await requireOrganizationPermission({
          user: actor,
          organizationId: input.organizationId,
          permission: MANAGE_PERMISSION,
        });
        const recovered = await recoverExistingImport(input);
        if (recovered) {
          return { ok: true, created: false, import: recovered };
        }
      } catch (recoveryError) {
        return (
          mapCsvImportError(recoveryError) ?? {
            ok: false,
            reason: "failed",
            message: "Could not stage the CSV import.",
          }
        );
      }
    }
    return (
      mapCsvImportError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not stage the CSV import.",
      }
    );
  }
}

async function recoverExistingImport(
  input: StageCsvImportInput,
): Promise<CsvImportView | null> {
  const validated = await validateMappedCsvFile({
    bytes: input.bytes,
    filename: input.filename,
    declaredMimeType: input.declaredMimeType,
    mapping: input.mapping,
    now: input.now,
    shouldTimeout: input.shouldTimeout,
  });
  if (!validated.validationComplete || validated.hasMoreIssues) {
    return null;
  }
  const importIdentity = deriveCsvImportIdentity({
    organizationId: input.organizationId,
    family: validated.family,
    sourceChecksum: validated.sourceChecksum,
    mappingIdentity: validated.mappingIdentity,
  });
  const existing = await prisma.csvImport.findUnique({
    where: {
      organizationId_importIdentity: {
        organizationId: input.organizationId,
        importIdentity,
      },
    },
  });
  if (!existing) {
    return null;
  }
  return loadImportView(prisma, {
    organizationId: input.organizationId,
    importId: existing.id,
  });
}

export async function getCsvImport(
  input: GetCsvImportInput,
): Promise<{ ok: true; import: CsvImportView } | CsvImportFailure> {
  try {
    const actor = requireActor(input.actor);
    await requireOrganizationPermission({
      user: actor,
      organizationId: input.organizationId,
      permission: MANAGE_PERMISSION,
    });
    const view = await loadImportView(prisma, {
      organizationId: input.organizationId,
      importId: input.importId,
    });
    if (!view) {
      throw new CsvImportNotFoundError();
    }
    return { ok: true, import: view };
  } catch (error) {
    return (
      mapCsvImportError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not load the CSV import.",
      }
    );
  }
}

export async function listRecentCsvImports(input: {
  actor: SafeUser | null;
  organizationId: string;
}): Promise<{ ok: true; imports: CsvImportListItem[] } | CsvImportFailure> {
  try {
    const actor = requireActor(input.actor);
    await requireOrganizationPermission({
      user: actor,
      organizationId: input.organizationId,
      permission: MANAGE_PERMISSION,
    });
    const records = await prisma.csvImport.findMany({
      where: { organizationId: input.organizationId },
      orderBy: { createdAt: "desc" },
      take: CSV_IMPORT_RECENT_LIMIT,
      select: {
        id: true,
        filename: true,
        targetFamily: true,
        status: true,
        createdAt: true,
        totalRowCount: true,
        validRowCount: true,
        invalidRowCount: true,
        issueCount: true,
        confirmation: { select: { id: true } },
      },
    });
    return {
      ok: true,
      imports: records.map((record) => ({
        id: record.id,
        filename: record.filename,
        family: toMappingFamily(record.targetFamily),
        status: record.status,
        createdAt: record.createdAt,
        totalRowCount: record.totalRowCount,
        validRowCount: record.validRowCount,
        invalidRowCount: record.invalidRowCount,
        issueCount: record.issueCount,
        confirmed: Boolean(record.confirmation),
      })),
    };
  } catch (error) {
    return (
      mapCsvImportError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not load recent CSV imports.",
      }
    );
  }
}
