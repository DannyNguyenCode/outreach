import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  archiveKnowledgeSource,
  confirmKnowledgeVersion,
  createManualKnowledgeSource,
  getKnowledgeSource,
  getKnowledgeVersion,
  listKnowledgeSources,
  updateKnowledgeDraft,
} from "@/lib/orgs/knowledge";
import { retrieveActiveKnowledge } from "@/lib/orgs/knowledge-retrieval";
import { changeMemberRole, deactivateMember } from "@/lib/orgs/memberships";
import {
  addMember,
  confirmSample,
  createMemberAccessFixtures,
  createOrgWithOwner,
  createSampleDraft,
} from "@/tests/integration/helpers/knowledge";
import { resetApplicationData } from "@/tests/integration/reset";

describe("Phase 4A knowledge security", () => {
  const prisma = new PrismaClient();

  beforeEach(async () => {
    await resetApplicationData(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("forbids members from managing or confirming knowledge", async () => {
    const ctx = await createOrgWithOwner(prisma, "know-forbid");
    const member = await addMember(
      prisma,
      ctx.organizationId,
      "know-forbid-member",
      "MEMBER",
    );
    const asOwner = await createSampleDraft(ctx.owner, ctx.organizationId);
    const memberCreate = await createManualKnowledgeSource({
      actor: member,
      organizationId: ctx.organizationId,
      raw: {
        title: "Member draft",
        sections: [{ title: "A", passages: [{ body: "nope" }] }],
      },
    });
    expect(memberCreate.ok).toBe(false);
    if (!memberCreate.ok) {
      expect(memberCreate.reason).toBe("forbidden");
    }

    const confirm = await confirmKnowledgeVersion({
      actor: member,
      organizationId: ctx.organizationId,
      raw: {
        sourceId: asOwner.source.id,
        versionId: asOwner.version.id,
        expectedDraftRevision: String(asOwner.version.draftRevision),
        expectedChecksum: asOwner.version.contentChecksum,
        confirmAccuracy: "on",
      },
    });
    expect(confirm.ok).toBe(false);
    if (!confirm.ok) {
      expect(confirm.reason).toBe("forbidden");
    }
  });

  it("does not distinguish missing knowledge from another tenant's IDs", async () => {
    const a = await createOrgWithOwner(prisma, "know-iso-a");
    const b = await createOrgWithOwner(prisma, "know-iso-b");
    const created = await createSampleDraft(a.owner, a.organizationId);
    const missing = await getKnowledgeSource({
      actor: b.owner,
      organizationId: b.organizationId,
      sourceId: created.source.id,
    });
    const unknown = await getKnowledgeSource({
      actor: b.owner,
      organizationId: b.organizationId,
      sourceId: "clkbogus00000000000000000",
    });
    expect(missing.ok).toBe(false);
    expect(unknown.ok).toBe(false);
    if (!missing.ok && !unknown.ok) {
      expect(missing.message).toBe(unknown.message);
      expect(missing.reason).toBe("not_found");
    }
  });

  it("ignores client-supplied confirmer identity and language version", async () => {
    const ctx = await createOrgWithOwner(prisma, "know-forge");
    const other = await addMember(
      prisma,
      ctx.organizationId,
      "know-forge-admin",
      "ADMIN",
    );
    const created = await createSampleDraft(ctx.owner, ctx.organizationId);
    const confirmed = await confirmKnowledgeVersion({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: {
        sourceId: created.source.id,
        versionId: created.version.id,
        expectedDraftRevision: String(created.version.draftRevision),
        expectedChecksum: created.version.contentChecksum,
        confirmAccuracy: "on",
        confirmerUserId: other.id,
        confirmedAt: "2000-01-01T00:00:00.000Z",
        confirmationLanguageVersion: "forged.v9",
        state: "ACTIVE",
        organizationId: "someone-else",
      },
    });
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) throw new Error(confirmed.message);
    expect(confirmed.version.confirmerUserId).toBe(ctx.owner.id);
    expect(confirmed.version.confirmationLanguageVersion).toBe(
      "knowledge.confirm.v1",
    );
    expect(
      confirmed.version.confirmedAt?.toISOString().startsWith("2000-"),
    ).toBe(false);
  });

  it("does not mutate confirmed content on a later draft edit", async () => {
    const ctx = await createOrgWithOwner(prisma, "know-immutable");
    const created = await createSampleDraft(ctx.owner, ctx.organizationId);
    await confirmSample(
      ctx.owner,
      ctx.organizationId,
      created.source.id,
      created.version.id,
      created.version.draftRevision,
      created.version.contentChecksum,
    );
    const edited = await updateKnowledgeDraft({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: {
        sourceId: created.source.id,
        versionId: created.version.id,
        expectedDraftRevision: "0",
        title: "Should not apply",
        sections: [{ title: "Nope", passages: [{ body: "mutated" }] }],
      },
    });
    expect(edited.ok).toBe(false);
    const original = await prisma.knowledgeVersion.findUniqueOrThrow({
      where: { id: created.version.id },
    });
    expect(original.title).toBe("Return policy");
    expect(original.state).toBe("ACTIVE");
  });

  it("blocks archive after membership deactivation", async () => {
    const ctx = await createOrgWithOwner(prisma, "know-deact");
    const admin = await addMember(
      prisma,
      ctx.organizationId,
      "know-deact-admin",
      "ADMIN",
    );
    const created = await createSampleDraft(admin, ctx.organizationId);
    await confirmSample(
      admin,
      ctx.organizationId,
      created.source.id,
      created.version.id,
      created.version.draftRevision,
      created.version.contentChecksum,
    );
    const membership = await prisma.membership.findFirstOrThrow({
      where: { organizationId: ctx.organizationId, userId: admin.id },
    });
    const deactivated = await deactivateMember({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      membershipId: membership.id,
    });
    expect(deactivated.ok).toBe(true);
    const source = await prisma.knowledgeSource.findUniqueOrThrow({
      where: { id: created.source.id },
    });
    const archived = await archiveKnowledgeSource({
      actor: admin,
      organizationId: ctx.organizationId,
      raw: {
        sourceId: created.source.id,
        expectedVersion: String(source.version),
      },
    });
    expect(archived.ok).toBe(false);
    if (!archived.ok) {
      expect(archived.reason).toBe("inactive_membership");
    }
  });

  it("blocks confirm after demotion to member", async () => {
    const ctx = await createOrgWithOwner(prisma, "know-demote");
    const admin = await addMember(
      prisma,
      ctx.organizationId,
      "know-demote-admin",
      "ADMIN",
    );
    const created = await createSampleDraft(admin, ctx.organizationId);
    const membership = await prisma.membership.findFirstOrThrow({
      where: { organizationId: ctx.organizationId, userId: admin.id },
    });
    const demoted = await changeMemberRole({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      membershipId: membership.id,
      nextRole: "MEMBER",
    });
    expect(demoted.ok).toBe(true);
    const confirm = await confirmKnowledgeVersion({
      actor: admin,
      organizationId: ctx.organizationId,
      raw: {
        sourceId: created.source.id,
        versionId: created.version.id,
        expectedDraftRevision: String(created.version.draftRevision),
        expectedChecksum: created.version.contentChecksum,
        confirmAccuracy: "on",
      },
    });
    expect(confirm.ok).toBe(false);
    if (!confirm.ok) {
      expect(confirm.reason).toBe("forbidden");
    }
  });

  it("hides non-visible knowledge behind the same not_found as unknown IDs", async () => {
    const ctx = await createOrgWithOwner(prisma, "know-member-hide");
    const member = await addMember(
      prisma,
      ctx.organizationId,
      "know-member-hide-user",
      "MEMBER",
    );
    const other = await createOrgWithOwner(prisma, "know-member-hide-other");
    const otherVisible = await createSampleDraft(
      other.owner,
      other.organizationId,
      { title: "Other tenant policy" },
    );
    await confirmSample(
      other.owner,
      other.organizationId,
      otherVisible.source.id,
      otherVisible.version.id,
      otherVisible.version.draftRevision,
      otherVisible.version.contentChecksum,
    );
    const fixtures = await createMemberAccessFixtures(
      prisma,
      ctx.owner,
      ctx.organizationId,
    );
    const unknownId = "clkbogus00000000000000000";

    const unknownSource = await getKnowledgeSource({
      actor: member,
      organizationId: ctx.organizationId,
      sourceId: unknownId,
    });
    const unknownVersion = await getKnowledgeVersion({
      actor: member,
      organizationId: ctx.organizationId,
      sourceId: unknownId,
      versionId: unknownId,
    });
    expect(unknownSource.ok).toBe(false);
    expect(unknownVersion.ok).toBe(false);
    if (!unknownSource.ok && !unknownVersion.ok) {
      expect(unknownSource.reason).toBe("not_found");
      expect(unknownVersion.reason).toBe("not_found");
    }

    const hiddenSourceLookups = [
      fixtures.draft.sourceId,
      fixtures.future.sourceId,
      fixtures.expired.sourceId,
      fixtures.archived.sourceId,
      fixtures.wrongCategory.sourceId,
      otherVisible.source.id,
      unknownId,
    ];
    for (const sourceId of hiddenSourceLookups) {
      const result = await getKnowledgeSource({
        actor: member,
        organizationId: ctx.organizationId,
        sourceId,
      });
      expect(result.ok).toBe(false);
      if (!result.ok && !unknownSource.ok) {
        expect(result.reason).toBe("not_found");
        expect(result.message).toBe(unknownSource.message);
      }
    }

    const hiddenVersionLookups = [
      fixtures.draft,
      fixtures.future,
      fixtures.expired,
      fixtures.archived,
      fixtures.superseded,
      fixtures.replacementDraft,
      fixtures.wrongCategory,
      {
        sourceId: otherVisible.source.id,
        versionId: otherVisible.version.id,
      },
      { sourceId: unknownId, versionId: unknownId },
      { sourceId: fixtures.alpha.sourceId, versionId: unknownId },
    ];
    for (const pair of hiddenVersionLookups) {
      const result = await getKnowledgeVersion({
        actor: member,
        organizationId: ctx.organizationId,
        sourceId: pair.sourceId,
        versionId: pair.versionId,
      });
      expect(result.ok).toBe(false);
      if (!result.ok && !unknownVersion.ok) {
        expect(result.reason).toBe("not_found");
        expect(result.message).toBe(unknownVersion.message);
      }
    }

    for (const pair of [fixtures.alpha, fixtures.current, fixtures.zebra]) {
      const source = await getKnowledgeSource({
        actor: member,
        organizationId: ctx.organizationId,
        sourceId: pair.sourceId,
      });
      const version = await getKnowledgeVersion({
        actor: member,
        organizationId: ctx.organizationId,
        sourceId: pair.sourceId,
        versionId: pair.versionId,
      });
      expect(source.ok).toBe(true);
      expect(version.ok).toBe(true);
      if (source.ok) {
        expect(source.source.versions.map((item) => item.id)).toEqual([
          pair.versionId,
        ]);
      }
      if (version.ok) {
        expect(version.version.id).toBe(pair.versionId);
        expect(version.version.title).toBe(pair.title);
      }
    }

    const retrieved = await retrieveActiveKnowledge({
      actor: member,
      organizationId: ctx.organizationId,
    });
    expect(retrieved.ok).toBe(true);
    if (!retrieved.ok) throw new Error(retrieved.message);
    expect(retrieved.items.map((item) => item.versionTitle)).toEqual(
      fixtures.visibleTitles,
    );
    const bodies = retrieved.items.map((item) => item.body);
    expect(bodies).toEqual([
      "alpha-visible-body",
      "currently-effective-body",
      "zebra-visible-body",
    ]);
    for (const hiddenBody of [
      "unconfirmed-draft-body",
      "future-confirmed-body",
      "expired-confirmed-body",
      "archived-confirmed-body",
      "superseded-historical-body",
      "secret-replacement-draft-body",
      "wrong-category-body",
    ]) {
      expect(bodies).not.toContain(hiddenBody);
    }

    const secretRetrieved = await retrieveActiveKnowledge({
      actor: member,
      organizationId: ctx.organizationId,
      query: "secret-replacement-draft-body",
    });
    expect(secretRetrieved.ok).toBe(true);
    if (secretRetrieved.ok) {
      expect(secretRetrieved.items).toEqual([]);
      expect(secretRetrieved.total).toBe(0);
    }
  });

  it("lists member-visible sources after SQL filtering, search, and pagination", async () => {
    const ctx = await createOrgWithOwner(prisma, "know-member-list");
    const member = await addMember(
      prisma,
      ctx.organizationId,
      "know-member-list-user",
      "MEMBER",
    );
    const fixtures = await createMemberAccessFixtures(
      prisma,
      ctx.owner,
      ctx.organizationId,
    );

    const listedAll = await listKnowledgeSources({
      actor: member,
      organizationId: ctx.organizationId,
      status: "all",
    });
    expect(listedAll.ok).toBe(true);
    if (!listedAll.ok) throw new Error(listedAll.message);
    expect(listedAll.total).toBe(3);
    expect(listedAll.items.map((item) => item.title)).toEqual(
      fixtures.visibleTitles,
    );
    expect(new Set(listedAll.items.map((item) => item.id)).size).toBe(3);
    expect(
      listedAll.items.filter((item) => item.id === fixtures.alpha.sourceId),
    ).toHaveLength(1);

    for (const item of listedAll.items) {
      expect(item.versions).toHaveLength(1);
      expect(item.versions[0]?.draftRevision).toBeUndefined();
      expect(item.versions[0]?.contentChecksum).toBeUndefined();
      expect(item).not.toHaveProperty("confirmerUserId");
      expect(item.versions[0]).not.toHaveProperty("confirmerUserId");
      expect(item.versions[0]).not.toHaveProperty("supersedesVersionId");
      expect(item.versions[0]).not.toHaveProperty("restoredFromVersionId");
      expect(item.versions[0]).not.toHaveProperty("createdByUserId");
    }

    const page1 = await listKnowledgeSources({
      actor: member,
      organizationId: ctx.organizationId,
      page: 1,
      pageSize: 2,
    });
    const page2 = await listKnowledgeSources({
      actor: member,
      organizationId: ctx.organizationId,
      page: 2,
      pageSize: 2,
    });
    expect(page1.ok).toBe(true);
    expect(page2.ok).toBe(true);
    if (!page1.ok || !page2.ok) {
      throw new Error("expected member list pagination to succeed");
    }
    expect(page1.total).toBe(3);
    expect(page2.total).toBe(3);
    expect(page1.items).toHaveLength(2);
    expect(page2.items).toHaveLength(1);
    expect([
      ...page1.items.map((item) => item.title),
      ...page2.items.map((item) => item.title),
    ]).toEqual(fixtures.visibleTitles);

    const secretSearch = await listKnowledgeSources({
      actor: member,
      organizationId: ctx.organizationId,
      query: "Secret replacement",
    });
    expect(secretSearch.ok).toBe(true);
    if (secretSearch.ok) {
      expect(secretSearch.items).toEqual([]);
      expect(secretSearch.total).toBe(0);
    }

    const historicalSearch = await listKnowledgeSources({
      actor: member,
      organizationId: ctx.organizationId,
      query: "Superseded historical",
    });
    expect(historicalSearch.ok).toBe(true);
    if (historicalSearch.ok) {
      expect(historicalSearch.items).toEqual([]);
      expect(historicalSearch.total).toBe(0);
    }

    const alphaSearch = await listKnowledgeSources({
      actor: member,
      organizationId: ctx.organizationId,
      query: "Alpha member",
    });
    expect(alphaSearch.ok).toBe(true);
    if (alphaSearch.ok) {
      expect(alphaSearch.total).toBe(1);
      expect(alphaSearch.items.map((item) => item.title)).toEqual([
        "Alpha member policy",
      ]);
    }
  });
});
