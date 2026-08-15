import { describe, expect, it } from "vitest";

import {
  assertRuntimeAdapterRegistryIsExhaustive,
  compareRuntimeEvidence,
  detectDeterministicConflicts,
  RUNTIME_SOURCE_ADAPTERS,
} from "@/lib/orgs/runtime-composition";
import {
  RUNTIME_SOURCE_CLASSES,
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
  it("requires an exhaustive adapter declaration for every source class", () => {
    assertRuntimeAdapterRegistryIsExhaustive();
    expect(Object.keys(RUNTIME_SOURCE_ADAPTERS).sort()).toEqual(
      [...RUNTIME_SOURCE_CLASSES].sort(),
    );
    expect(RUNTIME_SOURCE_ADAPTERS.PROSPECT_EVIDENCE).toBeNull();
    expect(RUNTIME_SOURCE_ADAPTERS.CRM_FACT).toBeNull();
    expect(RUNTIME_SOURCE_ADAPTERS.CALLER_STATEMENT).toBeNull();
    expect(RUNTIME_SOURCE_ADAPTERS.CUSTOMER_CONFIRMED_KNOWLEDGE).not.toBeNull();
    expect(RUNTIME_SOURCE_ADAPTERS.STRUCTURED_OFFERING).not.toBeNull();
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
      },
    });
    const variant = priceItem({
      evidenceId: "offering-price:var:p2",
      structuredValue: {
        kind: "price",
        amount: "79.00",
        currencyCode: "CAD",
        variantId: "var_1",
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
});
