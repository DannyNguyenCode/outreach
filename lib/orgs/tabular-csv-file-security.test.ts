/** @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";

import { validateMappedCsvFile } from "@/lib/orgs/tabular-csv-file";
import { CsvMappingError } from "@/lib/orgs/tabular-mapping";
import { TabularValidationError } from "@/lib/orgs/tabular-validation";
import {
  CSV_MIME,
  XLSX_MIME,
  csvBytes,
} from "@/tests/helpers/tabular-fixtures";

const SECRET = "SECRET_TOKEN_VALUE_42";
const EVIL_URL = "https://evil.example/steal?token=SECRET_TOKEN_VALUE_42";
const FORMULA = "=cmd|' /C calc'!A0";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("CSV complete-file mapping security", () => {
  it("keeps secrets, formulas, and URLs out of thrown errors and row issues", () => {
    const complete = validateMappedCsvFile({
      bytes: csvBytes(
        `Title,Section,Body,From\nPolicy,Overview,${SECRET},not-a-date\n`,
      ),
      filename: "knowledge.csv",
      declaredMimeType: CSV_MIME,
      mapping: {
        family: "knowledge",
        columns: [
          { sourceColumn: 1, target: "knowledge.title" },
          { sourceColumn: 2, target: "knowledge.sectionTitle" },
          { sourceColumn: 3, target: "knowledge.passageBody" },
          { sourceColumn: 4, target: "knowledge.effectiveFrom" },
        ],
      },
    });

    expect(complete.rows[0]?.values["knowledge.passageBody"]).toEqual({
      kind: "text",
      value: SECRET,
    });
    const serialized = `${JSON.stringify(complete.issues)}\n${JSON.stringify(complete.rows[0]?.issues)}`;
    expect(complete.issues).toEqual([
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

  it("rejects payload-bearing malformed mappings with static errors", () => {
    const bytes = csvBytes("Title,Section,Body\nPolicy,Overview,Returns\n");
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
    ];

    for (const mapping of malformed) {
      expectThrownStaticError(() =>
        validateMappedCsvFile({
          bytes,
          filename: "knowledge.csv",
          declaredMimeType: CSV_MIME,
          mapping,
        }),
      );
    }
  });

  it("does not echo XLSX payloads when rejecting workbook files", () => {
    try {
      validateMappedCsvFile({
        bytes: csvBytes(`${SECRET},${EVIL_URL},${FORMULA}\n`),
        filename: "payload.xlsx",
        declaredMimeType: XLSX_MIME,
        mapping: { family: "knowledge", columns: [] },
      });
      expect.unreachable("expected XLSX rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(CsvMappingError);
      const serialized = `${JSON.stringify(error)}\n${String(error)}`;
      expect(serialized).not.toContain(SECRET);
      expect(serialized).not.toContain(EVIL_URL);
      expect(serialized).not.toContain(FORMULA);
      expect((error as CsvMappingError).code).toBe("unsupported_kind");
    }
  });

  it("has no database, storage, network, filesystem, or formula side effects", () => {
    const fetchSpy = vi.fn();
    const prismaSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("prisma", { offering: { create: prismaSpy } });

    expect(() =>
      validateMappedCsvFile({
        bytes: csvBytes(`Title,Section,Body\n${FORMULA},Overview,Returns\n`),
        filename: "formula.csv",
        declaredMimeType: CSV_MIME,
        mapping: {
          family: "knowledge",
          columns: [
            { sourceColumn: 1, target: "knowledge.title" },
            { sourceColumn: 2, target: "knowledge.sectionTitle" },
            { sourceColumn: 3, target: "knowledge.passageBody" },
          ],
        },
      }),
    ).toThrowError(expect.objectContaining({ code: "parser_not_ready" }));

    const complete = validateMappedCsvFile({
      bytes: csvBytes(`Title,Section,Body\nPolicy,Overview,${EVIL_URL}\n`),
      filename: "url.csv",
      declaredMimeType: CSV_MIME,
      mapping: {
        family: "knowledge",
        columns: [
          { sourceColumn: 1, target: "knowledge.title" },
          { sourceColumn: 2, target: "knowledge.sectionTitle" },
          { sourceColumn: 3, target: "knowledge.passageBody" },
        ],
      },
    });

    expect(complete.rows[0]?.values["knowledge.passageBody"]).toEqual({
      kind: "text",
      value: EVIL_URL,
    });
    expect(JSON.stringify(complete.issues)).not.toContain(EVIL_URL);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(prismaSpy).not.toHaveBeenCalled();
  });
});

function expectThrownStaticError(run: () => unknown): void {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(
    thrown instanceof CsvMappingError ||
      thrown instanceof TabularValidationError,
  ).toBe(true);
  expect(thrown).not.toBeInstanceOf(TypeError);
  const serialized = `${JSON.stringify(thrown)}\n${String(thrown)}\n${(thrown as Error).message}`;
  expect(serialized).not.toContain(SECRET);
  expect(serialized).not.toContain(EVIL_URL);
  expect(serialized).not.toContain(FORMULA);
  expect(serialized).not.toContain("https://");
}
