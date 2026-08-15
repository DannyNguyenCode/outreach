/** @vitest-environment node */

import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { DOCUMENT_MAX_BYTES } from "@/lib/orgs/document-types";
import {
  DocumentValidationError,
  validateDocument,
} from "@/lib/orgs/document-validation";
import { offeringDraftContentSchema } from "@/lib/orgs/offering-validation";
import {
  TABULAR_MAX_AGGREGATE_CHARS,
  TABULAR_MAX_BYTES,
  TABULAR_MAX_CELL_CHARS,
  TABULAR_MAX_COLUMNS,
  TABULAR_MAX_PARSE_MS,
  TABULAR_MAX_ROWS,
  TABULAR_MAX_SHEETS,
  TABULAR_PREVIEW_ROWS,
  TabularValidationError,
  validateTabularImport,
} from "@/lib/orgs/tabular-validation";
import {
  CSV_MIME,
  SAMPLE_HEADERS,
  SAMPLE_ROWS,
  XLSX_MIME,
  csvBytes,
  makeXlsx,
  misboundWorkbookContentTypesXml,
  sampleCsv,
  sampleXlsx,
  setZipEncryptionFlag,
} from "@/tests/helpers/tabular-fixtures";

describe("tabular validation", () => {
  it("accepts equivalent UTF-8 CSV and non-macro XLSX previews", async () => {
    const csv = await validateTabularImport({
      bytes: csvBytes(sampleCsv()),
      filename: "../Offerings<>.CSV",
      declaredMimeType: "text/csv; charset=utf-8",
    });
    const xlsx = await validateTabularImport({
      bytes: await sampleXlsx(),
      filename: "offerings.xlsx",
      declaredMimeType: XLSX_MIME,
    });

    expect(csv.outcome).toBe("ready");
    expect(xlsx.outcome).toBe("ready");
    expect(csv.kind).toBe("csv");
    expect(xlsx.kind).toBe("xlsx");
    expect(csv.filename).toBe("Offerings__.csv");
    expect(csv.headers.map((header) => header.name)).toEqual([
      ...SAMPLE_HEADERS,
    ]);
    expect(xlsx.headers).toEqual(csv.headers);
    expect(csv.previewRows).toEqual([
      { sourceRowNumber: 2, cells: [...SAMPLE_ROWS[0]] },
      { sourceRowNumber: 3, cells: [...SAMPLE_ROWS[1]] },
    ]);
    expect(xlsx.previewRows).toEqual(csv.previewRows);
    expect(csv.totalRowCount).toBe(2);
    expect(csv.totalColumnCount).toBe(3);
    expect(csv.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(xlsx.sha256).not.toBe(csv.sha256);
  });

  it("normalizes BOM, CRLF, quoted commas/newlines, escaped quotes, and trailing blanks", async () => {
    const content = `\uFEFFName,Notes\r\n"Widget","He said ""ok"",\r\nstill one cell"\r\nGadget,hello\r\n\r\n`;
    const result = await validateTabularImport({
      bytes: csvBytes(content),
      filename: "quoted.csv",
      declaredMimeType: CSV_MIME,
    });

    expect(result.outcome).toBe("ready");
    expect(result.headers.map((header) => header.name)).toEqual([
      "Name",
      "Notes",
    ]);
    expect(result.previewRows).toEqual([
      {
        sourceRowNumber: 2,
        cells: ["Widget", 'He said "ok",\r\nstill one cell'],
      },
      { sourceRowNumber: 3, cells: ["Gadget", "hello"] },
    ]);
    expect(result.totalRowCount).toBe(2);
  });

  it("trims whitespace and keeps checksums and ordering stable across repeats", async () => {
    const bytes = csvBytes("  Name  , Price \n Widget ,  9.99  \n");
    const first = await validateTabularImport({
      bytes,
      filename: "stable.csv",
      declaredMimeType: CSV_MIME,
    });
    const second = await validateTabularImport({
      bytes,
      filename: "stable.csv",
      declaredMimeType: CSV_MIME,
    });

    expect(first).toEqual(second);
    expect(first.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(first.headers[0]).toEqual({
      sourceColumn: 1,
      name: "Name",
      normalizedName: "name",
    });
    expect(first.previewRows[0]?.cells).toEqual(["Widget", "9.99"]);
    expect(first.sheets.map((sheet) => sheet.name)).toEqual(["Sheet1"]);
  });

  it("rejects extension, MIME, and signature mismatches plus unsupported Excel families", async () => {
    await expect(
      validateTabularImport({
        bytes: csvBytes(sampleCsv()),
        filename: "offers.xlsx",
        declaredMimeType: CSV_MIME,
      }),
    ).rejects.toMatchObject({ code: "type_mismatch" });
    await expect(
      validateTabularImport({
        bytes: csvBytes(sampleCsv()),
        filename: "offers.csv",
        declaredMimeType: XLSX_MIME,
      }),
    ).rejects.toMatchObject({ code: "type_mismatch" });
    await expect(
      validateTabularImport({
        bytes: await sampleXlsx(),
        filename: "offers.csv",
        declaredMimeType: CSV_MIME,
      }),
    ).rejects.toMatchObject({ code: "invalid_signature" });
    await expect(
      validateTabularImport({
        bytes: Uint8Array.of(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1),
        filename: "legacy.xls",
        declaredMimeType: "application/vnd.ms-excel",
      }),
    ).rejects.toMatchObject({ code: "unsupported_type" });
    await expect(
      validateTabularImport({
        bytes: await makeXlsx({
          sheets: [{ name: "Sheet1", rows: [["Name"], ["A"]] }],
          macroEnabled: true,
        }),
        filename: "macro.xlsm",
        declaredMimeType: "application/vnd.ms-excel.sheet.macroEnabled.12",
      }),
    ).rejects.toMatchObject({ code: "unsupported_type" });
    await expect(
      validateTabularImport({
        bytes: csvBytes(sampleCsv()),
        filename: "archive.zip",
        declaredMimeType: "application/zip",
      }),
    ).rejects.toMatchObject({ code: "unsupported_type" });
  });

  it("rejects malformed, invalid encoding, NUL, encrypted, polyglot, and traversal inputs", async () => {
    await expect(
      validateTabularImport({
        bytes: csvBytes('Name,Notes\n"unterminated'),
        filename: "bad.csv",
        declaredMimeType: CSV_MIME,
      }),
    ).rejects.toMatchObject({ code: "malformed" });
    await expect(
      validateTabularImport({
        bytes: Uint8Array.of(0xff, 0xfe, 0xfd),
        filename: "bad.csv",
        declaredMimeType: CSV_MIME,
      }),
    ).rejects.toMatchObject({ code: "invalid_encoding" });
    await expect(
      validateTabularImport({
        bytes: csvBytes("Name\nhello\u0000world"),
        filename: "nul.csv",
        declaredMimeType: CSV_MIME,
      }),
    ).rejects.toMatchObject({ code: "binary_text" });
    await expect(
      validateTabularImport({
        bytes: Uint8Array.of(0x50, 0x4b, 0x03, 0x04, 1, 2, 3),
        filename: "broken.xlsx",
        declaredMimeType: XLSX_MIME,
      }),
    ).rejects.toBeInstanceOf(TabularValidationError);

    const encrypted = setZipEncryptionFlag(await sampleXlsx());
    await expect(
      validateTabularImport({
        bytes: encrypted,
        filename: "secret.xlsx",
        declaredMimeType: XLSX_MIME,
      }),
    ).rejects.toMatchObject({ code: "encrypted" });

    const xlsx = await sampleXlsx();
    const polyglot = new Uint8Array(xlsx.byteLength + 4);
    polyglot.set(xlsx);
    polyglot.set([0x50, 0x4b, 0x03, 0x04], xlsx.byteLength);
    await expect(
      validateTabularImport({
        bytes: polyglot,
        filename: "polyglot.xlsx",
        declaredMimeType: XLSX_MIME,
      }),
    ).rejects.toMatchObject({ code: "polyglot" });

    await expect(
      validateTabularImport({
        bytes: await makeXlsx({
          sheets: [{ name: "Sheet1", rows: [["Name"], ["A"]] }],
          extras: { "xl/worksheets/../../../evil.xml": "<ok/>" },
        }),
        filename: "traverse.xlsx",
        declaredMimeType: XLSX_MIME,
      }),
    ).rejects.toMatchObject({ code: "malformed" });

    await expect(
      validateTabularImport({
        bytes: await makeXlsx({
          sheets: [{ name: "Sheet1", rows: [["Name"], ["A"]] }],
          extras: {
            "xl/media/archive.bin": Uint8Array.of(0x50, 0x4b, 0x03, 0x04),
          },
        }),
        filename: "nested.xlsx",
        declaredMimeType: XLSX_MIME,
      }),
    ).rejects.toMatchObject({ code: "polyglot" });

    await expect(
      validateTabularImport({
        bytes: await makeXlsx({
          sheets: [{ name: "Sheet1", rows: [["Name"], ["A"]] }],
          extras: { "xl/huge.txt": "a".repeat(2 * 1024 * 1024) },
        }),
        filename: "bomb.xlsx",
        declaredMimeType: XLSX_MIME,
      }),
    ).rejects.toMatchObject({ code: "zip_bomb" });
  });

  it("enforces byte, sheet, row, column, cell, aggregate, and processing limits", async () => {
    const exactBytes = new Uint8Array(TABULAR_MAX_BYTES);
    exactBytes.set(csvBytes("Name,Price\nWidget,1\n"));
    exactBytes.fill(0x20, csvBytes("Name,Price\nWidget,1\n").byteLength);
    await expect(
      validateTabularImport({
        bytes: exactBytes,
        filename: "max.csv",
        declaredMimeType: CSV_MIME,
      }),
    ).resolves.toMatchObject({
      outcome: "ready",
      byteLength: TABULAR_MAX_BYTES,
    });
    await expect(
      validateTabularImport({
        bytes: new Uint8Array(TABULAR_MAX_BYTES + 1),
        filename: "over.csv",
        declaredMimeType: CSV_MIME,
      }),
    ).rejects.toMatchObject({ code: "too_large" });

    const maxSheets = await makeXlsx({
      sheets: Array.from({ length: TABULAR_MAX_SHEETS }, (_, index) => ({
        name: `S${index + 1}`,
        state: index === 0 ? "visible" : "hidden",
        rows: index === 0 ? [["Name"], ["A"]] : [["Other"], ["B"]],
      })),
    });
    await expect(
      validateTabularImport({
        bytes: maxSheets,
        filename: "sheets.xlsx",
        declaredMimeType: XLSX_MIME,
      }),
    ).resolves.toMatchObject({ outcome: "needs_attention" });
    await expect(
      validateTabularImport({
        bytes: await makeXlsx({
          sheets: Array.from(
            { length: TABULAR_MAX_SHEETS + 1 },
            (_, index) => ({
              name: `S${index + 1}`,
              rows: [["Name"], ["A"]],
            }),
          ),
        }),
        filename: "too-many-sheets.xlsx",
        declaredMimeType: XLSX_MIME,
      }),
    ).rejects.toMatchObject({ code: "too_many_sheets" });

    const maxRowCsv = `Name\n${"A\n".repeat(TABULAR_MAX_ROWS - 1)}`;
    await expect(
      validateTabularImport({
        bytes: csvBytes(maxRowCsv),
        filename: "rows.csv",
        declaredMimeType: CSV_MIME,
      }),
    ).resolves.toMatchObject({ totalRowCount: TABULAR_MAX_ROWS - 1 });
    await expect(
      validateTabularImport({
        bytes: csvBytes(`Name\n${"A\n".repeat(TABULAR_MAX_ROWS)}`),
        filename: "too-many-rows.csv",
        declaredMimeType: CSV_MIME,
      }),
    ).rejects.toMatchObject({ code: "too_many_rows" });

    const maxCols = Array.from(
      { length: TABULAR_MAX_COLUMNS },
      (_, i) => `C${i}`,
    ).join(",");
    await expect(
      validateTabularImport({
        bytes: csvBytes(`${maxCols}\n${maxCols}\n`),
        filename: "cols.csv",
        declaredMimeType: CSV_MIME,
      }),
    ).resolves.toMatchObject({ totalColumnCount: TABULAR_MAX_COLUMNS });
    await expect(
      validateTabularImport({
        bytes: csvBytes(`${maxCols},extra\n`),
        filename: "too-many-cols.csv",
        declaredMimeType: CSV_MIME,
      }),
    ).rejects.toMatchObject({ code: "too_many_columns" });

    await expect(
      validateTabularImport({
        bytes: csvBytes(`H\n${"x".repeat(TABULAR_MAX_CELL_CHARS)}\n`),
        filename: "cell.csv",
        declaredMimeType: CSV_MIME,
      }),
    ).resolves.toMatchObject({ outcome: "ready" });
    await expect(
      validateTabularImport({
        bytes: csvBytes(`H\n${"x".repeat(TABULAR_MAX_CELL_CHARS + 1)}\n`),
        filename: "cell-over.csv",
        declaredMimeType: CSV_MIME,
      }),
    ).rejects.toMatchObject({ code: "cell_too_long" });

    const aggregateRows = Math.floor(
      (TABULAR_MAX_AGGREGATE_CHARS - 1) / TABULAR_MAX_CELL_CHARS,
    );
    const remainder =
      TABULAR_MAX_AGGREGATE_CHARS - 1 - aggregateRows * TABULAR_MAX_CELL_CHARS;
    const aggregateOk = `H\n${`${"x".repeat(TABULAR_MAX_CELL_CHARS)}\n`.repeat(aggregateRows)}${"x".repeat(remainder)}\n`;
    await expect(
      validateTabularImport({
        bytes: csvBytes(aggregateOk),
        filename: "aggregate.csv",
        declaredMimeType: CSV_MIME,
      }),
    ).resolves.toMatchObject({ outcome: "ready" });
    await expect(
      validateTabularImport({
        bytes: csvBytes(`${aggregateOk}${"x".repeat(1)}\n`),
        filename: "aggregate-over.csv",
        declaredMimeType: CSV_MIME,
      }),
    ).rejects.toMatchObject({ code: "text_too_large" });

    const atLimit = vi.spyOn(performance, "now");
    atLimit.mockReturnValueOnce(0).mockReturnValue(TABULAR_MAX_PARSE_MS);
    await expect(
      validateTabularImport({
        bytes: csvBytes(sampleCsv()),
        filename: "time.csv",
        declaredMimeType: CSV_MIME,
      }),
    ).resolves.toMatchObject({ outcome: "ready" });
    atLimit.mockRestore();

    const overTime = vi.spyOn(performance, "now");
    overTime.mockReturnValueOnce(0).mockReturnValue(TABULAR_MAX_PARSE_MS + 1);
    await expect(
      validateTabularImport({
        bytes: csvBytes(sampleCsv()),
        filename: "timeout.csv",
        declaredMimeType: CSV_MIME,
      }),
    ).rejects.toMatchObject({ code: "timeout" });
    overTime.mockRestore();
  });

  it("does not silently choose ambiguous sheets or duplicate/blank headers", async () => {
    const ambiguous = await validateTabularImport({
      bytes: await makeXlsx({
        sheets: [
          { name: "Prices", rows: [["Name"], ["A"]] },
          { name: "Policies", rows: [["Title"], ["B"]] },
        ],
      }),
      filename: "many.xlsx",
      declaredMimeType: XLSX_MIME,
    });
    expect(ambiguous.outcome).toBe("needs_attention");
    expect(ambiguous.selectedSheet).toBeNull();
    expect(ambiguous.previewRows).toEqual([]);
    expect(
      ambiguous.issues.some((item) => item.code === "ambiguous_sheet"),
    ).toBe(true);

    const hidden = await validateTabularImport({
      bytes: await makeXlsx({
        sheets: [
          { name: "Visible", rows: [["Name"], ["A"]] },
          { name: "Secret", state: "hidden", rows: [["Hidden"], ["B"]] },
          { name: "Buried", state: "veryHidden", rows: [["X"], ["C"]] },
        ],
      }),
      filename: "hidden.xlsx",
      declaredMimeType: XLSX_MIME,
    });
    expect(hidden.selectedSheet).toEqual({ name: "Visible", index: 0 });
    expect(hidden.outcome).toBe("needs_attention");
    expect(hidden.issues.map((item) => item.code)).toEqual(
      expect.arrayContaining(["hidden_sheet"]),
    );

    const headers = await validateTabularImport({
      bytes: csvBytes("Name,,Name\nA,B,C\n"),
      filename: "headers.csv",
      declaredMimeType: CSV_MIME,
    });
    expect(headers.outcome).toBe("needs_attention");
    expect(headers.issues.map((item) => item.code).sort()).toEqual(
      ["blank_header", "duplicate_header"].sort(),
    );
    expect(headers.previewRows[0]?.sourceRowNumber).toBe(2);
  });

  it("flags merged cells, formulas, cached formula values, and hyperlinks without executing them", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await validateTabularImport({
      bytes: await makeXlsx({
        sheets: [
          {
            name: "Sheet1",
            rows: [
              ["Name", "Total"],
              ["Widget", ""],
            ],
            formulas: [
              {
                row: 2,
                column: 2,
                formula: 'HYPERLINK("https://evil.example/steal","2")',
                cached: "2",
              },
            ],
            merges: ["A1:A2"],
            hyperlinks: [{ ref: "A2", url: "https://evil.example/steal" }],
          },
        ],
        extras: { "xl/externalLinks/externalLink1.xml": "<externalLink/>" },
      }),
      filename: "formulas.xlsx",
      declaredMimeType: XLSX_MIME,
    });

    expect(result.outcome).toBe("needs_attention");
    expect(result.previewRows[0]?.cells).toEqual(["Widget", "2"]);
    expect(result.issues.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "cached_formula",
        "merged_cells",
        "hyperlink",
        "external_link",
      ]),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("keeps preview rows bounded and preserves later source row numbers", async () => {
    const rows = Array.from(
      { length: TABULAR_PREVIEW_ROWS + 5 },
      (_, index) => `item-${index + 1}`,
    );
    const result = await validateTabularImport({
      bytes: csvBytes(`Name\n${rows.join("\n")}\n`),
      filename: "preview.csv",
      declaredMimeType: CSV_MIME,
    });
    expect(result.totalRowCount).toBe(TABULAR_PREVIEW_ROWS + 5);
    expect(result.previewRows).toHaveLength(TABULAR_PREVIEW_ROWS);
    expect(result.previewRows[0]?.sourceRowNumber).toBe(2);
    expect(result.previewRows.at(-1)?.sourceRowNumber).toBe(
      TABULAR_PREVIEW_ROWS + 1,
    );
  });

  it("rejects junk after a closing CSV quote and quotes in unquoted fields", async () => {
    await expect(
      validateTabularImport({
        bytes: csvBytes('Name\n"safe"attacker\n'),
        filename: "junk-after-quote.csv",
        declaredMimeType: CSV_MIME,
      }),
    ).rejects.toMatchObject({ code: "malformed" });
    await expect(
      validateTabularImport({
        bytes: csvBytes('Name\n"safe" attacker\n'),
        filename: "space-after-quote.csv",
        declaredMimeType: CSV_MIME,
      }),
    ).rejects.toMatchObject({ code: "malformed" });
    await expect(
      validateTabularImport({
        bytes: csvBytes('Name\nfoo"bar\n'),
        filename: "quote-in-unquoted.csv",
        declaredMimeType: CSV_MIME,
      }),
    ).rejects.toMatchObject({ code: "malformed" });

    const escaped = await validateTabularImport({
      bytes: csvBytes(
        'Name,Notes\n"He said ""ok""","a,b"\n"line\nbreak",done\n',
      ),
      filename: "quoted-controls.csv",
      declaredMimeType: CSV_MIME,
    });
    expect(escaped.outcome).toBe("ready");
    expect(escaped.previewRows).toEqual([
      { sourceRowNumber: 2, cells: ['He said "ok"', "a,b"] },
      { sourceRowNumber: 3, cells: ["line\nbreak", "done"] },
    ]);
  });

  it("flags spreadsheet formula prefixes before whitespace normalization", async () => {
    const csv = await validateTabularImport({
      bytes: csvBytes(
        '+Price,Name\n+1+1,Widget\n-2+3,"\t@SUM"\n"\n=1","\r-3"\n',
      ),
      filename: "formulas.csv",
      declaredMimeType: CSV_MIME,
    });
    expect(csv.outcome).toBe("needs_attention");
    expect(csv.headers[0]?.name).toBe("+Price");
    expect(csv.previewRows.map((row) => row.cells)).toEqual([
      ["+1+1", "Widget"],
      ["-2+3", "@SUM"],
      ["=1", "-3"],
    ]);
    expect(
      csv.issues.filter((item) => item.code === "formula_like"),
    ).toHaveLength(6);
    expect(JSON.stringify(csv.issues)).not.toContain("+1+1");
    expect(JSON.stringify(csv.issues)).not.toContain("-2+3");
    expect(JSON.stringify(csv.issues)).not.toContain("@SUM");

    const xlsx = await validateTabularImport({
      bytes: await makeXlsx({
        sheets: [
          {
            name: "Sheet1",
            rows: [
              ["+Price", "Name"],
              ["+1+1", "Widget"],
              ["-2+3", "\t@SUM"],
              ["\n=1", "\r-3"],
            ],
          },
        ],
      }),
      filename: "formulas.xlsx",
      declaredMimeType: XLSX_MIME,
    });
    expect(xlsx.outcome).toBe("needs_attention");
    expect(xlsx.headers[0]?.name).toBe("+Price");
    expect(xlsx.previewRows.map((row) => row.cells)).toEqual([
      ["+1+1", "Widget"],
      ["-2+3", "@SUM"],
      ["=1", "-3"],
    ]);
    expect(
      xlsx.issues.filter((item) => item.code === "formula_like"),
    ).toHaveLength(6);
    expect(JSON.stringify(xlsx.issues)).not.toContain("+1+1");
    expect(JSON.stringify(xlsx.issues)).not.toContain("@SUM");
  });

  it("ignores commented OOXML markup and rejects duplicate cell coordinates", async () => {
    const commented = await validateTabularImport({
      bytes: await makeXlsx({
        sheets: [
          {
            name: "Sheet1",
            rows: [["Name"], ["Widget"]],
          },
        ],
        extras: {
          "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <!-- <sheet name="Evil" sheetId="99" r:id="rId99"/> -->
    <sheet name="Sheet1" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`,
          "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <!-- <Relationship Id="rId99" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/evil.xml"/> -->
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
          "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetData>
    <row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>Widget</t></is></c></row>
    <!-- <c r="A2" t="inlineStr"><is><t>Attacker</t></is></c> -->
    <!-- <c r="B2"><f>HYPERLINK("https://evil.example/steal","1")</f><v>1</v></c> -->
  </sheetData>
  <!-- <hyperlink ref="A2" r:id="rId9"/> -->
  <!-- <mergeCell ref="A1:B2"/> -->
</worksheet>`,
        },
      }),
      filename: "comments.xlsx",
      declaredMimeType: XLSX_MIME,
    });
    expect(commented.outcome).toBe("ready");
    expect(commented.sheets.map((sheet) => sheet.name)).toEqual(["Sheet1"]);
    expect(commented.previewRows).toEqual([
      { sourceRowNumber: 2, cells: ["Widget"] },
    ]);
    expect(commented.issues.map((item) => item.code)).toEqual([]);

    await expect(
      validateTabularImport({
        bytes: await makeXlsx({
          sheets: [{ name: "Sheet1", rows: [["Name"], ["Widget"]] }],
          extras: {
            "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="inlineStr"><is><t>Name</t></is></c>
      <c r="A1" t="inlineStr"><is><t>Attacker</t></is></c>
    </row>
  </sheetData>
</worksheet>`,
          },
        }),
        filename: "duplicate-cell.xlsx",
        declaredMimeType: XLSX_MIME,
      }),
    ).rejects.toMatchObject({ code: "malformed" });
  });

  it("counts every populated XLSX cell toward the aggregate text limit", async () => {
    await expect(
      validateTabularImport({
        bytes: await makeXlsx({
          sheets: [
            {
              name: "Sheet1",
              rows: columnARows(TABULAR_MAX_AGGREGATE_CHARS - 1),
            },
          ],
        }),
        filename: "xlsx-aggregate.xlsx",
        declaredMimeType: XLSX_MIME,
      }),
    ).resolves.toMatchObject({ outcome: "ready" });
    await expect(
      validateTabularImport({
        bytes: await makeXlsx({
          sheets: [
            {
              name: "Sheet1",
              rows: columnARows(TABULAR_MAX_AGGREGATE_CHARS),
            },
          ],
        }),
        filename: "xlsx-aggregate-over.xlsx",
        declaredMimeType: XLSX_MIME,
      }),
    ).rejects.toMatchObject({ code: "text_too_large" });

    const extraOk = await validateTabularImport({
      bytes: await makeXlsx({
        sheets: [
          {
            name: "Sheet1",
            rows: extraColumnRows(TABULAR_MAX_AGGREGATE_CHARS - 1),
          },
        ],
      }),
      filename: "xlsx-extra-aggregate.xlsx",
      declaredMimeType: XLSX_MIME,
    });
    expect(extraOk.outcome).toBe("needs_attention");
    expect(extraOk.issues.some((item) => item.code === "extra_columns")).toBe(
      true,
    );
    expect(extraOk.previewRows[0]?.cells).toEqual([""]);
    expect(extraOk.previewRows[0]?.cells).toHaveLength(1);

    await expect(
      validateTabularImport({
        bytes: await makeXlsx({
          sheets: [
            {
              name: "Sheet1",
              rows: extraColumnRows(TABULAR_MAX_AGGREGATE_CHARS),
            },
          ],
        }),
        filename: "xlsx-extra-aggregate-over.xlsx",
        declaredMimeType: XLSX_MIME,
      }),
    ).rejects.toMatchObject({ code: "text_too_large" });

    await expect(
      validateTabularImport({
        bytes: await makeXlsx({
          sheets: [
            { name: "Visible", rows: [["Name"], ["A"]] },
            {
              name: "Secret",
              state: "hidden",
              rows: extraColumnRows(TABULAR_MAX_AGGREGATE_CHARS),
            },
          ],
        }),
        filename: "xlsx-hidden-extra-aggregate.xlsx",
        declaredMimeType: XLSX_MIME,
      }),
    ).rejects.toMatchObject({ code: "text_too_large" });
  });

  it("requires the canonical workbook part to carry the XLSX main content type", async () => {
    await expect(
      validateTabularImport({
        bytes: await makeXlsx({
          sheets: [{ name: "Sheet1", rows: [["Name"], ["A"]] }],
          contentTypesXml: misboundWorkbookContentTypesXml(1),
        }),
        filename: "misbound.xlsx",
        declaredMimeType: XLSX_MIME,
      }),
    ).rejects.toMatchObject({ code: "type_mismatch" });
  });

  it("does not change PDF/DOCX/TXT document validation or Phase 4C offering validation", async () => {
    await expect(
      validateDocument({
        bytes: csvBytes(sampleCsv()),
        filename: "offers.csv",
        declaredMimeType: CSV_MIME,
      }),
    ).rejects.toBeInstanceOf(DocumentValidationError);
    await expect(
      validateDocument({
        bytes: await sampleXlsx(),
        filename: "offers.xlsx",
        declaredMimeType: XLSX_MIME,
      }),
    ).rejects.toMatchObject({ code: "unsupported_type" });
    await expect(
      validateDocument({
        bytes: new TextEncoder().encode("Returns are accepted within 30 days."),
        filename: "policy.txt",
        declaredMimeType: "text/plain",
      }),
    ).resolves.toMatchObject({ kind: "txt" });
    await expect(
      validateDocument({
        bytes: new Uint8Array(DOCUMENT_MAX_BYTES + 1),
        filename: "large.txt",
        declaredMimeType: "text/plain",
      }),
    ).rejects.toMatchObject({ code: "too_large" });
    expect(
      offeringDraftContentSchema.safeParse({
        name: "Premium plan",
        offeringType: "PLAN",
        pricingModel: "RECURRING",
        prices: [
          {
            amount: "49.00",
            currencyCode: "CAD",
            billingFrequency: "MONTHLY",
          },
        ],
      }).success,
    ).toBe(true);
  });
});

function columnARows(dataChars: number): string[][] {
  return [["H"], ...chunkedCells(dataChars, (text) => [text])];
}

function extraColumnRows(extraChars: number): string[][] {
  return [["H"], ...chunkedCells(extraChars, (text) => ["", text])];
}

function chunkedCells(
  totalChars: number,
  makeRow: (text: string) => string[],
): string[][] {
  const rows: string[][] = [];
  let remaining = totalChars;
  let row = 0;
  while (remaining > 0) {
    const chunk = Math.min(TABULAR_MAX_CELL_CHARS, remaining);
    rows.push(makeRow(noisyText(row, chunk)));
    remaining -= chunk;
    row += 1;
  }
  return rows;
}

function noisyText(row: number, length: number): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  let state = ((row + 1) * 1_000_003) >>> 0;
  let text = "";
  for (let index = 0; index < length; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    text += alphabet[state % 36];
  }
  return text;
}
