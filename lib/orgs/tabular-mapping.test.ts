/** @vitest-environment node */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  TABULAR_PREVIEW_ROWS,
  type TabularIssue,
  type TabularNormalizedPreview,
} from "@/lib/orgs/tabular-types";
import {
  CsvMappingError,
  CSV_MAPPING_TARGET_REGISTRY,
  getCsvMappingRegistry,
  mapCsvPreview,
  suggestCsvColumnMappings,
  validateCsvMapping,
  type CsvMappingColumnTarget,
  type CsvMappingInput,
  type CsvMappingTargetFamily,
} from "@/lib/orgs/tabular-mapping";
import { validateTabularImport } from "@/lib/orgs/tabular-validation";
import { CSV_MIME, csvBytes } from "@/tests/helpers/tabular-fixtures";

describe("CSV mapping registry", () => {
  it("keeps knowledge and offering targets distinct with Phase 4 labels", () => {
    const knowledge = getCsvMappingRegistry("knowledge");
    const offering = getCsvMappingRegistry("offering");
    expect(knowledge.every((field) => field.family === "knowledge")).toBe(true);
    expect(offering.every((field) => field.family === "offering")).toBe(true);
    expect(knowledge.map((field) => field.id)).toEqual([
      "knowledge.title",
      "knowledge.sectionTitle",
      "knowledge.passageBody",
      "knowledge.effectiveFrom",
      "knowledge.effectiveUntil",
    ]);
    expect(offering.map((field) => field.id)).toContain("offering.name");
    expect(offering.map((field) => field.id)).toContain(
      "offering.offeringType",
    );
    expect(offering.map((field) => field.id)).toContain(
      "offering.pricingModel",
    );
    expect(
      offering.find((field) => field.id === "offering.offeringType")
        ?.acceptedValues,
    ).toEqual([
      "PRODUCT",
      "SERVICE",
      "PLAN",
      "PACKAGE",
      "SUBSCRIPTION",
      "CUSTOM_QUOTE",
    ]);
    expect(
      CSV_MAPPING_TARGET_REGISTRY.some((field) => field.id.startsWith("xlsx")),
    ).toBe(false);
  });
});

describe("CSV mapping parser gate", () => {
  it("rejects XLSX previews without consuming workbook helpers", () => {
    const preview = makePreview({
      headers: ["Name", "Type", "Pricing model"],
      rows: [["Widget", "PRODUCT", "NONE"]],
      kind: "xlsx",
    });
    expect(() => mapCsvPreview(preview, offeringCovering(preview, {}))).toThrow(
      CsvMappingError,
    );
    try {
      mapCsvPreview(preview, offeringCovering(preview, {}));
    } catch (error) {
      expect(error).toMatchObject({ code: "unsupported_kind" });
      expect(String(error)).not.toContain("Widget");
    }
  });

  it.each([
    {
      name: "needs_attention outcome",
      preview: makePreview({
        headers: ["Name"],
        rows: [["Widget"]],
        outcome: "needs_attention",
        issues: [{ code: "blank_header", severity: "error", column: 1 }],
      }),
    },
    {
      name: "formula_like security issue",
      preview: makePreview({
        headers: ["Name", "Type", "Pricing model"],
        rows: [["=cmd", "PRODUCT", "NONE"]],
        issues: [{ code: "formula_like", severity: "warning", column: 1 }],
      }),
    },
    {
      name: "hyperlink security issue",
      preview: makePreview({
        headers: ["Name", "Type", "Pricing model"],
        rows: [["Widget", "PRODUCT", "NONE"]],
        issues: [{ code: "hyperlink", severity: "warning", column: 1 }],
      }),
    },
  ])("fails closed for $name", ({ preview }) => {
    expect(() =>
      validateCsvMapping(preview, covering(preview, "offering", {})),
    ).toThrowError(expect.objectContaining({ code: "parser_not_ready" }));
  });
});

describe("CSV mapping contract", () => {
  it("identifies columns by stable one-based sourceColumn after header rename", () => {
    const preview = makePreview({
      headers: ["Renamed", "Kind", "Model", "Notes"],
      rows: [["Widget", "PRODUCT", "NONE", "ignored"]],
    });
    preview.headers[0] = {
      sourceColumn: 1,
      name: "Renamed",
      normalizedName: "renamed",
    };
    const mapped = mapCsvPreview(
      preview,
      covering(preview, "offering", {
        1: "offering.name",
        2: "offering.offeringType",
        3: "offering.pricingModel",
        4: "ignored",
      }),
    );
    expect(mapped.rows[0]?.values["offering.name"]).toEqual({
      kind: "text",
      value: "Widget",
    });
  });

  it("rejects unknown, missing, duplicate, and cross-family mappings", () => {
    const preview = makePreview({
      headers: ["Title", "Section", "Body", "Extra"],
      rows: [["Policy", "Overview", "Returns", "x"]],
    });

    expect(() =>
      validateCsvMapping(preview, {
        family: "knowledge",
        columns: [
          { sourceColumn: 1, target: "knowledge.title" },
          { sourceColumn: 2, target: "knowledge.sectionTitle" },
          { sourceColumn: 3, target: "knowledge.passageBody" },
          { sourceColumn: 99, target: "ignored" },
        ],
      }),
    ).toThrowError(expect.objectContaining({ code: "unknown_source_column" }));

    expect(() =>
      validateCsvMapping(preview, {
        family: "knowledge",
        columns: [
          { sourceColumn: 1, target: "knowledge.title" },
          { sourceColumn: 2, target: "knowledge.sectionTitle" },
          { sourceColumn: 3, target: "knowledge.passageBody" },
        ],
      }),
    ).toThrowError(expect.objectContaining({ code: "unmapped_source_column" }));

    expect(() =>
      validateCsvMapping(
        preview,
        covering(preview, "knowledge", {
          1: "knowledge.title",
          2: "knowledge.sectionTitle",
          3: "knowledge.passageBody",
          4: "knowledge.title",
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "duplicate_target" }));

    expect(() =>
      validateCsvMapping(preview, {
        family: "knowledge",
        columns: [
          { sourceColumn: 1, target: "knowledge.title" },
          { sourceColumn: 1, target: "ignored" },
          { sourceColumn: 2, target: "knowledge.sectionTitle" },
          { sourceColumn: 3, target: "knowledge.passageBody" },
          { sourceColumn: 4, target: "ignored" },
        ],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "duplicate_source_column" }),
    );

    expect(() =>
      validateCsvMapping(
        preview,
        covering(preview, "knowledge", {
          1: "knowledge.title",
          2: "knowledge.sectionTitle",
          3: "offering.name",
        }),
      ),
    ).toThrowError(
      expect.objectContaining({ code: "incompatible_target_family" }),
    );

    expect(() =>
      validateCsvMapping(
        preview,
        covering(preview, "knowledge", {
          1: "knowledge.title",
          2: "knowledge.sectionTitle",
        }),
      ),
    ).toThrowError(
      expect.objectContaining({ code: "missing_required_target" }),
    );

    expect(() =>
      validateCsvMapping(
        preview,
        covering(preview, "knowledge", {
          1: "knowledge.title",
          2: "knowledge.sectionTitle",
          3: "not-a-target" as CsvMappingColumnTarget,
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "unknown_target" }));
  });

  it("allows multiple explicitly ignored source columns", () => {
    const preview = makePreview({
      headers: ["Title", "Section", "Body", "Skip A", "Skip B"],
      rows: [["Policy", "Overview", "Returns", "a", "b"]],
    });
    const mapping = covering(preview, "knowledge", {
      1: "knowledge.title",
      2: "knowledge.sectionTitle",
      3: "knowledge.passageBody",
      4: "ignored",
      5: "ignored",
    });
    expect(validateCsvMapping(preview, mapping).get(4)).toBe("ignored");
    expect(mapCsvPreview(preview, mapping).rows).toHaveLength(1);
  });
});

describe("CSV mapped preview rows", () => {
  it("skips completely blank rows and preserves original source row numbers", () => {
    const preview = makePreview({
      headers: ["Title", "Section", "Body"],
      rows: [
        ["Policy", "Overview", "Returns"],
        ["", "", ""],
        ["   ", "  ", ""],
        ["Hours", "Support", "9 to 5"],
      ],
      sourceRowNumbers: [2, 3, 5, 8],
    });
    const mapped = mapCsvPreview(
      preview,
      covering(preview, "knowledge", {
        1: "knowledge.title",
        2: "knowledge.sectionTitle",
        3: "knowledge.passageBody",
      }),
    );
    expect(mapped.skippedBlankRowCount).toBe(2);
    expect(mapped.rows.map((row) => row.sourceRowNumber)).toEqual([2, 8]);
    expect(mapped.rows[1]?.values["knowledge.title"]).toEqual({
      kind: "text",
      value: "Hours",
    });
  });

  it("parses required fields, enums, booleans, decimals, currency, frequency, and dates", () => {
    const preview = makePreview({
      headers: [
        "Name",
        "Type",
        "Model",
        "Quote",
        "Amount",
        "Currency",
        "Frequency",
        "From",
        "Until",
        "Notes",
      ],
      rows: [
        [
          "  Premium   plan  ",
          "plan",
          "RECURRING",
          "false",
          "49.5",
          "cad",
          "monthly",
          "2026-01-01",
          "2026-12-31",
          "  Family  plan  ",
        ],
      ],
    });
    const mapped = mapCsvPreview(
      preview,
      covering(preview, "offering", {
        1: "offering.name",
        2: "offering.offeringType",
        3: "offering.pricingModel",
        4: "offering.quoteRequired",
        5: "offering.priceAmount",
        6: "offering.priceCurrency",
        7: "offering.billingFrequency",
        8: "offering.effectiveFrom",
        9: "offering.effectiveUntil",
        10: "offering.description",
      }),
    );
    expect(mapped.rows[0]?.issues).toEqual([]);
    expect(mapped.rows[0]?.values).toEqual({
      "offering.name": { kind: "text", value: "Premium plan" },
      "offering.offeringType": { kind: "enum", value: "PLAN" },
      "offering.pricingModel": { kind: "enum", value: "RECURRING" },
      "offering.quoteRequired": { kind: "boolean", value: false },
      "offering.priceAmount": { kind: "decimal", value: "49.5000" },
      "offering.priceCurrency": { kind: "currency", value: "CAD" },
      "offering.billingFrequency": {
        kind: "billing_frequency",
        value: "MONTHLY",
      },
      "offering.effectiveFrom": { kind: "date", value: "2026-01-01" },
      "offering.effectiveUntil": { kind: "date", value: "2026-12-31" },
      "offering.description": { kind: "text", value: "Family  plan" },
    });
  });

  it.each([
    {
      name: "missing required title",
      row: ["", "Overview", "Body"],
      code: "missing_required_value",
      target: "knowledge.title",
    },
    {
      name: "unknown enum",
      family: "offering" as const,
      headers: ["Name", "Type", "Model"],
      row: ["Widget", "WIDGET", "NONE"],
      targets: {
        1: "offering.name",
        2: "offering.offeringType",
        3: "offering.pricingModel",
      },
      code: "unknown_enum_value",
      target: "offering.offeringType",
    },
    {
      name: "invalid boolean",
      family: "offering" as const,
      headers: ["Name", "Type", "Model", "Quote"],
      row: ["Widget", "PRODUCT", "NONE", "oui"],
      targets: {
        1: "offering.name",
        2: "offering.offeringType",
        3: "offering.pricingModel",
        4: "offering.quoteRequired",
      },
      code: "invalid_boolean",
      target: "offering.quoteRequired",
    },
    {
      name: "invalid date",
      family: "offering" as const,
      headers: ["Name", "Type", "Model", "From"],
      row: ["Widget", "PRODUCT", "NONE", "2026-13-40"],
      targets: {
        1: "offering.name",
        2: "offering.offeringType",
        3: "offering.pricingModel",
        4: "offering.effectiveFrom",
      },
      code: "invalid_date",
      target: "offering.effectiveFrom",
    },
    {
      name: "exponent decimal",
      family: "offering" as const,
      headers: ["Name", "Type", "Model", "Amount", "Currency", "Frequency"],
      row: ["Widget", "PRODUCT", "FIXED_ONE_TIME", "1e2", "USD", "ONE_TIME"],
      targets: {
        1: "offering.name",
        2: "offering.offeringType",
        3: "offering.pricingModel",
        4: "offering.priceAmount",
        5: "offering.priceCurrency",
        6: "offering.billingFrequency",
      },
      code: "invalid_decimal",
      target: "offering.priceAmount",
    },
    {
      name: "unknown currency",
      family: "offering" as const,
      headers: ["Name", "Type", "Model", "Amount", "Currency", "Frequency"],
      row: ["Widget", "PRODUCT", "FIXED_ONE_TIME", "10", "ZZZ", "ONE_TIME"],
      targets: {
        1: "offering.name",
        2: "offering.offeringType",
        3: "offering.pricingModel",
        4: "offering.priceAmount",
        5: "offering.priceCurrency",
        6: "offering.billingFrequency",
      },
      code: "invalid_currency",
      target: "offering.priceCurrency",
    },
    {
      name: "invalid billing frequency",
      family: "offering" as const,
      headers: ["Name", "Type", "Model", "Amount", "Currency", "Frequency"],
      row: ["Widget", "PRODUCT", "FIXED_ONE_TIME", "10", "USD", "BIWEEKLY"],
      targets: {
        1: "offering.name",
        2: "offering.offeringType",
        3: "offering.pricingModel",
        4: "offering.priceAmount",
        5: "offering.priceCurrency",
        6: "offering.billingFrequency",
      },
      code: "invalid_billing_frequency",
      target: "offering.billingFrequency",
    },
    {
      name: "locale date guessing",
      family: "knowledge" as const,
      headers: ["Title", "Section", "Body", "From"],
      row: ["Policy", "Overview", "Body", "15/08/2026"],
      targets: {
        1: "knowledge.title",
        2: "knowledge.sectionTitle",
        3: "knowledge.passageBody",
        4: "knowledge.effectiveFrom",
      },
      code: "invalid_date",
      target: "knowledge.effectiveFrom",
    },
  ])("flags $name without locale guessing", (example) => {
    const family = example.family ?? "knowledge";
    const headers = example.headers ?? ["Title", "Section", "Body"];
    const targets: Partial<Record<number, CsvMappingColumnTarget>> =
      (example.targets as
        Partial<Record<number, CsvMappingColumnTarget>> | undefined) ?? {
        1: "knowledge.title",
        2: "knowledge.sectionTitle",
        3: "knowledge.passageBody",
      };
    const preview = makePreview({ headers, rows: [example.row] });
    const mapped = mapCsvPreview(preview, covering(preview, family, targets));
    expect(
      mapped.rows[0]?.issues.some((issue) => issue.code === example.code),
    ).toBe(true);
    expect(
      mapped.rows[0]?.issues.some(
        (issue) => issue.targetField === example.target,
      ),
    ).toBe(true);
  });

  it("rejects incomplete price/currency pairs and invalid effective-date order", () => {
    const incomplete = makePreview({
      headers: ["Name", "Type", "Model", "Amount", "Currency", "Frequency"],
      rows: [["Widget", "PRODUCT", "FIXED_ONE_TIME", "49", "", "ONE_TIME"]],
    });
    const incompleteMapped = mapCsvPreview(
      incomplete,
      covering(incomplete, "offering", {
        1: "offering.name",
        2: "offering.offeringType",
        3: "offering.pricingModel",
        4: "offering.priceAmount",
        5: "offering.priceCurrency",
        6: "offering.billingFrequency",
      }),
    );
    expect(
      incompleteMapped.rows[0]?.issues.map((issue) => issue.code),
    ).toContain("incomplete_price_pair");

    const order = makePreview({
      headers: ["Title", "Section", "Body", "From", "Until"],
      rows: [["Policy", "Overview", "Body", "2026-12-31", "2026-01-01"]],
    });
    const orderMapped = mapCsvPreview(
      order,
      covering(order, "knowledge", {
        1: "knowledge.title",
        2: "knowledge.sectionTitle",
        3: "knowledge.passageBody",
        4: "knowledge.effectiveFrom",
        5: "knowledge.effectiveUntil",
      }),
    );
    expect(orderMapped.rows[0]?.issues).toEqual([
      {
        sourceRowNumber: 2,
        sourceColumn: 5,
        targetField: "knowledge.effectiveUntil",
        code: "invalid_effective_date_order",
      },
    ]);
  });

  it("applies Phase 4C pricing-model and quote-required rules", () => {
    const quote = makePreview({
      headers: ["Name", "Type", "Model", "Quote", "Amount", "Currency", "Freq"],
      rows: [["Custom", "CUSTOM_QUOTE", "QUOTE_REQUIRED", "false", "", "", ""]],
    });
    const quoteMapped = mapCsvPreview(
      quote,
      covering(quote, "offering", {
        1: "offering.name",
        2: "offering.offeringType",
        3: "offering.pricingModel",
        4: "offering.quoteRequired",
        5: "offering.priceAmount",
        6: "offering.priceCurrency",
        7: "offering.billingFrequency",
      }),
    );
    expect(
      quoteMapped.rows[0]?.issues.some(
        (issue) => issue.code === "quote_required_mismatch",
      ),
    ).toBe(true);

    const noneWithPrice = makePreview({
      headers: ["Name", "Type", "Model", "Amount", "Currency", "Freq"],
      rows: [["Widget", "PRODUCT", "NONE", "10", "USD", "ONE_TIME"]],
    });
    expect(
      mapCsvPreview(
        noneWithPrice,
        covering(noneWithPrice, "offering", {
          1: "offering.name",
          2: "offering.offeringType",
          3: "offering.pricingModel",
          4: "offering.priceAmount",
          5: "offering.priceCurrency",
          6: "offering.billingFrequency",
        }),
      ).rows[0]?.issues.some(
        (issue) => issue.code === "incompatible_pricing_model",
      ),
    ).toBe(true);

    const recurringOnce = makePreview({
      headers: ["Name", "Type", "Model", "Amount", "Currency", "Freq"],
      rows: [["Plan", "PLAN", "RECURRING", "10", "USD", "ONE_TIME"]],
    });
    expect(
      mapCsvPreview(
        recurringOnce,
        covering(recurringOnce, "offering", {
          1: "offering.name",
          2: "offering.offeringType",
          3: "offering.pricingModel",
          4: "offering.priceAmount",
          5: "offering.priceCurrency",
          6: "offering.billingFrequency",
        }),
      ).rows[0]?.issues.some(
        (issue) => issue.code === "incompatible_pricing_model",
      ),
    ).toBe(true);

    const tiered = makePreview({
      headers: ["Name", "Type", "Model"],
      rows: [["Plan", "PLAN", "TIERED"]],
    });
    expect(
      mapCsvPreview(
        tiered,
        covering(tiered, "offering", {
          1: "offering.name",
          2: "offering.offeringType",
          3: "offering.pricingModel",
        }),
      ).rows[0]?.issues.some(
        (issue) => issue.code === "incompatible_pricing_model",
      ),
    ).toBe(true);
  });

  it("reports hasMoreRows without implying the complete file was mapped", () => {
    const rows = Array.from({ length: 3 }, (_, index) => [
      `Title ${index + 1}`,
      "Section",
      "Body",
    ]);
    const preview = makePreview({
      headers: ["Title", "Section", "Body"],
      rows,
      totalRowCount: 80,
    });
    const mapped = mapCsvPreview(
      preview,
      covering(preview, "knowledge", {
        1: "knowledge.title",
        2: "knowledge.sectionTitle",
        3: "knowledge.passageBody",
      }),
    );
    expect(mapped.hasMoreRows).toBe(true);
    expect(mapped.totalRowCount).toBe(80);
    expect(mapped.mappedPreviewRowCount).toBe(3);
    expect(mapped.rows).toHaveLength(3);
  });

  it("caps mapping at the existing preview row bound", () => {
    const rows = Array.from(
      { length: TABULAR_PREVIEW_ROWS + 5 },
      (_, index) => [`Title ${index + 1}`, "Section", "Body"],
    );
    const preview = makePreview({
      headers: ["Title", "Section", "Body"],
      rows,
      totalRowCount: TABULAR_PREVIEW_ROWS + 5,
    });
    const mapped = mapCsvPreview(
      preview,
      covering(preview, "knowledge", {
        1: "knowledge.title",
        2: "knowledge.sectionTitle",
        3: "knowledge.passageBody",
      }),
    );
    expect(mapped.rows).toHaveLength(TABULAR_PREVIEW_ROWS);
    expect(mapped.hasMoreRows).toBe(true);
  });
});

describe("CSV mapping suggestions", () => {
  it("returns unique exact-alias suggestions without applying them", () => {
    const preview = makePreview({
      headers: ["Name", "Type", "Pricing model", "Notes"],
      rows: [["Widget", "PRODUCT", "NONE", "hello"]],
    });
    const suggestions = suggestCsvColumnMappings(preview, "offering");
    expect(suggestions).toEqual([
      { sourceColumn: 1, target: "offering.name", alias: "name" },
      { sourceColumn: 2, target: "offering.offeringType", alias: "type" },
      {
        sourceColumn: 3,
        target: "offering.pricingModel",
        alias: "pricing model",
      },
    ]);
    expect(() =>
      mapCsvPreview(preview, covering(preview, "offering", {})),
    ).toThrowError(
      expect.objectContaining({ code: "missing_required_target" }),
    );
  });

  it("omits suggestions when aliases are duplicate or ambiguous", () => {
    const preview = makePreview({
      headers: ["Price", "Amount", "Currency", "Name", "Type", "Pricing model"],
      rows: [["10", "10", "USD", "Widget", "PRODUCT", "FIXED_ONE_TIME"]],
    });
    const suggestions = suggestCsvColumnMappings(preview, "offering");
    expect(
      suggestions.some((item) => item.target === "offering.priceAmount"),
    ).toBe(false);
    expect(suggestions.some((item) => item.target === "offering.name")).toBe(
      true,
    );
  });

  it("does not guess from similar but inexact header text", () => {
    const preview = makePreview({
      headers: ["Offering", "Kind", "How priced"],
      rows: [["Widget", "PRODUCT", "NONE"]],
    });
    expect(suggestCsvColumnMappings(preview, "offering")).toEqual([]);
  });
});

describe("CSV mapping determinism", () => {
  it("does not mutate inputs and repeats the same preview", () => {
    const preview = makePreview({
      headers: ["Title", "Section", "Body"],
      rows: [["Policy", "Overview", "Returns"]],
    });
    const mapping = covering(preview, "knowledge", {
      1: "knowledge.title",
      2: "knowledge.sectionTitle",
      3: "knowledge.passageBody",
    });
    freezePreview(preview);
    Object.freeze(mapping);
    Object.freeze(mapping.columns);
    const first = mapCsvPreview(preview, mapping);
    const second = mapCsvPreview(preview, mapping);
    expect(second).toEqual(first);
    expect(preview.previewRows[0]?.cells).toEqual([
      "Policy",
      "Overview",
      "Returns",
    ]);
    expect(mapping.columns[0]?.target).toBe("knowledge.title");
  });

  it("maps a validated CSV parser preview without persistence", async () => {
    const parserPreview = await validateTabularImport({
      bytes: csvBytes(
        "Title,Section,Body\nReturn policy,Overview,30 day returns\n",
      ),
      filename: "knowledge.csv",
      declaredMimeType: CSV_MIME,
    });
    expect(parserPreview.outcome).toBe("ready");
    const mapped = mapCsvPreview(
      parserPreview,
      covering(parserPreview, "knowledge", {
        1: "knowledge.title",
        2: "knowledge.sectionTitle",
        3: "knowledge.passageBody",
      }),
    );
    expect(mapped.rows[0]).toEqual({
      sourceRowNumber: 2,
      values: {
        "knowledge.title": { kind: "text", value: "Return policy" },
        "knowledge.sectionTitle": { kind: "text", value: "Overview" },
        "knowledge.passageBody": { kind: "text", value: "30 day returns" },
      },
      issues: [],
    });
  });
});

describe("CSV mapping module boundary", () => {
  it("does not import XLSX helpers", () => {
    const source = readFileSync(
      path.join(process.cwd(), "lib/orgs/tabular-mapping.ts"),
      "utf8",
    );
    expect(source).not.toContain("tabular-xlsx");
    expect(source).not.toContain("tabular-xml");
    expect(source).not.toContain("tabular-zip");
    expect(source).not.toContain("parseXlsxWorkbook");
  });
});

function makePreview(options: {
  headers: string[];
  rows: string[][];
  kind?: TabularNormalizedPreview["kind"];
  outcome?: TabularNormalizedPreview["outcome"];
  totalRowCount?: number;
  issues?: TabularIssue[];
  sourceRowNumbers?: number[];
}): TabularNormalizedPreview {
  return {
    outcome: options.outcome ?? "ready",
    kind: options.kind ?? "csv",
    filename: "preview.csv",
    mimeType: "text/csv",
    byteLength: 32,
    sha256: "a".repeat(64),
    sheets: [{ name: "Sheet1", index: 0, visibility: "visible" }],
    selectedSheet: { name: "Sheet1", index: 0 },
    headers: options.headers.map((name, index) => ({
      sourceColumn: index + 1,
      name,
      normalizedName: name
        .trim()
        .replace(/\s+/g, " ")
        .toLocaleLowerCase("en-US"),
    })),
    previewRows: options.rows.map((cells, index) => ({
      sourceRowNumber: options.sourceRowNumbers?.[index] ?? index + 2,
      cells: [...cells],
    })),
    totalRowCount: options.totalRowCount ?? options.rows.length,
    totalColumnCount: options.headers.length,
    issues: options.issues ?? [],
  };
}

function covering(
  preview: TabularNormalizedPreview,
  family: CsvMappingTargetFamily,
  targets: Partial<Record<number, CsvMappingColumnTarget>>,
): CsvMappingInput {
  return {
    family,
    columns: preview.headers.map((header) => ({
      sourceColumn: header.sourceColumn,
      target: targets[header.sourceColumn] ?? "ignored",
    })),
  };
}

function offeringCovering(
  preview: TabularNormalizedPreview,
  targets: Partial<Record<number, CsvMappingColumnTarget>>,
): CsvMappingInput {
  return covering(preview, "offering", {
    1: "offering.name",
    2: "offering.offeringType",
    3: "offering.pricingModel",
    ...targets,
  });
}

function freezePreview(preview: TabularNormalizedPreview): void {
  Object.freeze(preview);
  Object.freeze(preview.headers);
  Object.freeze(preview.previewRows);
  Object.freeze(preview.issues);
  Object.freeze(preview.sheets);
  for (const header of preview.headers) Object.freeze(header);
  for (const row of preview.previewRows) {
    Object.freeze(row);
    Object.freeze(row.cells);
  }
}
