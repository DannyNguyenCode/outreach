import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { retrieveActiveKnowledge } from "@/lib/orgs/knowledge-retrieval";
import {
  addMember,
  confirmSample,
  createOrgWithOwner,
  createSampleDraft,
} from "@/tests/integration/helpers/knowledge";
import { resetApplicationData } from "@/tests/integration/reset";

describe("Phase 4A knowledge retrieval", () => {
  const prisma = new PrismaClient();

  beforeEach(async () => {
    await resetApplicationData(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("filters before pagination and orders deterministically", async () => {
    const ctx = await createOrgWithOwner(prisma, "know-order");
    const alpha = await createSampleDraft(ctx.owner, ctx.organizationId, {
      title: "Alpha policy",
      sections: [
        { title: "A", passages: [{ body: "Alpha body one." }] },
        { title: "B", passages: [{ body: "Alpha body two." }] },
      ],
    });
    const beta = await createSampleDraft(ctx.owner, ctx.organizationId, {
      title: "Beta policy",
      sections: [{ title: "B", passages: [{ body: "Beta body." }] }],
    });
    await confirmSample(
      ctx.owner,
      ctx.organizationId,
      alpha.source.id,
      alpha.version.id,
      alpha.version.draftRevision,
      alpha.version.contentChecksum,
    );
    await confirmSample(
      ctx.owner,
      ctx.organizationId,
      beta.source.id,
      beta.version.id,
      beta.version.draftRevision,
      beta.version.contentChecksum,
    );

    const page1 = await retrieveActiveKnowledge({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      page: 1,
      pageSize: 2,
    });
    expect(page1.ok).toBe(true);
    if (!page1.ok) throw new Error(page1.message);
    expect(page1.total).toBe(3);
    expect(page1.items.map((item) => item.body)).toEqual([
      "Alpha body one.",
      "Alpha body two.",
    ]);

    const page2 = await retrieveActiveKnowledge({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      page: 2,
      pageSize: 2,
    });
    expect(page2.ok).toBe(true);
    if (!page2.ok) throw new Error(page2.message);
    expect(page2.items.map((item) => item.body)).toEqual(["Beta body."]);
  });

  it("excludes future, expired, and other source classes", async () => {
    const ctx = await createOrgWithOwner(prisma, "know-filter");
    const future = await createSampleDraft(ctx.owner, ctx.organizationId, {
      title: "Future policy",
      effectiveFrom: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const expired = await createSampleDraft(ctx.owner, ctx.organizationId, {
      title: "Expired policy",
      effectiveFrom: new Date("2020-01-01T00:00:00.000Z").toISOString(),
      effectiveUntil: new Date("2020-12-31T00:00:00.000Z").toISOString(),
    });
    const current = await createSampleDraft(ctx.owner, ctx.organizationId, {
      title: "Current policy",
    });
    await confirmSample(
      ctx.owner,
      ctx.organizationId,
      future.source.id,
      future.version.id,
      future.version.draftRevision,
      future.version.contentChecksum,
    );
    await confirmSample(
      ctx.owner,
      ctx.organizationId,
      expired.source.id,
      expired.version.id,
      expired.version.draftRevision,
      expired.version.contentChecksum,
    );
    await confirmSample(
      ctx.owner,
      ctx.organizationId,
      current.source.id,
      current.version.id,
      current.version.draftRevision,
      current.version.contentChecksum,
    );

    const guidanceSource = await prisma.knowledgeSource.create({
      data: {
        organizationId: ctx.organizationId,
        inputKind: "MANUAL",
        category: "PLATFORM_MAINTAINED_GUIDANCE",
        title: "Template example",
      },
    });
    const guidanceVersion = await prisma.knowledgeVersion.create({
      data: {
        organizationId: ctx.organizationId,
        sourceId: guidanceSource.id,
        state: "ACTIVE",
        title: "Template example",
        contentChecksum: "b".repeat(64),
        confirmedAt: new Date(),
        confirmationLanguageVersion: "knowledge.confirm.v1",
        confirmerUserId: ctx.owner.id,
      },
    });
    const guidanceSection = await prisma.knowledgeSection.create({
      data: {
        organizationId: ctx.organizationId,
        sourceId: guidanceSource.id,
        versionId: guidanceVersion.id,
        citationKey: "sec_template",
        title: "Example",
        displayOrder: 0,
      },
    });
    await prisma.knowledgePassage.create({
      data: {
        organizationId: ctx.organizationId,
        sourceId: guidanceSource.id,
        versionId: guidanceVersion.id,
        sectionId: guidanceSection.id,
        citationKey: "pas_template",
        body: "This is platform guidance, not a customer fact.",
        displayOrder: 0,
      },
    });

    const retrieved = await retrieveActiveKnowledge({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
    });
    expect(retrieved.ok).toBe(true);
    if (!retrieved.ok) throw new Error(retrieved.message);
    expect(retrieved.items.map((item) => item.versionTitle)).toEqual([
      "Current policy",
    ]);
  });

  it("does not leak another tenant's passages", async () => {
    const a = await createOrgWithOwner(prisma, "know-tenant-a");
    const b = await createOrgWithOwner(prisma, "know-tenant-b");
    const created = await createSampleDraft(a.owner, a.organizationId, {
      title: "Secret policy",
      sections: [{ title: "Secret", passages: [{ body: "tenant-a-only" }] }],
    });
    await confirmSample(
      a.owner,
      a.organizationId,
      created.source.id,
      created.version.id,
      created.version.draftRevision,
      created.version.contentChecksum,
    );

    const leaked = await retrieveActiveKnowledge({
      actor: b.owner,
      organizationId: a.organizationId,
    });
    expect(leaked.ok).toBe(false);

    const own = await retrieveActiveKnowledge({
      actor: b.owner,
      organizationId: b.organizationId,
      query: "tenant-a-only",
    });
    expect(own.ok).toBe(true);
    if (own.ok) {
      expect(own.items).toEqual([]);
    }
  });

  it("lets members read active knowledge but not drafts", async () => {
    const ctx = await createOrgWithOwner(prisma, "know-member-read");
    const member = await addMember(
      prisma,
      ctx.organizationId,
      "know-member",
      "MEMBER",
    );
    const draft = await createSampleDraft(ctx.owner, ctx.organizationId, {
      title: "Draft only",
    });
    const active = await createSampleDraft(ctx.owner, ctx.organizationId, {
      title: "Active member policy",
    });
    await confirmSample(
      ctx.owner,
      ctx.organizationId,
      active.source.id,
      active.version.id,
      active.version.draftRevision,
      active.version.contentChecksum,
    );

    const retrieved = await retrieveActiveKnowledge({
      actor: member,
      organizationId: ctx.organizationId,
    });
    expect(retrieved.ok).toBe(true);
    if (!retrieved.ok) throw new Error(retrieved.message);
    expect(retrieved.items.map((item) => item.versionTitle)).toEqual([
      "Active member policy",
    ]);
    expect(draft.version.state).toBe("DRAFT");
  });
});
