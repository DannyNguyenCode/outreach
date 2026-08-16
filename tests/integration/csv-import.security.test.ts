import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { getCsvImport, stageCsvImport } from "@/lib/orgs/csv-import";
import { changeMemberRole, deactivateMember } from "@/lib/orgs/memberships";
import { retrieveActiveKnowledge } from "@/lib/orgs/knowledge-retrieval";
import { retrieveActiveOfferings } from "@/lib/orgs/offering-retrieval";
import {
  addMember,
  countCsvImportAudits,
  countDomainEntities,
  createOrgWithOwner,
  createUnverifiedActor,
  knowledgeCsvBytes,
  knowledgeMapping,
  officialTemplateBytes,
} from "@/tests/integration/helpers/csv-import";
import { resetApplicationData } from "@/tests/integration/reset";
import { CSV_MIME } from "@/tests/helpers/tabular-fixtures";

describe("Phase 4D CSV import authorization and isolation", () => {
  const prisma = new PrismaClient();

  beforeEach(async () => {
    await resetApplicationData(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("denies unauthenticated, unverified, inactive, wrong-selected, and member actors", async () => {
    const ctx = await createOrgWithOwner(prisma, "csv-auth");
    const other = await createOrgWithOwner(prisma, "csv-auth-other");
    const template = officialTemplateBytes("knowledge");
    const payload = {
      organizationId: ctx.organizationId,
      bytes: template.bytes,
      filename: template.filename,
      declaredMimeType: template.mimeType,
      mapping: template.mapping,
    };

    const unauthenticated = await stageCsvImport({
      ...payload,
      actor: null,
    });
    expect(unauthenticated.ok).toBe(false);
    if (!unauthenticated.ok) {
      expect(unauthenticated.reason).toBe("unauthenticated");
    }

    const unverified = await createUnverifiedActor(prisma, "csv-unverified");
    await prisma.membership.create({
      data: {
        organizationId: ctx.organizationId,
        userId: unverified.id,
        role: "ADMIN",
        status: "ACTIVE",
      },
    });
    const unverifiedResult = await stageCsvImport({
      ...payload,
      actor: unverified,
    });
    expect(unverifiedResult.ok).toBe(false);
    if (!unverifiedResult.ok) {
      expect(unverifiedResult.reason).toBe("unverified");
    }

    const admin = await addMember(
      prisma,
      ctx.organizationId,
      "csv-auth-admin",
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
    const inactive = await stageCsvImport({
      ...payload,
      actor: admin,
    });
    expect(inactive.ok).toBe(false);
    if (!inactive.ok) {
      expect(inactive.reason).toBe("inactive_membership");
    }

    const wrongSelected = await stageCsvImport({
      ...payload,
      actor: ctx.owner,
      organizationId: other.organizationId,
    });
    expect(wrongSelected.ok).toBe(false);
    if (!wrongSelected.ok) {
      expect(wrongSelected.reason).toBe("not_a_member");
    }

    const member = await addMember(
      prisma,
      ctx.organizationId,
      "csv-auth-member",
      "MEMBER",
    );
    const forbidden = await stageCsvImport({
      ...payload,
      actor: member,
    });
    expect(forbidden.ok).toBe(false);
    if (!forbidden.ok) {
      expect(forbidden.reason).toBe("forbidden");
    }

    expect(await prisma.csvImport.count()).toBe(0);
    expect(await countCsvImportAudits(prisma, ctx.organizationId)).toBe(0);
  });

  it("does not distinguish a foreign import id from a missing id", async () => {
    const a = await createOrgWithOwner(prisma, "csv-iso-a");
    const b = await createOrgWithOwner(prisma, "csv-iso-b");
    const template = officialTemplateBytes("knowledge");
    const staged = await stageCsvImport({
      actor: a.owner,
      organizationId: a.organizationId,
      bytes: template.bytes,
      filename: template.filename,
      declaredMimeType: template.mimeType,
      mapping: template.mapping,
    });
    expect(staged.ok).toBe(true);
    if (!staged.ok) throw new Error(staged.message);

    const foreign = await getCsvImport({
      actor: b.owner,
      organizationId: b.organizationId,
      importId: staged.import.id,
    });
    const missing = await getCsvImport({
      actor: b.owner,
      organizationId: b.organizationId,
      importId: "clkbogus00000000000000000",
    });
    expect(foreign.ok).toBe(false);
    expect(missing.ok).toBe(false);
    if (!foreign.ok && !missing.ok) {
      expect(foreign.reason).toBe("not_found");
      expect(missing.reason).toBe(foreign.reason);
      expect(missing.message).toBe(foreign.message);
    }

    const crossGet = await getCsvImport({
      actor: a.owner,
      organizationId: b.organizationId,
      importId: staged.import.id,
    });
    expect(crossGet.ok).toBe(false);
    if (!crossGet.ok) {
      expect(crossGet.reason).toBe("not_a_member");
    }
  });

  it("creates no knowledge, offering, retrieval, storage, or job side effects", async () => {
    const ctx = await createOrgWithOwner(prisma, "csv-no-domain");
    const staged = await stageCsvImport({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      bytes: knowledgeCsvBytes(),
      filename: "knowledge.csv",
      declaredMimeType: CSV_MIME,
      mapping: knowledgeMapping(),
    });
    expect(staged.ok).toBe(true);
    expect(await countDomainEntities(prisma, ctx.organizationId)).toEqual({
      knowledgeSources: 0,
      knowledgeVersions: 0,
      offerings: 0,
      offeringVersions: 0,
      documents: 0,
      jobs: 0,
      issues: 0,
    });

    const knowledge = await retrieveActiveKnowledge({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
    });
    expect(knowledge.ok).toBe(true);
    if (knowledge.ok) {
      expect(knowledge.items).toEqual([]);
    }
    const offerings = await retrieveActiveOfferings({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
    });
    expect(offerings.ok).toBe(true);
    if (offerings.ok) {
      expect(offerings.items).toEqual([]);
    }
  });

  it("still forbids a demoted admin from reading a staged import", async () => {
    const ctx = await createOrgWithOwner(prisma, "csv-demote");
    const admin = await addMember(
      prisma,
      ctx.organizationId,
      "csv-demote-admin",
      "ADMIN",
    );
    const staged = await stageCsvImport({
      actor: admin,
      organizationId: ctx.organizationId,
      bytes: knowledgeCsvBytes(),
      filename: "knowledge.csv",
      declaredMimeType: CSV_MIME,
      mapping: knowledgeMapping(),
    });
    expect(staged.ok).toBe(true);
    if (!staged.ok) throw new Error(staged.message);

    const membership = await prisma.membership.findFirstOrThrow({
      where: { organizationId: ctx.organizationId, userId: admin.id },
    });
    await changeMemberRole({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      membershipId: membership.id,
      nextRole: "MEMBER",
    });
    const denied = await getCsvImport({
      actor: admin,
      organizationId: ctx.organizationId,
      importId: staged.import.id,
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.reason).toBe("forbidden");
    }
  });
});
