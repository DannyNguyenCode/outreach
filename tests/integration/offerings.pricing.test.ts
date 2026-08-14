import { Prisma } from "@prisma/client";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createCustomField } from "@/lib/orgs/custom-fields";
import { compareActiveOfferings } from "@/lib/orgs/offering-comparison";
import { retrieveActiveOfferings } from "@/lib/orgs/offering-retrieval";
import {
  archiveOffering,
  confirmOfferingVersion,
  createOfferingDraft,
  createOfferingReplacementDraft,
  getOffering,
  updateOfferingDraft,
} from "@/lib/orgs/offerings";
import {
  addMember,
  confirmSampleOffering,
  countOfferingAudits,
  createOrgWithOwner,
  createSampleOfferingDraft,
  SAMPLE_OFFERING,
} from "@/tests/integration/helpers/offerings";
import { resetApplicationData } from "@/tests/integration/reset";

describe("Phase 4C offering pricing and catalog shapes", () => {
  const prisma = new PrismaClient();
  beforeEach(() => resetApplicationData(prisma));
  afterAll(() => prisma.$disconnect());

  it("supports each offering type and quote-required offerings", async () => {
    const ctx = await createOrgWithOwner(prisma, "offering-types");
    for (const offeringType of [
      "PRODUCT",
      "SERVICE",
      "PLAN",
      "PACKAGE",
      "SUBSCRIPTION",
      "CUSTOM_QUOTE",
    ] as const) {
      const draft = await createOfferingDraft({
        actor: ctx.owner,
        organizationId: ctx.organizationId,
        raw: {
          name: `${offeringType} item`,
          offeringType,
          pricingModel: "QUOTE_REQUIRED",
          quoteRequired: true,
          prices: [],
          features: [],
          variants: [],
        },
      });
      expect(draft.ok).toBe(true);
      if (!draft.ok) throw new Error(draft.message);
      expect(draft.version.offeringType).toBe(offeringType);
      expect(draft.version.quoteRequired).toBe(true);
      expect(draft.version.prices).toHaveLength(0);
    }
  });

  it("stores fixed one-time and recurring decimal prices", async () => {
    const ctx = await createOrgWithOwner(prisma, "offering-money");
    const oneTime = await createSampleOfferingDraft(
      ctx.owner,
      ctx.organizationId,
      {
        name: "Install fee",
        offeringType: "SERVICE",
        pricingModel: "FIXED_ONE_TIME",
        prices: [
          {
            amount: "199.50",
            currencyCode: "CAD",
            billingFrequency: "ONE_TIME",
            clientKey: "install",
          },
        ],
        features: [],
      },
    );
    expect(oneTime.version.prices[0]?.amount).toEqual(
      new Prisma.Decimal("199.5000"),
    );
    const recurring = await createSampleOfferingDraft(
      ctx.owner,
      ctx.organizationId,
      SAMPLE_OFFERING,
    );
    expect(recurring.version.prices[0]?.billingFrequency).toBe("MONTHLY");
  });

  it("rejects confirmation with ambiguous overlapping current base prices", async () => {
    const ctx = await createOrgWithOwner(prisma, "offering-conflict");
    const draft = await createSampleOfferingDraft(
      ctx.owner,
      ctx.organizationId,
      {
        pricingModel: "RECURRING",
        prices: [
          {
            amount: "49.00",
            currencyCode: "CAD",
            billingFrequency: "MONTHLY",
            clientKey: "current-a",
            isActive: true,
          },
        ],
      },
    );
    await prisma.offeringPrice.create({
      data: {
        organizationId: ctx.organizationId,
        offeringId: draft.offering.id,
        versionId: draft.version.id,
        amount: new Prisma.Decimal("59.00"),
        currencyCode: "CAD",
        billingFrequency: "MONTHLY",
        isActive: true,
        displayOrder: 1,
      },
    });
    const graph = await prisma.offeringVersion.findUniqueOrThrow({
      where: { id: draft.version.id },
      include: {
        prices: true,
        features: true,
        variants: true,
        eligibility: true,
        customValues: true,
      },
    });
    const { toCanonicalOfferingContent } =
      await import("@/lib/orgs/offering-validation");
    const checksum = toCanonicalOfferingContent({
      name: graph.name,
      description: graph.description,
      offeringType: graph.offeringType,
      pricingModel: graph.pricingModel,
      quoteRequired: graph.quoteRequired,
      effectiveFrom: graph.effectiveFrom,
      effectiveUntil: graph.effectiveUntil,
      displayOrder: graph.displayOrder,
      prices: graph.prices,
      features: graph.features,
      variants: [],
      eligibility: graph.eligibility,
      customValues: [],
    }).checksum;
    await prisma.offeringVersion.update({
      where: { id: graph.id },
      data: { contentChecksum: checksum },
    });
    const result = await confirmOfferingVersion({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: {
        offeringId: draft.offering.id,
        versionId: draft.version.id,
        expectedDraftRevision: graph.draftRevision,
        expectedChecksum: checksum,
        confirmAccuracy: true,
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("conflicting_prices");
  });

  it("allows multi-option current prices and excludes future/expired ones from current set", async () => {
    const ctx = await createOrgWithOwner(prisma, "offering-multi");
    const now = Date.now();
    const draft = await createSampleOfferingDraft(
      ctx.owner,
      ctx.organizationId,
      {
        name: "Tiered storage",
        offeringType: "PACKAGE",
        pricingModel: "MULTI_OPTION",
        prices: [
          {
            label: "Basic",
            amount: "10.00",
            currencyCode: "USD",
            billingFrequency: "MONTHLY",
            clientKey: "basic",
            effectiveFrom: new Date(now - 86_400_000).toISOString(),
          },
          {
            label: "Pro",
            amount: "20.00",
            currencyCode: "USD",
            billingFrequency: "MONTHLY",
            clientKey: "pro",
            effectiveFrom: new Date(now - 86_400_000).toISOString(),
          },
          {
            label: "Future",
            amount: "30.00",
            currencyCode: "USD",
            billingFrequency: "MONTHLY",
            clientKey: "future",
            effectiveFrom: new Date(now + 86_400_000 * 30).toISOString(),
          },
          {
            label: "Expired",
            amount: "5.00",
            currencyCode: "USD",
            billingFrequency: "MONTHLY",
            clientKey: "expired",
            effectiveFrom: new Date(now - 86_400_000 * 60).toISOString(),
            effectiveUntil: new Date(now - 86_400_000).toISOString(),
          },
        ],
        features: [{ featureKey: "tier", name: "Tier", value: "multi" }],
      },
    );
    const confirmed = await confirmSampleOffering(
      ctx.owner,
      ctx.organizationId,
      draft,
    );
    expect(confirmed.ok).toBe(true);
    const retrieved = await retrieveActiveOfferings({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
    });
    expect(retrieved.ok).toBe(true);
    if (!retrieved.ok) throw new Error(retrieved.message);
    expect(retrieved.items[0]?.currentPriceIds).toHaveLength(2);
  });

  it("supports variants, variant-specific pricing, features, eligibility, and custom attributes", async () => {
    const ctx = await createOrgWithOwner(prisma, "offering-rich");
    const field = await createCustomField({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: {
        key: "warranty_months",
        label: "Warranty months",
        dataType: "NUMBER",
        scope: "OFFERING",
        required: false,
        isActive: true,
      },
    });
    expect(field.ok).toBe(true);
    const draft = await createSampleOfferingDraft(
      ctx.owner,
      ctx.organizationId,
      {
        name: "Router",
        offeringType: "PRODUCT",
        pricingModel: "MULTI_OPTION",
        prices: [
          {
            label: "Standard",
            amount: "80.00",
            currencyCode: "USD",
            billingFrequency: "ONE_TIME",
            clientKey: "std",
          },
          {
            label: "XL",
            amount: "120.00",
            currencyCode: "USD",
            billingFrequency: "ONE_TIME",
            clientKey: "xl",
          },
        ],
        features: [
          { featureKey: "ports", name: "Ports", value: "4" },
          { featureKey: "wifi", name: "Wi-Fi", value: "6" },
        ],
        variants: [
          {
            name: "Black XL",
            sku: "RTR-BK-XL",
            attributes: { color: "black", size: "xl" },
            priceClientKeys: ["xl"],
          },
        ],
        eligibility: {
          description: "Business customers only",
          minimumQuantity: 1,
          maximumQuantity: 10,
          geographicNotes: "Canada",
        },
        customValues: [{ definitionKey: "warranty_months", value: "12" }],
      },
    );
    expect(draft.version.variants).toHaveLength(1);
    expect(draft.version.variants[0]?.prices).toHaveLength(1);
    expect(draft.version.eligibility?.minimumQuantity).toBe(1);
    expect(draft.version.customValues[0]?.definitionKey).toBe(
      "warranty_months",
    );
  });

  it("compares active plans deterministically and records audits", async () => {
    const ctx = await createOrgWithOwner(prisma, "offering-compare");
    const planA = await createSampleOfferingDraft(
      ctx.owner,
      ctx.organizationId,
      {
        name: "Plan A",
        features: [
          { featureKey: "dental", name: "Dental coverage", value: "yes" },
          { featureKey: "storage", name: "Storage", value: "10", unit: "GB" },
        ],
      },
    );
    const planB = await createSampleOfferingDraft(
      ctx.owner,
      ctx.organizationId,
      {
        name: "Plan B",
        prices: [
          {
            amount: "79.00",
            currencyCode: "CAD",
            billingFrequency: "MONTHLY",
            clientKey: "monthly",
          },
        ],
        features: [
          { featureKey: "dental", name: "Dental coverage", value: "yes" },
          { featureKey: "storage", name: "Storage", value: "25", unit: "GB" },
        ],
      },
    );
    await confirmSampleOffering(ctx.owner, ctx.organizationId, planA);
    await confirmSampleOffering(ctx.owner, ctx.organizationId, planB);
    const compared = await compareActiveOfferings({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      offeringIds: [planA.offering.id, planB.offering.id],
    });
    expect(compared.ok).toBe(true);
    if (!compared.ok) throw new Error(compared.message);
    expect(compared.comparison.features).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          featureKey: "storage",
          values: {
            [planA.offering.id]: "10 GB",
            [planB.offering.id]: "25 GB",
          },
        }),
      ]),
    );
    expect(
      await countOfferingAudits(prisma, ctx.organizationId),
    ).toBeGreaterThanOrEqual(4);
  });

  it("excludes drafts and archives from retrieval and enforces tenant isolation", async () => {
    const first = await createOrgWithOwner(prisma, "offering-iso-a");
    const second = await createOrgWithOwner(prisma, "offering-iso-b");
    const member = await addMember(
      prisma,
      first.organizationId,
      "offering-mem",
    );
    const draft = await createSampleOfferingDraft(
      first.owner,
      first.organizationId,
    );
    const confirmed = await confirmSampleOffering(
      first.owner,
      first.organizationId,
      draft,
    );
    await createSampleOfferingDraft(first.owner, first.organizationId, {
      name: "Still draft",
    });
    const offering = await prisma.offering.findUniqueOrThrow({
      where: { id: draft.offering.id },
    });
    await archiveOffering({
      actor: first.owner,
      organizationId: first.organizationId,
      raw: { offeringId: offering.id, expectedVersion: offering.version },
    });
    const retrieved = await retrieveActiveOfferings({
      actor: member,
      organizationId: first.organizationId,
    });
    expect(retrieved.ok).toBe(true);
    if (retrieved.ok) expect(retrieved.items).toHaveLength(0);

    const cross = await getOffering({
      actor: second.owner,
      organizationId: second.organizationId,
      offeringId: confirmed.version.offeringId,
    });
    expect(cross.ok).toBe(false);
  });

  it("rejects inactive membership mutations and stale OCC writes", async () => {
    const ctx = await createOrgWithOwner(prisma, "offering-auth");
    const member = await addMember(
      prisma,
      ctx.organizationId,
      "offering-inactive",
    );
    await prisma.membership.updateMany({
      where: { organizationId: ctx.organizationId, userId: member.id },
      data: { status: "INACTIVE", deactivatedAt: new Date() },
    });
    const denied = await createOfferingDraft({
      actor: member,
      organizationId: ctx.organizationId,
      raw: SAMPLE_OFFERING,
    });
    expect(denied.ok).toBe(false);

    const draft = await createSampleOfferingDraft(
      ctx.owner,
      ctx.organizationId,
    );
    const first = await updateOfferingDraft({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: {
        ...SAMPLE_OFFERING,
        offeringId: draft.offering.id,
        versionId: draft.version.id,
        expectedDraftRevision: draft.version.draftRevision,
        name: "Updated once",
      },
    });
    expect(first.ok).toBe(true);
    const stale = await updateOfferingDraft({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: {
        ...SAMPLE_OFFERING,
        offeringId: draft.offering.id,
        versionId: draft.version.id,
        expectedDraftRevision: draft.version.draftRevision,
        name: "Stale",
      },
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.reason).toBe("conflict");
  });

  it("supersedes prior active versions on replacement confirmation", async () => {
    const ctx = await createOrgWithOwner(prisma, "offering-super");
    const original = await createSampleOfferingDraft(
      ctx.owner,
      ctx.organizationId,
    );
    await confirmSampleOffering(ctx.owner, ctx.organizationId, original);
    const offering = await prisma.offering.findUniqueOrThrow({
      where: { id: original.offering.id },
    });
    const replacement = await createOfferingReplacementDraft({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: { offeringId: offering.id, expectedVersion: offering.version },
    });
    expect(replacement.ok).toBe(true);
    if (!replacement.ok) throw new Error(replacement.message);
    const confirmed = await confirmSampleOffering(
      ctx.owner,
      ctx.organizationId,
      {
        ok: true,
        offering,
        version: replacement.version,
      },
    );
    expect(confirmed.version.state).toBe("ACTIVE");
    const prior = await prisma.offeringVersion.findUniqueOrThrow({
      where: { id: original.version.id },
    });
    expect(prior.state).toBe("SUPERSEDED");
  });
});
