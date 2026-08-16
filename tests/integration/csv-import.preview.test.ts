import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { previewCsvImportFile } from "@/lib/orgs/csv-import-preview";
import {
  countCsvImportAudits,
  countDomainEntities,
  createOrgWithOwner,
  knowledgeCsvBytes,
} from "@/tests/integration/helpers/csv-import";
import { resetApplicationData } from "@/tests/integration/reset";
import { CSV_MIME, csvBytes } from "@/tests/helpers/tabular-fixtures";

describe("Phase 4D CSV import preview persistence boundary", () => {
  const prisma = new PrismaClient();

  beforeEach(async () => {
    await resetApplicationData(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns a bounded preview without creating records", async () => {
    const ctx = await createOrgWithOwner(prisma, "csv-preview");
    const result = await previewCsvImportFile({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      bytes: knowledgeCsvBytes(),
      filename: "knowledge.csv",
      declaredMimeType: CSV_MIME,
      family: "knowledge",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.preview.filename).toBe("knowledge.csv");
    expect(result.preview.headers.map((header) => header.name)).toEqual([
      "Title",
      "Section",
      "Body",
    ]);
    expect(result.preview.previewRows).toHaveLength(1);
    expect(result.preview.suggestions.length).toBeGreaterThan(0);
    expect(await prisma.csvImport.count()).toBe(0);
    expect(await prisma.csvImportRow.count()).toBe(0);
    expect(await prisma.csvImportConfirmation.count()).toBe(0);
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

  it("rejects XLSX before consuming a workbook preview", async () => {
    const ctx = await createOrgWithOwner(prisma, "csv-preview-xlsx");
    const result = await previewCsvImportFile({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      bytes: csvBytes("Name\nA\n"),
      filename: "workbook.xlsx",
      declaredMimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      family: "knowledge",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect([
        "unsupported_kind",
        "type_mismatch",
        "invalid_signature",
      ]).toContain(result.reason);
    }
    expect(await prisma.csvImport.count()).toBe(0);
  });
});
