/** @vitest-environment node */

import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  currencyCodeSchema,
  moneyAmountSchema,
  moneyToCanonicalString,
  parseMoneyDecimal,
} from "@/lib/orgs/money";
import {
  isPriceCurrentlyEffective,
  offeringDraftContentSchema,
  selectCurrentPrices,
  toCanonicalOfferingContent,
} from "@/lib/orgs/offering-validation";

describe("money helpers", () => {
  it("accepts supported ISO currency codes case-insensitively", () => {
    expect(currencyCodeSchema.parse("cad")).toBe("CAD");
    expect(currencyCodeSchema.safeParse("ZZZ").success).toBe(false);
  });

  it("parses decimal strings without using floating point authority", () => {
    const value = parseMoneyDecimal("49.9900");
    expect(value).toBeInstanceOf(Prisma.Decimal);
    expect(moneyToCanonicalString(value!)).toBe("49.9900");
  });

  it("rejects invalid and negative amounts", () => {
    expect(moneyAmountSchema.safeParse("1e2").success).toBe(false);
    expect(moneyAmountSchema.safeParse("-1.00").success).toBe(false);
    expect(moneyAmountSchema.safeParse("abc").success).toBe(false);
  });
});

describe("offering validation", () => {
  it("accepts each offering type", () => {
    for (const offeringType of [
      "PRODUCT",
      "SERVICE",
      "PLAN",
      "PACKAGE",
      "SUBSCRIPTION",
      "CUSTOM_QUOTE",
    ] as const) {
      const parsed = offeringDraftContentSchema.safeParse({
        name: `${offeringType} sample`,
        offeringType,
        pricingModel: "QUOTE_REQUIRED",
        quoteRequired: true,
        prices: [],
        features: [],
        variants: [],
      });
      expect(parsed.success).toBe(true);
    }
  });

  it("requires exactly one fixed one-time price", () => {
    const parsed = offeringDraftContentSchema.safeParse({
      name: "Install",
      offeringType: "SERVICE",
      pricingModel: "FIXED_ONE_TIME",
      prices: [
        {
          amount: "100.00",
          currencyCode: "CAD",
          billingFrequency: "ONE_TIME",
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("requires recurring frequency for recurring pricing", () => {
    const parsed = offeringDraftContentSchema.safeParse({
      name: "Premium",
      offeringType: "PLAN",
      pricingModel: "RECURRING",
      prices: [
        {
          amount: "49.00",
          currencyCode: "CAD",
          billingFrequency: "ONE_TIME",
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it("selects current prices and detects conflicts", () => {
    const now = new Date("2026-08-14T12:00:00.000Z");
    const prices = [
      {
        id: "a",
        isActive: true,
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        effectiveUntil: null,
        displayOrder: 0,
      },
      {
        id: "b",
        isActive: true,
        effectiveFrom: new Date("2026-06-01T00:00:00.000Z"),
        effectiveUntil: null,
        displayOrder: 1,
      },
      {
        id: "future",
        isActive: true,
        effectiveFrom: new Date("2027-01-01T00:00:00.000Z"),
        effectiveUntil: null,
        displayOrder: 2,
      },
      {
        id: "expired",
        isActive: true,
        effectiveFrom: new Date("2025-01-01T00:00:00.000Z"),
        effectiveUntil: new Date("2026-01-01T00:00:00.000Z"),
        displayOrder: 3,
      },
    ];
    expect(isPriceCurrentlyEffective(prices[2]!, now)).toBe(false);
    expect(isPriceCurrentlyEffective(prices[3]!, now)).toBe(false);
    const selected = selectCurrentPrices(prices, now);
    expect(selected.conflict).toBe(true);
    expect(selected.current.map((price) => price.id)).toEqual(["a", "b"]);
  });

  it("builds stable checksums for feature comparison payloads", () => {
    const first = toCanonicalOfferingContent({
      name: "Plan A",
      offeringType: "PLAN",
      pricingModel: "RECURRING",
      effectiveFrom: null,
      effectiveUntil: null,
      prices: [
        {
          amount: new Prisma.Decimal("49.00"),
          currencyCode: "CAD",
          billingFrequency: "MONTHLY",
          effectiveFrom: null,
          effectiveUntil: null,
        },
      ],
      features: [
        { featureKey: "dental", name: "Dental coverage", value: "yes" },
        { featureKey: "storage", name: "Storage", value: "10", unit: "GB" },
      ],
      variants: [],
    });
    const second = toCanonicalOfferingContent({
      name: "Plan A",
      offeringType: "PLAN",
      pricingModel: "RECURRING",
      effectiveFrom: null,
      effectiveUntil: null,
      prices: [
        {
          amount: new Prisma.Decimal("49.00"),
          currencyCode: "CAD",
          billingFrequency: "MONTHLY",
          effectiveFrom: null,
          effectiveUntil: null,
        },
      ],
      features: [
        { featureKey: "dental", name: "Dental coverage", value: "yes" },
        { featureKey: "storage", name: "Storage", value: "10", unit: "GB" },
      ],
      variants: [],
    });
    expect(first.checksum).toBe(second.checksum);
  });
});
