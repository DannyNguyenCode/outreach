import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { confirmCsvImport } from "@/lib/orgs/csv-import-activation";
import {
  getCsvImport,
  listRecentCsvImports,
  stageCsvImport,
} from "@/lib/orgs/csv-import";
import { CSV_IMPORT_ACTIVATION_MAX_ROWS } from "@/lib/orgs/csv-import-confirmation";
import { retrieveActiveKnowledge } from "@/lib/orgs/knowledge-retrieval";
import { retrieveActiveOfferings } from "@/lib/orgs/offering-retrieval";
import { deactivateMember } from "@/lib/orgs/memberships";
import {
  addMember,
  countCsvActivationAudits,
  countDomainEntities,
  createOrgWithOwner,
  createUnverifiedActor,
  knowledgeCsvBytes,
  knowledgeMapping,
  officialTemplateBytes,
  seedOrganizationTimeZone,
} from "@/tests/integration/helpers/csv-import";
import { resetApplicationData } from "@/tests/integration/reset";
import { CSV_MIME, csvBytes } from "@/tests/helpers/tabular-fixtures";

describe("Phase 4D CSV import confirmation and activation", () => {
  const prisma = new PrismaClient();

  beforeEach(async () => {
    await resetApplicationData(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("activates knowledge and offering rows with provenance, receipt, retrieval, and one audit", async () => {
    const ctx = await createOrgWithOwner(prisma, "csv-act");
    await seedOrganizationTimeZone(prisma, ctx.organizationId);
    const knowledgeTemplate = officialTemplateBytes("knowledge");
    const offeringTemplate = officialTemplateBytes("offering");

    const knowledgeStaged = await stageCsvImport({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      bytes: knowledgeTemplate.bytes,
      filename: knowledgeTemplate.filename,
      declaredMimeType: knowledgeTemplate.mimeType,
      mapping: knowledgeTemplate.mapping,
    });
    const offeringStaged = await stageCsvImport({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      bytes: offeringTemplate.bytes,
      filename: offeringTemplate.filename,
      declaredMimeType: offeringTemplate.mimeType,
      mapping: offeringTemplate.mapping,
    });
    expect(knowledgeStaged.ok && offeringStaged.ok).toBe(true);
    if (!knowledgeStaged.ok || !offeringStaged.ok) {
      throw new Error("expected staging");
    }

    const knowledgeConfirm = await confirmCsvImport({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      importId: knowledgeStaged.import.id,
      expectedImportIdentity: knowledgeStaged.import.importIdentity,
      acknowledged: true,
    });
    const offeringConfirm = await confirmCsvImport({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      importId: offeringStaged.import.id,
      expectedImportIdentity: offeringStaged.import.importIdentity,
      acknowledged: true,
    });
    expect(knowledgeConfirm.ok && offeringConfirm.ok).toBe(true);
    if (!knowledgeConfirm.ok || !offeringConfirm.ok) {
      throw new Error("expected confirmation");
    }
    expect(knowledgeConfirm.created).toBe(true);
    expect(offeringConfirm.created).toBe(true);
    expect(knowledgeConfirm.confirmation.knowledgeActivations).toHaveLength(1);
    expect(offeringConfirm.confirmation.offeringActivations).toHaveLength(1);

    const sourceId =
      knowledgeConfirm.confirmation.knowledgeActivations[0]?.knowledgeSourceId;
    const versionId =
      knowledgeConfirm.confirmation.knowledgeActivations[0]?.knowledgeVersionId;
    const offeringId =
      offeringConfirm.confirmation.offeringActivations[0]?.offeringId;
    expect(sourceId).toBeTruthy();
    const version = await prisma.knowledgeVersion.findFirstOrThrow({
      where: { id: versionId, organizationId: ctx.organizationId },
    });
    expect(version.state).toBe("ACTIVE");
    expect(version.confirmationLanguageVersion).toBe("csv.import.confirm.v1");
    expect(version.contentChecksum).toMatch(/^[0-9a-f]{64}$/);

    const retrievedKnowledge = await retrieveActiveKnowledge({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
    });
    expect(retrievedKnowledge.ok).toBe(true);
    if (retrievedKnowledge.ok) {
      expect(
        retrievedKnowledge.items.some((item) =>
          item.body.includes("Visitor parking"),
        ),
      ).toBe(true);
    }
    const retrievedOfferings = await retrieveActiveOfferings({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
    });
    expect(retrievedOfferings.ok).toBe(true);
    if (retrievedOfferings.ok) {
      expect(
        retrievedOfferings.items.some((item) => item.name === "Weekday desk"),
      ).toBe(true);
    }

    expect(await countCsvActivationAudits(prisma, ctx.organizationId)).toBe(2);
    const audits = await prisma.organizationAuditEvent.findMany({
      where: {
        organizationId: ctx.organizationId,
        action: "CSV_IMPORT_ACTIVATED",
      },
    });
    const knowledgeAudit = audits.find((item) =>
      JSON.stringify(item.metadata ?? {}).includes(knowledgeStaged.import.id),
    );
    expect(knowledgeAudit).toBeTruthy();
    const metadata = JSON.stringify(knowledgeAudit?.metadata ?? {});
    expect(metadata).not.toContain("Visitor parking");
    expect(metadata).not.toContain(knowledgeStaged.import.filename);

    const retry = await confirmCsvImport({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      importId: knowledgeStaged.import.id,
      expectedImportIdentity: knowledgeStaged.import.importIdentity,
      acknowledged: true,
    });
    expect(retry.ok).toBe(true);
    if (retry.ok) {
      expect(retry.created).toBe(false);
      expect(retry.confirmation.id).toBe(knowledgeConfirm.confirmation.id);
      expect(
        retry.confirmation.knowledgeActivations[0]?.knowledgeSourceId,
      ).toBe(sourceId);
    }
    expect(
      await prisma.knowledgeSource.count({
        where: { organizationId: ctx.organizationId },
      }),
    ).toBe(1);
    expect(await countCsvActivationAudits(prisma, ctx.organizationId)).toBe(2);
    expect(offeringId).toBeTruthy();
  });

  it("rejects missing acknowledgment, NEEDS_ATTENTION, wrong identity, and foreign IDs", async () => {
    const ctx = await createOrgWithOwner(prisma, "csv-act-deny");
    const other = await createOrgWithOwner(prisma, "csv-act-other");
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

    const missingAck = await confirmCsvImport({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      importId: staged.import.id,
      expectedImportIdentity: staged.import.importIdentity,
      acknowledged: false,
    });
    expect(missingAck.ok).toBe(false);
    if (!missingAck.ok) {
      expect(missingAck.reason).toBe("missing_acknowledgment");
    }

    const wrongIdentity = await confirmCsvImport({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      importId: staged.import.id,
      expectedImportIdentity: "b".repeat(64),
      acknowledged: true,
    });
    expect(wrongIdentity.ok).toBe(false);
    if (!wrongIdentity.ok) {
      expect(wrongIdentity.reason).toBe("identity_mismatch");
    }

    const foreign = await confirmCsvImport({
      actor: other.owner,
      organizationId: other.organizationId,
      importId: staged.import.id,
      expectedImportIdentity: staged.import.importIdentity,
      acknowledged: true,
    });
    const missing = await confirmCsvImport({
      actor: other.owner,
      organizationId: other.organizationId,
      importId: "clkbogus00000000000000000",
      expectedImportIdentity: "c".repeat(64),
      acknowledged: true,
    });
    expect(foreign.ok).toBe(false);
    expect(missing.ok).toBe(false);
    if (!foreign.ok && !missing.ok) {
      expect(foreign.reason).toBe("not_found");
      expect(missing.reason).toBe(foreign.reason);
      expect(missing.message).toBe(foreign.message);
    }

    const attention = await stageCsvImport({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      bytes: csvBytes("Title,Section,Body\nOnlyTitle,,\n"),
      filename: "bad.csv",
      declaredMimeType: CSV_MIME,
      mapping: knowledgeMapping(),
    });
    expect(attention.ok).toBe(true);
    if (!attention.ok) throw new Error(attention.message);
    expect(attention.import.status).toBe("NEEDS_ATTENTION");
    const blocked = await confirmCsvImport({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      importId: attention.import.id,
      expectedImportIdentity: attention.import.importIdentity,
      acknowledged: true,
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.reason).toBe("not_confirmable");
    }
    expect(await countDomainEntities(prisma, ctx.organizationId)).toMatchObject(
      {
        knowledgeSources: 0,
        offerings: 0,
      },
    );
  });

  it("fails closed on corrupt persisted mapping or row JSON", async () => {
    const ctx = await createOrgWithOwner(prisma, "csv-corrupt");
    const mappingJson = JSON.stringify(knowledgeMapping());
    const corruptImport = await prisma.csvImport.create({
      data: {
        organizationId: ctx.organizationId,
        importIdentity: "d".repeat(64),
        targetFamily: "KNOWLEDGE",
        status: "READY_TO_CONFIRM",
        filename: "knowledge.csv",
        mimeType: "text/csv",
        byteLength: 12,
        sourceChecksum: "e".repeat(64),
        mappingJson: "{not-json",
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
    const corruptMapping = await confirmCsvImport({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      importId: corruptImport.id,
      expectedImportIdentity: corruptImport.importIdentity,
      acknowledged: true,
    });
    expect(corruptMapping.ok).toBe(false);
    if (!corruptMapping.ok) {
      expect(corruptMapping.reason).toBe("corrupt_snapshot");
    }

    const rowImport = await prisma.csvImport.create({
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
    await prisma.csvImportRow.create({
      data: {
        organizationId: ctx.organizationId,
        importId: rowImport.id,
        displayOrder: 0,
        sourceRowNumber: 2,
        valuesJson: "{bad",
        issuesJson: "[]",
      },
    });
    const corruptRow = await confirmCsvImport({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      importId: rowImport.id,
      expectedImportIdentity: rowImport.importIdentity,
      acknowledged: true,
    });
    expect(corruptRow.ok).toBe(false);
    if (!corruptRow.ok) {
      expect(corruptRow.reason).toBe("corrupt_snapshot");
    }
    expect(
      await prisma.knowledgeSource.count({
        where: { organizationId: ctx.organizationId },
      }),
    ).toBe(0);
  });

  it("rolls back every domain write when a later row fails", async () => {
    const ctx = await createOrgWithOwner(prisma, "csv-partial");
    await seedOrganizationTimeZone(prisma, ctx.organizationId);
    const bytes = knowledgeCsvBytes([
      ["Policy A", "Overview", "Body A"],
      ["Policy B", "Overview", "Body B"],
    ]);
    const staged = await stageCsvImport({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      bytes,
      filename: "knowledge.csv",
      declaredMimeType: CSV_MIME,
      mapping: knowledgeMapping(),
    });
    expect(staged.ok).toBe(true);
    if (!staged.ok) throw new Error(staged.message);

    const failed = await confirmCsvImport(
      {
        actor: ctx.owner,
        organizationId: ctx.organizationId,
        importId: staged.import.id,
        expectedImportIdentity: staged.import.importIdentity,
        acknowledged: true,
      },
      {
        testBeforeActivateRow: async (index) => {
          if (index === 1) {
            throw new Error("forced row failure");
          }
        },
      },
    );
    expect(failed.ok).toBe(false);
    expect(
      await prisma.knowledgeSource.count({
        where: { organizationId: ctx.organizationId },
      }),
    ).toBe(0);
    expect(
      await prisma.csvImportConfirmation.count({
        where: { organizationId: ctx.organizationId },
      }),
    ).toBe(0);
    expect(await countCsvActivationAudits(prisma, ctx.organizationId)).toBe(0);
    const listed = await listRecentCsvImports({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
    });
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      expect(listed.imports[0]?.confirmed).toBe(false);
    }
  });

  it("rejects inactive membership, members, and unverified actors", async () => {
    const ctx = await createOrgWithOwner(prisma, "csv-act-auth");
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

    const member = await addMember(
      prisma,
      ctx.organizationId,
      "csv-act-member",
      "MEMBER",
    );
    const forbidden = await confirmCsvImport({
      actor: member,
      organizationId: ctx.organizationId,
      importId: staged.import.id,
      expectedImportIdentity: staged.import.importIdentity,
      acknowledged: true,
    });
    expect(forbidden.ok).toBe(false);
    if (!forbidden.ok) expect(forbidden.reason).toBe("forbidden");

    const unverified = await createUnverifiedActor(
      prisma,
      "csv-act-unverified",
    );
    await prisma.membership.create({
      data: {
        organizationId: ctx.organizationId,
        userId: unverified.id,
        role: "ADMIN",
        status: "ACTIVE",
      },
    });
    const unverifiedResult = await confirmCsvImport({
      actor: unverified,
      organizationId: ctx.organizationId,
      importId: staged.import.id,
      expectedImportIdentity: staged.import.importIdentity,
      acknowledged: true,
    });
    expect(unverifiedResult.ok).toBe(false);
    if (!unverifiedResult.ok) {
      expect(unverifiedResult.reason).toBe("unverified");
    }

    const admin = await addMember(
      prisma,
      ctx.organizationId,
      "csv-act-admin",
      "ADMIN",
    );
    const membership = await prisma.membership.findFirstOrThrow({
      where: { organizationId: ctx.organizationId, userId: admin.id },
    });
    await deactivateMember({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      membershipId: membership.id,
    });
    const inactive = await confirmCsvImport({
      actor: admin,
      organizationId: ctx.organizationId,
      importId: staged.import.id,
      expectedImportIdentity: staged.import.importIdentity,
      acknowledged: true,
    });
    expect(inactive.ok).toBe(false);
    if (!inactive.ok) {
      expect(inactive.reason).toBe("inactive_membership");
    }
  });

  it("rejects activation above the supported row cap and accepts the exact maximum", async () => {
    const ctx = await createOrgWithOwner(prisma, "csv-cap");
    const atMax = Array.from(
      { length: CSV_IMPORT_ACTIVATION_MAX_ROWS },
      (_, index) =>
        [`Item ${index + 1}`, "Overview", `Body ${index + 1}`] as [
          string,
          string,
          string,
        ],
    );
    const maxStaged = await stageCsvImport({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      bytes: knowledgeCsvBytes(atMax),
      filename: "max.csv",
      declaredMimeType: CSV_MIME,
      mapping: knowledgeMapping(),
    });
    expect(maxStaged.ok).toBe(true);
    if (!maxStaged.ok) throw new Error(maxStaged.message);
    const maxConfirm = await confirmCsvImport({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      importId: maxStaged.import.id,
      expectedImportIdentity: maxStaged.import.importIdentity,
      acknowledged: true,
    });
    expect(maxConfirm.ok).toBe(true);
    if (maxConfirm.ok) {
      expect(maxConfirm.confirmation.createdRowCount).toBe(
        CSV_IMPORT_ACTIVATION_MAX_ROWS,
      );
    }

    const over = [
      ...atMax,
      ["Extra", "Overview", "Too many"] as [string, string, string],
    ];
    const overStaged = await stageCsvImport({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      bytes: knowledgeCsvBytes(over),
      filename: "over.csv",
      declaredMimeType: CSV_MIME,
      mapping: knowledgeMapping(),
    });
    expect(overStaged.ok).toBe(true);
    if (!overStaged.ok) throw new Error(overStaged.message);
    const overConfirm = await confirmCsvImport({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      importId: overStaged.import.id,
      expectedImportIdentity: overStaged.import.importIdentity,
      acknowledged: true,
    });
    expect(overConfirm.ok).toBe(false);
    if (!overConfirm.ok) {
      expect(overConfirm.reason).toBe("activation_cap");
      expect(overConfirm.message).toContain(
        String(CSV_IMPORT_ACTIVATION_MAX_ROWS),
      );
    }
  }, 120_000);

  it("does not leak customer cell content into errors or audit metadata", async () => {
    const ctx = await createOrgWithOwner(prisma, "csv-privacy");
    const secret = "SECRET_CELL_VALUE_DO_NOT_LEAK";
    const staged = await stageCsvImport({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      bytes: knowledgeCsvBytes([["Title", "Section", secret]]),
      filename: "knowledge.csv",
      declaredMimeType: CSV_MIME,
      mapping: knowledgeMapping(),
    });
    expect(staged.ok).toBe(true);
    if (!staged.ok) throw new Error(staged.message);
    const confirmed = await confirmCsvImport({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      importId: staged.import.id,
      expectedImportIdentity: staged.import.importIdentity,
      acknowledged: true,
    });
    expect(confirmed.ok).toBe(true);
    const audits = await prisma.organizationAuditEvent.findMany({
      where: { organizationId: ctx.organizationId },
    });
    for (const audit of audits) {
      expect(JSON.stringify(audit.metadata ?? {})).not.toContain(secret);
    }
    const loaded = await getCsvImport({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      importId: staged.import.id,
    });
    expect(loaded.ok).toBe(true);
  });
});
