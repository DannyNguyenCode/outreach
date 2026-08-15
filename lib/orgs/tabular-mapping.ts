import "server-only";

import { isValidLocalDateString } from "@/lib/orgs/config-3b-validation";
import {
  KNOWLEDGE_PASSAGE_BODY_MAX,
  KNOWLEDGE_SECTION_TITLE_MAX,
  KNOWLEDGE_TITLE_MAX,
} from "@/lib/orgs/knowledge-validation";
import {
  currencyCodeSchema,
  moneyAmountSchema,
  moneyToCanonicalString,
} from "@/lib/orgs/money";
import {
  OFFERING_BILLING_FREQUENCIES,
  OFFERING_DESCRIPTION_MAX,
  OFFERING_NAME_MAX,
  OFFERING_PRICING_MODELS,
  OFFERING_TYPES,
  type OfferingBillingFrequencyValue,
  type OfferingPricingModelValue,
} from "@/lib/orgs/offering-validation";
import { normalizeHeaderName } from "@/lib/orgs/tabular-helpers";
import {
  TABULAR_MAX_COLUMNS,
  TABULAR_PREVIEW_ROWS,
  type TabularHeader,
  type TabularIssue,
  type TabularNormalizedPreview,
  type TabularPreviewRow,
} from "@/lib/orgs/tabular-types";

export const CSV_MAPPING_TARGET_FAMILIES = ["knowledge", "offering"] as const;
export type CsvMappingTargetFamily =
  (typeof CSV_MAPPING_TARGET_FAMILIES)[number];

export const CSV_MAPPING_IGNORED_TARGET = "ignored" as const;
export type CsvMappingIgnoredTarget = typeof CSV_MAPPING_IGNORED_TARGET;

export const KNOWLEDGE_MAPPING_TARGET_IDS = [
  "knowledge.title",
  "knowledge.sectionTitle",
  "knowledge.passageBody",
  "knowledge.effectiveFrom",
  "knowledge.effectiveUntil",
] as const;

export const OFFERING_MAPPING_TARGET_IDS = [
  "offering.name",
  "offering.description",
  "offering.offeringType",
  "offering.pricingModel",
  "offering.quoteRequired",
  "offering.effectiveFrom",
  "offering.effectiveUntil",
  "offering.priceAmount",
  "offering.priceCurrency",
  "offering.billingFrequency",
] as const;

export const CSV_MAPPING_TARGET_IDS = [
  ...KNOWLEDGE_MAPPING_TARGET_IDS,
  ...OFFERING_MAPPING_TARGET_IDS,
] as const;

export type KnowledgeMappingTargetId =
  (typeof KNOWLEDGE_MAPPING_TARGET_IDS)[number];
export type OfferingMappingTargetId =
  (typeof OFFERING_MAPPING_TARGET_IDS)[number];
export type CsvMappingTargetFieldId = (typeof CSV_MAPPING_TARGET_IDS)[number];
export type CsvMappingColumnTarget =
  CsvMappingTargetFieldId | CsvMappingIgnoredTarget;

export type CsvMappingFieldDataType =
  | "text"
  | "boolean"
  | "date"
  | "enum"
  | "decimal"
  | "currency"
  | "billing_frequency";

export type CsvMappingTargetFieldDefinition = {
  id: CsvMappingTargetFieldId;
  family: CsvMappingTargetFamily;
  label: string;
  required: boolean;
  dataType: CsvMappingFieldDataType;
  acceptedValues?: readonly string[];
  maxLength?: number;
};

export type CsvColumnMapping = {
  sourceColumn: number;
  target: CsvMappingColumnTarget;
};

export type CsvMappingInput = {
  family: CsvMappingTargetFamily;
  columns: readonly CsvColumnMapping[];
};

export type CsvMappingErrorCode =
  | "unsupported_kind"
  | "parser_not_ready"
  | "unknown_source_column"
  | "unmapped_source_column"
  | "duplicate_source_column"
  | "duplicate_target"
  | "unknown_target"
  | "missing_required_target"
  | "incompatible_target_family"
  | "invalid_source_column"
  | "invalid_mapping";

export type CsvMappedRowIssueCode =
  | "missing_required_value"
  | "invalid_value"
  | "unknown_enum_value"
  | "invalid_boolean"
  | "invalid_date"
  | "invalid_decimal"
  | "invalid_currency"
  | "invalid_billing_frequency"
  | "text_too_long"
  | "incomplete_price_pair"
  | "invalid_effective_date_order"
  | "incompatible_pricing_model"
  | "quote_required_mismatch";

export type CsvMappedRowIssue = {
  sourceRowNumber: number;
  sourceColumn: number | null;
  targetField: CsvMappingTargetFieldId | null;
  code: CsvMappedRowIssueCode;
};

export type CsvMappedValue =
  | { kind: "text"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "date"; value: string }
  | { kind: "enum"; value: string }
  | { kind: "decimal"; value: string }
  | { kind: "currency"; value: string }
  | { kind: "billing_frequency"; value: OfferingBillingFrequencyValue };

export type CsvMappedPreviewRow = {
  sourceRowNumber: number;
  values: Partial<Record<CsvMappingTargetFieldId, CsvMappedValue>>;
  issues: CsvMappedRowIssue[];
};

export type CsvMappedPreview = {
  family: CsvMappingTargetFamily;
  rows: CsvMappedPreviewRow[];
  skippedBlankRowCount: number;
  hasMoreRows: boolean;
  totalRowCount: number;
  mappedPreviewRowCount: number;
};

export type CsvMappingSuggestion = {
  sourceColumn: number;
  target: CsvMappingTargetFieldId;
  alias: string;
};

const SECURITY_ISSUE_CODES = new Set<TabularIssue["code"]>([
  "cached_formula",
  "external_link",
  "formula",
  "formula_like",
  "hyperlink",
]);

const BOOLEAN_TRUE = new Set(["true", "1", "on", "yes"]);
const BOOLEAN_FALSE = new Set(["false", "0", "off", "no"]);

const PRICE_DEPENDENT_MODELS = new Set<OfferingPricingModelValue>([
  "FIXED_ONE_TIME",
  "RECURRING",
]);
const PRICELESS_MODELS = new Set<OfferingPricingModelValue>([
  "NONE",
  "QUOTE_REQUIRED",
]);
const MULTI_PRICE_MODELS = new Set<OfferingPricingModelValue>([
  "MULTI_OPTION",
  "TIERED",
]);

const ERROR_MESSAGES: Record<CsvMappingErrorCode, string> = {
  unsupported_kind: "Only CSV previews can be mapped.",
  parser_not_ready:
    "The CSV preview is not ready for mapping until parser issues are resolved.",
  unknown_source_column:
    "A mapping refers to a source column that does not exist.",
  unmapped_source_column:
    "Every source column must be mapped to a target or explicitly ignored.",
  duplicate_source_column: "Each source column may be mapped only once.",
  duplicate_target: "Each target field may be assigned only once.",
  unknown_target: "A mapping refers to an unknown target field.",
  missing_required_target: "A required target field is not mapped.",
  incompatible_target_family:
    "A mapped target does not belong to the selected target family.",
  invalid_source_column: "Source columns must be stable one-based integers.",
  invalid_mapping: "The CSV mapping contract is invalid.",
};

export const CSV_MAPPING_TARGET_REGISTRY: readonly CsvMappingTargetFieldDefinition[] =
  [
    {
      id: "knowledge.title",
      family: "knowledge",
      label: "Title",
      required: true,
      dataType: "text",
      maxLength: KNOWLEDGE_TITLE_MAX,
    },
    {
      id: "knowledge.sectionTitle",
      family: "knowledge",
      label: "Section title",
      required: true,
      dataType: "text",
      maxLength: KNOWLEDGE_SECTION_TITLE_MAX,
    },
    {
      id: "knowledge.passageBody",
      family: "knowledge",
      label: "Passage body",
      required: true,
      dataType: "text",
      maxLength: KNOWLEDGE_PASSAGE_BODY_MAX,
    },
    {
      id: "knowledge.effectiveFrom",
      family: "knowledge",
      label: "Effective from",
      required: false,
      dataType: "date",
    },
    {
      id: "knowledge.effectiveUntil",
      family: "knowledge",
      label: "Effective until",
      required: false,
      dataType: "date",
    },
    {
      id: "offering.name",
      family: "offering",
      label: "Name",
      required: true,
      dataType: "text",
      maxLength: OFFERING_NAME_MAX,
    },
    {
      id: "offering.description",
      family: "offering",
      label: "Description",
      required: false,
      dataType: "text",
      maxLength: OFFERING_DESCRIPTION_MAX,
    },
    {
      id: "offering.offeringType",
      family: "offering",
      label: "Offering type",
      required: true,
      dataType: "enum",
      acceptedValues: OFFERING_TYPES,
    },
    {
      id: "offering.pricingModel",
      family: "offering",
      label: "Pricing model",
      required: true,
      dataType: "enum",
      acceptedValues: OFFERING_PRICING_MODELS,
    },
    {
      id: "offering.quoteRequired",
      family: "offering",
      label: "Quote required",
      required: false,
      dataType: "boolean",
    },
    {
      id: "offering.effectiveFrom",
      family: "offering",
      label: "Effective from",
      required: false,
      dataType: "date",
    },
    {
      id: "offering.effectiveUntil",
      family: "offering",
      label: "Effective until",
      required: false,
      dataType: "date",
    },
    {
      id: "offering.priceAmount",
      family: "offering",
      label: "Price amount",
      required: false,
      dataType: "decimal",
    },
    {
      id: "offering.priceCurrency",
      family: "offering",
      label: "Price currency",
      required: false,
      dataType: "currency",
    },
    {
      id: "offering.billingFrequency",
      family: "offering",
      label: "Billing frequency",
      required: false,
      dataType: "billing_frequency",
      acceptedValues: OFFERING_BILLING_FREQUENCIES,
    },
  ];

const REGISTRY_BY_ID = new Map(
  CSV_MAPPING_TARGET_REGISTRY.map((field) => [field.id, field]),
);

const TARGET_ID_SET = new Set<string>(CSV_MAPPING_TARGET_IDS);
const FAMILY_SET = new Set<string>(CSV_MAPPING_TARGET_FAMILIES);

/**
 * Exact normalized header aliases. Suggestions are non-authoritative and are
 * emitted only when a single source column matches a unique alias.
 */
const TARGET_ALIASES: Record<CsvMappingTargetFieldId, readonly string[]> = {
  "knowledge.title": ["title", "knowledge title"],
  "knowledge.sectionTitle": ["section", "section title", "heading"],
  "knowledge.passageBody": ["body", "passage", "passage body", "content"],
  "knowledge.effectiveFrom": ["effective from", "start date"],
  "knowledge.effectiveUntil": ["effective until", "end date", "expiry"],
  "offering.name": ["name", "offering name", "product name"],
  "offering.description": ["description", "details"],
  "offering.offeringType": ["type", "offering type"],
  "offering.pricingModel": ["pricing model", "pricing_model"],
  "offering.quoteRequired": ["quote required", "quote_required"],
  "offering.effectiveFrom": ["effective from", "start date"],
  "offering.effectiveUntil": ["effective until", "end date", "expiry"],
  "offering.priceAmount": ["price", "amount", "price amount"],
  "offering.priceCurrency": ["currency", "currency code", "currency_code"],
  "offering.billingFrequency": [
    "billing frequency",
    "frequency",
    "billing_frequency",
  ],
};

const ALIAS_BY_FAMILY: Record<
  CsvMappingTargetFamily,
  ReadonlyMap<string, CsvMappingTargetFieldId>
> = {
  knowledge: buildAliasMap("knowledge"),
  offering: buildAliasMap("offering"),
};

export class CsvMappingError extends Error {
  constructor(
    readonly code: CsvMappingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CsvMappingError";
  }
}

export function getCsvMappingRegistry(
  family: CsvMappingTargetFamily,
): readonly CsvMappingTargetFieldDefinition[] {
  return CSV_MAPPING_TARGET_REGISTRY.filter((field) => field.family === family);
}

export function suggestCsvColumnMappings(
  preview: TabularNormalizedPreview,
  family: CsvMappingTargetFamily,
): CsvMappingSuggestion[] {
  assertFamily(family);
  assertCsvPreviewReady(preview);

  const aliasMap = ALIAS_BY_FAMILY[family];
  const matches = new Map<
    CsvMappingTargetFieldId,
    { sourceColumn: number; alias: string }[]
  >();

  for (const header of preview.headers) {
    const alias = header.normalizedName;
    const target = aliasMap.get(alias);
    if (!target) continue;
    const current = matches.get(target) ?? [];
    current.push({ sourceColumn: header.sourceColumn, alias });
    matches.set(target, current);
  }

  const suggestions: CsvMappingSuggestion[] = [];
  for (const [target, hits] of matches) {
    if (hits.length !== 1) continue;
    const hit = hits[0];
    if (!hit) continue;
    suggestions.push({
      sourceColumn: hit.sourceColumn,
      target,
      alias: hit.alias,
    });
  }
  return suggestions.sort(
    (a, b) =>
      a.sourceColumn - b.sourceColumn || a.target.localeCompare(b.target),
  );
}

/**
 * Runtime-validates untrusted mapping JSON before any property dereference or
 * semantic assignment. Returns a canonical mapping used by later checks.
 */
export function parseCsvMappingInput(input: unknown): CsvMappingInput {
  if (!isPlainObject(input)) {
    throw mappingError("invalid_mapping");
  }

  if (typeof input.family !== "string") {
    throw mappingError("invalid_mapping");
  }
  if (!FAMILY_SET.has(input.family)) {
    throw mappingError("incompatible_target_family");
  }
  const family = input.family as CsvMappingTargetFamily;

  if (!Array.isArray(input.columns)) {
    throw mappingError("invalid_mapping");
  }
  if (input.columns.length > TABULAR_MAX_COLUMNS) {
    throw mappingError("invalid_mapping");
  }

  const columns: CsvColumnMapping[] = [];
  for (const column of input.columns) {
    if (!isPlainObject(column)) {
      throw mappingError("invalid_mapping");
    }
    if (typeof column.sourceColumn !== "number") {
      throw mappingError("invalid_mapping");
    }
    if (typeof column.target !== "string") {
      throw mappingError("invalid_mapping");
    }
    columns.push({
      sourceColumn: column.sourceColumn,
      target: column.target as CsvMappingColumnTarget,
    });
  }

  return { family, columns };
}

export function mapCsvPreview(
  preview: TabularNormalizedPreview,
  mapping: unknown,
): CsvMappedPreview {
  const parsed = parseCsvMappingInput(mapping);
  const assignments = validateParsedCsvMapping(preview, parsed);
  const columnCount = preview.headers.length;
  const boundedRows = preview.previewRows.slice(0, TABULAR_PREVIEW_ROWS);
  const mapped = mapCsvRows(
    boundedRows,
    columnCount,
    assignments,
    parsed.family,
  );

  return {
    family: parsed.family,
    rows: mapped.rows,
    skippedBlankRowCount: mapped.skippedBlankRowCount,
    hasMoreRows: preview.totalRowCount > boundedRows.length,
    totalRowCount: preview.totalRowCount,
    mappedPreviewRowCount: mapped.rows.length,
  };
}

export function mapCsvRows(
  rows: readonly TabularPreviewRow[],
  columnCount: number,
  assignments: ReadonlyMap<
    number,
    CsvMappingTargetFieldId | CsvMappingIgnoredTarget
  >,
  family: CsvMappingTargetFamily,
): { rows: CsvMappedPreviewRow[]; skippedBlankRowCount: number } {
  let skippedBlankRowCount = 0;
  const mappedRows: CsvMappedPreviewRow[] = [];
  for (const row of rows) {
    if (isCompletelyBlankRow(row, columnCount)) {
      skippedBlankRowCount += 1;
      continue;
    }
    mappedRows.push(mapPreviewRow(row, columnCount, assignments, family));
  }
  return { rows: mappedRows, skippedBlankRowCount };
}

export function validateCsvMapping(
  preview: TabularNormalizedPreview,
  mapping: unknown,
): ReadonlyMap<number, CsvMappingTargetFieldId | CsvMappingIgnoredTarget> {
  return validateParsedCsvMapping(preview, parseCsvMappingInput(mapping));
}

function validateParsedCsvMapping(
  preview: TabularNormalizedPreview,
  mapping: CsvMappingInput,
): ReadonlyMap<number, CsvMappingTargetFieldId | CsvMappingIgnoredTarget> {
  assertCsvPreviewReady(preview);

  const headerByColumn = new Map<number, TabularHeader>();
  for (const header of preview.headers) {
    headerByColumn.set(header.sourceColumn, header);
  }

  if (mapping.columns.length === 0) {
    throw mappingError("missing_required_target");
  }

  const seenSources = new Set<number>();
  const seenTargets = new Set<CsvMappingTargetFieldId>();
  const assignments = new Map<
    number,
    CsvMappingTargetFieldId | CsvMappingIgnoredTarget
  >();

  for (const column of mapping.columns) {
    if (!Number.isInteger(column.sourceColumn) || column.sourceColumn < 1) {
      throw mappingError("invalid_source_column");
    }
    if (!headerByColumn.has(column.sourceColumn)) {
      throw mappingError("unknown_source_column");
    }
    if (seenSources.has(column.sourceColumn)) {
      throw mappingError("duplicate_source_column");
    }
    seenSources.add(column.sourceColumn);

    if (column.target === CSV_MAPPING_IGNORED_TARGET) {
      assignments.set(column.sourceColumn, CSV_MAPPING_IGNORED_TARGET);
      continue;
    }
    if (!TARGET_ID_SET.has(column.target)) {
      throw mappingError("unknown_target");
    }
    const field = REGISTRY_BY_ID.get(column.target);
    if (!field || field.family !== mapping.family) {
      throw mappingError("incompatible_target_family");
    }
    if (seenTargets.has(column.target)) {
      throw mappingError("duplicate_target");
    }
    seenTargets.add(column.target);
    assignments.set(column.sourceColumn, column.target);
  }

  for (const header of preview.headers) {
    if (!seenSources.has(header.sourceColumn)) {
      throw mappingError("unmapped_source_column");
    }
  }

  for (const field of getCsvMappingRegistry(mapping.family)) {
    if (field.required && !seenTargets.has(field.id)) {
      throw mappingError("missing_required_target");
    }
  }

  return assignments;
}

function mapPreviewRow(
  row: TabularPreviewRow,
  columnCount: number,
  assignments: ReadonlyMap<
    number,
    CsvMappingTargetFieldId | CsvMappingIgnoredTarget
  >,
  family: CsvMappingTargetFamily,
): CsvMappedPreviewRow {
  const values: Partial<Record<CsvMappingTargetFieldId, CsvMappedValue>> = {};
  const issues: CsvMappedRowIssue[] = [];
  const parsedByField = new Map<
    CsvMappingTargetFieldId,
    CsvMappedValue | null
  >();
  const columnByField = new Map<CsvMappingTargetFieldId, number>();

  for (const [sourceColumn, target] of assignments) {
    if (target === CSV_MAPPING_IGNORED_TARGET) continue;
    const field = REGISTRY_BY_ID.get(target);
    if (!field) continue;
    columnByField.set(target, sourceColumn);
    const raw = cellAt(row, sourceColumn, columnCount);
    const parsed = parseMappedCell(field, raw);
    if (parsed.status === "empty") {
      parsedByField.set(target, null);
      if (field.required) {
        issues.push(
          rowIssue(
            row.sourceRowNumber,
            sourceColumn,
            target,
            "missing_required_value",
          ),
        );
      }
      continue;
    }
    if (parsed.status === "invalid") {
      parsedByField.set(target, null);
      issues.push(
        rowIssue(row.sourceRowNumber, sourceColumn, target, parsed.code),
      );
      continue;
    }
    parsedByField.set(target, parsed.value);
    values[target] = parsed.value;
  }

  if (family === "offering") {
    applyOfferingCrossFieldRules(
      row.sourceRowNumber,
      parsedByField,
      columnByField,
      values,
      issues,
    );
  } else {
    applyEffectiveDateOrder(
      row.sourceRowNumber,
      "knowledge.effectiveFrom",
      "knowledge.effectiveUntil",
      parsedByField,
      columnByField,
      issues,
    );
  }

  issues.sort(compareRowIssues);
  return {
    sourceRowNumber: row.sourceRowNumber,
    values,
    issues,
  };
}

function applyOfferingCrossFieldRules(
  sourceRowNumber: number,
  parsedByField: ReadonlyMap<CsvMappingTargetFieldId, CsvMappedValue | null>,
  columnByField: ReadonlyMap<CsvMappingTargetFieldId, number>,
  values: Partial<Record<CsvMappingTargetFieldId, CsvMappedValue>>,
  issues: CsvMappedRowIssue[],
): void {
  const pricingModel = enumValue<OfferingPricingModelValue>(
    parsedByField.get("offering.pricingModel"),
  );
  const amountPresent = hasValue(parsedByField.get("offering.priceAmount"));
  const currencyPresent = hasValue(parsedByField.get("offering.priceCurrency"));
  const frequencyPresent = hasValue(
    parsedByField.get("offering.billingFrequency"),
  );
  const anyPricePart = amountPresent || currencyPresent || frequencyPresent;
  const completePrice = amountPresent && currencyPresent && frequencyPresent;

  if (anyPricePart && !completePrice) {
    pushMissingPricePart(
      sourceRowNumber,
      columnByField,
      issues,
      "offering.priceAmount",
      amountPresent,
    );
    pushMissingPricePart(
      sourceRowNumber,
      columnByField,
      issues,
      "offering.priceCurrency",
      currencyPresent,
    );
    pushMissingPricePart(
      sourceRowNumber,
      columnByField,
      issues,
      "offering.billingFrequency",
      frequencyPresent,
    );
  }

  if (pricingModel && PRICELESS_MODELS.has(pricingModel) && anyPricePart) {
    issues.push(
      rowIssue(
        sourceRowNumber,
        columnByField.get("offering.priceAmount") ??
          columnByField.get("offering.pricingModel") ??
          null,
        "offering.priceAmount",
        "incompatible_pricing_model",
      ),
    );
  }

  if (
    pricingModel &&
    PRICE_DEPENDENT_MODELS.has(pricingModel) &&
    !completePrice &&
    !anyPricePart
  ) {
    issues.push(
      rowIssue(
        sourceRowNumber,
        columnByField.get("offering.priceAmount") ??
          columnByField.get("offering.pricingModel") ??
          null,
        "offering.priceAmount",
        "incomplete_price_pair",
      ),
    );
  }

  if (pricingModel && MULTI_PRICE_MODELS.has(pricingModel)) {
    issues.push(
      rowIssue(
        sourceRowNumber,
        columnByField.get("offering.pricingModel") ?? null,
        "offering.pricingModel",
        "incompatible_pricing_model",
      ),
    );
  }

  const frequency = enumValue<OfferingBillingFrequencyValue>(
    parsedByField.get("offering.billingFrequency"),
  );
  if (
    pricingModel === "FIXED_ONE_TIME" &&
    frequency &&
    frequency !== "ONE_TIME"
  ) {
    issues.push(
      rowIssue(
        sourceRowNumber,
        columnByField.get("offering.billingFrequency") ?? null,
        "offering.billingFrequency",
        "incompatible_pricing_model",
      ),
    );
  }
  if (pricingModel === "RECURRING" && frequency === "ONE_TIME") {
    issues.push(
      rowIssue(
        sourceRowNumber,
        columnByField.get("offering.billingFrequency") ?? null,
        "offering.billingFrequency",
        "incompatible_pricing_model",
      ),
    );
  }

  const quoteMapped = columnByField.has("offering.quoteRequired");
  const quoteValue = booleanValue(parsedByField.get("offering.quoteRequired"));
  if (pricingModel === "QUOTE_REQUIRED") {
    if (quoteMapped && quoteValue === false) {
      issues.push(
        rowIssue(
          sourceRowNumber,
          columnByField.get("offering.quoteRequired") ?? null,
          "offering.quoteRequired",
          "quote_required_mismatch",
        ),
      );
    } else if (!quoteMapped || quoteValue === undefined) {
      values["offering.quoteRequired"] = { kind: "boolean", value: true };
    }
  }

  applyEffectiveDateOrder(
    sourceRowNumber,
    "offering.effectiveFrom",
    "offering.effectiveUntil",
    parsedByField,
    columnByField,
    issues,
  );
}

function applyEffectiveDateOrder(
  sourceRowNumber: number,
  fromId: CsvMappingTargetFieldId,
  untilId: CsvMappingTargetFieldId,
  parsedByField: ReadonlyMap<CsvMappingTargetFieldId, CsvMappedValue | null>,
  columnByField: ReadonlyMap<CsvMappingTargetFieldId, number>,
  issues: CsvMappedRowIssue[],
): void {
  const from = dateValue(parsedByField.get(fromId));
  const until = dateValue(parsedByField.get(untilId));
  if (from && until && until <= from) {
    issues.push(
      rowIssue(
        sourceRowNumber,
        columnByField.get(untilId) ?? null,
        untilId,
        "invalid_effective_date_order",
      ),
    );
  }
}

function parseMappedCell(
  field: CsvMappingTargetFieldDefinition,
  raw: string,
):
  | { status: "empty" }
  | { status: "invalid"; code: CsvMappedRowIssueCode }
  | { status: "ok"; value: CsvMappedValue } {
  if (field.dataType === "text") {
    const value =
      field.id === "knowledge.passageBody" ||
      field.id === "offering.description"
        ? raw.trim()
        : collapseWhitespace(raw);
    if (!value) return { status: "empty" };
    if (field.maxLength !== undefined && value.length > field.maxLength) {
      return { status: "invalid", code: "text_too_long" };
    }
    return { status: "ok", value: { kind: "text", value } };
  }

  const trimmed = raw.trim();
  if (!trimmed) return { status: "empty" };

  switch (field.dataType) {
    case "boolean": {
      const token = trimmed.toLocaleLowerCase("en-US");
      if (BOOLEAN_TRUE.has(token)) {
        return { status: "ok", value: { kind: "boolean", value: true } };
      }
      if (BOOLEAN_FALSE.has(token)) {
        return { status: "ok", value: { kind: "boolean", value: false } };
      }
      return { status: "invalid", code: "invalid_boolean" };
    }
    case "date": {
      if (!isValidLocalDateString(trimmed)) {
        return { status: "invalid", code: "invalid_date" };
      }
      return { status: "ok", value: { kind: "date", value: trimmed } };
    }
    case "enum": {
      const match = matchAccepted(trimmed, field.acceptedValues ?? []);
      if (!match) return { status: "invalid", code: "unknown_enum_value" };
      return { status: "ok", value: { kind: "enum", value: match } };
    }
    case "decimal": {
      const parsed = moneyAmountSchema.safeParse(trimmed);
      if (!parsed.success) {
        return { status: "invalid", code: "invalid_decimal" };
      }
      return {
        status: "ok",
        value: { kind: "decimal", value: moneyToCanonicalString(parsed.data) },
      };
    }
    case "currency": {
      const parsed = currencyCodeSchema.safeParse(trimmed);
      if (!parsed.success) {
        return { status: "invalid", code: "invalid_currency" };
      }
      return { status: "ok", value: { kind: "currency", value: parsed.data } };
    }
    case "billing_frequency": {
      const match = matchAccepted(
        trimmed,
        field.acceptedValues ?? OFFERING_BILLING_FREQUENCIES,
      );
      if (!match) {
        return { status: "invalid", code: "invalid_billing_frequency" };
      }
      return {
        status: "ok",
        value: {
          kind: "billing_frequency",
          value: match as OfferingBillingFrequencyValue,
        },
      };
    }
    default:
      return { status: "invalid", code: "invalid_value" };
  }
}

function assertCsvPreviewReady(preview: TabularNormalizedPreview): void {
  if (preview.kind !== "csv") {
    throw mappingError("unsupported_kind");
  }
  if (
    preview.outcome !== "ready" ||
    preview.headers.length === 0 ||
    preview.issues.some(isBlockingParserIssue)
  ) {
    throw mappingError("parser_not_ready");
  }
}

function isBlockingParserIssue(issue: TabularIssue): boolean {
  return issue.severity === "error" || SECURITY_ISSUE_CODES.has(issue.code);
}

function assertFamily(
  family: string,
): asserts family is CsvMappingTargetFamily {
  if (!FAMILY_SET.has(family)) {
    throw mappingError("incompatible_target_family");
  }
}

function mappingError(code: CsvMappingErrorCode): CsvMappingError {
  return new CsvMappingError(code, ERROR_MESSAGES[code]);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildAliasMap(
  family: CsvMappingTargetFamily,
): ReadonlyMap<string, CsvMappingTargetFieldId> {
  const map = new Map<string, CsvMappingTargetFieldId>();
  for (const field of CSV_MAPPING_TARGET_REGISTRY) {
    if (field.family !== family) continue;
    for (const alias of TARGET_ALIASES[field.id]) {
      const normalized = normalizeHeaderName(alias);
      if (map.has(normalized) && map.get(normalized) !== field.id) {
        throw new Error(`Duplicate CSV mapping alias: ${normalized}`);
      }
      map.set(normalized, field.id);
    }
  }
  return map;
}

function cellAt(
  row: TabularPreviewRow,
  sourceColumn: number,
  columnCount: number,
): string {
  if (sourceColumn > columnCount) return "";
  return row.cells[sourceColumn - 1] ?? "";
}

function isCompletelyBlankRow(
  row: TabularPreviewRow,
  columnCount: number,
): boolean {
  for (let column = 1; column <= columnCount; column += 1) {
    if (cellAt(row, column, columnCount).trim() !== "") {
      return false;
    }
  }
  return true;
}

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function matchAccepted(
  raw: string,
  accepted: readonly string[],
): string | null {
  const needle = raw.trim().toLocaleUpperCase("en-US");
  return (
    accepted.find((value) => value.toLocaleUpperCase("en-US") === needle) ??
    null
  );
}

function hasValue(value: CsvMappedValue | null | undefined): boolean {
  return value != null;
}

function enumValue<T extends string>(
  value: CsvMappedValue | null | undefined,
): T | undefined {
  if (value?.kind === "enum" || value?.kind === "billing_frequency") {
    return value.value as T;
  }
  return undefined;
}

function booleanValue(
  value: CsvMappedValue | null | undefined,
): boolean | undefined {
  if (value?.kind === "boolean") return value.value;
  return undefined;
}

function dateValue(
  value: CsvMappedValue | null | undefined,
): string | undefined {
  if (value?.kind === "date") return value.value;
  return undefined;
}

function pushMissingPricePart(
  sourceRowNumber: number,
  columnByField: ReadonlyMap<CsvMappingTargetFieldId, number>,
  issues: CsvMappedRowIssue[],
  field: OfferingMappingTargetId,
  present: boolean,
): void {
  if (present) return;
  issues.push(
    rowIssue(
      sourceRowNumber,
      columnByField.get(field) ?? null,
      field,
      "incomplete_price_pair",
    ),
  );
}

function rowIssue(
  sourceRowNumber: number,
  sourceColumn: number | null,
  targetField: CsvMappingTargetFieldId | null,
  code: CsvMappedRowIssueCode,
): CsvMappedRowIssue {
  return { sourceRowNumber, sourceColumn, targetField, code };
}

function compareRowIssues(a: CsvMappedRowIssue, b: CsvMappedRowIssue): number {
  return (
    a.sourceRowNumber - b.sourceRowNumber ||
    (a.sourceColumn ?? 0) - (b.sourceColumn ?? 0) ||
    (a.targetField ?? "").localeCompare(b.targetField ?? "") ||
    a.code.localeCompare(b.code)
  );
}
