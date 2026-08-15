/** @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CsvMappingError,
  mapCsvPreview,
  parseCsvMappingInput,
  validateCsvMapping,
  type CsvMappingInput,
} from "@/lib/orgs/tabular-mapping";
import type { TabularNormalizedPreview } from "@/lib/orgs/tabular-types";

const SECRET = "SECRET_TOKEN_VALUE_42";
const EVIL_URL = "https://evil.example/steal?token=SECRET_TOKEN_VALUE_42";
const FORMULA = "=cmd|' /C calc'!A0";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("CSV mapping security", () => {
  it("does not echo malicious cell text, formulas, URLs, or secrets in issues", () => {
    const preview = securityPreview({
      headers: ["Title", "Section", "Body", "From"],
      rows: [["Policy", "Overview", "Returns", SECRET]],
    });
    const mapped = mapCsvPreview(preview, {
      family: "knowledge",
      columns: [
        { sourceColumn: 1, target: "knowledge.title" },
        { sourceColumn: 2, target: "knowledge.sectionTitle" },
        { sourceColumn: 3, target: "knowledge.passageBody" },
        { sourceColumn: 4, target: "knowledge.effectiveFrom" },
      ],
    });
    const serialized = JSON.stringify(mapped.rows[0]?.issues ?? []);
    expect(mapped.rows[0]?.issues).toEqual([
      {
        sourceRowNumber: 2,
        sourceColumn: 4,
        targetField: "knowledge.effectiveFrom",
        code: "invalid_date",
      },
    ]);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain(FORMULA);
    expect(serialized).not.toContain(EVIL_URL);
    expect(serialized).not.toContain("https://");
  });

  it("keeps mapped customer values only in explicit preview fields", () => {
    const preview = securityPreview({
      headers: ["Title", "Section", "Body"],
      rows: [["Return policy", "Overview", SECRET]],
    });
    const mapped = mapCsvPreview(preview, knowledgeMapping(preview));
    const issues = JSON.stringify(mapped.rows[0]?.issues ?? []);
    expect(mapped.rows[0]?.values["knowledge.passageBody"]).toEqual({
      kind: "text",
      value: SECRET,
    });
    expect(issues).not.toContain(SECRET);
    expect(mapped).not.toHaveProperty("cells");
    expect(mapped).not.toHaveProperty("rawRows");
  });

  it("rejects XLSX mapping with a static error and no payload leak", () => {
    const preview = securityPreview({
      headers: ["Name", "Type", "Pricing model"],
      rows: [[SECRET, FORMULA, EVIL_URL]],
      kind: "xlsx",
    });
    expect(() => mapCsvPreview(preview, offeringMapping(preview))).toThrow(
      CsvMappingError,
    );
    try {
      mapCsvPreview(preview, offeringMapping(preview));
    } catch (error) {
      expect(error).toMatchObject({
        name: "CsvMappingError",
        code: "unsupported_kind",
      });
      expect(JSON.stringify(error)).not.toContain(SECRET);
      expect(JSON.stringify(error)).not.toContain(FORMULA);
      expect(JSON.stringify(error)).not.toContain(EVIL_URL);
      expect((error as Error).message).toBe("Only CSV previews can be mapped.");
    }
  });

  it("has no database, storage, network, filesystem, or formula side effects", () => {
    const fetchSpy = vi.fn();
    const prismaSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("prisma", { offering: { create: prismaSpy } });

    const preview = securityPreview({
      headers: ["Title", "Section", "Body"],
      rows: [[FORMULA, SECRET, EVIL_URL]],
    });
    const mapped = mapCsvPreview(preview, knowledgeMapping(preview));

    expect(mapped.mappedPreviewRowCount).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(prismaSpy).not.toHaveBeenCalled();
    expect(mapped.rows[0]?.values["knowledge.title"]?.kind).toBe("text");
  });

  it("rejects malformed mappings with static errors and never echoes secrets", () => {
    const fetchSpy = vi.fn();
    const prismaSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("prisma", { offering: { create: prismaSpy } });

    const preview = securityPreview({
      headers: ["Title", "Section", "Body"],
      rows: [["Policy", "Overview", "Returns"]],
    });
    const malformed = [
      JSON.parse("null"),
      JSON.parse(
        `{"family":"knowledge","columns":[{"sourceColumn":1,"target":"${SECRET}"}]}`,
      ),
      JSON.parse(
        `{"family":"knowledge","columns":[{"sourceColumn":1,"target":"${EVIL_URL}"}]}`,
      ),
      JSON.parse(
        `{"family":"knowledge","columns":[{"sourceColumn":1,"target":${JSON.stringify(FORMULA)}}]}`,
      ),
      { family: "knowledge", columns: [null] },
      {
        family: "knowledge",
        columns: [{ sourceColumn: "1", target: SECRET }],
      },
    ];

    for (const mapping of malformed) {
      expectThrownStaticMappingError(() =>
        validateCsvMapping(preview, mapping),
      );
      expectThrownStaticMappingError(() => mapCsvPreview(preview, mapping));
    }

    expectThrownStaticMappingError(() => parseCsvMappingInput(null));
    expectThrownStaticMappingError(() =>
      parseCsvMappingInput({ family: "knowledge", columns: [null] }),
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(prismaSpy).not.toHaveBeenCalled();
  });
});

function securityPreview(options: {
  headers: string[];
  rows: string[][];
  kind?: TabularNormalizedPreview["kind"];
}): TabularNormalizedPreview {
  return {
    outcome: "ready",
    kind: options.kind ?? "csv",
    filename: "preview.csv",
    mimeType: "text/csv",
    byteLength: 32,
    sha256: "b".repeat(64),
    sheets: [{ name: "Sheet1", index: 0, visibility: "visible" }],
    selectedSheet: { name: "Sheet1", index: 0 },
    headers: options.headers.map((name, index) => ({
      sourceColumn: index + 1,
      name,
      normalizedName: name.trim().toLocaleLowerCase("en-US"),
    })),
    previewRows: options.rows.map((cells, index) => ({
      sourceRowNumber: index + 2,
      cells: [...cells],
    })),
    totalRowCount: options.rows.length,
    totalColumnCount: options.headers.length,
    issues: [],
  };
}

function knowledgeMapping(preview: TabularNormalizedPreview): CsvMappingInput {
  return {
    family: "knowledge",
    columns: preview.headers.map((header) => ({
      sourceColumn: header.sourceColumn,
      target:
        header.sourceColumn === 1
          ? "knowledge.title"
          : header.sourceColumn === 2
            ? "knowledge.sectionTitle"
            : header.sourceColumn === 3
              ? "knowledge.passageBody"
              : "ignored",
    })),
  };
}

function offeringMapping(preview: TabularNormalizedPreview): CsvMappingInput {
  return {
    family: "offering",
    columns: preview.headers.map((header) => ({
      sourceColumn: header.sourceColumn,
      target:
        header.sourceColumn === 1
          ? "offering.name"
          : header.sourceColumn === 2
            ? "offering.offeringType"
            : header.sourceColumn === 3
              ? "offering.pricingModel"
              : "ignored",
    })),
  };
}

function expectThrownStaticMappingError(run: () => unknown): void {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(CsvMappingError);
  expect(thrown).not.toBeInstanceOf(TypeError);
  const serialized = `${JSON.stringify(thrown)}\n${String(thrown)}\n${(thrown as Error).message}`;
  expect(serialized).not.toContain(SECRET);
  expect(serialized).not.toContain(EVIL_URL);
  expect(serialized).not.toContain(FORMULA);
  expect(serialized).not.toContain("https://");
}
