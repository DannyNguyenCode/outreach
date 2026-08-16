import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { getCsvImport, stageCsvImport } from "@/lib/orgs/csv-import";
import { CSV_IMPORT_VALIDATION_CONTRACT_VERSION } from "@/lib/orgs/csv-import-identity";
import {
  CSV_MAPPED_FILE_MAX_ISSUES,
  TABULAR_MAX_BYTES,
} from "@/lib/orgs/tabular-types";
import {
  countCsvImportAudits,
  countDomainEntities,
  createOrgWithOwner,
  knowledgeCsvBytes,
  knowledgeMapping,
  offeringCsvBytes,
  offeringMapping,
  officialTemplateBytes,
} from "@/tests/integration/helpers/csv-import";
import { resetApplicationData } from "@/tests/integration/reset";
import {
  CSV_MIME,
  XLSX_MIME,
  csvBytes,
} from "@/tests/helpers/tabular-fixtures";

describe("Phase 4D CSV import staging lifecycle", () => {
  const prisma = new PrismaClient();

  beforeEach(async () => {
    await resetApplicationData(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("stages valid knowledge and offering templates as READY_TO_CONFIRM", async () => {
    const ctx = await createOrgWithOwner(prisma, "csv-valid");
    const knowledgeTemplate = officialTemplateBytes("knowledge");
    const offeringTemplate = officialTemplateBytes("offering");

    const knowledge = await stageCsvImport({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      bytes: knowledgeTemplate.bytes,
      filename: knowledgeTemplate.filename,
      declaredMimeType: knowledgeTemplate.mimeType,
      mapping: knowledgeTemplate.mapping,
    });
    const offering = await stageCsvImport({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      bytes: offeringTemplate.bytes,
      filename: offeringTemplate.filename,
      declaredMimeType: offeringTemplate.mimeType,
      mapping: offeringTemplate.mapping,
    });
    expect(knowledge.ok).toBe(true);
    expect(offering.ok).toBe(true);
    if (!knowledge.ok || !offering.ok) {
      throw new Error("expected valid staging");
    }
    expect(knowledge.created).toBe(true);
    expect(offering.created).toBe(true);
    expect(knowledge.import.status).toBe("READY_TO_CONFIRM");
    expect(offering.import.status).toBe("READY_TO_CONFIRM");
    expect(knowledge.import.family).toBe("knowledge");
    expect(offering.import.family).toBe("offering");
    expect(knowledge.import.validationContractVersion).toBe(
      CSV_IMPORT_VALIDATION_CONTRACT_VERSION,
    );
    expect(knowledge.import.rows).toHaveLength(1);
    expect(knowledge.import.rows[0]?.sourceRowNumber).toBe(2);
    expect(knowledge.import.mappingIdentity).toBe(
      JSON.stringify(knowledge.import.mapping),
    );
    expect(offering.import.importIdentity).not.toBe(
      knowledge.import.importIdentity,
    );

    const loaded = await getCsvImport({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      importId: knowledge.import.id,
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error(loaded.message);
    expect(JSON.stringify(loaded.import.mapping)).toBe(
      JSON.stringify(knowledge.import.mapping),
    );
    expect(JSON.stringify(loaded.import.rows)).toBe(
      JSON.stringify(knowledge.import.rows),
    );
    expect(await countCsvImportAudits(prisma, ctx.organizationId)).toBe(2);
    expect(await countDomainEntities(prisma, ctx.organizationId)).toEqual({
      knowledgeSources: 0,
      knowledgeVersions: 0,
      offerings: 0,
      offeringVersions: 0,
      documents: 0,
      jobs: 0,
      issues: 0,
    });
  });

  it("stages a complete invalid CSV as NEEDS_ATTENTION with exact static issues", async () => {
    const ctx = await createOrgWithOwner(prisma, "csv-invalid");
    const bytes = knowledgeCsvBytes([["", "Overview", "Body"]]);
    const staged = await stageCsvImport({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      bytes,
      filename: "invalid.csv",
      declaredMimeType: CSV_MIME,
      mapping: knowledgeMapping(),
    });
    expect(staged.ok).toBe(true);
    if (!staged.ok) throw new Error(staged.message);
    expect(staged.import.status).toBe("NEEDS_ATTENTION");
    expect(staged.import.validationContractVersion).toBe(
      CSV_IMPORT_VALIDATION_CONTRACT_VERSION,
    );
    expect(staged.import.validRowCount).toBe(0);
    expect(staged.import.invalidRowCount).toBe(1);
    expect(staged.import.issueCount).toBe(1);
    expect(staged.import.totalRowCount).toBe(1);
    expect(staged.import.issues).toEqual([
      {
        sourceRowNumber: 2,
        sourceColumn: 1,
        targetField: "knowledge.title",
        code: "missing_required_value",
      },
    ]);
    expect(JSON.stringify(staged.import.issues)).not.toContain("Overview");
  });

  it("rejects timeout, malformed, parser-attention, incomplete, over-limit, and XLSX inputs without writes", async () => {
    const ctx = await createOrgWithOwner(prisma, "csv-reject");
    const mapping = knowledgeMapping();
    const validBytes = knowledgeCsvBytes();

    const timeout = await stageCsvImport({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      bytes: validBytes,
      filename: "timeout.csv",
      declaredMimeType: CSV_MIME,
      mapping,
      shouldTimeout: (checkpoint) => checkpoint === "before_parse",
    });
    expect(timeout.ok).toBe(false);
    if (!timeout.ok) expect(timeout.reason).toBe("timeout");

    const malformed = await stageCsvImport({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      bytes: csvBytes('Title,Section,Body\n"safe"attacker,Overview,Body\n'),
      filename: "malformed.csv",
      declaredMimeType: CSV_MIME,
      mapping,
    });
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.reason).toBe("malformed");

    const formula = await stageCsvImport({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      bytes: knowledgeCsvBytes([["=cmd", "Overview", "Body"]]),
      filename: "formula.csv",
      declaredMimeType: CSV_MIME,
      mapping,
    });
    expect(formula.ok).toBe(false);
    if (!formula.ok) expect(formula.reason).toBe("parser_not_ready");

    const incompleteRows = Array.from(
      { length: CSV_MAPPED_FILE_MAX_ISSUES + 1 },
      () => ["", "Overview", "Body"] as [string, string, string],
    );
    const incomplete = await stageCsvImport({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      bytes: knowledgeCsvBytes(incompleteRows),
      filename: "incomplete.csv",
      declaredMimeType: CSV_MIME,
      mapping,
    });
    expect(incomplete.ok).toBe(false);
    if (!incomplete.ok) expect(incomplete.reason).toBe("incomplete");

    const overLimit = await stageCsvImport({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      bytes: new Uint8Array(TABULAR_MAX_BYTES + 1),
      filename: "huge.csv",
      declaredMimeType: CSV_MIME,
      mapping,
    });
    expect(overLimit.ok).toBe(false);
    if (!overLimit.ok) expect(overLimit.reason).toBe("too_large");

    const xlsx = await stageCsvImport({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]),
      filename: "workbook.xlsx",
      declaredMimeType: XLSX_MIME,
      mapping,
    });
    expect(xlsx.ok).toBe(false);
    if (!xlsx.ok) expect(xlsx.reason).toBe("unsupported_kind");

    expect(await prisma.csvImport.count()).toBe(0);
    expect(await prisma.csvImportRow.count()).toBe(0);
    expect(await countCsvImportAudits(prisma, ctx.organizationId)).toBe(0);
    expect(await countDomainEntities(prisma, ctx.organizationId)).toEqual({
      knowledgeSources: 0,
      knowledgeVersions: 0,
      offerings: 0,
      offeringVersions: 0,
      documents: 0,
      jobs: 0,
      issues: 0,
    });
  });

  it("returns the same import on sequential retry and isolates changed identity inputs", async () => {
    const a = await createOrgWithOwner(prisma, "csv-id-a");
    const b = await createOrgWithOwner(prisma, "csv-id-b");
    const bytes = knowledgeCsvBytes();
    const mapping = knowledgeMapping();
    const first = await stageCsvImport({
      actor: a.owner,
      organizationId: a.organizationId,
      bytes,
      filename: "knowledge.csv",
      declaredMimeType: CSV_MIME,
      mapping,
    });
    const retry = await stageCsvImport({
      actor: a.owner,
      organizationId: a.organizationId,
      bytes,
      filename: "knowledge-retry.csv",
      declaredMimeType: CSV_MIME,
      mapping: {
        family: "knowledge",
        columns: [...mapping.columns].reverse(),
      },
    });
    expect(first.ok).toBe(true);
    expect(retry.ok).toBe(true);
    if (!first.ok || !retry.ok) throw new Error("expected retry success");
    expect(retry.created).toBe(false);
    expect(retry.import.id).toBe(first.import.id);
    expect(retry.import.importIdentity).toBe(first.import.importIdentity);
    expect(await countCsvImportAudits(prisma, a.organizationId)).toBe(1);
    expect(
      await prisma.csvImportRow.count({ where: { importId: first.import.id } }),
    ).toBe(first.import.rows.length);

    const otherOrg = await stageCsvImport({
      actor: b.owner,
      organizationId: b.organizationId,
      bytes,
      filename: "knowledge.csv",
      declaredMimeType: CSV_MIME,
      mapping,
    });
    expect(otherOrg.ok).toBe(true);
    if (!otherOrg.ok) throw new Error(otherOrg.message);
    expect(otherOrg.import.id).not.toBe(first.import.id);
    expect(otherOrg.import.importIdentity).not.toBe(
      first.import.importIdentity,
    );

    const changedBytes = await stageCsvImport({
      actor: a.owner,
      organizationId: a.organizationId,
      bytes: knowledgeCsvBytes([
        ["Changed title", "Overview", "Customers may return unused items."],
      ]),
      filename: "knowledge.csv",
      declaredMimeType: CSV_MIME,
      mapping,
    });
    expect(changedBytes.ok).toBe(true);
    if (!changedBytes.ok) throw new Error(changedBytes.message);
    expect(changedBytes.created).toBe(true);
    expect(changedBytes.import.id).not.toBe(first.import.id);

    const changedFamily = await stageCsvImport({
      actor: a.owner,
      organizationId: a.organizationId,
      bytes: offeringCsvBytes(),
      filename: "offering.csv",
      declaredMimeType: CSV_MIME,
      mapping: offeringMapping(),
    });
    expect(changedFamily.ok).toBe(true);
    if (!changedFamily.ok) throw new Error(changedFamily.message);
    expect(changedFamily.import.family).toBe("offering");
    expect(changedFamily.import.importIdentity).not.toBe(
      first.import.importIdentity,
    );
    expect(await countCsvImportAudits(prisma, a.organizationId)).toBe(3);
  });

  it("preserves canonical mapping and row order after a database round trip", async () => {
    const ctx = await createOrgWithOwner(prisma, "csv-roundtrip");
    const mapping = {
      family: "knowledge" as const,
      columns: [
        { sourceColumn: 3, target: "knowledge.passageBody" as const },
        { sourceColumn: 1, target: "knowledge.title" as const },
        { sourceColumn: 2, target: "knowledge.sectionTitle" as const },
      ],
    };
    const bytes = knowledgeCsvBytes([
      ["First", "Overview", "One"],
      ["Second", "Overview", "Two"],
    ]);
    const staged = await stageCsvImport({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      bytes,
      filename: "ordered.csv",
      declaredMimeType: CSV_MIME,
      mapping,
    });
    expect(staged.ok).toBe(true);
    if (!staged.ok) throw new Error(staged.message);
    expect(
      staged.import.mapping.columns.map((column) => column.sourceColumn),
    ).toEqual([1, 2, 3]);
    expect(Object.keys(staged.import.rows[0]?.values ?? {})).toEqual([
      "knowledge.title",
      "knowledge.sectionTitle",
      "knowledge.passageBody",
    ]);
    expect(staged.import.rows.map((row) => row.sourceRowNumber)).toEqual([
      2, 3,
    ]);

    const loaded = await getCsvImport({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      importId: staged.import.id,
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error(loaded.message);
    expect(JSON.stringify(loaded.import.mapping)).toBe(
      JSON.stringify(staged.import.mapping),
    );
    expect(JSON.stringify(loaded.import.rows)).toBe(
      JSON.stringify(staged.import.rows),
    );
    expect(JSON.stringify(loaded.import.issues)).toBe(
      JSON.stringify(staged.import.issues),
    );
  });

  it("rolls back a partial insert so no import or rows remain", async () => {
    const ctx = await createOrgWithOwner(prisma, "csv-rollback");
    const staged = await stageCsvImport(
      {
        actor: ctx.owner,
        organizationId: ctx.organizationId,
        bytes: knowledgeCsvBytes(),
        filename: "rollback.csv",
        declaredMimeType: CSV_MIME,
        mapping: knowledgeMapping(),
      },
      {
        testBeforeRowsInsert: async () => {
          throw new Error("forced rollback");
        },
      },
    );
    expect(staged.ok).toBe(false);
    expect(await prisma.csvImport.count()).toBe(0);
    expect(await prisma.csvImportRow.count()).toBe(0);
    expect(await countCsvImportAudits(prisma, ctx.organizationId)).toBe(0);
  });

  it("persists an exact-cap complete invalid file and refuses incomplete results", async () => {
    const ctx = await createOrgWithOwner(prisma, "csv-cap");
    const exactCap = Array.from(
      { length: CSV_MAPPED_FILE_MAX_ISSUES },
      () => ["", "Overview", "Body"] as [string, string, string],
    );
    const staged = await stageCsvImport({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      bytes: knowledgeCsvBytes(exactCap),
      filename: "cap.csv",
      declaredMimeType: CSV_MIME,
      mapping: knowledgeMapping(),
    });
    expect(staged.ok).toBe(true);
    if (!staged.ok) throw new Error(staged.message);
    expect(staged.import.status).toBe("NEEDS_ATTENTION");
    expect(staged.import.issueCount).toBe(CSV_MAPPED_FILE_MAX_ISSUES);
    expect(staged.import.invalidRowCount).toBe(CSV_MAPPED_FILE_MAX_ISSUES);
    expect(staged.import.totalRowCount).toBe(CSV_MAPPED_FILE_MAX_ISSUES);
  });
});
