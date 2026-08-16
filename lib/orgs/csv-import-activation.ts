import "server-only";

import { createHash } from "node:crypto";

import type { Prisma } from "@prisma/client";
import { Prisma as PrismaNamespace } from "@prisma/client";

import type { SafeUser } from "@/lib/auth/users";
import { recordOrganizationAuditEvent } from "@/lib/orgs/audit";
import {
  OrganizationAuthError,
  requireOrganizationPermission,
} from "@/lib/orgs/authorization";
import {
  acquireOrganizationCsvImportLock,
  CsvImportCorruptSnapshotError,
  CsvImportNotConfirmableError,
  CsvImportNotFoundError,
  lockCsvImportForUpdate,
  mapAuthError,
  requireActiveActorInTx,
  type CsvImportActivationTestHooks,
} from "@/lib/orgs/csv-import-access";
import {
  CSV_IMPORT_ACTIVATION_MAX_ROWS,
  CSV_IMPORT_CONFIRMATION_LANGUAGE_VERSION,
} from "@/lib/orgs/csv-import-confirmation";
import {
  CSV_IMPORT_VALIDATION_CONTRACT_VERSION,
  identityPrefix,
  parseStoredCanonicalMapping,
  parseStoredMappedIssues,
  parseStoredMappedValues,
  serializeCanonicalMapping,
  serializeMappedIssues,
  serializeMappedValues,
} from "@/lib/orgs/csv-import-identity";
import { createActiveKnowledgeFromCsvRow } from "@/lib/orgs/csv-import-knowledge";
import { createActiveOfferingFromCsvRow } from "@/lib/orgs/csv-import-offering";
import { acquireOrganizationKnowledgeLock } from "@/lib/orgs/knowledge-access";
import { acquireOrganizationOfferingsLock } from "@/lib/orgs/offering-access";
import { prisma } from "@/lib/prisma";
import type {
  CsvMappedPreviewRow,
  CsvMappingInput,
  CsvMappingTargetFamily,
} from "@/lib/orgs/tabular-mapping";

const MANAGE_PERMISSION = "org.knowledge.manage" as const;
const ACTIVATION_TX_TIMEOUT_MS = 60_000;
const ACTIVATION_TX_MAX_WAIT_MS = 10_000;

export type CsvImportActivationFailure = {
  ok: false;
  reason: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
};

export type CsvImportConfirmationView = {
  id: string;
  importId: string;
  organizationId: string;
  importIdentity: string;
  sourceChecksum: string;
  actorUserId: string;
  confirmedAt: Date;
  confirmationLanguageVersion: string;
  family: CsvMappingTargetFamily;
  createdRowCount: number;
  resultSummary: CsvImportActivationSummary;
  knowledgeActivations: Array<{
    importRowId: string;
    knowledgeSourceId: string;
    knowledgeVersionId: string;
  }>;
  offeringActivations: Array<{
    importRowId: string;
    offeringId: string;
    offeringVersionId: string;
  }>;
};

export type CsvImportActivationSummary = {
  family: CsvMappingTargetFamily;
  createdRowCount: number;
  createdIdentityChecksum: string;
};

export type ConfirmCsvImportInput = {
  actor: SafeUser | null;
  organizationId: string;
  importId: string;
  expectedImportIdentity: string;
  acknowledged: boolean;
};

function requireActor(actor: SafeUser | null): SafeUser {
  if (!actor) {
    throw new OrganizationAuthError("unauthenticated");
  }
  return actor;
}

function toMappingFamily(family: string): CsvMappingTargetFamily {
  return family === "KNOWLEDGE" || family === "knowledge"
    ? "knowledge"
    : "offering";
}

function serializeActivationSummary(
  summary: CsvImportActivationSummary,
): string {
  return JSON.stringify({
    family: summary.family,
    createdRowCount: summary.createdRowCount,
    createdIdentityChecksum: summary.createdIdentityChecksum,
  });
}

export function parseActivationSummary(
  raw: string,
): CsvImportActivationSummary {
  const parsed = JSON.parse(raw) as unknown;
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    !("family" in parsed) ||
    !("createdRowCount" in parsed) ||
    !("createdIdentityChecksum" in parsed)
  ) {
    throw new CsvImportCorruptSnapshotError();
  }
  const record = parsed as Record<string, unknown>;
  if (
    (record.family !== "knowledge" && record.family !== "offering") ||
    typeof record.createdRowCount !== "number" ||
    typeof record.createdIdentityChecksum !== "string"
  ) {
    throw new CsvImportCorruptSnapshotError();
  }
  return {
    family: record.family,
    createdRowCount: record.createdRowCount,
    createdIdentityChecksum: record.createdIdentityChecksum,
  };
}

function createdIdentityChecksum(lines: readonly string[]): string {
  return createHash("sha256").update(lines.join("\n"), "utf8").digest("hex");
}

function mapActivationError(error: unknown): CsvImportActivationFailure | null {
  const auth = mapAuthError(error);
  if (auth) return auth;
  if (error instanceof CsvImportNotFoundError) {
    return { ok: false, reason: "not_found", message: "Import not found." };
  }
  if (error instanceof CsvImportCorruptSnapshotError) {
    return { ok: false, reason: error.code, message: error.message };
  }
  if (error instanceof CsvImportNotConfirmableError) {
    return { ok: false, reason: error.code, message: error.message };
  }
  return null;
}

function revalidateStagedRows(
  mapping: CsvMappingInput,
  mappingJson: string,
  mappingIdentity: string,
  rows: Array<{
    id: string;
    displayOrder: number;
    sourceRowNumber: number;
    valuesJson: string;
    issuesJson: string;
  }>,
): CsvMappedPreviewRow[] {
  const recanonicalMapping = serializeCanonicalMapping(mapping);
  if (
    recanonicalMapping !== mappingJson ||
    recanonicalMapping !== mappingIdentity
  ) {
    throw new CsvImportCorruptSnapshotError();
  }
  return rows.map((row) => {
    let values;
    let issues;
    try {
      values = parseStoredMappedValues(row.valuesJson, mapping);
      issues = parseStoredMappedIssues(row.issuesJson);
    } catch {
      throw new CsvImportCorruptSnapshotError();
    }
    if (serializeMappedValues(values, mapping) !== row.valuesJson) {
      throw new CsvImportCorruptSnapshotError();
    }
    if (serializeMappedIssues(issues) !== row.issuesJson) {
      throw new CsvImportCorruptSnapshotError();
    }
    if (issues.length > 0) {
      throw new CsvImportCorruptSnapshotError();
    }
    return {
      sourceRowNumber: row.sourceRowNumber,
      values,
      issues,
    };
  });
}

async function loadConfirmationView(
  db: Prisma.TransactionClient | typeof prisma,
  input: { organizationId: string; confirmationId: string },
): Promise<CsvImportConfirmationView | null> {
  const record = await db.csvImportConfirmation.findFirst({
    where: {
      id: input.confirmationId,
      organizationId: input.organizationId,
    },
  });
  if (!record) return null;
  const [knowledgeActivations, offeringActivations] = await Promise.all([
    db.csvImportKnowledgeRowActivation.findMany({
      where: {
        confirmationId: record.id,
        organizationId: input.organizationId,
      },
      orderBy: { importRowId: "asc" },
      select: {
        importRowId: true,
        knowledgeSourceId: true,
        knowledgeVersionId: true,
      },
    }),
    db.csvImportOfferingRowActivation.findMany({
      where: {
        confirmationId: record.id,
        organizationId: input.organizationId,
      },
      orderBy: { importRowId: "asc" },
      select: {
        importRowId: true,
        offeringId: true,
        offeringVersionId: true,
      },
    }),
  ]);
  return {
    id: record.id,
    importId: record.importId,
    organizationId: record.organizationId,
    importIdentity: record.importIdentity,
    sourceChecksum: record.sourceChecksum,
    actorUserId: record.actorUserId,
    confirmedAt: record.confirmedAt,
    confirmationLanguageVersion: record.confirmationLanguageVersion,
    family: toMappingFamily(record.targetFamily),
    createdRowCount: record.createdRowCount,
    resultSummary: parseActivationSummary(record.resultSummaryJson),
    knowledgeActivations,
    offeringActivations,
  };
}

async function acquireFamilyLock(
  tx: Prisma.TransactionClient,
  family: CsvMappingTargetFamily,
  organizationId: string,
  hooks: CsvImportActivationTestHooks,
): Promise<void> {
  if (family === "knowledge") {
    await acquireOrganizationKnowledgeLock(tx, organizationId, {
      testBeforeKnowledgeLock: hooks.testBeforeDomainLock,
      testAfterKnowledgeLock: hooks.testAfterDomainLock,
    });
    return;
  }
  await acquireOrganizationOfferingsLock(tx, organizationId, {
    testBeforeOfferingsLock: hooks.testBeforeDomainLock,
    testAfterOfferingsLock: hooks.testAfterDomainLock,
  });
}

/**
 * Confirm a staged READY_TO_CONFIRM CSV import and activate all rows
 * atomically. Lock order:
 * 1. `organization-csv-import:<organizationId>`
 * 2. family domain lock (`organization-knowledge:` or `organization-offerings:`)
 * 3. actor membership `FOR UPDATE`
 * 4. `CsvImport` row `FOR UPDATE`
 * 5. existing confirmation lookup / insert
 *
 * Knowledge imports never acquire the offerings lock. Offering imports never
 * acquire the knowledge lock. Staging writers still take only the CSV import
 * lock.
 */
export async function confirmCsvImport(
  input: ConfirmCsvImportInput,
  hooks: CsvImportActivationTestHooks = {},
): Promise<
  | {
      ok: true;
      created: boolean;
      confirmation: CsvImportConfirmationView;
    }
  | CsvImportActivationFailure
> {
  try {
    const actor = requireActor(input.actor);
    await requireOrganizationPermission({
      user: actor,
      organizationId: input.organizationId,
      permission: MANAGE_PERMISSION,
    });
    if (!input.acknowledged) {
      throw new CsvImportNotConfirmableError(
        "missing_acknowledgment",
        "Confirm that you are authorized to provide this information and have reviewed it for accuracy.",
      );
    }
    if (
      typeof input.expectedImportIdentity !== "string" ||
      !/^[0-9a-f]{64}$/.test(input.expectedImportIdentity)
    ) {
      throw new CsvImportNotConfirmableError(
        "identity_mismatch",
        "This import no longer matches the expected identity. Reload and review it again.",
      );
    }

    const confirmed = await prisma.$transaction(
      async (tx) => {
        await acquireOrganizationCsvImportLock(tx, input.organizationId, hooks);

        const peeked = await tx.csvImport.findFirst({
          where: {
            id: input.importId,
            organizationId: input.organizationId,
          },
          select: { targetFamily: true },
        });
        if (!peeked) {
          throw new CsvImportNotFoundError();
        }
        const family = toMappingFamily(peeked.targetFamily);
        await acquireFamilyLock(tx, family, input.organizationId, hooks);
        await requireActiveActorInTx(
          tx,
          {
            organizationId: input.organizationId,
            userId: actor.id,
            permission: MANAGE_PERMISSION,
          },
          hooks,
        );

        const header = await lockCsvImportForUpdate(tx, {
          organizationId: input.organizationId,
          importId: input.importId,
        });
        if (!header) {
          throw new CsvImportNotFoundError();
        }
        if (toMappingFamily(header.targetFamily) !== family) {
          throw new CsvImportCorruptSnapshotError();
        }

        if (header.importIdentity !== input.expectedImportIdentity) {
          throw new CsvImportNotConfirmableError(
            "identity_mismatch",
            "This import no longer matches the expected identity. Reload and review it again.",
          );
        }
        if (header.status !== "READY_TO_CONFIRM") {
          throw new CsvImportNotConfirmableError(
            "not_confirmable",
            "Imports that need attention cannot be confirmed. Upload a corrected CSV to create a new review snapshot.",
          );
        }
        if (header.validRowCount > CSV_IMPORT_ACTIVATION_MAX_ROWS) {
          throw new CsvImportNotConfirmableError(
            "activation_cap",
            `This import has more rows than Outreach can activate in one confirmation. The current maximum is ${CSV_IMPORT_ACTIVATION_MAX_ROWS} rows.`,
          );
        }
        if (
          header.validationContractVersion !==
          CSV_IMPORT_VALIDATION_CONTRACT_VERSION
        ) {
          throw new CsvImportCorruptSnapshotError();
        }

        const existing = await tx.csvImportConfirmation.findUnique({
          where: { importId: header.id },
        });
        if (hooks.testAfterExistingConfirmationLookup) {
          await hooks.testAfterExistingConfirmationLookup();
        }
        if (existing) {
          const view = await loadConfirmationView(tx, {
            organizationId: input.organizationId,
            confirmationId: existing.id,
          });
          if (!view) {
            throw new CsvImportCorruptSnapshotError();
          }
          return { created: false, view };
        }

        const rowRecords = await tx.csvImportRow.findMany({
          where: {
            importId: header.id,
            organizationId: input.organizationId,
          },
          orderBy: { displayOrder: "asc" },
        });
        if (rowRecords.length !== header.validRowCount) {
          throw new CsvImportCorruptSnapshotError();
        }
        if (header.invalidRowCount !== 0 || header.issueCount !== 0) {
          throw new CsvImportCorruptSnapshotError();
        }

        let mapping: CsvMappingInput;
        try {
          mapping = parseStoredCanonicalMapping(header.mappingJson);
        } catch {
          throw new CsvImportCorruptSnapshotError();
        }
        if (mapping.family !== family) {
          throw new CsvImportCorruptSnapshotError();
        }
        const parsedRows = revalidateStagedRows(
          mapping,
          header.mappingJson,
          header.mappingIdentity,
          rowRecords,
        );

        if (hooks.testBeforeDomainWrites) {
          await hooks.testBeforeDomainWrites();
        }

        const [profile, organization] = await Promise.all([
          tx.businessProfile.findUnique({
            where: { organizationId: input.organizationId },
            select: { timeZone: true },
          }),
          tx.organization.findUnique({
            where: { id: input.organizationId },
            select: { slug: true },
          }),
        ]);
        const timeZone = profile?.timeZone?.trim() || null;
        const settingsHref = organization?.slug
          ? `/app/orgs/${organization.slug}/settings`
          : null;
        const confirmedAt = new Date();
        const identityLines: string[] = [];
        const knowledgeCreates: Array<{
          importRowId: string;
          knowledgeSourceId: string;
          knowledgeVersionId: string;
        }> = [];
        const offeringCreates: Array<{
          importRowId: string;
          offeringId: string;
          offeringVersionId: string;
        }> = [];

        for (const [index, rowRecord] of rowRecords.entries()) {
          if (hooks.testBeforeActivateRow) {
            await hooks.testBeforeActivateRow(index);
          }
          const parsed = parsedRows[index];
          if (!parsed) {
            throw new CsvImportCorruptSnapshotError();
          }
          if (family === "knowledge") {
            const created = await createActiveKnowledgeFromCsvRow(tx, {
              organizationId: input.organizationId,
              actorUserId: actor.id,
              confirmedAt,
              confirmationLanguageVersion:
                CSV_IMPORT_CONFIRMATION_LANGUAGE_VERSION,
              importRowId: rowRecord.id,
              values: parsed.values,
              timeZone,
              settingsHref,
            });
            knowledgeCreates.push({
              importRowId: rowRecord.id,
              knowledgeSourceId: created.sourceId,
              knowledgeVersionId: created.versionId,
            });
            identityLines.push(
              `${rowRecord.id}:${created.sourceId}:${created.versionId}`,
            );
          } else {
            const created = await createActiveOfferingFromCsvRow(tx, {
              organizationId: input.organizationId,
              actorUserId: actor.id,
              confirmedAt,
              confirmationLanguageVersion:
                CSV_IMPORT_CONFIRMATION_LANGUAGE_VERSION,
              displayOrder: rowRecord.displayOrder,
              values: parsed.values,
              timeZone,
              settingsHref,
            });
            offeringCreates.push({
              importRowId: rowRecord.id,
              offeringId: created.offeringId,
              offeringVersionId: created.versionId,
            });
            identityLines.push(
              `${rowRecord.id}:${created.offeringId}:${created.versionId}`,
            );
          }
        }

        const summary: CsvImportActivationSummary = {
          family,
          createdRowCount: rowRecords.length,
          createdIdentityChecksum: createdIdentityChecksum(identityLines),
        };

        if (hooks.testBeforeConfirmationInsert) {
          await hooks.testBeforeConfirmationInsert();
        }

        const confirmation = await tx.csvImportConfirmation.create({
          data: {
            organizationId: input.organizationId,
            importId: header.id,
            importIdentity: header.importIdentity,
            sourceChecksum: header.sourceChecksum,
            actorUserId: actor.id,
            confirmedAt,
            confirmationLanguageVersion:
              CSV_IMPORT_CONFIRMATION_LANGUAGE_VERSION,
            targetFamily: family === "knowledge" ? "KNOWLEDGE" : "OFFERING",
            createdRowCount: rowRecords.length,
            resultSummaryJson: serializeActivationSummary(summary),
          },
        });

        if (knowledgeCreates.length > 0) {
          await tx.csvImportKnowledgeRowActivation.createMany({
            data: knowledgeCreates.map((item) => ({
              organizationId: input.organizationId,
              importId: header.id,
              importRowId: item.importRowId,
              confirmationId: confirmation.id,
              knowledgeSourceId: item.knowledgeSourceId,
              knowledgeVersionId: item.knowledgeVersionId,
            })),
          });
        }
        if (offeringCreates.length > 0) {
          await tx.csvImportOfferingRowActivation.createMany({
            data: offeringCreates.map((item) => ({
              organizationId: input.organizationId,
              importId: header.id,
              importRowId: item.importRowId,
              confirmationId: confirmation.id,
              offeringId: item.offeringId,
              offeringVersionId: item.offeringVersionId,
            })),
          });
        }

        await recordOrganizationAuditEvent(tx, {
          organizationId: input.organizationId,
          actorUserId: actor.id,
          action: "CSV_IMPORT_ACTIVATED",
          metadata: {
            importId: header.id,
            family,
            rowCount: rowRecords.length,
            confirmationId: confirmation.id,
            importIdentityPrefix: identityPrefix(header.importIdentity),
            sourceChecksumPrefix: identityPrefix(header.sourceChecksum),
          },
        });

        const view = await loadConfirmationView(tx, {
          organizationId: input.organizationId,
          confirmationId: confirmation.id,
        });
        if (!view) {
          throw new CsvImportCorruptSnapshotError();
        }
        return { created: true, view };
      },
      {
        timeout: ACTIVATION_TX_TIMEOUT_MS,
        maxWait: ACTIVATION_TX_MAX_WAIT_MS,
      },
    );

    if (hooks.testAfterTransactionCommit) {
      await hooks.testAfterTransactionCommit();
    }
    return {
      ok: true,
      created: confirmed.created,
      confirmation: confirmed.view,
    };
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
        const recovered = await prisma.csvImportConfirmation.findUnique({
          where: { importId: input.importId },
        });
        if (recovered && recovered.organizationId === input.organizationId) {
          const view = await loadConfirmationView(prisma, {
            organizationId: input.organizationId,
            confirmationId: recovered.id,
          });
          if (view) {
            return { ok: true, created: false, confirmation: view };
          }
        }
      } catch (recoveryError) {
        return (
          mapActivationError(recoveryError) ?? {
            ok: false,
            reason: "failed",
            message: "Could not confirm the CSV import.",
          }
        );
      }
    }
    return (
      mapActivationError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not confirm the CSV import.",
      }
    );
  }
}

export async function getCsvImportConfirmation(input: {
  actor: SafeUser | null;
  organizationId: string;
  importId: string;
}): Promise<
  | { ok: true; confirmation: CsvImportConfirmationView | null }
  | CsvImportActivationFailure
> {
  try {
    const actor = requireActor(input.actor);
    await requireOrganizationPermission({
      user: actor,
      organizationId: input.organizationId,
      permission: MANAGE_PERMISSION,
    });
    const record = await prisma.csvImportConfirmation.findFirst({
      where: {
        importId: input.importId,
        organizationId: input.organizationId,
      },
    });
    if (!record) {
      return { ok: true, confirmation: null };
    }
    const view = await loadConfirmationView(prisma, {
      organizationId: input.organizationId,
      confirmationId: record.id,
    });
    return { ok: true, confirmation: view };
  } catch (error) {
    return (
      mapActivationError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not load the CSV import confirmation.",
      }
    );
  }
}
