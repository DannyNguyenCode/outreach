import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { retrieveActiveOfferings } from "@/lib/orgs/offering-retrieval";
import {
  confirmSampleOffering,
  createOrgWithOwner,
  createSampleOfferingDraft,
} from "@/tests/integration/helpers/offerings";
import { resetApplicationData } from "@/tests/integration/reset";

describe("Phase 4C offering retrieval", () => {
  const prisma = new PrismaClient();
  beforeEach(() => resetApplicationData(prisma));
  afterAll(() => prisma.$disconnect());

  it("returns only current active offerings with stable provenance", async () => {
    const ctx = await createOrgWithOwner(prisma, "offering-retrieve");
    const draft = await createSampleOfferingDraft(
      ctx.owner,
      ctx.organizationId,
    );
    await confirmSampleOffering(ctx.owner, ctx.organizationId, draft);
    await createSampleOfferingDraft(ctx.owner, ctx.organizationId, {
      name: "Hidden draft",
    });
    const result = await retrieveActiveOfferings({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        sourceClass: "STRUCTURED_OFFERING",
        offeringId: draft.offering.id,
        versionId: draft.version.id,
      });
      expect(result.items[0]?.currentPriceIds).toHaveLength(1);
    }
  });
});
