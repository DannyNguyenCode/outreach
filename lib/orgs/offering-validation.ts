import { createHash } from "node:crypto";

import { Prisma } from "@prisma/client";
import { z } from "zod";

import { requireExpectedVersion } from "@/lib/orgs/business-validation";
import {
  customFieldKeySchema,
  isValidLocalDateString,
} from "@/lib/orgs/config-3b-validation";
import {
  currencyCodeSchema,
  moneyAmountSchema,
  moneyToCanonicalString,
} from "@/lib/orgs/money";

export { requireExpectedVersion };

export const OFFERING_NAME_MAX = 200;
export const OFFERING_DESCRIPTION_MAX = 4_000;
export const OFFERING_MAX_PRICES = 40;
export const OFFERING_MAX_FEATURES = 80;
export const OFFERING_MAX_VARIANTS = 40;
export const OFFERING_MAX_CUSTOM_VALUES = 40;
export const OFFERING_FEATURE_VALUE_MAX = 200;
export const OFFERING_SEARCH_MAX = 200;
export const OFFERING_PAGE_SIZE_DEFAULT = 20;
export const OFFERING_PAGE_SIZE_MAX = 50;
export const OFFERING_COMPARE_MAX = 6;
export const OFFERING_ELIGIBILITY_TEXT_MAX = 2_000;
export const OFFERING_VARIANT_ATTR_MAX_KEYS = 20;
export const OFFERING_VARIANT_ATTR_KEY_MAX = 64;
export const OFFERING_VARIANT_ATTR_VALUE_MAX = 200;

export const OFFERING_TYPES = [
  "PRODUCT",
  "SERVICE",
  "PLAN",
  "PACKAGE",
  "SUBSCRIPTION",
  "CUSTOM_QUOTE",
] as const;

export const OFFERING_PRICING_MODELS = [
  "NONE",
  "QUOTE_REQUIRED",
  "FIXED_ONE_TIME",
  "RECURRING",
  "MULTI_OPTION",
  "TIERED",
] as const;

export const OFFERING_BILLING_FREQUENCIES = [
  "ONE_TIME",
  "WEEKLY",
  "MONTHLY",
  "QUARTERLY",
  "YEARLY",
  "CUSTOM",
] as const;

export type OfferingTypeValue = (typeof OFFERING_TYPES)[number];
export type OfferingPricingModelValue =
  (typeof OFFERING_PRICING_MODELS)[number];
export type OfferingBillingFrequencyValue =
  (typeof OFFERING_BILLING_FREQUENCIES)[number];

const optionalWallOrInstantSchema = z
  .union([z.string(), z.date(), z.null(), z.undefined()])
  .optional();

const dstDisambiguationSchema = z
  .union([
    z.literal("earlier"),
    z.literal("later"),
    z.literal(""),
    z.null(),
    z.undefined(),
  ])
  .optional();

const confirmAccuracySchema = z
  .union([z.literal(true), z.literal("on"), z.literal("true"), z.literal("1")])
  .transform(() => true as const);

const featureKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(
    /^[a-z][a-z0-9_]*$/,
    "Feature keys must start with a letter and use lowercase letters, digits, or underscores.",
  );

const priceInputSchema = z.object({
  label: z
    .string()
    .trim()
    .max(120)
    .transform((value) => (value.length === 0 ? undefined : value))
    .optional()
    .nullable(),
  amount: moneyAmountSchema,
  currencyCode: currencyCodeSchema,
  billingFrequency: z.enum(OFFERING_BILLING_FREQUENCIES),
  intervalCount: z.number().int().min(1).max(120).optional().nullable(),
  isActive: z.boolean().optional().default(true),
  effectiveFrom: optionalWallOrInstantSchema,
  effectiveUntil: optionalWallOrInstantSchema,
  effectiveFromDisambiguation: dstDisambiguationSchema,
  effectiveUntilDisambiguation: dstDisambiguationSchema,
  displayOrder: z.number().int().min(0).max(10_000).optional(),
  /** Client-local temp id used only to attach variant price overrides. */
  clientKey: z.string().trim().min(1).max(64).optional(),
});

const featureInputSchema = z.object({
  featureKey: featureKeySchema.optional(),
  name: z.string().trim().min(1).max(120),
  value: z
    .string()
    .trim()
    .max(OFFERING_FEATURE_VALUE_MAX)
    .transform((value) => (value.length === 0 ? undefined : value))
    .optional()
    .nullable(),
  unit: z
    .string()
    .trim()
    .max(40)
    .transform((value) => (value.length === 0 ? undefined : value))
    .optional()
    .nullable(),
  displayOrder: z.number().int().min(0).max(10_000).optional(),
});

const variantAttributesSchema = z
  .unknown()
  .superRefine((raw, ctx) => {
    if (raw === undefined || raw === null) return;
    if (typeof raw !== "object" || Array.isArray(raw)) {
      ctx.addIssue({
        code: "custom",
        message: "Variant attributes must be an object.",
      });
      return;
    }
    const attrs = raw as Record<string, unknown>;
    const keys = Object.getOwnPropertyNames(attrs);
    if (keys.length > OFFERING_VARIANT_ATTR_MAX_KEYS) {
      ctx.addIssue({
        code: "custom",
        message: `At most ${OFFERING_VARIANT_ATTR_MAX_KEYS} variant attributes are allowed.`,
      });
    }
    for (const key of keys) {
      if (key === "__proto__" || key === "prototype" || key === "constructor") {
        ctx.addIssue({
          code: "custom",
          message: "Variant attribute keys are invalid.",
          path: [key],
        });
        continue;
      }
      if (
        key.length < 1 ||
        key.length > OFFERING_VARIANT_ATTR_KEY_MAX ||
        !/^[a-z][a-z0-9_]*$/.test(key)
      ) {
        ctx.addIssue({
          code: "custom",
          message:
            "Variant attribute keys must be stable lowercase identifiers.",
          path: [key],
        });
      }
      const value = attrs[key];
      if (
        typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean" &&
        value !== null
      ) {
        ctx.addIssue({
          code: "custom",
          message:
            "Variant attribute values must be string, number, boolean, or null.",
          path: [key],
        });
        continue;
      }
      if (
        typeof value === "string" &&
        value.length > OFFERING_VARIANT_ATTR_VALUE_MAX
      ) {
        ctx.addIssue({
          code: "custom",
          message: `Variant attribute values must be at most ${OFFERING_VARIANT_ATTR_VALUE_MAX} characters.`,
          path: [key],
        });
      }
    }
  })
  .transform((raw) => {
    if (raw === undefined || raw === null) return {};
    if (typeof raw !== "object" || Array.isArray(raw)) return {};
    const attrs = raw as Record<string, unknown>;
    const cleaned: Record<string, string | number | boolean | null> = {};
    for (const key of Object.getOwnPropertyNames(attrs)) {
      if (key === "__proto__" || key === "prototype" || key === "constructor") {
        continue;
      }
      const value = attrs[key];
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean" ||
        value === null
      ) {
        cleaned[key] = value;
      }
    }
    return cleaned;
  });

const variantInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  sku: z
    .string()
    .trim()
    .max(64)
    .regex(/^[A-Za-z0-9._-]*$/, "SKU may only use letters, numbers, . _ -")
    .transform((value) => (value.length === 0 ? undefined : value))
    .optional()
    .nullable(),
  referenceCode: z
    .string()
    .trim()
    .max(64)
    .transform((value) => (value.length === 0 ? undefined : value))
    .optional()
    .nullable(),
  attributes: variantAttributesSchema.optional().default({}),
  isActive: z.boolean().optional().default(true),
  displayOrder: z.number().int().min(0).max(10_000).optional(),
  /** References price.clientKey values for variant-specific prices. */
  priceClientKeys: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
});

const eligibilityInputSchema = z
  .object({
    description: z
      .string()
      .trim()
      .max(OFFERING_ELIGIBILITY_TEXT_MAX)
      .optional()
      .nullable(),
    availabilityRestrictions: z
      .string()
      .trim()
      .max(OFFERING_ELIGIBILITY_TEXT_MAX)
      .optional()
      .nullable(),
    qualificationNotes: z
      .string()
      .trim()
      .max(OFFERING_ELIGIBILITY_TEXT_MAX)
      .optional()
      .nullable(),
    geographicNotes: z
      .string()
      .trim()
      .max(OFFERING_ELIGIBILITY_TEXT_MAX)
      .optional()
      .nullable(),
    minimumQuantity: z
      .number()
      .int()
      .min(0)
      .max(1_000_000)
      .optional()
      .nullable(),
    maximumQuantity: z
      .number()
      .int()
      .min(0)
      .max(1_000_000)
      .optional()
      .nullable(),
  })
  .superRefine((data, ctx) => {
    if (
      data.minimumQuantity != null &&
      data.maximumQuantity != null &&
      data.maximumQuantity < data.minimumQuantity
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Maximum quantity must be greater than or equal to minimum.",
        path: ["maximumQuantity"],
      });
    }
  })
  .optional()
  .nullable();

const customValueInputSchema = z.object({
  definitionKey: customFieldKeySchema,
  value: z.unknown(),
});

const offeringContentFields = {
  name: z
    .string()
    .trim()
    .min(1, `Enter a name (1–${OFFERING_NAME_MAX} characters).`)
    .max(OFFERING_NAME_MAX),
  description: z
    .string()
    .trim()
    .max(OFFERING_DESCRIPTION_MAX)
    .transform((value) => (value.length === 0 ? undefined : value))
    .optional()
    .nullable(),
  offeringType: z.enum(OFFERING_TYPES),
  pricingModel: z.enum(OFFERING_PRICING_MODELS),
  quoteRequired: z.boolean().optional(),
  effectiveFrom: optionalWallOrInstantSchema,
  effectiveUntil: optionalWallOrInstantSchema,
  effectiveFromDisambiguation: dstDisambiguationSchema,
  effectiveUntilDisambiguation: dstDisambiguationSchema,
  displayOrder: z.number().int().min(0).max(10_000).optional(),
  prices: z
    .array(priceInputSchema)
    .max(OFFERING_MAX_PRICES)
    .optional()
    .default([]),
  features: z
    .array(featureInputSchema)
    .max(OFFERING_MAX_FEATURES)
    .optional()
    .default([]),
  variants: z
    .array(variantInputSchema)
    .max(OFFERING_MAX_VARIANTS)
    .optional()
    .default([]),
  eligibility: eligibilityInputSchema,
  customValues: z
    .array(customValueInputSchema)
    .max(OFFERING_MAX_CUSTOM_VALUES)
    .optional()
    .default([]),
};

function refineOfferingContent(
  data: {
    pricingModel: OfferingPricingModelValue;
    quoteRequired?: boolean;
    prices: Array<{
      billingFrequency: OfferingBillingFrequencyValue;
      clientKey?: string;
    }>;
    features: Array<{ featureKey?: string; name: string }>;
    variants: Array<{
      sku?: string | null;
      priceClientKeys?: string[];
    }>;
  },
  ctx: z.RefinementCtx,
) {
  const quoteRequired =
    data.quoteRequired ?? data.pricingModel === "QUOTE_REQUIRED";
  if (data.pricingModel === "QUOTE_REQUIRED" && !quoteRequired) {
    ctx.addIssue({
      code: "custom",
      path: ["quoteRequired"],
      message: "Quote-required pricing model must set quoteRequired.",
    });
  }
  if (data.pricingModel === "NONE" && data.prices.length > 0) {
    ctx.addIssue({
      code: "custom",
      path: ["prices"],
      message: "Pricing model NONE cannot include published prices.",
    });
  }
  if (data.pricingModel === "QUOTE_REQUIRED" && data.prices.length > 0) {
    ctx.addIssue({
      code: "custom",
      path: ["prices"],
      message: "Quote-required offerings cannot publish fixed prices.",
    });
  }
  if (
    (data.pricingModel === "FIXED_ONE_TIME" ||
      data.pricingModel === "RECURRING") &&
    data.prices.length !== 1
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["prices"],
      message: `${data.pricingModel} requires exactly one price.`,
    });
  }
  if (
    (data.pricingModel === "MULTI_OPTION" || data.pricingModel === "TIERED") &&
    data.prices.length < 2
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["prices"],
      message: `${data.pricingModel} requires at least two prices.`,
    });
  }
  if (data.pricingModel === "FIXED_ONE_TIME") {
    const frequency = data.prices[0]?.billingFrequency;
    if (frequency && frequency !== "ONE_TIME") {
      ctx.addIssue({
        code: "custom",
        path: ["prices", 0, "billingFrequency"],
        message: "Fixed one-time pricing must use ONE_TIME frequency.",
      });
    }
  }
  if (data.pricingModel === "RECURRING") {
    const frequency = data.prices[0]?.billingFrequency;
    if (frequency === "ONE_TIME") {
      ctx.addIssue({
        code: "custom",
        path: ["prices", 0, "billingFrequency"],
        message: "Recurring pricing cannot use ONE_TIME frequency.",
      });
    }
  }

  const featureKeys = new Set<string>();
  for (const [index, feature] of data.features.entries()) {
    const key = (
      feature.featureKey ?? slugifyFeatureKey(feature.name)
    ).toLowerCase();
    if (featureKeys.has(key)) {
      ctx.addIssue({
        code: "custom",
        path: ["features", index, "featureKey"],
        message: "Feature keys must be unique within an offering version.",
      });
    }
    featureKeys.add(key);
  }

  const priceKeys = new Set<string>();
  for (const [index, price] of data.prices.entries()) {
    if (!price.clientKey) continue;
    if (priceKeys.has(price.clientKey)) {
      ctx.addIssue({
        code: "custom",
        path: ["prices", index, "clientKey"],
        message: "Price client keys must be unique.",
      });
    }
    priceKeys.add(price.clientKey);
  }

  const skus = new Set<string>();
  for (const [index, variant] of data.variants.entries()) {
    if (variant.sku) {
      const skuKey = variant.sku.toLowerCase();
      if (skus.has(skuKey)) {
        ctx.addIssue({
          code: "custom",
          path: ["variants", index, "sku"],
          message: "Variant SKUs must be unique within an offering version.",
        });
      }
      skus.add(skuKey);
    }
    for (const priceKey of variant.priceClientKeys ?? []) {
      if (!priceKeys.has(priceKey)) {
        ctx.addIssue({
          code: "custom",
          path: ["variants", index, "priceClientKeys"],
          message: "Variant price references an unknown price client key.",
        });
      }
    }
  }
}

export const offeringDraftContentSchema = z
  .object(offeringContentFields)
  .superRefine(refineOfferingContent);

export const createOfferingSchema = offeringDraftContentSchema;

export const updateOfferingDraftSchema = offeringDraftContentSchema.extend({
  offeringId: z.string().trim().min(1, "Offering is required."),
  versionId: z.string().trim().min(1, "Version is required."),
  expectedDraftRevision: z.unknown(),
});

export const confirmOfferingSchema = z.object({
  offeringId: z.string().trim().min(1, "Offering is required."),
  versionId: z.string().trim().min(1, "Version is required."),
  expectedDraftRevision: z.unknown(),
  expectedChecksum: z
    .string()
    .trim()
    .regex(/^[a-f0-9]{64}$/i, "Preview checksum is invalid."),
  confirmAccuracy: confirmAccuracySchema,
});

export const archiveOfferingSchema = z.object({
  offeringId: z.string().trim().min(1, "Offering is required."),
  expectedVersion: z.unknown(),
});

export const restoreOfferingSchema = z.object({
  offeringId: z.string().trim().min(1, "Offering is required."),
  versionId: z.string().trim().min(1, "Version is required."),
  expectedVersion: z.unknown(),
});

export const replacementOfferingDraftSchema = z.object({
  offeringId: z.string().trim().min(1, "Offering is required."),
  expectedVersion: z.unknown(),
});

export const compareOfferingsSchema = z.object({
  offeringIds: z
    .array(z.string().trim().min(1))
    .min(2, "Select at least two offerings to compare.")
    .max(OFFERING_COMPARE_MAX),
});

export type CanonicalOfferingPrice = {
  label: string | null;
  amount: string;
  currencyCode: string;
  billingFrequency: OfferingBillingFrequencyValue;
  intervalCount: number | null;
  isActive: boolean;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  displayOrder: number;
  clientKey: string;
};

export type CanonicalOfferingFeature = {
  featureKey: string;
  name: string;
  value: string | null;
  unit: string | null;
  displayOrder: number;
};

export type CanonicalOfferingVariant = {
  name: string;
  sku: string | null;
  referenceCode: string | null;
  attributes: Record<string, string | number | boolean | null>;
  isActive: boolean;
  displayOrder: number;
  priceClientKeys: string[];
};

export type CanonicalOfferingEligibility = {
  description: string | null;
  availabilityRestrictions: string | null;
  qualificationNotes: string | null;
  geographicNotes: string | null;
  minimumQuantity: number | null;
  maximumQuantity: number | null;
} | null;

export type CanonicalOfferingCustomValue = {
  definitionKey: string;
  value: unknown;
};

export type CanonicalOfferingContent = {
  name: string;
  description: string | null;
  offeringType: OfferingTypeValue;
  pricingModel: OfferingPricingModelValue;
  quoteRequired: boolean;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  displayOrder: number;
  prices: CanonicalOfferingPrice[];
  features: CanonicalOfferingFeature[];
  variants: CanonicalOfferingVariant[];
  eligibility: CanonicalOfferingEligibility;
  customValues: CanonicalOfferingCustomValue[];
};

export function slugifyFeatureKey(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  if (/^[a-z][a-z0-9_]*$/.test(base)) return base;
  return `feature_${createHash("sha256")
    .update(name.trim())
    .digest("hex")
    .slice(0, 12)}`;
}

export function sanitizeSearchQuery(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/[%_\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, OFFERING_SEARCH_MAX);
}

export function parsePage(raw: unknown): number {
  if (raw === undefined || raw === null || raw === "") return 1;
  const value = Number(String(raw));
  if (!Number.isInteger(value) || value < 1) return 1;
  return value;
}

export function parsePageSize(raw: unknown): number {
  if (raw === undefined || raw === null || raw === "") {
    return OFFERING_PAGE_SIZE_DEFAULT;
  }
  const value = Number(String(raw));
  if (!Number.isInteger(value) || value < 1) {
    return OFFERING_PAGE_SIZE_DEFAULT;
  }
  return Math.min(value, OFFERING_PAGE_SIZE_MAX);
}

export function parseContentJson(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return { _invalidJson: true };
  }
}

export function zodFieldErrors(error: z.ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "_form";
    fieldErrors[key] ??= [];
    fieldErrors[key].push(issue.message);
  }
  return fieldErrors;
}

export function toCanonicalOfferingContent(input: {
  name: string;
  description?: string | null;
  offeringType: OfferingTypeValue;
  pricingModel: OfferingPricingModelValue;
  quoteRequired?: boolean;
  effectiveFrom: Date | null;
  effectiveUntil: Date | null;
  displayOrder?: number;
  prices: Array<{
    label?: string | null;
    amount: Prisma.Decimal;
    currencyCode: string;
    billingFrequency: OfferingBillingFrequencyValue;
    intervalCount?: number | null;
    isActive?: boolean;
    effectiveFrom: Date | null;
    effectiveUntil: Date | null;
    displayOrder?: number;
    clientKey?: string;
  }>;
  features: Array<{
    featureKey?: string;
    name: string;
    value?: string | null;
    unit?: string | null;
    displayOrder?: number;
  }>;
  variants: Array<{
    name: string;
    sku?: string | null;
    referenceCode?: string | null;
    attributes?: Record<string, string | number | boolean | null>;
    isActive?: boolean;
    displayOrder?: number;
    priceClientKeys?: string[];
  }>;
  eligibility?: CanonicalOfferingEligibility;
  customValues?: CanonicalOfferingCustomValue[];
}): { canonical: CanonicalOfferingContent; checksum: string } {
  const usedFeatureKeys = new Set<string>();
  const features = input.features
    .map((feature, index) => ({
      featureKey: feature.featureKey?.trim() || slugifyFeatureKey(feature.name),
      name: feature.name.trim(),
      value: feature.value?.trim() || null,
      unit: feature.unit?.trim() || null,
      displayOrder: feature.displayOrder ?? index,
    }))
    .sort(
      (a, b) =>
        a.displayOrder - b.displayOrder ||
        compareCanonicalText(a.featureKey, b.featureKey) ||
        compareCanonicalText(a.name, b.name),
    )
    .map((feature, index) => {
      let key = feature.featureKey;
      if (usedFeatureKeys.has(key)) {
        key = `${key}_${index + 1}`.slice(0, 64);
      }
      usedFeatureKeys.add(key);
      return { ...feature, featureKey: key };
    });

  const prices = input.prices
    .map((price, index) => ({
      label: price.label?.trim() || null,
      amount: moneyToCanonicalString(price.amount),
      currencyCode: price.currencyCode,
      billingFrequency: price.billingFrequency,
      intervalCount: price.intervalCount ?? null,
      isActive: price.isActive ?? true,
      effectiveFrom: price.effectiveFrom?.toISOString() ?? null,
      effectiveUntil: price.effectiveUntil?.toISOString() ?? null,
      displayOrder: price.displayOrder ?? index,
      clientKey: price.clientKey?.trim() || `price_${index + 1}`,
    }))
    .sort(
      (a, b) =>
        a.displayOrder - b.displayOrder ||
        compareCanonicalText(priceFingerprint(a), priceFingerprint(b)),
    );

  const variants = input.variants
    .map((variant, index) => {
      const attributes: Record<string, string | number | boolean | null> = {};
      for (const key of Object.keys(variant.attributes ?? {}).sort(
        compareCanonicalText,
      )) {
        if (
          key === "__proto__" ||
          key === "prototype" ||
          key === "constructor"
        ) {
          continue;
        }
        const value = variant.attributes?.[key];
        if (
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean" ||
          value === null
        ) {
          attributes[key] = value;
        }
      }
      return {
        name: variant.name.trim(),
        sku: variant.sku?.trim() || null,
        referenceCode: variant.referenceCode?.trim() || null,
        attributes,
        isActive: variant.isActive ?? true,
        displayOrder: variant.displayOrder ?? index,
        priceClientKeys: [...(variant.priceClientKeys ?? [])].sort(
          compareCanonicalText,
        ),
      };
    })
    .sort(
      (a, b) =>
        a.displayOrder - b.displayOrder ||
        compareCanonicalText(variantFingerprint(a), variantFingerprint(b)),
    );

  const canonical: CanonicalOfferingContent = {
    name: input.name.trim(),
    description: input.description?.trim() || null,
    offeringType: input.offeringType,
    pricingModel: input.pricingModel,
    quoteRequired:
      input.quoteRequired ?? input.pricingModel === "QUOTE_REQUIRED",
    effectiveFrom: input.effectiveFrom?.toISOString() ?? null,
    effectiveUntil: input.effectiveUntil?.toISOString() ?? null,
    displayOrder: input.displayOrder ?? 0,
    prices,
    features,
    variants,
    eligibility: input.eligibility
      ? {
          description: emptyToNull(input.eligibility.description),
          availabilityRestrictions: emptyToNull(
            input.eligibility.availabilityRestrictions,
          ),
          qualificationNotes: emptyToNull(input.eligibility.qualificationNotes),
          geographicNotes: emptyToNull(input.eligibility.geographicNotes),
          minimumQuantity: input.eligibility.minimumQuantity ?? null,
          maximumQuantity: input.eligibility.maximumQuantity ?? null,
        }
      : null,
    customValues: [...(input.customValues ?? [])]
      .map((item) => ({
        definitionKey: item.definitionKey,
        value: canonicalizeJsonValue(item.value),
      }))
      .sort((a, b) => compareCanonicalText(a.definitionKey, b.definitionKey)),
  };

  return {
    canonical,
    checksum: computeOfferingChecksum(canonical),
  };
}

export function computeOfferingChecksum(
  canonical: CanonicalOfferingContent,
): string {
  // clientKey exists only to wire draft variant→price links in the editor.
  // Checksums instead fingerprint the linked price payload so confirmation remains stable.
  const pricesByClientKey = new Map(
    canonical.prices.map((price) => [price.clientKey, price]),
  );
  const forChecksum = {
    ...canonical,
    prices: canonical.prices.map((price) => ({
      label: price.label,
      amount: price.amount,
      currencyCode: price.currencyCode,
      billingFrequency: price.billingFrequency,
      intervalCount: price.intervalCount,
      isActive: price.isActive,
      effectiveFrom: price.effectiveFrom,
      effectiveUntil: price.effectiveUntil,
      displayOrder: price.displayOrder,
    })),
    variants: canonical.variants.map((variant) => ({
      ...variant,
      priceClientKeys: undefined,
      linkedPriceFingerprints: variant.priceClientKeys
        .map((key) => {
          const price = pricesByClientKey.get(key);
          if (!price) return key;
          return [
            price.amount,
            price.currencyCode,
            price.billingFrequency,
            price.intervalCount ?? "",
            price.label ?? "",
            price.displayOrder,
            price.isActive ? "1" : "0",
            price.effectiveFrom ?? "",
            price.effectiveUntil ?? "",
          ].join("|");
        })
        .sort(),
    })),
  };
  return createHash("sha256").update(JSON.stringify(forChecksum)).digest("hex");
}

export function isPriceCurrentlyEffective(
  price: {
    isActive: boolean;
    effectiveFrom: Date | null;
    effectiveUntil: Date | null;
  },
  now: Date,
): boolean {
  if (!price.isActive) return false;
  if (price.effectiveFrom && price.effectiveFrom.getTime() > now.getTime()) {
    return false;
  }
  if (price.effectiveUntil && price.effectiveUntil.getTime() <= now.getTime()) {
    return false;
  }
  return true;
}

/**
 * Select current prices for a version. Throws when multiple base (non-variant)
 * current prices conflict, or when a variant has multiple current prices.
 */
export function selectCurrentPrices<
  T extends {
    id: string;
    isActive: boolean;
    effectiveFrom: Date | null;
    effectiveUntil: Date | null;
    displayOrder: number;
  },
>(
  prices: T[],
  now: Date,
  variantPriceIds?: ReadonlySet<string>,
): { current: T[]; conflict: boolean } {
  const current = prices
    .filter((price) => isPriceCurrentlyEffective(price, now))
    .filter((price) => (variantPriceIds ? variantPriceIds.has(price.id) : true))
    .sort(
      (a, b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id),
    );
  return { current, conflict: current.length > 1 };
}

export function validateCustomFieldValue(input: {
  dataType: string;
  options?: unknown;
  value: unknown;
}):
  | { ok: true; normalized: CanonicalCustomValue }
  | { ok: false; message: string } {
  switch (input.dataType) {
    case "TEXT":
    case "LONG_TEXT":
    case "URL":
    case "EMAIL":
    case "PHONE": {
      if (typeof input.value !== "string") {
        return { ok: false, message: "Value must be text." };
      }
      const trimmed = input.value.trim();
      const max = input.dataType === "LONG_TEXT" ? 4_000 : 500;
      if (trimmed.length === 0 || trimmed.length > max) {
        return { ok: false, message: `Enter text (1–${max} characters).` };
      }
      return {
        ok: true,
        normalized: { kind: "string", stringValue: trimmed },
      };
    }
    case "NUMBER": {
      const amount = moneyAmountSchema.safeParse(input.value);
      if (!amount.success) {
        return { ok: false, message: "Enter a valid number." };
      }
      return {
        ok: true,
        normalized: { kind: "number", numberValue: amount.data },
      };
    }
    case "BOOLEAN": {
      if (typeof input.value !== "boolean") {
        return { ok: false, message: "Value must be true or false." };
      }
      return {
        ok: true,
        normalized: { kind: "boolean", booleanValue: input.value },
      };
    }
    case "DATE": {
      if (
        typeof input.value !== "string" ||
        !isValidLocalDateString(input.value)
      ) {
        return { ok: false, message: "Enter a valid date (YYYY-MM-DD)." };
      }
      return {
        ok: true,
        normalized: {
          kind: "date",
          dateValue: new Date(`${input.value}T00:00:00.000Z`),
        },
      };
    }
    case "SINGLE_SELECT": {
      if (typeof input.value !== "string") {
        return { ok: false, message: "Select a single option." };
      }
      const options = asStringArray(input.options);
      if (!options.includes(input.value)) {
        return { ok: false, message: "Selected option is not allowed." };
      }
      return {
        ok: true,
        normalized: { kind: "string", stringValue: input.value },
      };
    }
    case "MULTI_SELECT": {
      if (
        !Array.isArray(input.value) ||
        input.value.some((v) => typeof v !== "string")
      ) {
        return { ok: false, message: "Select one or more options." };
      }
      const options = new Set(asStringArray(input.options));
      const selected = input.value
        .map((value) => String(value))
        .sort(compareCanonicalText);
      if (selected.some((value) => !options.has(value))) {
        return {
          ok: false,
          message: "One or more selected options are not allowed.",
        };
      }
      return {
        ok: true,
        normalized: { kind: "json", jsonValue: selected },
      };
    }
    default:
      return { ok: false, message: "Unsupported custom field type." };
  }
}

export type CanonicalCustomValue =
  | { kind: "string"; stringValue: string }
  | { kind: "number"; numberValue: Prisma.Decimal }
  | { kind: "boolean"; booleanValue: boolean }
  | { kind: "date"; dateValue: Date }
  | { kind: "json"; jsonValue: Prisma.InputJsonValue };

function emptyToNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function compareCanonicalText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function priceFingerprint(price: CanonicalOfferingPrice): string {
  return JSON.stringify({
    label: price.label,
    amount: price.amount,
    currencyCode: price.currencyCode,
    billingFrequency: price.billingFrequency,
    intervalCount: price.intervalCount,
    isActive: price.isActive,
    effectiveFrom: price.effectiveFrom,
    effectiveUntil: price.effectiveUntil,
  });
}

function variantFingerprint(variant: CanonicalOfferingVariant): string {
  return JSON.stringify({
    name: variant.name,
    sku: variant.sku,
    referenceCode: variant.referenceCode,
    attributes: variant.attributes,
    isActive: variant.isActive,
    priceClientKeys: variant.priceClientKeys,
  });
}

function canonicalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeJsonValue);
  }
  if (value && typeof value === "object") {
    const canonical: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort(compareCanonicalText)) {
      canonical[key] = canonicalizeJsonValue(
        (value as Record<string, unknown>)[key],
      );
    }
    return canonical;
  }
  return value;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}
