import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { confirmCsvImport } from "@/lib/orgs/csv-import-activation";
import { stageCsvImport } from "@/lib/orgs/csv-import";
import {
  countCsvActivationAudits,
  createGate,
  createOrgWithOwner,
  knowledgeCsvBytes,
  knowledgeMapping,
  seedOrganizationTimeZone,
} from "@/tests/integration/helpers/csv-import";
import { resetApplicationData } from "@/tests/integration/reset";
import { CSV_MIME } from "@/tests/helpers/tabular-fixtures";

describe("Phase 4D CSV import activation concurrency", () => {
  const prisma = new PrismaClient();

  beforeEach(async () => {
    await resetApplicationData(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns one receipt, one domain graph, and one activation audit for a concurrent retry", async () => {
    const ctx = await createOrgWithOwner(prisma, "csv-act-race");
    await seedOrganizationTimeZone(prisma, ctx.organizationId);
    const staged = await stageCsvImport({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      bytes: knowledgeCsvBytes(),
      filename: "knowledge.csv",
      declaredMimeType: CSV_MIME,
      mapping: knowledgeMapping(),
    });
    expect(staged.ok).toBe(true);
    if (!staged.ok) throw new Error(staged.message);

    const payload = {
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      importId: staged.import.id,
      expectedImportIdentity: staged.import.importIdentity,
      acknowledged: true,
    };
    const firstHeld = createGate();
    const secondBeforeLock = createGate();
    const secondAfterLock = createGate();
    let secondAcquiredLock = false;

    const first = confirmCsvImport(payload, {
      testAfterCsvImportLock: async () => {
        firstHeld.markReached();
        await firstHeld.waitForRelease();
      },
    });
    await firstHeld.waitUntilReached();

    const second = confirmCsvImport(payload, {
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
      throw new Error("expected both concurrent confirmations to succeed");
    }
    expect(firstResult.confirmation.id).toBe(secondResult.confirmation.id);
    expect([firstResult.created, secondResult.created].sort()).toEqual([
      false,
      true,
    ]);
    expect(
      await prisma.csvImportConfirmation.count({
        where: { organizationId: ctx.organizationId },
      }),
    ).toBe(1);
    expect(
      await prisma.knowledgeSource.count({
        where: { organizationId: ctx.organizationId },
      }),
    ).toBe(1);
    expect(await countCsvActivationAudits(prisma, ctx.organizationId)).toBe(1);
  });
});
