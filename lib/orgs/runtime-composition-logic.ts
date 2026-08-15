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
 * Detect conflicts on the bounded candidate pool, then select a `limit`-sized
 * result that keeps both cited items whenever CONFLICT is emitted. A limit
 * too small to carry a pair never exceeds `limit` and cannot emit CONFLICT.
 */
export function selectConflictAwareEvidence(
  candidates: RuntimeEvidenceItem[],
  limit: number,
): {
  items: RuntimeEvidenceItem[];
  conflicts: RuntimeEvidenceConflict[];
} {
  const boundedLimit = Math.max(0, limit);
  const ordered = [...candidates].sort(compareRuntimeEvidence);
  const detected = detectDeterministicConflicts(ordered);
  if (detected.length === 0 || boundedLimit < 2) {
    return { items: ordered.slice(0, boundedLimit), conflicts: [] };
  }

  const byId = new Map(ordered.map((item) => [item.evidenceId, item]));
  const selectedIds: string[] = [];
  const selected = new Set<string>();

  const tryAdd = (evidenceId: string): boolean => {
    if (selected.has(evidenceId)) return true;
    if (selected.size >= boundedLimit) return false;
    if (!byId.has(evidenceId)) return false;
    selected.add(evidenceId);
    selectedIds.push(evidenceId);
    return true;
  };

  const emitted: RuntimeEvidenceConflict[] = [];
  for (const conflict of detected) {
    const [firstId, secondId] = conflict.evidenceIds;
    if (!byId.has(firstId) || !byId.has(secondId)) continue;
    const missing = [firstId, secondId].filter((id) => !selected.has(id));
    if (missing.length > boundedLimit - selected.size) continue;
    tryAdd(firstId);
    tryAdd(secondId);
    emitted.push(conflict);
  }

  for (const item of ordered) {
    if (selected.size >= boundedLimit) break;
    tryAdd(item.evidenceId);
  }

  return {
    items: selectedIds
      .map((evidenceId) => byId.get(evidenceId))
      .filter((item): item is RuntimeEvidenceItem => item !== undefined)
      .sort(compareRuntimeEvidence),
    conflicts: emitted,
  };
}

/**
 * Phase 4D exact detector: a current base structured price conflicts with a
 * customer-confirmed passage only when that passage explicitly names the
 * canonical offering and contains an explicit different money amount using a
 * reviewed compatible currency marker. It does not attempt semantic conflict
 * resolution. Ambiguous markers such as `$` never prove currency.
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
    const value = price.structuredValue;
    const offeringName = value.offeringName;
    for (const passage of knowledge) {
      if (!passageExplicitlyNamesOffering(passage.safeText, offeringName)) {
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

type BasePriceStructuredValue = {
  kind: "price";
  amount: string;
  currencyCode: string;
  variantId: null;
  offeringName: string;
};

function isBasePriceEvidence(
  item: RuntimeEvidenceItem,
): item is RuntimeEvidenceItem & {
  structuredValue: BasePriceStructuredValue;
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
    typeof item.structuredValue.currencyCode === "string" &&
    typeof item.structuredValue.offeringName === "string" &&
    item.structuredValue.offeringName.trim() !== ""
  );
}

/**
 * Reviewed compatible markers for structured ISO codes. Bare `$` is never
 * included because it cannot prove USD vs CAD vs AUD.
 */
const REVIEWED_CURRENCY_MARKERS: Readonly<Record<string, readonly string[]>> = {
  CAD: ["CAD", "C$", "CA$"],
  USD: ["USD", "US$"],
  EUR: ["EUR", "€"],
  GBP: ["GBP", "£"],
  AUD: ["AUD", "A$", "AU$"],
  NZD: ["NZD", "NZ$"],
};

function compatibleCurrencyMarkers(currencyCode: string): string[] {
  const code = currencyCode.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return [];
  const reviewed = REVIEWED_CURRENCY_MARKERS[code];
  const markers = reviewed ? [...reviewed] : [code];
  if (!markers.includes(code)) markers.unshift(code);
  return markers;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function markerPattern(marker: string): string {
  const escaped = escapeRegExp(marker);
  const startsWithTokenChar = /^[\p{L}\p{N}_]/u.test(marker);
  const endsWithTokenChar = /[\p{L}\p{N}_]$/u.test(marker);
  return `${startsWithTokenChar ? "(?<![\\p{L}\\p{N}_])" : ""}${escaped}${
    endsWithTokenChar ? "(?![\\p{L}\\p{N}_])" : ""
  }`;
}

function extractMoneyAmounts(text: string, currencyCode: string): string[] {
  const markers = compatibleCurrencyMarkers(currencyCode).sort(
    (left, right) => right.length - left.length,
  );
  if (markers.length === 0) return [];
  const markerAlt = markers.map(markerPattern).join("|");
  const amount = "([0-9]+(?:\\.[0-9]{1,4})?)";
  const pattern = new RegExp(
    `(?:(?:${markerAlt})\\s*${amount})|(?:${amount}\\s*(?:${markerAlt}))`,
    "giu",
  );
  const amounts: string[] = [];
  for (const match of text.matchAll(pattern)) {
    const value = match[1] ?? match[2] ?? "";
    if (value) amounts.push(value);
  }
  return amounts;
}

function passageExplicitlyNamesOffering(
  text: string,
  offeringName: string,
): boolean {
  const name = normalizeWords(offeringName);
  if (!name) return false;
  const phrase = name.split(" ").filter(Boolean).map(escapeRegExp).join("\\s+");
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}_])${phrase}(?![\\p{L}\\p{N}_])`,
    "iu",
  );
  return pattern.test(normalizeWords(text));
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
