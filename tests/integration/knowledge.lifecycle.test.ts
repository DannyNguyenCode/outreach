import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  archiveKnowledgeSource,
  confirmKnowledgeVersion,
  createReplacementDraft,
  restoreKnowledgeVersion,
  updateKnowledgeDraft,
} from "@/lib/orgs/knowledge";
import { retrieveActiveKnowledge } from "@/lib/orgs/knowledge-retrieval";
import {
  confirmSample,
  countKnowledgeAudits,
  createOrgWithOwner,
  createSampleDraft,
} from "@/tests/integration/helpers/knowledge";
import { resetApplicationData } from "@/tests/integration/reset";

describe("Phase 4A knowledge lifecycle", () => {
  const prisma = new PrismaClient();

  beforeEach(async () => {
    await resetApplicationData(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a draft that is excluded from retrieval until confirmed", async () => {
    const ctx = await createOrgWithOwner(prisma, "know-draft");
    const created = await createSampleDraft(ctx.owner, ctx.organizationId);
    expect(created.version.state).toBe("DRAFT");
    expect(created.version.confirmedAt).toBeNull();
    expect(created.version.confirmerUserId).toBeNull();
    expect(created.version.sections[0]?.citationKey).toBeTruthy();

    const retrieved = await retrieveActiveKnowledge({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
    });
    expect(retrieved.ok).toBe(true);
    if (retrieved.ok) {
      expect(retrieved.items).toEqual([]);
      expect(retrieved.total).toBe(0);
    }
    expect(
      await countKnowledgeAudits(
        prisma,
        ctx.organizationId,
        "KNOWLEDGE_SOURCE_CREATED",
      ),
    ).toBe(1);
  });

  it("rejects activation without explicit confirmation", async () => {
    const ctx = await createOrgWithOwner(prisma, "know-noconfirm");
    const created = await createSampleDraft(ctx.owner, ctx.organizationId);
    const result = await confirmKnowledgeVersion({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: {
        sourceId: created.source.id,
        versionId: created.version.id,
        expectedDraftRevision: String(created.version.draftRevision),
        expectedChecksum: created.version.contentChecksum,
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("validation");
    }
    const version = await prisma.knowledgeVersion.findUniqueOrThrow({
      where: { id: created.version.id },
    });
    expect(version.state).toBe("DRAFT");
    expect(
      await countKnowledgeAudits(
        prisma,
        ctx.organizationId,
        "KNOWLEDGE_VERSION_CONFIRMED",
      ),
    ).toBe(0);
  });

  it("confirms the exact previewed version and returns it from retrieval", async () => {
    const ctx = await createOrgWithOwner(prisma, "know-confirm");
    const created = await createSampleDraft(ctx.owner, ctx.organizationId);
    const confirmed = await confirmSample(
      ctx.owner,
      ctx.organizationId,
      created.source.id,
      created.version.id,
      created.version.draftRevision,
      created.version.contentChecksum,
    );
    expect(confirmed.version.state).toBe("ACTIVE");
    expect(confirmed.version.confirmerUserId).toBe(ctx.owner.id);
    expect(confirmed.version.confirmedAt).toBeTruthy();
    expect(confirmed.version.confirmationLanguageVersion).toBe(
      "knowledge.confirm.v1",
    );
    expect(confirmed.version.contentChecksum).toBe(
      created.version.contentChecksum,
    );

    const retrieved = await retrieveActiveKnowledge({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
    });
    expect(retrieved.ok).toBe(true);
    if (!retrieved.ok) throw new Error(retrieved.message);
    expect(retrieved.items).toHaveLength(1);
    expect(retrieved.items[0]?.citation.sourceId).toBe(created.source.id);
    expect(retrieved.items[0]?.citation.versionId).toBe(created.version.id);
    expect(retrieved.items[0]?.citation.sectionCitationKey).toBe(
      created.version.sections[0]?.citationKey,
    );
    expect(retrieved.items[0]?.body).toContain("30 days");
  });

  it("rejects a stale preview checksum", async () => {
    const ctx = await createOrgWithOwner(prisma, "know-checksum");
    const created = await createSampleDraft(ctx.owner, ctx.organizationId);
    const updated = await updateKnowledgeDraft({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: {
        sourceId: created.source.id,
        versionId: created.version.id,
        expectedDraftRevision: String(created.version.draftRevision),
        title: "Updated return policy",
        sections: [
          {
            citationKey: created.version.sections[0]?.citationKey,
            title: "Overview",
            passages: [
              {
                citationKey:
                  created.version.sections[0]?.passages[0]?.citationKey,
                body: "Customers may return unused items within 14 days.",
              },
            ],
          },
        ],
      },
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) throw new Error(updated.message);

    const stale = await confirmKnowledgeVersion({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: {
        sourceId: created.source.id,
        versionId: created.version.id,
        expectedDraftRevision: String(updated.version.draftRevision),
        expectedChecksum: created.version.contentChecksum,
        confirmAccuracy: "on",
      },
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.reason).toBe("checksum_mismatch");
    }
  });

  it("supersedes the previous active version when a replacement is confirmed", async () => {
    const ctx = await createOrgWithOwner(prisma, "know-replace");
    const created = await createSampleDraft(ctx.owner, ctx.organizationId);
    const first = await confirmSample(
      ctx.owner,
      ctx.organizationId,
      created.source.id,
      created.version.id,
      created.version.draftRevision,
      created.version.contentChecksum,
    );
    const sourceAfterConfirm = await prisma.knowledgeSource.findUniqueOrThrow({
      where: { id: created.source.id },
    });
    const replacement = await createReplacementDraft({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: {
        sourceId: created.source.id,
        expectedVersion: String(sourceAfterConfirm.version),
      },
    });
    expect(replacement.ok).toBe(true);
    if (!replacement.ok) throw new Error(replacement.message);

    const second = await confirmSample(
      ctx.owner,
      ctx.organizationId,
      created.source.id,
      replacement.version.id,
      replacement.version.draftRevision,
      replacement.version.contentChecksum,
    );
    expect(second.version.supersedesVersionId).toBe(first.version.id);

    const previous = await prisma.knowledgeVersion.findUniqueOrThrow({
      where: { id: first.version.id },
    });
    expect(previous.state).toBe("SUPERSEDED");
    expect(previous.confirmedAt).toEqual(first.version.confirmedAt);
    expect(previous.contentChecksum).toBe(first.version.contentChecksum);

    const retrieved = await retrieveActiveKnowledge({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
    });
    expect(retrieved.ok).toBe(true);
    if (!retrieved.ok) throw new Error(retrieved.message);
    expect(retrieved.items).toHaveLength(1);
    expect(retrieved.items[0]?.versionId).toBe(second.version.id);
  });

  it("archives a source out of retrieval and restores as a new draft", async () => {
    const ctx = await createOrgWithOwner(prisma, "know-archive");
    const created = await createSampleDraft(ctx.owner, ctx.organizationId);
    await confirmSample(
      ctx.owner,
      ctx.organizationId,
      created.source.id,
      created.version.id,
      created.version.draftRevision,
      created.version.contentChecksum,
    );
    const source = await prisma.knowledgeSource.findUniqueOrThrow({
      where: { id: created.source.id },
    });
    const archived = await archiveKnowledgeSource({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: {
        sourceId: created.source.id,
        expectedVersion: String(source.version),
      },
    });
    expect(archived.ok).toBe(true);

    const retrieved = await retrieveActiveKnowledge({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
    });
    expect(retrieved.ok).toBe(true);
    if (retrieved.ok) {
      expect(retrieved.items).toEqual([]);
    }

    const historical = await prisma.knowledgeVersion.findUniqueOrThrow({
      where: { id: created.version.id },
    });
    expect(historical.state).toBe("ARCHIVED");
    expect(historical.confirmedAt).toBeTruthy();

    const restored = await restoreKnowledgeVersion({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: {
        sourceId: created.source.id,
        versionId: created.version.id,
        expectedVersion: String(
          (
            await prisma.knowledgeSource.findUniqueOrThrow({
              where: { id: created.source.id },
            })
          ).version,
        ),
      },
    });
    expect(restored.ok).toBe(true);
    if (!restored.ok) throw new Error(restored.message);
    expect(restored.version.state).toBe("DRAFT");
    expect(restored.version.id).not.toBe(created.version.id);
    expect(restored.version.restoredFromVersionId).toBe(created.version.id);

    const original = await prisma.knowledgeVersion.findUniqueOrThrow({
      where: { id: created.version.id },
    });
    expect(original.state).toBe("ARCHIVED");
    expect(original.contentChecksum).toBe(historical.contentChecksum);
  });
});
