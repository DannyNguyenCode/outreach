import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  createOfferingReplacementDraft,
  getOffering,
  listOfferings,
} from "@/lib/orgs/offerings";
import {
  addMember,
  confirmSampleOffering,
  createOrgWithOwner,
  createSampleOfferingDraft,
} from "@/tests/integration/helpers/offerings";
import { resetApplicationData } from "@/tests/integration/reset";

describe("Phase 4C offering security", () => {
  const prisma = new PrismaClient();
  beforeEach(() => resetApplicationData(prisma));
  afterAll(() => prisma.$disconnect());

  it("hides drafts and cross-tenant identifiers from members", async () => {
    const first = await createOrgWithOwner(prisma, "offering-sec-a");
    const second = await createOrgWithOwner(prisma, "offering-sec-b");
    const member = await addMember(
      prisma,
      first.organizationId,
      "offering-member",
    );
    const draft = await createSampleOfferingDraft(
      first.owner,
      first.organizationId,
    );
    const hiddenDraft = await getOffering({
      actor: member,
      organizationId: first.organizationId,
      offeringId: draft.offering.id,
    });
    expect(hiddenDraft.ok).toBe(false);

    const crossTenant = await getOffering({
      actor: second.owner,
      organizationId: second.organizationId,
      offeringId: draft.offering.id,
    });
    expect(crossTenant.ok).toBe(false);
    if (!crossTenant.ok) expect(crossTenant.reason).toBe("not_found");
  });

  it("does not let members discover unpublished draft names via search", async () => {
    const ctx = await createOrgWithOwner(prisma, "offering-sec-search");
    const member = await addMember(
      prisma,
      ctx.organizationId,
      "offering-search-member",
    );
    const draft = await createSampleOfferingDraft(
      ctx.owner,
      ctx.organizationId,
      {
        name: "Public starter plan",
      },
    );
    const confirmed = await confirmSampleOffering(
      ctx.owner,
      ctx.organizationId,
      draft,
    );
    const offering = await prisma.offering.findUniqueOrThrow({
      where: { id: confirmed.version.offeringId },
    });
    const replacement = await createOfferingReplacementDraft({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: {
        offeringId: offering.id,
        expectedVersion: offering.version,
      },
    });
    expect(replacement.ok).toBe(true);
    if (!replacement.ok) throw new Error(replacement.message);

    await prisma.offeringVersion.update({
      where: { id: replacement.version.id },
      data: { name: "Internal upcoming 50 percent discount draft" },
    });

    const secretSearch = await listOfferings({
      actor: member,
      organizationId: ctx.organizationId,
      query: "50 percent discount",
    });
    expect(secretSearch.ok).toBe(true);
    if (secretSearch.ok) {
      expect(secretSearch.items).toHaveLength(0);
    }

    const publicSearch = await listOfferings({
      actor: member,
      organizationId: ctx.organizationId,
      query: "Public starter",
    });
    expect(publicSearch.ok).toBe(true);
    if (publicSearch.ok) {
      expect(publicSearch.items).toHaveLength(1);
      expect(
        publicSearch.items[0]?.versions.every((v) => v.state === "ACTIVE"),
      ).toBe(true);
    }

    const ownerSearch = await listOfferings({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      query: "50 percent discount",
      status: "draft",
    });
    expect(ownerSearch.ok).toBe(true);
    if (ownerSearch.ok) {
      expect(ownerSearch.items).toHaveLength(1);
    }
  });
});
