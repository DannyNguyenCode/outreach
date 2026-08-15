import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  createOrgWithOwner,
  knowledgeMapping,
} from "@/tests/integration/helpers/csv-import";
import { resetApplicationData } from "@/tests/integration/reset";

function postgresCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const record = error as {
    meta?: { code?: unknown };
    message?: unknown;
    cause?: unknown;
  };
  if (record.meta && record.meta.code != null) {
    return String(record.meta.code);
  }
  if (typeof record.message === "string") {
    const match = record.message.match(/\b(23\d{3})\b/);
    if (match) {
      return match[1];
    }
  }
  return postgresCode(record.cause);
}

describe("Phase 4D CSV import schema constraints", () => {
  const prisma = new PrismaClient();

  beforeEach(async () => {
    await resetApplicationData(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rejects cross-organization row attachment, duplicate row identity, and impossible counts", async () => {
    const ctx = await createOrgWithOwner(prisma, "csv-schema");
    const other = await createOrgWithOwner(prisma, "csv-schema-other");
    const mappingJson = JSON.stringify(knowledgeMapping());
    const importRow = await prisma.csvImport.create({
      data: {
        organizationId: ctx.organizationId,
        importIdentity: "a".repeat(64),
        targetFamily: "KNOWLEDGE",
        status: "READY_TO_CONFIRM",
        filename: "knowledge.csv",
        mimeType: "text/csv",
        byteLength: 12,
        sourceChecksum: "b".repeat(64),
        mappingJson,
        mappingIdentity: mappingJson,
        validationContractVersion: "csv-import.v1",
        totalRowCount: 1,
        nonblankRowCount: 1,
        validRowCount: 1,
        invalidRowCount: 0,
        skippedBlankRowCount: 0,
        processedRowCount: 1,
        issueCount: 0,
        createdByUserId: ctx.owner.id,
      },
    });

    await expect(
      prisma.csvImport.create({
        data: {
          organizationId: ctx.organizationId,
          importIdentity: "a".repeat(64),
          targetFamily: "KNOWLEDGE",
          status: "READY_TO_CONFIRM",
          filename: "dup.csv",
          mimeType: "text/csv",
          byteLength: 12,
          sourceChecksum: "c".repeat(64),
          mappingJson,
          mappingIdentity: mappingJson,
          validationContractVersion: "csv-import.v1",
          totalRowCount: 0,
          nonblankRowCount: 0,
          validRowCount: 0,
          invalidRowCount: 0,
          skippedBlankRowCount: 0,
          processedRowCount: 0,
          issueCount: 0,
          createdByUserId: ctx.owner.id,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    try {
      await prisma.$executeRaw`
        INSERT INTO "CsvImportRow" (
          id, "organizationId", "importId", "displayOrder", "sourceRowNumber",
          "valuesJson", "issuesJson", "createdAt"
        ) VALUES (
          'row_cross', ${other.organizationId}, ${importRow.id},
          0, 2, '{}', '[]', NOW()
        )
      `;
      throw new Error("expected cross-organization row FK to fail");
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "expected cross-organization row FK to fail"
      ) {
        throw error;
      }
      expect(postgresCode(error)).toBe("23503");
    }

    await prisma.csvImportRow.create({
      data: {
        organizationId: ctx.organizationId,
        importId: importRow.id,
        displayOrder: 0,
        sourceRowNumber: 2,
        valuesJson: "{}",
        issuesJson: "[]",
      },
    });

    await expect(
      prisma.csvImportRow.create({
        data: {
          organizationId: ctx.organizationId,
          importId: importRow.id,
          displayOrder: 0,
          sourceRowNumber: 3,
          valuesJson: "{}",
          issuesJson: "[]",
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    await expect(
      prisma.csvImportRow.create({
        data: {
          organizationId: ctx.organizationId,
          importId: importRow.id,
          displayOrder: 1,
          sourceRowNumber: 2,
          valuesJson: "{}",
          issuesJson: "[]",
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    try {
      await prisma.csvImport.create({
        data: {
          organizationId: ctx.organizationId,
          importIdentity: "d".repeat(64),
          targetFamily: "KNOWLEDGE",
          status: "READY_TO_CONFIRM",
          filename: "bad-counts.csv",
          mimeType: "text/csv",
          byteLength: 12,
          sourceChecksum: "e".repeat(64),
          mappingJson,
          mappingIdentity: mappingJson,
          validationContractVersion: "csv-import.v1",
          totalRowCount: 1,
          nonblankRowCount: 1,
          validRowCount: 0,
          invalidRowCount: 1,
          skippedBlankRowCount: 0,
          processedRowCount: 1,
          issueCount: 0,
          createdByUserId: ctx.owner.id,
        },
      });
      throw new Error("expected status/count check to fail");
    } catch (error) {
      expect(postgresCode(error)).toBe("23514");
    }
  });

  it("rejects updates to staged import content", async () => {
    const ctx = await createOrgWithOwner(prisma, "csv-immutable");
    const mappingJson = JSON.stringify(knowledgeMapping());
    const created = await prisma.csvImport.create({
      data: {
        organizationId: ctx.organizationId,
        importIdentity: "f".repeat(64),
        targetFamily: "KNOWLEDGE",
        status: "READY_TO_CONFIRM",
        filename: "knowledge.csv",
        mimeType: "text/csv",
        byteLength: 12,
        sourceChecksum: "1".repeat(64),
        mappingJson,
        mappingIdentity: mappingJson,
        validationContractVersion: "csv-import.v1",
        totalRowCount: 0,
        nonblankRowCount: 0,
        validRowCount: 0,
        invalidRowCount: 0,
        skippedBlankRowCount: 0,
        processedRowCount: 0,
        issueCount: 0,
        createdByUserId: ctx.owner.id,
      },
    });
    const row = await prisma.csvImportRow.create({
      data: {
        organizationId: ctx.organizationId,
        importId: created.id,
        displayOrder: 0,
        sourceRowNumber: 2,
        valuesJson: "{}",
        issuesJson: "[]",
      },
    });

    await expect(
      prisma.csvImport.update({
        where: { id: created.id },
        data: { filename: "mutated.csv" },
      }),
    ).rejects.toThrow(/immutable/i);
    await expect(
      prisma.csvImportRow.update({
        where: { id: row.id },
        data: { valuesJson: '{"mutated":true}' },
      }),
    ).rejects.toThrow(/immutable/i);
  });
});
