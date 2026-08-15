import { describe, expect, it } from "vitest";

import {
  compareRuntimeEvidence,
  detectDeterministicConflicts,
  selectConflictAwareEvidence,
} from "@/lib/orgs/runtime-composition-logic";
import {
  PHASE_4D_COMPOSABLE_SOURCE_CLASSES,
  RUNTIME_SOURCE_CLASSES,
  RUNTIME_SOURCE_REGISTRY,
  runtimeAuthorityFor,
  type RuntimeEvidenceItem,
} from "@/lib/orgs/runtime-evidence";

const visibility = {
  scope: "ORGANIZATION_AUTHORIZED",
  requiredPermission: "org.knowledge.read",
} as const;

const freshness = {
  state: "CURRENT" as const,
  effectiveFrom: null,
  effectiveUntil: null,
  confirmedAt: "2026-08-15T00:00:00.000Z",
  observedAt: null,
};

function knowledgeItem(
  overrides: Partial<RuntimeEvidenceItem> & { evidenceId: string },
): RuntimeEvidenceItem {
  return {
    organizationId: "org_1",
    sourceClass: "CUSTOMER_CONFIRMED_KNOWLEDGE",
    claimScope: "ORGANIZATION",
    title: "Premium plan pricing — Price",
    safeText: "Premium plan is CAD 49 per month.",
    promptSafeText:
      "[SOURCE CONTENT — CUSTOMER_CONFIRMED_KNOWLEDGE]\nPremium plan is CAD 49 per month.\n[END SOURCE CONTENT]",
    sourceEntityId: "src_1",
    sourceVersionId: "ver_1",
    sourceChildId: "pas_1",
    provenance: {
      kind: "KNOWLEDGE_PASSAGE",
      inputKind: "MANUAL",
      sourceId: "src_1",
      versionId: "ver_1",
      sectionId: "sec_1",
      passageId: "pas_1",
      sectionCitationKey: "s1",
      passageCitationKey: "s1_p1",
      sourceTitle: "Premium plan pricing",
    },
    freshness,
    authority: runtimeAuthorityFor("CUSTOMER_CONFIRMED_KNOWLEDGE"),
    visibility,
    ...overrides,
  };
}

function featureItem(evidenceId: string, title: string): RuntimeEvidenceItem {
  return {
    organizationId: "org_1",
    sourceClass: "STRUCTURED_OFFERING",
    claimScope: "ORGANIZATION",
    title,
    safeText: `${title} feature`,
    promptSafeText: `[SOURCE CONTENT — STRUCTURED_OFFERING]\n${title} feature\n[END SOURCE CONTENT]`,
    evidenceId,
    sourceEntityId: "off_1",
    sourceVersionId: "offver_1",
    sourceChildId: evidenceId,
    provenance: {
      kind: "FEATURE",
      offeringId: "off_1",
      versionId: "offver_1",
      featureId: evidenceId,
    },
    freshness,
    authority: runtimeAuthorityFor("STRUCTURED_OFFERING"),
    visibility,
    structuredValue: { kind: "feature", name: title },
  };
}

function priceItem(
  overrides: Partial<RuntimeEvidenceItem> & {
    evidenceId: string;
    structuredValue: RuntimeEvidenceItem["structuredValue"];
  },
): RuntimeEvidenceItem {
  return {
    organizationId: "org_1",
    sourceClass: "STRUCTURED_OFFERING",
    claimScope: "ORGANIZATION",
    title: "Premium plan — Current price",
    safeText: "CAD 59 / monthly",
    promptSafeText:
      "[SOURCE CONTENT — STRUCTURED_OFFERING]\nCAD 59 / monthly\n[END SOURCE CONTENT]",
    sourceEntityId: "off_1",
    sourceVersionId: "offver_1",
    sourceChildId: "price_1",
    provenance: {
      kind: "PRICE",
      offeringId: "off_1",
      versionId: "offver_1",
      priceId: "price_1",
    },
    freshness,
    authority: runtimeAuthorityFor("STRUCTURED_OFFERING"),
    visibility,
    ...overrides,
  };
}

describe("KNOW-004 runtime composition helpers", () => {
  it("requires live adapters only for current Phase 4D organization sources", () => {
    expect([...PHASE_4D_COMPOSABLE_SOURCE_CLASSES]).toEqual([
      "CUSTOMER_CONFIRMED_KNOWLEDGE",
      "STRUCTURED_OFFERING",
    ]);
    expect(Object.keys(RUNTIME_SOURCE_REGISTRY).sort()).toEqual(
      [...RUNTIME_SOURCE_CLASSES].sort(),
    );
    expect(RUNTIME_SOURCE_REGISTRY.PROSPECT_EVIDENCE.implementedInPhase4D).toBe(
      false,
    );
    expect(RUNTIME_SOURCE_REGISTRY.CRM_FACT.implementedInPhase4D).toBe(false);
    expect(RUNTIME_SOURCE_REGISTRY.CALLER_STATEMENT.implementedInPhase4D).toBe(
      false,
    );
    expect(
      RUNTIME_SOURCE_REGISTRY.CUSTOMER_CONFIRMED_KNOWLEDGE.implementedInPhase4D,
    ).toBe(true);
    expect(
      RUNTIME_SOURCE_REGISTRY.STRUCTURED_OFFERING.implementedInPhase4D,
    ).toBe(true);
  });

  it("orders structured prices before offerings and knowledge", () => {
    const knowledge = knowledgeItem({ evidenceId: "knowledge-passage:a" });
    const offering: RuntimeEvidenceItem = {
      ...priceItem({
        evidenceId: "offering:v1",
        structuredValue: { kind: "offering" },
      }),
      title: "Premium plan",
      provenance: {
        kind: "OFFERING",
        offeringId: "off_1",
        versionId: "offver_1",
      },
    };
    const price = priceItem({
      evidenceId: "offering-price:p1",
      structuredValue: {
        kind: "price",
        amount: "59.00",
        currencyCode: "CAD",
        variantId: null,
      },
    });
    const ordered = [knowledge, offering, price].sort(compareRuntimeEvidence);
    expect(ordered.map((item) => item.evidenceId)).toEqual([
      "offering-price:p1",
      "offering:v1",
      "knowledge-passage:a",
    ]);
  });

  it("detects a narrow base-price mismatch and ignores matching or variant prices", () => {
    const passage = knowledgeItem({ evidenceId: "knowledge-passage:pas" });
    const mismatch = priceItem({
      evidenceId: "offering-price:base",
      structuredValue: {
        kind: "price",
        amount: "59.00",
        currencyCode: "CAD",
        variantId: null,
        offeringName: "Premium plan",
      },
    });
    const matching = priceItem({
      evidenceId: "offering-price:match",
      title: "Other plan — Current price",
      structuredValue: {
        kind: "price",
        amount: "49.00",
        currencyCode: "CAD",
        variantId: null,
        offeringName: "Other plan",
      },
    });
    const variant = priceItem({
      evidenceId: "offering-price:var:p2",
      structuredValue: {
        kind: "price",
        amount: "79.00",
        currencyCode: "CAD",
        variantId: "var_1",
        offeringName: "Premium plan",
      },
    });

    const conflicts = detectDeterministicConflicts([
      passage,
      mismatch,
      matching,
      variant,
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      kind: "STRUCTURED_PRICE_MISMATCH",
      conflictId: "price-conflict:knowledge-passage:pas:offering-price:base",
    });
    expect(
      detectDeterministicConflicts([
        knowledgeItem({
          evidenceId: "knowledge-passage:same",
          safeText: "Premium plan is CAD 59 per month.",
        }),
        mismatch,
      ]),
    ).toEqual([]);
  });

  it("does not treat a short offering name embedded in an unrelated word as explicit", () => {
    const conflicts = detectDeterministicConflicts([
      knowledgeItem({
        evidenceId: "knowledge-passage:improve",
        title: "Process notes — Body",
        safeText: "We improve CAD 10 workflows every quarter.",
      }),
      priceItem({
        evidenceId: "offering-price:pro",
        title: "Pro — Current price",
        structuredValue: {
          kind: "price",
          amount: "20.00",
          currencyCode: "CAD",
          variantId: null,
          offeringName: "Pro",
        },
      }),
    ]);
    expect(conflicts).toEqual([]);
  });

  it("does not treat unrelated currency symbols or foreign codes as relevant", () => {
    const cadPrice = priceItem({
      evidenceId: "offering-price:cad",
      structuredValue: {
        kind: "price",
        amount: "59.00",
        currencyCode: "CAD",
        variantId: null,
        offeringName: "Premium plan",
      },
    });
    const eurPrice = priceItem({
      evidenceId: "offering-price:eur",
      structuredValue: {
        kind: "price",
        amount: "59.00",
        currencyCode: "EUR",
        variantId: null,
        offeringName: "Premium plan",
      },
    });
    expect(
      detectDeterministicConflicts([
        knowledgeItem({
          evidenceId: "knowledge-passage:euro",
          safeText: "Premium plan is €49 per month.",
        }),
        cadPrice,
      ]),
    ).toEqual([]);
    expect(
      detectDeterministicConflicts([
        knowledgeItem({
          evidenceId: "knowledge-passage:pound",
          safeText: "Premium plan is £49 per month.",
        }),
        cadPrice,
      ]),
    ).toEqual([]);
    expect(
      detectDeterministicConflicts([
        knowledgeItem({
          evidenceId: "knowledge-passage:dollar",
          safeText: "Premium plan is $49 per month.",
        }),
        cadPrice,
      ]),
    ).toEqual([]);
    expect(
      detectDeterministicConflicts([
        knowledgeItem({
          evidenceId: "knowledge-passage:gbp-code",
          safeText: "Premium plan is GBP 49 per month.",
        }),
        eurPrice,
      ]),
    ).toEqual([]);
  });

  it("still detects a mismatch when the passage names the offering and uses a compatible marker", () => {
    const cadPrice = priceItem({
      evidenceId: "offering-price:base",
      structuredValue: {
        kind: "price",
        amount: "59.00",
        currencyCode: "CAD",
        variantId: null,
        offeringName: "Premium plan",
      },
    });
    expect(
      detectDeterministicConflicts([
        knowledgeItem({
          evidenceId: "knowledge-passage:cad",
          safeText: "The Premium plan is CAD 49 per month.",
        }),
        cadPrice,
      ]),
    ).toHaveLength(1);
    expect(
      detectDeterministicConflicts([
        knowledgeItem({
          evidenceId: "knowledge-passage:csign",
          safeText: "Premium plan costs C$49 each month.",
        }),
        cadPrice,
      ]),
    ).toHaveLength(1);
    expect(
      detectDeterministicConflicts([
        knowledgeItem({
          evidenceId: "knowledge-passage:eur",
          safeText: "Premium plan is €40 per month.",
        }),
        priceItem({
          evidenceId: "offering-price:eur-base",
          structuredValue: {
            kind: "price",
            amount: "59.00",
            currencyCode: "EUR",
            variantId: null,
            offeringName: "Premium plan",
          },
        }),
      ]),
    ).toHaveLength(1);
  });

  it.each([
    {
      title: "CAD does not match C$ inside ABC$49",
      currencyCode: "CAD",
      safeText: "Premium plan uses SKU ABC$49.",
    },
    {
      title: "CAD does not match CA$ inside ABCA$49",
      currencyCode: "CAD",
      safeText: "Premium plan uses SKU ABCA$49.",
    },
    {
      title: "CAD does not match a suffix inside ABCAU$49",
      currencyCode: "CAD",
      safeText: "Premium plan uses SKU ABCAU$49.",
    },
    {
      title: "USD does not match US$ inside BUS$49",
      currencyCode: "USD",
      safeText: "Premium plan uses SKU BUS$49.",
    },
    {
      title: "AUD does not match AU$ inside ABCAU$49",
      currencyCode: "AUD",
      safeText: "Premium plan uses SKU ABCAU$49.",
    },
    {
      title: "AUD does not match A$ inside ABCA$49",
      currencyCode: "AUD",
      safeText: "Premium plan uses SKU ABCA$49.",
    },
    {
      title: "CAD does not match C$ after an underscore token",
      currencyCode: "CAD",
      safeText: "Premium plan uses SKU _C$49.",
    },
    {
      title: "CAD still treats a bare dollar as ambiguous",
      currencyCode: "CAD",
      safeText: "Premium plan costs $49 each month.",
    },
    {
      title: "USD still ignores a foreign euro marker",
      currencyCode: "USD",
      safeText: "Premium plan is €49 per month.",
    },
  ])("$title", ({ currencyCode, safeText }) => {
    expect(
      detectDeterministicConflicts([
        knowledgeItem({
          evidenceId: `knowledge-passage:${currencyCode}-embedded`,
          safeText,
        }),
        priceItem({
          evidenceId: `offering-price:${currencyCode}-embedded`,
          structuredValue: {
            kind: "price",
            amount: "59.00",
            currencyCode,
            variantId: null,
            offeringName: "Premium plan",
          },
        }),
      ]),
    ).toEqual([]);
  });

  it.each([
    {
      title: "standalone C$49 proves CAD",
      currencyCode: "CAD",
      safeText: "Premium plan costs C$49 each month.",
    },
    {
      title: "standalone CA$49 proves CAD",
      currencyCode: "CAD",
      safeText: "Premium plan costs CA$49 each month.",
    },
    {
      title: "standalone US$49 proves USD",
      currencyCode: "USD",
      safeText: "Premium plan costs US$49 each month.",
    },
    {
      title: "standalone A$49 proves AUD",
      currencyCode: "AUD",
      safeText: "Premium plan costs A$49 each month.",
    },
    {
      title: "standalone AU$49 proves AUD",
      currencyCode: "AUD",
      safeText: "Premium plan costs AU$49 each month.",
    },
    {
      title: "standalone NZ$49 proves NZD",
      currencyCode: "NZD",
      safeText: "Premium plan costs NZ$49 each month.",
    },
    {
      title: "amount before C$ proves CAD",
      currencyCode: "CAD",
      safeText: "Premium plan costs 49 C$ each month.",
    },
    {
      title: "amount before CA$ proves CAD",
      currencyCode: "CAD",
      safeText: "Premium plan costs 49 CA$ each month.",
    },
    {
      title: "amount before US$ proves USD",
      currencyCode: "USD",
      safeText: "Premium plan costs 49 US$ each month.",
    },
    {
      title: "amount before A$ proves AUD",
      currencyCode: "AUD",
      safeText: "Premium plan costs 49 A$ each month.",
    },
    {
      title: "amount before AU$ proves AUD",
      currencyCode: "AUD",
      safeText: "Premium plan costs 49 AU$ each month.",
    },
    {
      title: "amount before NZ$ proves NZD",
      currencyCode: "NZD",
      safeText: "Premium plan costs 49 NZ$ each month.",
    },
    {
      title: "parenthesized C$49 still proves CAD",
      currencyCode: "CAD",
      safeText: "Premium plan costs (C$49) each month.",
    },
    {
      title: "amount adjacent to euro still proves EUR",
      currencyCode: "EUR",
      safeText: "Premium plan costs 49€ each month.",
    },
  ])("$title", ({ currencyCode, safeText }) => {
    expect(
      detectDeterministicConflicts([
        knowledgeItem({
          evidenceId: `knowledge-passage:${currencyCode}-standalone`,
          safeText,
        }),
        priceItem({
          evidenceId: `offering-price:${currencyCode}-standalone`,
          structuredValue: {
            kind: "price",
            amount: "59.00",
            currencyCode,
            variantId: null,
            offeringName: "Premium plan",
          },
        }),
      ]),
    ).toHaveLength(1);
  });

  it("cannot hide a genuine conflict behind higher-priority structured children", () => {
    const passage = knowledgeItem({ evidenceId: "knowledge-passage:pas" });
    const price = priceItem({
      evidenceId: "offering-price:base",
      structuredValue: {
        kind: "price",
        amount: "59.00",
        currencyCode: "CAD",
        variantId: null,
        offeringName: "Premium plan",
      },
    });
    const fillers = Array.from({ length: 8 }, (_, index) =>
      featureItem(
        `offering-feature:${String(index).padStart(2, "0")}`,
        `Premium plan — Extra ${index}`,
      ),
    );
    const selected = selectConflictAwareEvidence(
      [passage, price, ...fillers],
      5,
    );
    expect(selected.items).toHaveLength(5);
    expect(selected.conflicts).toHaveLength(1);
    expect(selected.items.map((item) => item.evidenceId)).toEqual(
      expect.arrayContaining([passage.evidenceId, price.evidenceId]),
    );
    expect(selected.conflicts[0]?.evidenceIds).toEqual(
      [passage.evidenceId, price.evidenceId].sort(),
    );
  });

  it("keeps conflict-safe selection deterministic, bounded, and pair-complete", () => {
    const passage = knowledgeItem({ evidenceId: "knowledge-passage:pas" });
    const price = priceItem({
      evidenceId: "offering-price:base",
      structuredValue: {
        kind: "price",
        amount: "59.00",
        currencyCode: "CAD",
        variantId: null,
        offeringName: "Premium plan",
      },
    });
    const fillers = Array.from({ length: 6 }, (_, index) =>
      featureItem(
        `offering-feature:${String(index).padStart(2, "0")}`,
        `Premium plan — Extra ${index}`,
      ),
    );
    const candidates = [passage, price, ...fillers];
    const limited = selectConflictAwareEvidence(candidates, 4);
    expect(limited.items).toHaveLength(4);
    expect(limited.conflicts).toHaveLength(1);
    for (const conflict of limited.conflicts) {
      expect(limited.items.map((item) => item.evidenceId)).toEqual(
        expect.arrayContaining([...conflict.evidenceIds]),
      );
    }
    expect(selectConflictAwareEvidence(candidates, 4).items).toEqual(
      limited.items,
    );

    const tooSmall = selectConflictAwareEvidence(candidates, 1);
    expect(tooSmall.items).toHaveLength(1);
    expect(tooSmall.conflicts).toEqual([]);
    expect(tooSmall.items[0]?.evidenceId).toBe(price.evidenceId);
  });
});
