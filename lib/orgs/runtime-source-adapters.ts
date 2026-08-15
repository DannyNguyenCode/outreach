import type { RetrievedKnowledgePassage } from "@/lib/orgs/knowledge-retrieval";
import type { RetrievedActiveOffering } from "@/lib/orgs/offering-retrieval";
import {
  renderRuntimeSourceText,
  runtimeAuthorityFor,
  toClientSafeStructuredValue,
  type ClientSafeStructuredValue,
  type OrganizationRuntimeEvidence,
  type RuntimeFreshness,
  type RuntimeOfferingProvenance,
} from "@/lib/orgs/runtime-evidence";

const VISIBILITY = {
  scope: "ORGANIZATION_AUTHORIZED",
  requiredPermission: "org.knowledge.read",
} as const;

export function adaptKnowledgePassagesToRuntimeEvidence(
  organizationId: string,
  passages: RetrievedKnowledgePassage[],
): OrganizationRuntimeEvidence[] {
  return passages.map((passage) => {
    const rendered = renderRuntimeSourceText(
      "CUSTOMER_CONFIRMED_KNOWLEDGE",
      passage.body,
    );
    return {
      evidenceId: `knowledge-passage:${passage.passageId}`,
      organizationId,
      sourceClass: "CUSTOMER_CONFIRMED_KNOWLEDGE",
      claimScope: "ORGANIZATION",
      title: `${passage.sourceTitle} — ${passage.sectionTitle}`,
      safeText: rendered.safeText,
      promptSafeText: rendered.promptSafeText,
      sourceEntityId: passage.sourceId,
      sourceVersionId: passage.versionId,
      sourceChildId: passage.passageId,
      provenance: {
        kind: "KNOWLEDGE_PASSAGE",
        inputKind: passage.inputKind,
        sourceId: passage.sourceId,
        versionId: passage.versionId,
        sectionId: passage.sectionId,
        passageId: passage.passageId,
        sectionCitationKey: passage.citation.sectionCitationKey,
        passageCitationKey: passage.citation.passageCitationKey,
        sourceTitle: passage.sourceTitle,
      },
      freshness: {
        state: "CURRENT",
        effectiveFrom: toIso(passage.effectiveFrom),
        effectiveUntil: toIso(passage.effectiveUntil),
        confirmedAt: passage.confirmedAt.toISOString(),
        observedAt: null,
      },
      authority: runtimeAuthorityFor("CUSTOMER_CONFIRMED_KNOWLEDGE"),
      visibility: VISIBILITY,
      relevance: {
        strategy: "DETERMINISTIC_SUBSTRING",
        rank: null,
      },
    };
  });
}

export function adaptOfferingsToRuntimeEvidence(
  organizationId: string,
  offerings: RetrievedActiveOffering[],
): OrganizationRuntimeEvidence[] {
  return offerings.flatMap((offering) => {
    const freshness = offeringFreshness(offering);
    const common = {
      organizationId,
      sourceClass: "STRUCTURED_OFFERING" as const,
      claimScope: "ORGANIZATION" as const,
      sourceEntityId: offering.offeringId,
      sourceVersionId: offering.versionId,
      authority: runtimeAuthorityFor("STRUCTURED_OFFERING"),
      visibility: VISIBILITY,
      relevance: {
        strategy: "DETERMINISTIC_SUBSTRING" as const,
        rank: null,
      },
    };
    const items: OrganizationRuntimeEvidence[] = [];
    items.push(
      offeringEvidence({
        ...common,
        evidenceId: `offering:${offering.versionId}`,
        title: offering.name,
        text:
          offering.description ??
          `${offering.name} (${offering.offeringType.toLowerCase()})`,
        structuredValue: {
          kind: "offering",
          offeringType: offering.offeringType,
          pricingModel: offering.pricingModel,
          quoteRequired: offering.quoteRequired,
        },
        provenance: offeringProvenance(offering, "OFFERING"),
        freshness,
      }),
    );

    const currentPriceIds = new Set(offering.currentPriceIds);
    const linkedPriceIds = new Set(
      offering.variants.flatMap((variant) =>
        variant.prices.map((link) => link.priceId),
      ),
    );
    for (const price of offering.prices) {
      if (!currentPriceIds.has(price.id) || linkedPriceIds.has(price.id)) {
        continue;
      }
      items.push(
        priceEvidence({
          ...common,
          offering,
          price,
          freshness: childFreshness(price, offering.confirmedAt),
        }),
      );
    }

    for (const variant of offering.variants) {
      items.push(
        offeringEvidence({
          ...common,
          evidenceId: `offering-variant:${variant.id}`,
          sourceChildId: variant.id,
          title: `${offering.name} — ${variant.name}`,
          text: [
            `Variant: ${variant.name}.`,
            variant.sku ? `SKU: ${variant.sku}.` : "",
            variant.referenceCode ? `Reference: ${variant.referenceCode}.` : "",
          ]
            .filter(Boolean)
            .join(" "),
          structuredValue: {
            kind: "variant",
            name: variant.name,
            sku: variant.sku,
            referenceCode: variant.referenceCode,
            attributes: toClientSafeStructuredValue(variant.attributes),
          },
          provenance: offeringProvenance(offering, "VARIANT", {
            variantId: variant.id,
          }),
          freshness,
        }),
      );
      for (const link of variant.prices) {
        if (!currentPriceIds.has(link.priceId)) continue;
        const price = offering.prices.find(
          (candidate) => candidate.id === link.priceId,
        );
        if (!price) continue;
        items.push(
          priceEvidence({
            ...common,
            offering,
            price,
            variantId: variant.id,
            variantName: variant.name,
            freshness: childFreshness(price, offering.confirmedAt),
          }),
        );
      }
    }

    for (const feature of offering.features) {
      items.push(
        offeringEvidence({
          ...common,
          evidenceId: `offering-feature:${feature.id}`,
          sourceChildId: feature.id,
          title: `${offering.name} — ${feature.name}`,
          text: [feature.name, feature.value, feature.unit]
            .filter((part) => part !== null && part !== "")
            .join(" "),
          structuredValue: {
            kind: "feature",
            featureKey: feature.featureKey,
            name: feature.name,
            value: feature.value,
            unit: feature.unit,
          },
          provenance: offeringProvenance(offering, "FEATURE", {
            featureId: feature.id,
          }),
          freshness,
        }),
      );
    }

    if (offering.eligibility) {
      const eligibility = offering.eligibility;
      const text = [
        eligibility.description,
        eligibility.availabilityRestrictions,
        eligibility.qualificationNotes,
        eligibility.geographicNotes,
      ]
        .filter(Boolean)
        .join(" ");
      items.push(
        offeringEvidence({
          ...common,
          evidenceId: `offering-eligibility:${eligibility.id}`,
          sourceChildId: eligibility.id,
          title: `${offering.name} — Eligibility`,
          text: text || "Structured eligibility constraints are present.",
          structuredValue: {
            kind: "eligibility",
            description: eligibility.description,
            availabilityRestrictions: eligibility.availabilityRestrictions,
            qualificationNotes: eligibility.qualificationNotes,
            geographicNotes: eligibility.geographicNotes,
            minimumQuantity: eligibility.minimumQuantity,
            maximumQuantity: eligibility.maximumQuantity,
          },
          provenance: offeringProvenance(offering, "ELIGIBILITY", {
            eligibilityId: eligibility.id,
          }),
          freshness,
        }),
      );
    }

    for (const customValue of offering.customValues) {
      const value = customValueDisplayValue(customValue);
      items.push(
        offeringEvidence({
          ...common,
          evidenceId: `offering-custom:${customValue.id}`,
          sourceChildId: customValue.id,
          title: `${offering.name} — ${customValue.definitionKey}`,
          text: `${customValue.definitionKey}: ${displayStructuredValue(value)}`,
          structuredValue: {
            kind: "custom_value",
            definitionKey: customValue.definitionKey,
            value,
          },
          provenance: offeringProvenance(offering, "CUSTOM_VALUE", {
            customValueId: customValue.id,
            customDefinitionId: customValue.definitionId,
            customDefinitionKey: customValue.definitionKey,
          }),
          freshness,
        }),
      );
    }

    return items;
  });
}

function offeringEvidence(
  input: Omit<OrganizationRuntimeEvidence, "safeText" | "promptSafeText"> & {
    text: string;
  },
): OrganizationRuntimeEvidence {
  const { text, ...item } = input;
  const rendered = renderRuntimeSourceText("STRUCTURED_OFFERING", text);
  return {
    ...item,
    safeText: rendered.safeText,
    promptSafeText: rendered.promptSafeText,
  };
}

function priceEvidence(input: {
  organizationId: string;
  sourceClass: "STRUCTURED_OFFERING";
  claimScope: "ORGANIZATION";
  sourceEntityId: string;
  sourceVersionId: string;
  authority: OrganizationRuntimeEvidence["authority"];
  visibility: OrganizationRuntimeEvidence["visibility"];
  relevance: NonNullable<OrganizationRuntimeEvidence["relevance"]>;
  offering: RetrievedActiveOffering;
  price: RetrievedActiveOffering["prices"][number];
  variantId?: string;
  variantName?: string;
  freshness: RuntimeFreshness;
}): OrganizationRuntimeEvidence {
  const amount = input.price.amount.toString();
  const frequency = input.price.billingFrequency.toLowerCase();
  return offeringEvidence({
    organizationId: input.organizationId,
    sourceClass: input.sourceClass,
    claimScope: input.claimScope,
    evidenceId: input.variantId
      ? `offering-price:${input.variantId}:${input.price.id}`
      : `offering-price:${input.price.id}`,
    sourceEntityId: input.sourceEntityId,
    sourceVersionId: input.sourceVersionId,
    sourceChildId: input.price.id,
    title: [
      input.offering.name,
      input.variantName,
      input.price.label ?? "Current price",
    ]
      .filter(Boolean)
      .join(" — "),
    text: `${input.price.currencyCode} ${amount} / ${frequency}`,
    structuredValue: {
      kind: "price",
      amount,
      currencyCode: input.price.currencyCode,
      billingFrequency: input.price.billingFrequency,
      intervalCount: input.price.intervalCount,
      priceId: input.price.id,
      variantId: input.variantId ?? null,
      offeringName: input.offering.name,
    },
    provenance: offeringProvenance(input.offering, "PRICE", {
      priceId: input.price.id,
      variantId: input.variantId,
    }),
    freshness: input.freshness,
    authority: input.authority,
    visibility: input.visibility,
    relevance: input.relevance,
  });
}

function offeringProvenance(
  offering: RetrievedActiveOffering,
  kind: RuntimeOfferingProvenance["kind"],
  children: Omit<
    RuntimeOfferingProvenance,
    "kind" | "offeringId" | "versionId"
  > = {},
): RuntimeOfferingProvenance {
  return {
    kind,
    offeringId: offering.offeringId,
    versionId: offering.versionId,
    ...children,
  };
}

function offeringFreshness(
  offering: RetrievedActiveOffering,
): RuntimeFreshness {
  return {
    state: "CURRENT",
    effectiveFrom: toIso(offering.effectiveFrom),
    effectiveUntil: toIso(offering.effectiveUntil),
    confirmedAt: offering.confirmedAt.toISOString(),
    observedAt: null,
  };
}

function childFreshness(
  child: { effectiveFrom: Date | null; effectiveUntil: Date | null },
  confirmedAt: Date,
): RuntimeFreshness {
  return {
    state: "CURRENT",
    effectiveFrom: toIso(child.effectiveFrom),
    effectiveUntil: toIso(child.effectiveUntil),
    confirmedAt: confirmedAt.toISOString(),
    observedAt: null,
  };
}

function customValueDisplayValue(
  value: RetrievedActiveOffering["customValues"][number],
): ClientSafeStructuredValue {
  if (value.stringValue !== null) return value.stringValue;
  if (value.numberValue !== null) return value.numberValue.toString();
  if (value.booleanValue !== null) return value.booleanValue;
  if (value.dateValue !== null) return value.dateValue.toISOString();
  return toClientSafeStructuredValue(value.jsonValue);
}

function displayStructuredValue(value: ClientSafeStructuredValue): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(displayStructuredValue).join(", ");
  }
  return Object.entries(value)
    .map(([key, entry]) => `${key}: ${displayStructuredValue(entry)}`)
    .join(", ");
}

function toIso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}
