import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { KNOWLEDGE_CONFIRMATION_LANGUAGE_VERSION } from "@/lib/orgs/knowledge-confirmation";
import {
  archiveKnowledgeSource,
  createReplacementDraft,
  restoreKnowledgeVersion,
} from "@/lib/orgs/knowledge";
import { changeMemberRole, deactivateMember } from "@/lib/orgs/memberships";
import { createVerifiedActor } from "@/tests/integration/helpers/config-3b";
import {
  addMember,
  confirmSample,
  createOrgWithOwner,
  createSampleDraft,
} from "@/tests/integration/helpers/knowledge";
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

function errorBlob(error: unknown): string {
  if (!error || typeof error !== "object") {
    return String(error);
  }
  const record = error as { message?: unknown; meta?: unknown };
  return `${String(record.message ?? "")} ${JSON.stringify(record.meta ?? {})}`;
}

async function expectForeignKeyReject(run: () => Promise<unknown>) {
  try {
    await run();
    throw new Error("expected PostgreSQL foreign-key rejection");
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "expected PostgreSQL foreign-key rejection"
    ) {
      throw error;
    }
    expect(postgresCode(error)).toBe("23503");
    expect(postgresCode(error)).not.toBe("23514");
    return error;
  }
}

describe("Phase 4A knowledge schema integrity", () => {
  const prisma = new PrismaClient();

  beforeEach(async () => {
    await resetApplicationData(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rejects cross-parent ancestry and confirmation/effective-range violations", async () => {
    const ctx = await createOrgWithOwner(prisma, "know-schema");
    const other = await createOrgWithOwner(prisma, "know-schema-other");
    const source = await prisma.knowledgeSource.create({
      data: {
        organizationId: ctx.organizationId,
        inputKind: "MANUAL",
        category: "CUSTOMER_CONFIRMED_BUSINESS_FACTS",
        title: "Policy",
      },
    });
    const version = await prisma.knowledgeVersion.create({
      data: {
        organizationId: ctx.organizationId,
        sourceId: source.id,
        state: "DRAFT",
        title: "Policy",
        contentChecksum: "a".repeat(64),
      },
    });
    const otherSource = await prisma.knowledgeSource.create({
      data: {
        organizationId: other.organizationId,
        inputKind: "MANUAL",
        category: "CUSTOMER_CONFIRMED_BUSINESS_FACTS",
        title: "Other",
      },
    });
    const otherVersion = await prisma.knowledgeVersion.create({
      data: {
        organizationId: other.organizationId,
        sourceId: otherSource.id,
        state: "DRAFT",
        title: "Other",
        contentChecksum: "b".repeat(64),
      },
    });

    try {
      await prisma.$executeRaw`
        INSERT INTO "KnowledgeSection" (
          id, "organizationId", "sourceId", "versionId", "citationKey", title, "displayOrder", "createdAt", "updatedAt"
        ) VALUES (
          'sec_cross', ${ctx.organizationId}, ${source.id}, ${otherVersion.id},
          'sec_x', 'X', 0, NOW(), NOW()
        )
      `;
      throw new Error("expected section ancestry FK to fail");
    } catch (error) {
      expect(postgresCode(error)).toBe("23503");
    }

    const section = await prisma.knowledgeSection.create({
      data: {
        organizationId: ctx.organizationId,
        sourceId: source.id,
        versionId: version.id,
        citationKey: "sec_ok",
        title: "Overview",
        displayOrder: 0,
      },
    });

    try {
      await prisma.$executeRaw`
        INSERT INTO "KnowledgePassage" (
          id, "organizationId", "sourceId", "versionId", "sectionId",
          "citationKey", body, "displayOrder", "createdAt", "updatedAt"
        ) VALUES (
          'pas_cross', ${other.organizationId}, ${source.id}, ${version.id},
          ${section.id}, 'pas_x', 'nope', 0, NOW(), NOW()
        )
      `;
      throw new Error("expected passage ancestry FK to fail");
    } catch (error) {
      expect(postgresCode(error)).toBe("23503");
    }

    try {
      await prisma.$executeRaw`
        INSERT INTO "KnowledgeVersion" (
          id, "organizationId", "sourceId", state, title, "contentChecksum",
          "draftRevision", "createdAt", "updatedAt"
        ) VALUES (
          'ver_active_unconfirmed', ${ctx.organizationId}, ${source.id},
          'ACTIVE', 'Bad', ${"c".repeat(64)}, 0, NOW(), NOW()
        )
      `;
      throw new Error("expected ACTIVE confirmation check to fail");
    } catch (error) {
      expect(postgresCode(error)).toBe("23514");
    }

    try {
      await prisma.$executeRaw`
        INSERT INTO "KnowledgeVersion" (
          id, "organizationId", "sourceId", state, title, "contentChecksum",
          "draftRevision", "effectiveFrom", "effectiveUntil", "createdAt", "updatedAt"
        ) VALUES (
          'ver_range', ${ctx.organizationId}, ${source.id},
          'DRAFT', 'Range', ${"d".repeat(64)}, 0,
          TIMESTAMPTZ '2026-02-01 00:00:00+00',
          TIMESTAMPTZ '2026-01-01 00:00:00+00',
          NOW(), NOW()
        )
      `;
      throw new Error("expected effective range check to fail");
    } catch (error) {
      expect(postgresCode(error)).toBe("23514");
    }

    try {
      await prisma.$executeRaw`
        INSERT INTO "KnowledgeVersion" (
          id, "organizationId", "sourceId", state, title, "contentChecksum",
          "draftRevision", "confirmerUserId", "confirmedAt",
          "confirmationLanguageVersion", "createdAt", "updatedAt"
        ) VALUES (
          'ver_draft_confirmed', ${ctx.organizationId}, ${source.id},
          'DRAFT', 'Draft confirmed', ${"e".repeat(64)}, 0,
          ${ctx.owner.id}, NOW(), 'knowledge.confirm.v1', NOW(), NOW()
        )
      `;
      throw new Error("expected DRAFT confirmation check to fail");
    } catch (error) {
      expect(postgresCode(error)).toBe("23514");
    }
  });

  it("retains confirmation evidence and rejects confirmer hard-delete", async () => {
    const ctx = await createOrgWithOwner(prisma, "know-confirm-retain");
    const confirmer = await addMember(
      prisma,
      ctx.organizationId,
      "know-confirm-retain-admin",
      "ADMIN",
    );
    const created = await createSampleDraft(confirmer, ctx.organizationId);
    const confirmed = await confirmSample(
      confirmer,
      ctx.organizationId,
      created.source.id,
      created.version.id,
      created.version.draftRevision,
      created.version.contentChecksum,
    );
    expect(confirmed.version.confirmerUserId).toBe(confirmer.id);
    expect(confirmed.version.confirmedAt).toBeTruthy();
    expect(confirmed.version.confirmationLanguageVersion).toBe(
      KNOWLEDGE_CONFIRMATION_LANGUAGE_VERSION,
    );
    const retained = {
      confirmerUserId: confirmed.version.confirmerUserId,
      confirmedAt: confirmed.version.confirmedAt,
      confirmationLanguageVersion:
        confirmed.version.confirmationLanguageVersion,
    };

    const membership = await prisma.membership.findFirstOrThrow({
      where: { organizationId: ctx.organizationId, userId: confirmer.id },
    });
    const demoted = await changeMemberRole({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      membershipId: membership.id,
      nextRole: "MEMBER",
    });
    expect(demoted.ok).toBe(true);

    const afterDemote = await prisma.knowledgeVersion.findUniqueOrThrow({
      where: { id: confirmed.version.id },
    });
    expect(afterDemote.confirmerUserId).toBe(retained.confirmerUserId);
    expect(afterDemote.confirmedAt).toEqual(retained.confirmedAt);
    expect(afterDemote.confirmationLanguageVersion).toBe(
      retained.confirmationLanguageVersion,
    );

    const deleteError = await expectForeignKeyReject(
      () => prisma.$executeRaw`DELETE FROM "User" WHERE id = ${confirmer.id}`,
    );
    expect(errorBlob(deleteError)).toMatch(
      /KnowledgeVersion_confirmerUserId_fkey/,
    );

    expect(
      await prisma.user.findUnique({ where: { id: confirmer.id } }),
    ).not.toBeNull();
    const afterFailedDelete = await prisma.knowledgeVersion.findUniqueOrThrow({
      where: { id: confirmed.version.id },
    });
    expect(afterFailedDelete.confirmerUserId).toBe(retained.confirmerUserId);
    expect(afterFailedDelete.confirmedAt).toEqual(retained.confirmedAt);
    expect(afterFailedDelete.confirmationLanguageVersion).toBe(
      retained.confirmationLanguageVersion,
    );

    const deactivated = await deactivateMember({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      membershipId: membership.id,
    });
    expect(deactivated.ok).toBe(true);
    const afterDeactivate = await prisma.knowledgeVersion.findUniqueOrThrow({
      where: { id: confirmed.version.id },
    });
    expect(afterDeactivate.confirmerUserId).toBe(retained.confirmerUserId);
    expect(afterDeactivate.confirmedAt).toEqual(retained.confirmedAt);
    expect(afterDeactivate.confirmationLanguageVersion).toBe(
      retained.confirmationLanguageVersion,
    );
  });

  it("does not block hard-delete of a user with no confirmation evidence", async () => {
    const ctx = await createOrgWithOwner(prisma, "know-unrelated-user");
    const created = await createSampleDraft(ctx.owner, ctx.organizationId);
    await confirmSample(
      ctx.owner,
      ctx.organizationId,
      created.source.id,
      created.version.id,
      created.version.draftRevision,
      created.version.contentChecksum,
    );
    const unrelated = await createVerifiedActor(prisma, "know-unrelated-del");
    await prisma.$executeRaw`DELETE FROM "User" WHERE id = ${unrelated.id}`;
    expect(
      await prisma.user.findUnique({ where: { id: unrelated.id } }),
    ).toBeNull();
    const version = await prisma.knowledgeVersion.findUniqueOrThrow({
      where: { id: created.version.id },
    });
    expect(version.confirmerUserId).toBe(ctx.owner.id);
  });

  it("cascades organization and source deletes despite version self-FKs", async () => {
    const ctx = await createOrgWithOwner(prisma, "know-cascade-source");
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
    if (!replacement.ok) throw new Error(replacement.message);
    await confirmSample(
      ctx.owner,
      ctx.organizationId,
      created.source.id,
      replacement.version.id,
      replacement.version.draftRevision,
      replacement.version.contentChecksum,
    );
    const sourceAfterReplace = await prisma.knowledgeSource.findUniqueOrThrow({
      where: { id: created.source.id },
    });
    const archived = await archiveKnowledgeSource({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: {
        sourceId: created.source.id,
        expectedVersion: String(sourceAfterReplace.version),
      },
    });
    if (!archived.ok) throw new Error(archived.message);
    const restored = await restoreKnowledgeVersion({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: {
        sourceId: created.source.id,
        versionId: first.version.id,
        expectedVersion: String(
          (
            await prisma.knowledgeSource.findUniqueOrThrow({
              where: { id: created.source.id },
            })
          ).version,
        ),
      },
    });
    if (!restored.ok) throw new Error(restored.message);
    expect(restored.version.restoredFromVersionId).toBe(first.version.id);

    await prisma.knowledgeSource.delete({ where: { id: created.source.id } });
    expect(
      await prisma.knowledgeVersion.count({
        where: { sourceId: created.source.id },
      }),
    ).toBe(0);

    const other = await createOrgWithOwner(prisma, "know-cascade-org");
    const otherDraft = await createSampleDraft(
      other.owner,
      other.organizationId,
    );
    const otherFirst = await confirmSample(
      other.owner,
      other.organizationId,
      otherDraft.source.id,
      otherDraft.version.id,
      otherDraft.version.draftRevision,
      otherDraft.version.contentChecksum,
    );
    const otherSource = await prisma.knowledgeSource.findUniqueOrThrow({
      where: { id: otherDraft.source.id },
    });
    const otherReplacement = await createReplacementDraft({
      actor: other.owner,
      organizationId: other.organizationId,
      raw: {
        sourceId: otherDraft.source.id,
        expectedVersion: String(otherSource.version),
      },
    });
    if (!otherReplacement.ok) throw new Error(otherReplacement.message);
    await confirmSample(
      other.owner,
      other.organizationId,
      otherDraft.source.id,
      otherReplacement.version.id,
      otherReplacement.version.draftRevision,
      otherReplacement.version.contentChecksum,
    );
    await prisma.organization.delete({ where: { id: other.organizationId } });
    expect(
      await prisma.knowledgeVersion.count({
        where: { organizationId: other.organizationId },
      }),
    ).toBe(0);
    expect(
      await prisma.knowledgeVersion.findUnique({
        where: { id: otherFirst.version.id },
      }),
    ).toBeNull();
  });

  it("rejects cross-source and cross-tenant supersedes/restoredFrom FKs", async () => {
    const ctx = await createOrgWithOwner(prisma, "know-self-fk");
    const other = await createOrgWithOwner(prisma, "know-self-fk-other");
    const source = await prisma.knowledgeSource.create({
      data: {
        organizationId: ctx.organizationId,
        inputKind: "MANUAL",
        category: "CUSTOMER_CONFIRMED_BUSINESS_FACTS",
        title: "Self FK",
      },
    });
    const version = await prisma.knowledgeVersion.create({
      data: {
        organizationId: ctx.organizationId,
        sourceId: source.id,
        state: "DRAFT",
        title: "Self FK",
        contentChecksum: "a".repeat(64),
      },
    });
    const sameOrgOtherSource = await prisma.knowledgeSource.create({
      data: {
        organizationId: ctx.organizationId,
        inputKind: "MANUAL",
        category: "CUSTOMER_CONFIRMED_BUSINESS_FACTS",
        title: "Other source",
      },
    });
    const sameOrgOtherVersion = await prisma.knowledgeVersion.create({
      data: {
        organizationId: ctx.organizationId,
        sourceId: sameOrgOtherSource.id,
        state: "DRAFT",
        title: "Other source",
        contentChecksum: "b".repeat(64),
      },
    });
    const otherSource = await prisma.knowledgeSource.create({
      data: {
        organizationId: other.organizationId,
        inputKind: "MANUAL",
        category: "CUSTOMER_CONFIRMED_BUSINESS_FACTS",
        title: "Other org",
      },
    });
    const otherVersion = await prisma.knowledgeVersion.create({
      data: {
        organizationId: other.organizationId,
        sourceId: otherSource.id,
        state: "DRAFT",
        title: "Other org",
        contentChecksum: "c".repeat(64),
      },
    });

    const beforeCount = await prisma.knowledgeVersion.count();

    await expectForeignKeyReject(
      () => prisma.$executeRaw`
        INSERT INTO "KnowledgeVersion" (
          id, "organizationId", "sourceId", state, title, "contentChecksum",
          "draftRevision", "supersedesVersionId", "createdAt", "updatedAt"
        ) VALUES (
          'ver_sup_cross_source', ${ctx.organizationId}, ${source.id},
          'PROCESSING', 'Bad supersede source', ${"d".repeat(64)},
          0, ${sameOrgOtherVersion.id}, NOW(), NOW()
        )
      `,
    );
    await expectForeignKeyReject(
      () => prisma.$executeRaw`
        INSERT INTO "KnowledgeVersion" (
          id, "organizationId", "sourceId", state, title, "contentChecksum",
          "draftRevision", "supersedesVersionId", "createdAt", "updatedAt"
        ) VALUES (
          'ver_sup_cross_org', ${ctx.organizationId}, ${source.id},
          'PROCESSING', 'Bad supersede org', ${"e".repeat(64)},
          0, ${otherVersion.id}, NOW(), NOW()
        )
      `,
    );
    await expectForeignKeyReject(
      () => prisma.$executeRaw`
        INSERT INTO "KnowledgeVersion" (
          id, "organizationId", "sourceId", state, title, "contentChecksum",
          "draftRevision", "restoredFromVersionId", "createdAt", "updatedAt"
        ) VALUES (
          'ver_res_cross_source', ${ctx.organizationId}, ${source.id},
          'PROCESSING', 'Bad restore source', ${"f".repeat(64)},
          0, ${sameOrgOtherVersion.id}, NOW(), NOW()
        )
      `,
    );
    await expectForeignKeyReject(
      () => prisma.$executeRaw`
        INSERT INTO "KnowledgeVersion" (
          id, "organizationId", "sourceId", state, title, "contentChecksum",
          "draftRevision", "restoredFromVersionId", "createdAt", "updatedAt"
        ) VALUES (
          'ver_res_cross_org', ${ctx.organizationId}, ${source.id},
          'PROCESSING', 'Bad restore org', ${"g".repeat(64)},
          0, ${otherVersion.id}, NOW(), NOW()
        )
      `,
    );

    expect(await prisma.knowledgeVersion.count()).toBe(beforeCount);
    expect(
      await prisma.knowledgeVersion.findUnique({
        where: { id: "ver_sup_cross_source" },
      }),
    ).toBeNull();
    expect(
      await prisma.knowledgeVersion.findUnique({
        where: { id: "ver_res_cross_org" },
      }),
    ).toBeNull();

    const validSupersede = await prisma.knowledgeVersion.create({
      data: {
        organizationId: ctx.organizationId,
        sourceId: source.id,
        state: "PROCESSING",
        title: "Valid supersede",
        contentChecksum: "h".repeat(64),
        supersedesVersionId: version.id,
      },
    });
    const validRestore = await prisma.knowledgeVersion.create({
      data: {
        organizationId: ctx.organizationId,
        sourceId: source.id,
        state: "PROCESSING",
        title: "Valid restore",
        contentChecksum: "i".repeat(64),
        restoredFromVersionId: version.id,
      },
    });
    expect(validSupersede.supersedesVersionId).toBe(version.id);
    expect(validRestore.restoredFromVersionId).toBe(version.id);
  });
});
