import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  archiveKnowledgeSource,
  confirmKnowledgeVersion,
  createManualKnowledgeSource,
  getKnowledgeSource,
  updateKnowledgeDraft,
} from "@/lib/orgs/knowledge";
import { changeMemberRole, deactivateMember } from "@/lib/orgs/memberships";
import {
  addMember,
  confirmSample,
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
});
