/** @vitest-environment node */

import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  offeringDraftContentSchema,
  selectCurrentPrices,
  toCanonicalOfferingContent,
  validateCustomFieldValue,
} from "@/lib/orgs/offering-validation";

const base = {
  name: "Premium plan",
  offeringType: "PLAN" as const,
  pricingModel: "RECURRING" as const,
  prices: [
    {
      amount: "49.00",
      currencyCode: "CAD",
      billingFrequency: "MONTHLY" as const,
    },
  ],
};

describe("offering draft validation", () => {
  it("validates pricing models and unique feature keys", () => {
    expect(offeringDraftContentSchema.safeParse(base).success).toBe(true);
    expect(
      offeringDraftContentSchema.safeParse({
        ...base,
        features: [
          { featureKey: "storage", name: "Storage" },
          { featureKey: "storage", name: "More storage" },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects prototype pollution in variant attributes", () => {
    const attributes = JSON.parse('{"__proto__":"bad"}') as unknown;
    expect(
      offeringDraftContentSchema.safeParse({
        ...base,
        variants: [{ name: "Large", attributes }],
      }).success,
    ).toBe(false);
  });

  it("selects effective prices using half-open ranges", () => {
    const now = new Date("2026-08-14T12:00:00.000Z");
    const result = selectCurrentPrices(
      [
        {
          id: "expired",
          isActive: true,
          effectiveFrom: null,
          effectiveUntil: now,
          displayOrder: 0,
        },
        {
          id: "current",
          isActive: true,
          effectiveFrom: now,
          effectiveUntil: null,
          displayOrder: 1,
        },
      ],
      now,
    );
    expect(result.conflict).toBe(false);
    expect(result.current.map((price) => price.id)).toEqual(["current"]);
  });

  it("normalizes and validates typed custom values", () => {
    const number = validateCustomFieldValue({
      dataType: "NUMBER",
      value: "12.5000",
    });
    expect(number.ok).toBe(true);
    if (number.ok && number.normalized.kind === "number") {
      expect(number.normalized.numberValue).toEqual(
        new Prisma.Decimal("12.5000"),
      );
    }
    expect(
      validateCustomFieldValue({
        dataType: "SINGLE_SELECT",
        options: ["A", "B"],
        value: "C",
      }).ok,
    ).toBe(false);
  });

  it("produces a checksum that changes with structured features", () => {
    const draft = {
      name: "Premium plan",
      offeringType: "PLAN" as const,
      pricingModel: "RECURRING" as const,
      effectiveFrom: null,
      effectiveUntil: null,
      prices: [
        {
          amount: new Prisma.Decimal("49"),
          currencyCode: "CAD",
          billingFrequency: "MONTHLY" as const,
          effectiveFrom: null,
          effectiveUntil: null,
        },
      ],
      variants: [],
    };
    const first = toCanonicalOfferingContent({
      ...draft,
      features: [{ featureKey: "storage", name: "Storage", value: "10" }],
    });
    const second = toCanonicalOfferingContent({
      ...draft,
      features: [{ featureKey: "storage", name: "Storage", value: "20" }],
    });
    expect(first.checksum).not.toBe(second.checksum);
  });

  it("produces the same checksum for harmless graph ordering and client IDs", () => {
    const common = {
      name: "Configurable plan",
      offeringType: "PLAN" as const,
      pricingModel: "MULTI_OPTION" as const,
      effectiveFrom: new Date("2026-08-14T12:00:00.000Z"),
      effectiveUntil: null,
      displayOrder: 4,
    };
    const first = toCanonicalOfferingContent({
      ...common,
      prices: [
        {
          label: "Annual",
          amount: new Prisma.Decimal("100"),
          currencyCode: "USD",
          billingFrequency: "YEARLY" as const,
          effectiveFrom: null,
          effectiveUntil: null,
          displayOrder: 2,
          clientKey: "client-price-a",
        },
        {
          label: "Monthly",
          amount: new Prisma.Decimal("10.0000"),
          currencyCode: "USD",
          billingFrequency: "MONTHLY" as const,
          effectiveFrom: null,
          effectiveUntil: null,
          displayOrder: 1,
          clientKey: "client-price-b",
        },
      ],
      features: [
        { featureKey: "support", name: "Support", displayOrder: 2 },
        { featureKey: "storage", name: "Storage", displayOrder: 1 },
      ],
      variants: [
        {
          name: "Blue",
          displayOrder: 1,
          attributes: { size: "large", color: "blue" },
          priceClientKeys: ["client-price-b"],
        },
      ],
      customValues: [
        {
          definitionKey: "configuration",
          value: { zeta: true, nested: { second: 2, first: 1 } },
        },
      ],
    });
    const second = toCanonicalOfferingContent({
      ...common,
      prices: [
        {
          label: "Monthly",
          amount: new Prisma.Decimal("10"),
          currencyCode: "USD",
          billingFrequency: "MONTHLY" as const,
          effectiveFrom: null,
          effectiveUntil: null,
          displayOrder: 1,
          clientKey: "database-price-99",
        },
        {
          label: "Annual",
          amount: new Prisma.Decimal("100.0000"),
          currencyCode: "USD",
          billingFrequency: "YEARLY" as const,
          effectiveFrom: null,
          effectiveUntil: null,
          displayOrder: 2,
          clientKey: "database-price-42",
        },
      ],
      features: [
        { featureKey: "storage", name: "Storage", displayOrder: 1 },
        { featureKey: "support", name: "Support", displayOrder: 2 },
      ],
      variants: [
        {
          name: "Blue",
          displayOrder: 1,
          attributes: { color: "blue", size: "large" },
          priceClientKeys: ["database-price-99"],
        },
      ],
      customValues: [
        {
          definitionKey: "configuration",
          value: { nested: { first: 1, second: 2 }, zeta: true },
        },
      ],
    });
    expect(second.checksum).toBe(first.checksum);
  });

  it("derives deterministic feature keys and multi-select values", () => {
    const input = {
      name: "Emoji feature plan",
      offeringType: "PLAN" as const,
      pricingModel: "NONE" as const,
      effectiveFrom: null,
      effectiveUntil: null,
      prices: [],
      features: [{ name: "✨" }],
      variants: [],
    };
    const first = toCanonicalOfferingContent(input);
    const second = toCanonicalOfferingContent(input);
    expect(first.canonical.features[0]?.featureKey).toMatch(
      /^feature_[a-f0-9]{12}$/,
    );
    expect(second.checksum).toBe(first.checksum);

    const selected = validateCustomFieldValue({
      dataType: "MULTI_SELECT",
      options: ["A", "B"],
      value: ["B", "A"],
    });
    expect(selected).toMatchObject({
      ok: true,
      normalized: { kind: "json", jsonValue: ["A", "B"] },
    });
  });
});
