import "server-only";

import type { SafeUser } from "@/lib/auth/users";
import {
  retrieveActiveOfferings,
  type RetrievedActiveOffering,
} from "@/lib/orgs/offering-retrieval";
import {
  compareOfferingsSchema,
  zodFieldErrors,
} from "@/lib/orgs/offering-validation";

export type OfferingComparisonRow = {
  featureKey: string;
  label: string;
  values: Record<string, string | null>;
};

export type OfferingComparison = {
  offerings: Array<{
    offeringId: string;
    versionId: string;
    name: string;
    offeringType: RetrievedActiveOffering["offeringType"];
    quoteRequired: boolean;
    currentPrices: Array<{
      id: string;
      amount: string;
      currencyCode: string;
      billingFrequency: string;
      intervalCount: number | null;
    }>;
    variants: RetrievedActiveOffering["variants"];
    eligibility: RetrievedActiveOffering["eligibility"];
  }>;
  features: OfferingComparisonRow[];
};

/**
 * Deterministic structured comparison. It intentionally performs no ranking,
 * recommendation, inference, or AI completion.
 */
export async function compareActiveOfferings(input: {
  actor: SafeUser;
  organizationId: string;
  offeringIds: unknown;
}) {
  const parsed = compareOfferingsSchema.safeParse({
    offeringIds: input.offeringIds,
  });
  if (!parsed.success) {
    return {
      ok: false as const,
      reason: "validation" as const,
      message: "Select valid offerings to compare.",
      fieldErrors: zodFieldErrors(parsed.error),
    };
  }
  const uniqueIds = [...new Set(parsed.data.offeringIds)];
  if (uniqueIds.length !== parsed.data.offeringIds.length) {
    return {
      ok: false as const,
      reason: "validation" as const,
      message: "Select each offering only once.",
    };
  }
  const retrieved = await retrieveActiveOfferings({
    actor: input.actor,
    organizationId: input.organizationId,
    offeringIds: uniqueIds,
  });
  if (!retrieved.ok) return retrieved;
  if (retrieved.items.length !== uniqueIds.length) {
    return {
      ok: false as const,
      reason: "not_found" as const,
      message: "One or more offerings are unavailable for comparison.",
    };
  }
  const unsupported = retrieved.items.find(
    (item) =>
      item.offeringType !== "PLAN" &&
      item.offeringType !== "PACKAGE" &&
      item.offeringType !== "SUBSCRIPTION",
  );
  if (unsupported) {
    return {
      ok: false as const,
      reason: "validation" as const,
      message: "Only plans, packages, and subscriptions can be compared.",
    };
  }

  const byId = new Map(retrieved.items.map((item) => [item.offeringId, item]));
  const ordered = uniqueIds.map((id) => byId.get(id)!);
  const featureLabels = new Map<string, string>();
  for (const item of ordered) {
    for (const feature of item.features) {
      if (!featureLabels.has(feature.featureKey)) {
        featureLabels.set(feature.featureKey, feature.name);
      }
    }
  }
  const featureKeys = [...featureLabels.keys()].sort();
  const comparison: OfferingComparison = {
    offerings: ordered.map((item) => ({
      offeringId: item.offeringId,
      versionId: item.versionId,
      name: item.name,
      offeringType: item.offeringType,
      quoteRequired: item.quoteRequired,
      currentPrices: item.prices
        .filter((price) => item.currentPriceIds.includes(price.id))
        .map((price) => ({
          id: price.id,
          amount: price.amount.toFixed(4),
          currencyCode: price.currencyCode,
          billingFrequency: price.billingFrequency,
          intervalCount: price.intervalCount,
        })),
      variants: item.variants,
      eligibility: item.eligibility,
    })),
    features: featureKeys.map((featureKey) => ({
      featureKey,
      label: featureLabels.get(featureKey) ?? featureKey,
      values: Object.fromEntries(
        ordered.map((item) => {
          const feature = item.features.find(
            (candidate) => candidate.featureKey === featureKey,
          );
          return [
            item.offeringId,
            feature
              ? [feature.value, feature.unit].filter(Boolean).join(" ") ||
                "Included"
              : null,
          ];
        }),
      ),
    })),
  };
  return { ok: true as const, comparison };
}
