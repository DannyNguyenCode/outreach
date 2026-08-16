import "server-only";

import type { Prisma } from "@prisma/client";

import {
  CsvImportCorruptSnapshotError,
  CsvImportNotConfirmableError,
} from "@/lib/orgs/csv-import-access";
import {
  checksumFromDraft,
  KNOWLEDGE_ACTIVATABLE_CATEGORY,
} from "@/lib/orgs/knowledge-validation";
import type {
  CsvMappedValue,
  CsvMappingTargetFieldId,
} from "@/lib/orgs/tabular-mapping";
import { resolveEffectiveRange } from "@/lib/time/organization-datetime";

function requireText(
  values: Partial<Record<CsvMappingTargetFieldId, CsvMappedValue>>,
  field: CsvMappingTargetFieldId,
): string {
  const value = values[field];
  if (!value || value.kind !== "text" || !value.value) {
    throw new CsvImportCorruptSnapshotError();
  }
  return value.value;
}

function optionalDate(
  values: Partial<Record<CsvMappingTargetFieldId, CsvMappedValue>>,
  field: CsvMappingTargetFieldId,
): string | null {
  const value = values[field];
  if (!value) return null;
  if (value.kind !== "date" || typeof value.value !== "string") {
    throw new CsvImportCorruptSnapshotError();
  }
  return value.value;
}

function wallTimeFromDate(value: string | null): string | undefined {
  return value ? `${value}T00:00` : undefined;
}

export async function createActiveKnowledgeFromCsvRow(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    actorUserId: string;
    confirmedAt: Date;
    confirmationLanguageVersion: string;
    importRowId: string;
    values: Partial<Record<CsvMappingTargetFieldId, CsvMappedValue>>;
    timeZone: string | null;
    settingsHref: string | null;
  },
): Promise<{ sourceId: string; versionId: string }> {
  const title = requireText(input.values, "knowledge.title");
  const sectionTitle = requireText(input.values, "knowledge.sectionTitle");
  const passageBody = requireText(input.values, "knowledge.passageBody");
  const effectiveFromDate = optionalDate(
    input.values,
    "knowledge.effectiveFrom",
  );
  const effectiveUntilDate = optionalDate(
    input.values,
    "knowledge.effectiveUntil",
  );
  const times = resolveEffectiveRange({
    effectiveFrom: wallTimeFromDate(effectiveFromDate),
    effectiveUntil: wallTimeFromDate(effectiveUntilDate),
    timeZone: input.timeZone,
    settingsHref: input.settingsHref,
  });
  if (!times.ok) {
    throw new CsvImportNotConfirmableError(times.code, times.message);
  }

  const prepared = checksumFromDraft({
    title,
    effectiveFrom: times.effectiveFrom,
    effectiveUntil: times.effectiveUntil,
    sections: [
      {
        citationKey: `csvsec_${input.importRowId}`,
        title: sectionTitle,
        passages: [
          {
            citationKey: `csvpas_${input.importRowId}`,
            body: passageBody,
          },
        ],
      },
    ],
  });

  const source = await tx.knowledgeSource.create({
    data: {
      organizationId: input.organizationId,
      inputKind: "MANUAL",
      category: KNOWLEDGE_ACTIVATABLE_CATEGORY,
      title: prepared.canonical.title,
      createdByUserId: input.actorUserId,
      version: 1,
    },
  });

  const version = await tx.knowledgeVersion.create({
    data: {
      organizationId: input.organizationId,
      sourceId: source.id,
      state: "ACTIVE",
      title: prepared.canonical.title,
      contentChecksum: prepared.checksum,
      effectiveFrom: times.effectiveFrom,
      effectiveUntil: times.effectiveUntil,
      createdByUserId: input.actorUserId,
      confirmerUserId: input.actorUserId,
      confirmedAt: input.confirmedAt,
      confirmationLanguageVersion: input.confirmationLanguageVersion,
      draftRevision: 1,
    },
  });

  for (const [sectionIndex, section] of prepared.sections.entries()) {
    const createdSection = await tx.knowledgeSection.create({
      data: {
        organizationId: input.organizationId,
        sourceId: source.id,
        versionId: version.id,
        citationKey: section.citationKey,
        title: section.title,
        displayOrder: sectionIndex,
      },
    });
    for (const [passageIndex, passage] of section.passages.entries()) {
      await tx.knowledgePassage.create({
        data: {
          organizationId: input.organizationId,
          sourceId: source.id,
          versionId: version.id,
          sectionId: createdSection.id,
          citationKey: passage.citationKey,
          body: passage.body,
          displayOrder: passageIndex,
        },
      });
    }
  }

  return { sourceId: source.id, versionId: version.id };
}
