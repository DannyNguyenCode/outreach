import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  archiveOffering,
  createOfferingReplacementDraft,
  restoreOfferingVersion,
} from "@/lib/orgs/offerings";
import {
  confirmSampleOffering,
  createOrgWithOwner,
  createSampleOfferingDraft,
} from "@/tests/integration/helpers/offerings";
import { resetApplicationData } from "@/tests/integration/reset";

describe("Phase 4C offering lifecycle", () => {
  const prisma = new PrismaClient();
  beforeEach(() => resetApplicationData(prisma));
  afterAll(() => prisma.$disconnect());

  it("confirms, replaces, archives, and restores without rewriting history", async () => {
    const ctx = await createOrgWithOwner(prisma, "offering-life");
    const draft = await createSampleOfferingDraft(
      ctx.owner,
      ctx.organizationId,
    );
    const confirmed = await confirmSampleOffering(
      ctx.owner,
      ctx.organizationId,
      draft,
    );
    expect(confirmed.version.state).toBe("ACTIVE");
    const offering = await prisma.offering.findUniqueOrThrow({
      where: { id: draft.offering.id },
    });
    const replacement = await createOfferingReplacementDraft({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: {
        offeringId: offering.id,
        expectedVersion: offering.version,
      },
    });
    expect(replacement.ok && replacement.version.state).toBe("DRAFT");

    const current = await prisma.offering.findUniqueOrThrow({
      where: { id: offering.id },
    });
    const archived = await archiveOffering({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: { offeringId: offering.id, expectedVersion: current.version },
    });
    expect(archived.ok).toBe(true);
    const archivedOffering = await prisma.offering.findUniqueOrThrow({
      where: { id: offering.id },
    });
    const restored = await restoreOfferingVersion({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: {
        offeringId: offering.id,
        versionId: confirmed.version.id,
        expectedVersion: archivedOffering.version,
      },
    });
    expect(restored.ok).toBe(true);
    if (restored.ok) {
      expect(restored.version.id).not.toBe(confirmed.version.id);
      expect(restored.version.restoredFromVersionId).toBe(confirmed.version.id);
    }
  });
});
