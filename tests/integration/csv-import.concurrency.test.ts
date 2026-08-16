import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { stageCsvImport } from "@/lib/orgs/csv-import";
import {
  countCsvImportAudits,
  createGate,
  createOrgWithOwner,
  knowledgeCsvBytes,
  knowledgeMapping,
} from "@/tests/integration/helpers/csv-import";
import { resetApplicationData } from "@/tests/integration/reset";
import { CSV_MIME } from "@/tests/helpers/tabular-fixtures";

describe("Phase 4D CSV import concurrency", () => {
  const prisma = new PrismaClient();

  beforeEach(async () => {
    await resetApplicationData(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns one import and one audit event for a forced concurrent retry", async () => {
    const ctx = await createOrgWithOwner(prisma, "csv-race");
    const bytes = knowledgeCsvBytes();
    const mapping = knowledgeMapping();
    const firstHeld = createGate();
    const secondBeforeLock = createGate();
    const secondAfterLock = createGate();
    let secondAcquiredLock = false;

    const payload = {
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      bytes,
      filename: "knowledge.csv",
      declaredMimeType: CSV_MIME,
      mapping,
    };

    const first = stageCsvImport(payload, {
      testAfterCsvImportLock: async () => {
        firstHeld.markReached();
        await firstHeld.waitForRelease();
      },
    });
    await firstHeld.waitUntilReached();

    const second = stageCsvImport(payload, {
      testBeforeCsvImportLock: async () => {
        secondBeforeLock.markReached();
      },
      testAfterCsvImportLock: async () => {
        secondAcquiredLock = true;
        secondAfterLock.markReached();
      },
    });
    await secondBeforeLock.waitUntilReached();
    expect(secondAcquiredLock).toBe(false);

    firstHeld.release();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    await secondAfterLock.waitUntilReached();
    expect(secondAcquiredLock).toBe(true);

    expect(firstResult.ok).toBe(true);
    expect(secondResult.ok).toBe(true);
    if (!firstResult.ok || !secondResult.ok) {
      throw new Error("expected both concurrent retries to succeed");
    }
    expect(firstResult.import.id).toBe(secondResult.import.id);
    expect([firstResult.created, secondResult.created].sort()).toEqual([
      false,
      true,
    ]);
    expect(
      await prisma.csvImport.count({
        where: { organizationId: ctx.organizationId },
      }),
    ).toBe(1);
    expect(
      await prisma.csvImportRow.count({
        where: { organizationId: ctx.organizationId },
      }),
    ).toBe(firstResult.import.rows.length);
    expect(await countCsvImportAudits(prisma, ctx.organizationId)).toBe(1);

    const audit = await prisma.organizationAuditEvent.findFirstOrThrow({
      where: {
        organizationId: ctx.organizationId,
        action: "CSV_IMPORT_STAGED",
      },
    });
    const metadata = JSON.stringify(audit.metadata ?? {});
    expect(metadata).toContain(firstResult.import.id);
    expect(metadata).not.toContain("Customers may return unused items.");
    expect(metadata).not.toContain("knowledge.title");
    expect(metadata).not.toContain(
      mapping.columns[0]?.target ?? "knowledge.title",
    );
  });
});
