import JSZip from "jszip";

export const CSV_MIME = "text/csv";
export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const SAMPLE_HEADERS = ["Name", "Price", "Notes"] as const;
export const SAMPLE_ROWS = [
  ["Widget", "9.99", "Line 1"],
  ["Gadget", "12.50", "hello"],
] as const;

export function sampleCsv(options?: {
  bom?: boolean;
  newline?: "\n" | "\r\n" | "\r";
  quoted?: boolean;
}): string {
  const newline = options?.newline ?? "\n";
  const header = SAMPLE_HEADERS.join(",");
  const rows = SAMPLE_ROWS.map((row) =>
    options?.quoted
      ? row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")
      : row.join(","),
  );
  const body = [header, ...rows].join(newline);
  return `${options?.bom ? "\uFEFF" : ""}${body}${newline}`;
}

export function csvBytes(content: string): Uint8Array {
  return new TextEncoder().encode(content);
}

export type FixtureSheet = {
  name: string;
  state?: "visible" | "hidden" | "veryHidden";
  rows: string[][];
  formulas?: {
    row: number;
    column: number;
    formula: string;
    cached?: string;
  }[];
  merges?: string[];
  hyperlinks?: { ref: string; url: string }[];
};

export async function makeXlsx(options: {
  sheets: FixtureSheet[];
  extras?: Record<string, string | Uint8Array>;
  macroEnabled?: boolean;
  comment?: string;
  contentTypesXml?: string;
}): Promise<Uint8Array> {
  const zip = new JSZip();
  const sheets = options.sheets;
  const shared: string[] = [];
  const intern = (value: string): number => {
    const existing = shared.indexOf(value);
    if (existing >= 0) {
      return existing;
    }
    shared.push(value);
    return shared.length - 1;
  };

  zip.file(
    "[Content_Types].xml",
    options.contentTypesXml ?? contentTypesXml(sheets, options.macroEnabled),
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
  );
  zip.file("xl/workbook.xml", workbookXml(sheets));
  zip.file("xl/_rels/workbook.xml.rels", workbookRelsXml(sheets));
  for (const [index, sheet] of sheets.entries()) {
    zip.file(`xl/worksheets/sheet${index + 1}.xml`, sheetXml(sheet, intern));
  }
  zip.file("xl/sharedStrings.xml", sharedStringsXml(shared));
  for (const [name, value] of Object.entries(options.extras ?? {})) {
    zip.file(name, value);
  }
  return zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
    comment: options.comment,
  });
}

export async function sampleXlsx(): Promise<Uint8Array> {
  return makeXlsx({
    sheets: [
      {
        name: "Sheet1",
        rows: [[...SAMPLE_HEADERS], ...SAMPLE_ROWS.map((row) => [...row])],
      },
    ],
  });
}

export function misboundWorkbookContentTypesXml(sheetCount: number): string {
  const sheetOverrides = Array.from({ length: sheetCount }, (_, index) => {
    const part = `/xl/worksheets/sheet${index + 1}.xml`;
    const type =
      index === 0
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml";
    return `<Override PartName="${part}" ContentType="${type}"/>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/xml"/>
  ${sheetOverrides}
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`;
}

function contentTypesXml(
  sheets: FixtureSheet[],
  macroEnabled?: boolean,
): string {
  const workbookType = macroEnabled
    ? "application/vnd.ms-excel.sheet.macroEnabled.main+xml"
    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";
  const sheetOverrides = sheets
    .map(
      (_sheet, index) =>
        `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="${workbookType}"/>
  ${sheetOverrides}
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`;
}

function workbookXml(sheets: FixtureSheet[]): string {
  const sheetTags = sheets
    .map((sheet, index) => {
      const state =
        sheet.state && sheet.state !== "visible"
          ? ` state="${sheet.state}"`
          : "";
      return `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"${state}/>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${sheetTags}</sheets>
</workbook>`;
}

function workbookRelsXml(sheets: FixtureSheet[]): string {
  const rels = sheets
    .map(
      (_sheet, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${rels}
</Relationships>`;
}

function sheetXml(
  sheet: FixtureSheet,
  intern: (value: string) => number,
): string {
  const rowsXml = sheet.rows
    .map((cells, rowIndex) => {
      const rowNumber = rowIndex + 1;
      const cellsXml = cells
        .map((value, columnIndex) => {
          const formula = sheet.formulas?.find(
            (item) => item.row === rowNumber && item.column === columnIndex + 1,
          );
          const ref = cellRef(columnIndex + 1, rowNumber);
          if (formula) {
            const cached =
              formula.cached !== undefined
                ? `<v>${escapeXml(formula.cached)}</v>`
                : "";
            return `<c r="${ref}"><f>${escapeXml(formula.formula)}</f>${cached}</c>`;
          }
          const index = intern(value);
          return `<c r="${ref}" t="s"><v>${index}</v></c>`;
        })
        .join("");
      return `<row r="${rowNumber}">${cellsXml}</row>`;
    })
    .join("");
  const extraFormulas = (sheet.formulas ?? [])
    .filter(
      (formula) =>
        formula.row > sheet.rows.length ||
        formula.column > (sheet.rows[formula.row - 1]?.length ?? 0),
    )
    .map((formula) => {
      const ref = cellRef(formula.column, formula.row);
      const cached =
        formula.cached !== undefined
          ? `<v>${escapeXml(formula.cached)}</v>`
          : "";
      return `<row r="${formula.row}"><c r="${ref}"><f>${escapeXml(formula.formula)}</f>${cached}</c></row>`;
    })
    .join("");
  const merges = sheet.merges?.length
    ? `<mergeCells count="${sheet.merges.length}">${sheet.merges
        .map((ref) => `<mergeCell ref="${escapeXml(ref)}"/>`)
        .join("")}</mergeCells>`
    : "";
  const hyperlinks = sheet.hyperlinks?.length
    ? `<hyperlinks>${sheet.hyperlinks
        .map(
          (item, index) =>
            `<hyperlink ref="${escapeXml(item.ref)}" r:id="rId${index + 1}"/>`,
        )
        .join("")}</hyperlinks>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetData>${rowsXml}${extraFormulas}</sheetData>
  ${merges}
  ${hyperlinks}
</worksheet>`;
}

function sharedStringsXml(values: string[]): string {
  const items = values
    .map((value) => `<si><t>${escapeXml(value)}</t></si>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${values.length}" uniqueCount="${values.length}">
  ${items}
</sst>`;
}

export function cellRef(column: number, row: number): string {
  let n = column;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return `${letters}${row}`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function setZipEncryptionFlag(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes);
  const view = new DataView(copy.buffer);
  for (let cursor = 0; cursor + 10 < copy.byteLength; cursor += 1) {
    const signature = view.getUint32(cursor, true);
    if (signature === 0x04034b50) {
      view.setUint16(cursor + 6, view.getUint16(cursor + 6, true) | 0x1, true);
    }
    if (signature === 0x02014b50) {
      view.setUint16(cursor + 8, view.getUint16(cursor + 8, true) | 0x1, true);
    }
  }
  return copy;
}
