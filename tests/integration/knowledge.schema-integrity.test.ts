import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createOrgWithOwner } from "@/tests/integration/helpers/knowledge";
import { resetApplicationData } from "@/tests/integration/reset";

function postgresCode(error: unknown): string | undefined {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.meta &&
    typeof error.meta === "object" &&
    "code" in error.meta
  ) {
    return String(error.meta.code);
  }
  return undefined;
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
});
