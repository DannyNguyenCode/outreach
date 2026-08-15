/** @vitest-environment node */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CSV_MAPPED_FILE_MAX_ISSUES,
  validateMappedCsvFile,
} from "@/lib/orgs/tabular-csv-file";
import {
  mapCsvPreview,
  type CsvMappingInput,
} from "@/lib/orgs/tabular-mapping";
import {
  TABULAR_MAX_BYTES,
  TABULAR_MAX_CELL_CHARS,
  TABULAR_MAX_COLUMNS,
  TABULAR_MAX_ROWS,
  TABULAR_PREVIEW_ROWS,
} from "@/lib/orgs/tabular-types";
import { validateTabularImport } from "@/lib/orgs/tabular-validation";
import {
  CSV_MIME,
  XLSX_MIME,
  csvBytes,
} from "@/tests/helpers/tabular-fixtures";

const KNOWLEDGE_HEADERS = ["Title", "Section", "Body"] as const;
const OFFERING_HEADERS = [
  "Name",
  "Type",
  "Pricing model",
  "Amount",
  "Currency",
  "Frequency",
] as const;

describe("CSV complete-file mapped validation", () => {
  it("returns every mapped row past the 50-row preview in source order", async () => {
    const values = Array.from(
      { length: TABULAR_PREVIEW_ROWS + 10 },
      (_, index) => `item-${index + 1}`,
    );
    const bytes = csvBytes(
      knowledgeCsv(values.map((title) => knowledgeRow(title))),
    );
    const mapping = knowledgeMapping();
    const preview = await validateTabularImport({
      bytes,
      filename: "knowledge.csv",
      declaredMimeType: CSV_MIME,
    });
    const mappedPreview = mapCsvPreview(preview, mapping);
    const complete = validateMappedCsvFile({
      bytes,
      filename: "knowledge.csv",
      declaredMimeType: CSV_MIME,
      mapping,
    });

    expect(preview.previewRows).toHaveLength(TABULAR_PREVIEW_ROWS);
    expect(mappedPreview.rows).toHaveLength(TABULAR_PREVIEW_ROWS);
    expect(mappedPreview.hasMoreRows).toBe(true);
    expect(complete.rows).toHaveLength(TABULAR_PREVIEW_ROWS + 10);
    expect(complete.rows.map((row) => row.sourceRowNumber)).toEqual(
      values.map((_, index) => index + 2),
    );
    expect(complete.rows[0]?.sourceRowNumber).toBe(2);
    expect(complete.rows.at(-1)?.sourceRowNumber).toBe(
      TABULAR_PREVIEW_ROWS + 11,
    );
    expect(
      complete.rows.map((row) => row.values["knowledge.title"]?.value),
    ).toEqual(values);
    expect(JSON.stringify(mappedPreview.rows)).toBe(
      JSON.stringify(complete.rows.slice(0, TABULAR_PREVIEW_ROWS)),
    );
    expect(complete.validRowCount).toBe(TABULAR_PREVIEW_ROWS + 10);
    expect(complete.invalidRowCount).toBe(0);
    expect(complete.skippedBlankRowCount).toBe(0);
    expect(complete.totalRowCount).toBe(TABULAR_PREVIEW_ROWS + 10);
    expect(complete.hasMoreIssues).toBe(false);
  });

  it("detects an invalid mapped value only after preview row 50", async () => {
    const valid = Array.from({ length: TABULAR_PREVIEW_ROWS }, (_, index) =>
      knowledgeRow(`item-${index + 1}`),
    );
    const bytes = csvBytes(
      knowledgeCsv([
        ...valid,
        ["", "Overview", "Missing title after preview"],
        knowledgeRow("after-invalid"),
      ]),
    );
    const mapping = knowledgeMapping();
    const preview = await validateTabularImport({
      bytes,
      filename: "late-invalid.csv",
      declaredMimeType: CSV_MIME,
    });
    const mappedPreview = mapCsvPreview(preview, mapping);
    const complete = validateMappedCsvFile({
      bytes,
      filename: "late-invalid.csv",
      declaredMimeType: CSV_MIME,
      mapping,
    });

    expect(mappedPreview.rows.every((row) => row.issues.length === 0)).toBe(
      true,
    );
    expect(complete.totalRowCount).toBe(TABULAR_PREVIEW_ROWS + 2);
    expect(complete.invalidRowCount).toBe(1);
    expect(complete.validRowCount).toBe(TABULAR_PREVIEW_ROWS + 1);
    expect(complete.issues).toEqual([
      {
        sourceRowNumber: TABULAR_PREVIEW_ROWS + 2,
        sourceColumn: 1,
        targetField: "knowledge.title",
        code: "missing_required_value",
      },
    ]);
    expect(complete.rows.at(-1)?.sourceRowNumber).toBe(
      TABULAR_PREVIEW_ROWS + 3,
    );
  });

  it("fails closed when a formula-like cell appears only after preview row 50", () => {
    const valid = Array.from({ length: TABULAR_PREVIEW_ROWS }, (_, index) =>
      knowledgeRow(`item-${index + 1}`),
    );
    expect(() =>
      validateMappedCsvFile({
        bytes: csvBytes(knowledgeCsv([...valid, ["=cmd", "Overview", "Body"]])),
        filename: "late-formula.csv",
        declaredMimeType: CSV_MIME,
        mapping: knowledgeMapping(),
      }),
    ).toThrowError(
      expect.objectContaining({
        name: "CsvMappingError",
        code: "parser_not_ready",
      }),
    );
  });

  it("preserves first/last source rows and skips internal blank rows", () => {
    const bytes = csvBytes(
      [
        KNOWLEDGE_HEADERS.join(","),
        knowledgeRow("first").join(","),
        ",,",
        knowledgeRow("middle").join(","),
        knowledgeRow("last").join(","),
        ",,",
        "",
      ].join("\n"),
    );
    const complete = validateMappedCsvFile({
      bytes,
      filename: "blanks.csv",
      declaredMimeType: CSV_MIME,
      mapping: knowledgeMapping(),
    });

    expect(complete.rows.map((row) => row.sourceRowNumber)).toEqual([2, 4, 5]);
    expect(complete.rows[0]?.values["knowledge.title"]?.value).toBe("first");
    expect(complete.rows.at(-1)?.values["knowledge.title"]?.value).toBe("last");
    expect(complete.skippedBlankRowCount).toBe(1);
    expect(complete.totalRowCount).toBe(4);
    expect(complete.nonblankRowCount).toBe(3);
  });

  it("treats a CSV whose data rows are entirely blank as empty after trailing-strip", () => {
    const complete = validateMappedCsvFile({
      bytes: csvBytes("Title,Section,Body\n,,\n,,\n"),
      filename: "all-blank.csv",
      declaredMimeType: CSV_MIME,
      mapping: knowledgeMapping(),
    });
    expect(complete.rows).toEqual([]);
    expect(complete.totalRowCount).toBe(0);
    expect(complete.skippedBlankRowCount).toBe(0);
    expect(complete.validRowCount).toBe(0);
    expect(complete.invalidRowCount).toBe(0);
  });

  it("maps knowledge and offering families with existing cross-field semantics", () => {
    const knowledge = validateMappedCsvFile({
      bytes: csvBytes(
        knowledgeCsv([
          ["Return policy", "Overview", "30 day returns"],
          ["Hours", "Support", "9 to 5"],
        ]),
      ),
      filename: "knowledge.csv",
      declaredMimeType: CSV_MIME,
      mapping: knowledgeMapping(),
    });
    expect(knowledge.family).toBe("knowledge");
    expect(knowledge.rows[0]?.values).toEqual({
      "knowledge.title": { kind: "text", value: "Return policy" },
      "knowledge.sectionTitle": { kind: "text", value: "Overview" },
      "knowledge.passageBody": { kind: "text", value: "30 day returns" },
    });

    const offering = validateMappedCsvFile({
      bytes: csvBytes(
        [
          OFFERING_HEADERS.join(","),
          "Widget,PRODUCT,FIXED_ONE_TIME,9.99,USD,ONE_TIME",
          "Quote,SERVICE,QUOTE_REQUIRED,,,",
          "Bad,PRODUCT,FIXED_ONE_TIME,10,,ONE_TIME",
        ].join("\n") + "\n",
      ),
      filename: "offerings.csv",
      declaredMimeType: CSV_MIME,
      mapping: offeringMapping(),
    });
    expect(offering.family).toBe("offering");
    expect(offering.validRowCount).toBe(2);
    expect(offering.invalidRowCount).toBe(1);
    expect(offering.rows[1]?.values["offering.quoteRequired"]).toEqual({
      kind: "boolean",
      value: true,
    });
    expect(
      offering.rows[2]?.issues.some(
        (issue) => issue.code === "incomplete_price_pair",
      ),
    ).toBe(true);
  });

  it("fails malformed bytes, mappings, headers, formulas, and limits through existing static errors", () => {
    expect(() =>
      validateMappedCsvFile({
        bytes: csvBytes(""),
        filename: "empty.csv",
        declaredMimeType: CSV_MIME,
        mapping: knowledgeMapping(),
      }),
    ).toThrowError(
      expect.objectContaining({
        name: "TabularValidationError",
        code: "empty",
      }),
    );

    expect(() =>
      validateMappedCsvFile({
        bytes: csvBytes("Title,Section,Body\nPolicy,Overview,=HYPERLINK\n"),
        filename: "formula.csv",
        declaredMimeType: CSV_MIME,
        mapping: knowledgeMapping(),
      }),
    ).toThrowError(
      expect.objectContaining({
        name: "CsvMappingError",
        code: "parser_not_ready",
      }),
    );

    expect(() =>
      validateMappedCsvFile({
        bytes: csvBytes("Title,Title,Body\nA,B,C\n"),
        filename: "dup-header.csv",
        declaredMimeType: CSV_MIME,
        mapping: knowledgeMapping(),
      }),
    ).toThrowError(
      expect.objectContaining({
        name: "CsvMappingError",
        code: "parser_not_ready",
      }),
    );

    expect(() =>
      validateMappedCsvFile({
        bytes: csvBytes("Title,Section,Body\nPolicy,Overview,Returns\n"),
        filename: "knowledge.csv",
        declaredMimeType: CSV_MIME,
        mapping: null,
      }),
    ).toThrowError(
      expect.objectContaining({
        name: "CsvMappingError",
        code: "invalid_mapping",
      }),
    );

    expect(() =>
      validateMappedCsvFile({
        bytes: csvBytes(`H\n${"x".repeat(TABULAR_MAX_CELL_CHARS + 1)}\n`),
        filename: "cell-over.csv",
        declaredMimeType: CSV_MIME,
        mapping: knowledgeMapping(),
      }),
    ).toThrowError(
      expect.objectContaining({
        name: "TabularValidationError",
        code: "cell_too_long",
      }),
    );

    const tooManyColumns = Array.from(
      { length: TABULAR_MAX_COLUMNS + 1 },
      (_, index) => `C${index}`,
    ).join(",");
    expect(() =>
      validateMappedCsvFile({
        bytes: csvBytes(`${tooManyColumns}\n`),
        filename: "too-many-cols.csv",
        declaredMimeType: CSV_MIME,
        mapping: knowledgeMapping(),
      }),
    ).toThrowError(
      expect.objectContaining({
        name: "TabularValidationError",
        code: "too_many_columns",
      }),
    );

    expect(() =>
      validateMappedCsvFile({
        bytes: new Uint8Array(TABULAR_MAX_BYTES + 1),
        filename: "huge.csv",
        declaredMimeType: CSV_MIME,
        mapping: knowledgeMapping(),
      }),
    ).toThrowError(
      expect.objectContaining({
        name: "TabularValidationError",
        code: "too_large",
      }),
    );

    expect(() =>
      validateMappedCsvFile({
        bytes: csvBytes("Title,Section,Body\nPolicy,Overview,Returns\n"),
        filename: "notes.txt",
        declaredMimeType: "text/plain",
        mapping: knowledgeMapping(),
      }),
    ).toThrowError(
      expect.objectContaining({
        name: "TabularValidationError",
        code: "unsupported_type",
      }),
    );
  });

  it("rejects XLSX before workbook helpers run", () => {
    expect(() =>
      validateMappedCsvFile({
        bytes: csvBytes("Name,Type,Pricing model\nWidget,PRODUCT,NONE\n"),
        filename: "offerings.xlsx",
        declaredMimeType: XLSX_MIME,
        mapping: offeringMapping(),
      }),
    ).toThrowError(
      expect.objectContaining({
        name: "CsvMappingError",
        code: "unsupported_kind",
      }),
    );
  });

  it("accepts the CSV row-limit boundary and rejects one past it", () => {
    const mapping: CsvMappingInput = {
      family: "knowledge",
      columns: [
        { sourceColumn: 1, target: "knowledge.title" },
        { sourceColumn: 2, target: "knowledge.sectionTitle" },
        { sourceColumn: 3, target: "knowledge.passageBody" },
      ],
    };
    const accepted = validateMappedCsvFile({
      bytes: csvBytes(
        `Title,Section,Body\n${"Item,Overview,Body\n".repeat(TABULAR_MAX_ROWS - 1)}`,
      ),
      filename: "max-rows.csv",
      declaredMimeType: CSV_MIME,
      mapping,
    });
    expect(accepted.totalRowCount).toBe(TABULAR_MAX_ROWS - 1);
    expect(accepted.rows).toHaveLength(TABULAR_MAX_ROWS - 1);
    expect(accepted.rows.at(-1)?.sourceRowNumber).toBe(TABULAR_MAX_ROWS);

    expect(() =>
      validateMappedCsvFile({
        bytes: csvBytes(
          `Title,Section,Body\n${"Item,Overview,Body\n".repeat(TABULAR_MAX_ROWS)}`,
        ),
        filename: "over-rows.csv",
        declaredMimeType: CSV_MIME,
        mapping,
      }),
    ).toThrowError(
      expect.objectContaining({
        name: "TabularValidationError",
        code: "too_many_rows",
      }),
    );
  });

  it("caps flattened issues without implying omitted invalid rows were valid", () => {
    const rows = Array.from(
      { length: CSV_MAPPED_FILE_MAX_ISSUES + 5 },
      () => ",Overview,Body",
    );
    const complete = validateMappedCsvFile({
      bytes: csvBytes(`Title,Section,Body\n${rows.join("\n")}\n`),
      filename: "many-invalid.csv",
      declaredMimeType: CSV_MIME,
      mapping: knowledgeMapping(),
    });
    expect(complete.invalidRowCount).toBe(CSV_MAPPED_FILE_MAX_ISSUES + 5);
    expect(complete.validRowCount).toBe(0);
    expect(complete.issueCount).toBe(CSV_MAPPED_FILE_MAX_ISSUES + 5);
    expect(complete.issues).toHaveLength(CSV_MAPPED_FILE_MAX_ISSUES);
    expect(complete.hasMoreIssues).toBe(true);
    expect(complete.rows).toHaveLength(CSV_MAPPED_FILE_MAX_ISSUES + 5);
    expect(complete.rows.every((row) => row.issues.length === 1)).toBe(true);
  });

  it("repeats canonical checksum/mapping identity and does not mutate inputs", () => {
    const csv = knowledgeCsv([knowledgeRow("Policy")]);
    const bytes = csvBytes(csv);
    const original = Uint8Array.from(bytes);
    const mapping = knowledgeMapping();
    Object.freeze(mapping);
    Object.freeze(mapping.columns);

    const first = validateMappedCsvFile({
      bytes,
      filename: "knowledge.csv",
      declaredMimeType: CSV_MIME,
      mapping,
    });
    const second = validateMappedCsvFile({
      bytes,
      filename: "knowledge.csv",
      declaredMimeType: CSV_MIME,
      mapping,
    });

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first.sourceChecksum).toBe(
      createHash("sha256").update(original).digest("hex"),
    );
    expect(first.mappingIdentity).toBe(JSON.stringify(first.mapping));
    expect(first.mapping).toEqual(mapping);
    expect(bytes).toEqual(original);
    expect(mapping.columns[0]?.target).toBe("knowledge.title");
  });

  it("keeps existing 50-row mapped-preview output byte-for-byte unchanged", async () => {
    const bytes = csvBytes(
      knowledgeCsv([["Return policy", "Overview", "30 day returns"]]),
    );
    const preview = await validateTabularImport({
      bytes,
      filename: "knowledge.csv",
      declaredMimeType: CSV_MIME,
    });
    const mapped = mapCsvPreview(preview, knowledgeMapping());
    expect(JSON.stringify(mapped)).toBe(
      JSON.stringify({
        family: "knowledge",
        rows: [
          {
            sourceRowNumber: 2,
            values: {
              "knowledge.title": { kind: "text", value: "Return policy" },
              "knowledge.sectionTitle": { kind: "text", value: "Overview" },
              "knowledge.passageBody": {
                kind: "text",
                value: "30 day returns",
              },
            },
            issues: [],
          },
        ],
        skippedBlankRowCount: 0,
        hasMoreRows: false,
        totalRowCount: 1,
        mappedPreviewRowCount: 1,
      }),
    );
  });

  it("does not import XLSX helpers", () => {
    const source = readFileSync(
      path.join(process.cwd(), "lib/orgs/tabular-csv-file.ts"),
      "utf8",
    );
    const previewSource = readFileSync(
      path.join(process.cwd(), "lib/orgs/tabular-preview.ts"),
      "utf8",
    );
    for (const text of [source, previewSource]) {
      expect(text).not.toContain("tabular-xlsx");
      expect(text).not.toContain("tabular-xml");
      expect(text).not.toContain("tabular-zip");
      expect(text).not.toContain("parseXlsxWorkbook");
    }
  });
});

function knowledgeRow(title: string): [string, string, string] {
  return [title, "Overview", "Body"];
}

function knowledgeCsv(rows: string[][]): string {
  return `${[KNOWLEDGE_HEADERS.join(","), ...rows.map((row) => row.join(","))].join("\n")}\n`;
}

function knowledgeMapping(): CsvMappingInput {
  return {
    family: "knowledge",
    columns: [
      { sourceColumn: 1, target: "knowledge.title" },
      { sourceColumn: 2, target: "knowledge.sectionTitle" },
      { sourceColumn: 3, target: "knowledge.passageBody" },
    ],
  };
}

function offeringMapping(): CsvMappingInput {
  return {
    family: "offering",
    columns: [
      { sourceColumn: 1, target: "offering.name" },
      { sourceColumn: 2, target: "offering.offeringType" },
      { sourceColumn: 3, target: "offering.pricingModel" },
      { sourceColumn: 4, target: "offering.priceAmount" },
      { sourceColumn: 5, target: "offering.priceCurrency" },
      { sourceColumn: 6, target: "offering.billingFrequency" },
    ],
  };
}
