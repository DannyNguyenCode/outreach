import type {
  RuntimeEvidenceConflict,
  RuntimeEvidenceItem,
} from "@/lib/orgs/runtime-evidence";

export function compareRuntimeEvidence(
  left: RuntimeEvidenceItem,
  right: RuntimeEvidenceItem,
): number {
  return (
    left.authority.order - right.authority.order ||
    childKindOrder(left) - childKindOrder(right) ||
    left.title.localeCompare(right.title) ||
    left.evidenceId.localeCompare(right.evidenceId)
  );
}

function childKindOrder(item: RuntimeEvidenceItem): number {
  if (item.provenance.kind === "PRICE") return 0;
  if (item.provenance.kind === "OFFERING") return 1;
  if (item.provenance.kind === "VARIANT") return 2;
  if (item.provenance.kind === "FEATURE") return 3;
  if (item.provenance.kind === "ELIGIBILITY") return 4;
  if (item.provenance.kind === "CUSTOM_VALUE") return 5;
  return 10;
}

/**
 * Phase 4D exact detector: a current base structured price conflicts with a
 * customer-confirmed passage only when that passage names the offering and
 * contains an explicit different money amount. It does not attempt semantic
 * conflict resolution.
 */
export function detectDeterministicConflicts(
  items: RuntimeEvidenceItem[],
): RuntimeEvidenceConflict[] {
  const knowledge = items.filter(
    (item) => item.sourceClass === "CUSTOMER_CONFIRMED_KNOWLEDGE",
  );
  const prices = items.filter(isBasePriceEvidence);
  const conflicts: RuntimeEvidenceConflict[] = [];
  for (const price of prices) {
    const value = price.structuredValue as {
      amount: string;
      currencyCode: string;
    };
    const offeringName = price.title.split(" — ")[0] ?? price.title;
    const normalizedOffering = normalizeWords(offeringName);
    for (const passage of knowledge) {
      if (!normalizeWords(passage.safeText).includes(normalizedOffering)) {
        continue;
      }
      const statedAmounts = extractMoneyAmounts(
        passage.safeText,
        value.currencyCode,
      );
      if (
        statedAmounts.length === 0 ||
        statedAmounts.some((amount) => amountsEqual(amount, value.amount))
      ) {
        continue;
      }
      const evidenceIds = [price.evidenceId, passage.evidenceId].sort() as [
        string,
        string,
      ];
      conflicts.push({
        conflictId: `price-conflict:${evidenceIds.join(":")}`,
        kind: "STRUCTURED_PRICE_MISMATCH",
        message: `${offeringName} has conflicting current price evidence.`,
        evidenceIds,
        sourceClasses: [price.sourceClass, passage.sourceClass],
        provenance: [price.provenance, passage.provenance],
      });
    }
  }
  return conflicts.sort((left, right) =>
    left.conflictId.localeCompare(right.conflictId),
  );
}

function isBasePriceEvidence(
  item: RuntimeEvidenceItem,
): item is RuntimeEvidenceItem & {
  structuredValue: {
    kind: "price";
    amount: string;
    currencyCode: string;
    variantId: null;
  };
} {
  if (
    item.sourceClass !== "STRUCTURED_OFFERING" ||
    item.provenance.kind !== "PRICE" ||
    !item.structuredValue ||
    Array.isArray(item.structuredValue) ||
    typeof item.structuredValue !== "object"
  ) {
    return false;
  }
  return (
    item.structuredValue.kind === "price" &&
    item.structuredValue.variantId === null &&
    typeof item.structuredValue.amount === "string" &&
    typeof item.structuredValue.currencyCode === "string"
  );
}

function extractMoneyAmounts(text: string, currencyCode: string): string[] {
  const escapedCode = currencyCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `(?:${escapedCode}|[$€£])\\s*([0-9]+(?:\\.[0-9]{1,4})?)`,
    "gi",
  );
  return [...text.matchAll(pattern)].map((match) => match[1] ?? "");
}

function amountsEqual(left: string, right: string): boolean {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  return (
    Number.isFinite(leftNumber) &&
    Number.isFinite(rightNumber) &&
    leftNumber === rightNumber
  );
}

function normalizeWords(value: string): string {
  return value.toLocaleLowerCase("en").replace(/\s+/g, " ").trim();
}
