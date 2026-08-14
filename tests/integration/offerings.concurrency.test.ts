import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { updateOfferingDraft } from "@/lib/orgs/offerings";
import {
  SAMPLE_OFFERING,
  createOrgWithOwner,
  createSampleOfferingDraft,
} from "@/tests/integration/helpers/offerings";
import { resetApplicationData } from "@/tests/integration/reset";

describe("Phase 4C offering concurrency", () => {
  const prisma = new PrismaClient();
  beforeEach(() => resetApplicationData(prisma));
  afterAll(() => prisma.$disconnect());

  it("rejects a stale draft revision", async () => {
    const ctx = await createOrgWithOwner(prisma, "offering-occ");
    const draft = await createSampleOfferingDraft(
      ctx.owner,
      ctx.organizationId,
    );
    const raw = {
      ...SAMPLE_OFFERING,
      offeringId: draft.offering.id,
      versionId: draft.version.id,
      expectedDraftRevision: draft.version.draftRevision,
      name: "First update",
    };
    const first = await updateOfferingDraft({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw,
    });
    expect(first.ok).toBe(true);
    const stale = await updateOfferingDraft({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: { ...raw, name: "Stale update" },
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.reason).toBe("conflict");
  });
});
