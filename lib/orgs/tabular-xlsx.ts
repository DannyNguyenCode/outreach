import "server-only";

import JSZip from "jszip";

import {
  TABULAR_MAX_AGGREGATE_CHARS,
  TABULAR_MAX_CELL_CHARS,
  TABULAR_MAX_COLUMNS,
  TABULAR_MAX_ROWS,
  TABULAR_MAX_SHEETS,
  type ParsedTabularRow,
  type ParsedTabularSheet,
  type TabularIssue,
  type TabularSheetInfo,
  type TabularSheetVisibility,
} from "@/lib/orgs/tabular-types";
import {
  enforceTabularDeadline,
  invalid,
  isArchiveSignature,
  isFormulaLike,
  issue,
  parseCellRef,
} from "@/lib/orgs/tabular-helpers";
import { inspectTabularZipDirectory } from "@/lib/orgs/tabular-zip";

const TAG = "(?:[\\w.-]+:)?";
const WORKSHEET_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet";
const WORKBOOK_MAIN_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";

export type ParsedWorkbook = {
  sheets: TabularSheetInfo[];
  parsedSheets: ParsedTabularSheet[];
  issues: TabularIssue[];
};

export async function parseXlsxWorkbook(
  bytes: Uint8Array,
  started: number,
): Promise<ParsedWorkbook> {
  const centralEntries = inspectTabularZipDirectory(bytes);
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes, {
      checkCRC32: true,
      createFolders: false,
    });
  } catch {
    throw invalid("malformed", "The spreadsheet ZIP archive is malformed.");
  }
  enforceTabularDeadline(started);

  const files = Object.values(zip.files).filter((entry) => !entry.dir);
  if (files.length !== centralEntries.length) {
    throw invalid(
      "malformed",
      "The spreadsheet ZIP directory is inconsistent.",
    );
  }

  for (const entry of files) {
    enforceTabularDeadline(started);
    const original = entry.unsafeOriginalName ?? entry.name;
    const normalized = original.replaceAll("\\", "/");
    if (
      original.includes("\\") ||
      original.startsWith("/") ||
      normalized.split("/").includes("..")
    ) {
      throw invalid(
        "malformed",
        "The spreadsheet contains an unsafe ZIP path.",
      );
    }
    if (
      /(^|\/)vbaProject\.bin$/i.test(normalized) ||
      /(^|\/)vbaData\.xml$/i.test(normalized) ||
      /\.(xlsm|xltm|xlsb)$/i.test(normalized)
    ) {
      throw invalid("macros", "Macro-enabled spreadsheets are not supported.");
    }
    if (
      /(^|\/)encryptioninfo$/i.test(normalized) ||
      /(^|\/)encryptedpackage$/i.test(normalized)
    ) {
      throw invalid("encrypted", "Encrypted spreadsheets are not supported.");
    }
    const expanded = await entry.async("uint8array");
    enforceTabularDeadline(started);
    if (
      /\.(zip|7z|rar|gz|tar|docx|xlsx|pptx)$/i.test(normalized) ||
      (isArchiveSignature(expanded) &&
        !normalized.toLowerCase().endsWith(".xml"))
    ) {
      throw invalid(
        "polyglot",
        "Nested archives are not permitted inside spreadsheet files.",
      );
    }
  }

  const contentTypesXml = zip.file("[Content_Types].xml");
  const workbookXml = zip.file("xl/workbook.xml");
  const workbookRels = zip.file("xl/_rels/workbook.xml.rels");
  if (!contentTypesXml || !workbookXml || !workbookRels) {
    throw invalid(
      "malformed",
      "The spreadsheet is missing required workbook parts.",
    );
  }

  const [contentTypes, workbook, rels] = await Promise.all([
    contentTypesXml.async("string"),
    workbookXml.async("string"),
    workbookRels.async("string"),
  ]);
  enforceTabularDeadline(started);
  rejectUnsafeXml(contentTypes);
  rejectUnsafeXml(workbook);
  rejectUnsafeXml(rels);

  if (/macroEnabled|vbaProject|application\/vnd\.ms-/i.test(contentTypes)) {
    throw invalid("macros", "Macro-enabled spreadsheets are not supported.");
  }
  if (/encrypted/i.test(contentTypes)) {
    throw invalid("encrypted", "Encrypted spreadsheets are not supported.");
  }
  if (
    !new RegExp(
      `<Override\\b[^>]*ContentType=["']${escapeRegExp(WORKBOOK_MAIN_TYPE)}["']`,
      "i",
    ).test(contentTypes) &&
    !new RegExp(
      `<Override\\b[^>]*PartName=["']/xl/workbook\\.xml["'][^>]*ContentType=["']${escapeRegExp(WORKBOOK_MAIN_TYPE)}["']`,
      "i",
    ).test(contentTypes)
  ) {
    throw invalid("type_mismatch", "The ZIP is not a standard XLSX workbook.");
  }

  const issues: TabularIssue[] = [];
  if (
    files.some((entry) =>
      (entry.unsafeOriginalName ?? entry.name)
        .replaceAll("\\", "/")
        .toLowerCase()
        .includes("xl/externallinks/"),
    )
  ) {
    issues.push(issue("external_link", "warning"));
  }

  const sheetTargets = parseWorkbookRelationships(rels);
  const sheetRefs = parseWorkbookSheets(workbook, sheetTargets);
  if (sheetRefs.length > TABULAR_MAX_SHEETS) {
    throw invalid(
      "too_many_sheets",
      "The spreadsheet contains too many worksheets.",
    );
  }
  if (sheetRefs.length === 0) {
    throw invalid("malformed", "The spreadsheet does not contain a worksheet.");
  }

  const sharedStrings = await readSharedStrings(zip, started);
  const parsedSheets: ParsedTabularSheet[] = [];
  let aggregateChars = 0;
  const sheetInfos: TabularSheetInfo[] = sheetRefs.map((sheet) => ({
    name: sheet.name,
    index: sheet.index,
    visibility: sheet.visibility,
  }));

  for (const sheetRef of sheetRefs) {
    enforceTabularDeadline(started);
    const { path, ...info } = sheetRef;
    const sheetFile = path ? zip.file(path) : null;
    if (!sheetFile) {
      throw invalid("malformed", "The spreadsheet worksheet part is missing.");
    }
    const sheetXml = await sheetFile.async("string");
    enforceTabularDeadline(started);
    rejectUnsafeXml(sheetXml);
    const parsed = parseWorksheet(sheetXml, info, sharedStrings, started);
    aggregateChars += parsed.aggregateChars;
    if (aggregateChars > TABULAR_MAX_AGGREGATE_CHARS) {
      throw invalid(
        "text_too_large",
        "The spreadsheet contains too much cell text.",
      );
    }
    parsedSheets.push(parsed);
    if (info.visibility !== "visible") {
      issues.push(
        issue("hidden_sheet", "warning", {
          sheetIndex: info.index,
          sheetName: info.name,
        }),
      );
    }
  }

  return { sheets: sheetInfos, parsedSheets, issues };
}

function parseWorkbookRelationships(relsXml: string): Map<string, string> {
  const byId = new Map<string, string>();
  const pattern = new RegExp(`<${TAG}Relationship\\b([^>]*)/?>`, "gi");
  for (const match of relsXml.matchAll(pattern)) {
    const attrs = parseAttrs(match[1] ?? "");
    const type = attrs.Type ?? attrs.type ?? "";
    const id = attrs.Id ?? attrs.ID ?? "";
    const target = attrs.Target ?? attrs.target ?? "";
    if (!id || !target) {
      continue;
    }
    if (type === WORKSHEET_REL || type.endsWith("/worksheet")) {
      byId.set(id, target);
    }
  }
  if (byId.size === 0) {
    throw invalid(
      "malformed",
      "The spreadsheet workbook relationships are missing.",
    );
  }
  return byId;
}

function parseWorkbookSheets(
  workbookXml: string,
  rels: Map<string, string>,
): Array<TabularSheetInfo & { path: string }> {
  const sheets: Array<TabularSheetInfo & { path: string }> = [];
  const pattern = new RegExp(`<${TAG}sheet\\b([^>]*)/?>`, "gi");
  for (const match of workbookXml.matchAll(pattern)) {
    const attrs = parseAttrs(match[1] ?? "");
    const name = (attrs.name ?? "").trim();
    const rId = attrs["r:id"] ?? attrs.rId ?? attrs.id ?? "";
    const target = rId ? rels.get(rId) : undefined;
    if (!name || !target) {
      continue;
    }
    const state = (attrs.state ?? "visible").toLowerCase();
    const visibility: TabularSheetVisibility =
      state === "veryhidden"
        ? "veryHidden"
        : state === "hidden"
          ? "hidden"
          : "visible";
    sheets.push({
      name,
      index: sheets.length,
      visibility,
      path: worksheetPath(target),
    });
  }
  return sheets;
}

async function readSharedStrings(
  zip: JSZip,
  started: number,
): Promise<string[]> {
  const file = zip.file("xl/sharedStrings.xml");
  if (!file) {
    return [];
  }
  const xml = await file.async("string");
  enforceTabularDeadline(started);
  rejectUnsafeXml(xml);
  const values: string[] = [];
  const siPattern = new RegExp(
    `<${TAG}si\\b[^>]*>([\\s\\S]*?)</${TAG}si>`,
    "gi",
  );
  for (const match of xml.matchAll(siPattern)) {
    enforceTabularDeadline(started);
    const body = (match[1] ?? "").replace(
      new RegExp(`<${TAG}rPh\\b[\\s\\S]*?</${TAG}rPh>`, "gi"),
      "",
    );
    values.push(extractTextNodes(body));
  }
  return values;
}

function parseWorksheet(
  sheetXml: string,
  info: TabularSheetInfo,
  sharedStrings: string[],
  started: number,
): ParsedTabularSheet {
  const issues: TabularIssue[] = [];
  if (new RegExp(`<${TAG}hyperlink\\b`, "i").test(sheetXml)) {
    issues.push(
      issue("hyperlink", "warning", {
        sheetIndex: info.index,
        sheetName: info.name,
      }),
    );
  }
  if (new RegExp(`<${TAG}mergeCell\\b`, "i").test(sheetXml)) {
    issues.push(
      issue("merged_cells", "warning", {
        sheetIndex: info.index,
        sheetName: info.name,
      }),
    );
  }

  const cells = new Map<string, string>();
  let maxRow = 0;
  let headerColumnCount = 0;
  let minRow = Number.POSITIVE_INFINITY;
  const cellPattern = new RegExp(
    `<${TAG}c\\b([^>]*)(?:/>|>([\\s\\S]*?)</${TAG}c>)`,
    "gi",
  );
  let scanned = 0;
  for (const match of sheetXml.matchAll(cellPattern)) {
    scanned += 1;
    if (scanned % 256 === 0) {
      enforceTabularDeadline(started);
    }
    const attrs = parseAttrs(match[1] ?? "");
    const ref = attrs.r;
    if (!ref) {
      continue;
    }
    const { column, row } = parseCellRef(ref);
    if (column > TABULAR_MAX_COLUMNS) {
      throw invalid(
        "too_many_columns",
        "The spreadsheet has too many columns.",
      );
    }
    if (row > TABULAR_MAX_ROWS) {
      throw invalid("too_many_rows", "The spreadsheet has too many rows.");
    }
    const inner = match[2] ?? "";
    const formula = new RegExp(`<${TAG}f\\b`, "i").test(inner);
    const type = (attrs.t ?? "").toLowerCase();
    const cachedValue = extractCachedValue(inner, type, sharedStrings);
    if (formula) {
      issues.push(
        issue(cachedValue !== "" ? "cached_formula" : "formula", "warning", {
          sheetIndex: info.index,
          sheetName: info.name,
          row,
          column,
        }),
      );
    } else if (isFormulaLike(cachedValue)) {
      issues.push(
        issue("formula_like", "warning", {
          sheetIndex: info.index,
          sheetName: info.name,
          row,
          column,
        }),
      );
    }
    if (cachedValue.length > TABULAR_MAX_CELL_CHARS) {
      throw invalid(
        "cell_too_long",
        "A spreadsheet cell exceeds the permitted length.",
      );
    }
    cells.set(`${row}:${column}`, cachedValue);
    maxRow = Math.max(maxRow, row);
    minRow = Math.min(minRow, row);
  }

  if (!Number.isFinite(minRow)) {
    return {
      info,
      headerRowNumber: 1,
      headers: [],
      rows: [],
      issues: [
        ...issues,
        issue("empty_sheet", "error", {
          sheetIndex: info.index,
          sheetName: info.name,
        }),
      ],
      aggregateChars: 0,
    };
  }

  for (let column = 1; column <= TABULAR_MAX_COLUMNS; column += 1) {
    if (cells.has(`${minRow}:${column}`)) {
      headerColumnCount = column;
    }
  }
  if (headerColumnCount === 0) {
    return {
      info,
      headerRowNumber: minRow,
      headers: [],
      rows: [],
      issues: [
        ...issues,
        issue("empty_sheet", "error", {
          sheetIndex: info.index,
          sheetName: info.name,
        }),
      ],
      aggregateChars: 0,
    };
  }

  const headers: string[] = [];
  let aggregateChars = 0;
  for (let column = 1; column <= headerColumnCount; column += 1) {
    const value = cells.get(`${minRow}:${column}`) ?? "";
    aggregateChars = addAggregate(aggregateChars, value);
    headers.push(value);
  }

  const rows: ParsedTabularRow[] = [];
  for (let row = minRow + 1; row <= maxRow; row += 1) {
    enforceTabularDeadline(started);
    const rowCells: string[] = [];
    let wider = false;
    for (let column = 1; column <= headerColumnCount; column += 1) {
      const value = cells.get(`${row}:${column}`) ?? "";
      aggregateChars = addAggregate(aggregateChars, value);
      rowCells.push(value);
    }
    for (
      let column = headerColumnCount + 1;
      column <= TABULAR_MAX_COLUMNS;
      column += 1
    ) {
      if (cells.has(`${row}:${column}`)) {
        wider = true;
        break;
      }
    }
    if (wider) {
      issues.push(
        issue("extra_columns", "warning", {
          sheetIndex: info.index,
          sheetName: info.name,
          row,
        }),
      );
    }
    rows.push({ sourceRowNumber: row, cells: rowCells });
  }

  return {
    info,
    headerRowNumber: minRow,
    headers,
    rows,
    issues,
    aggregateChars,
  };
}

function extractCachedValue(
  inner: string,
  type: string,
  sharedStrings: string[],
): string {
  if (type === "inlineStr" || new RegExp(`<${TAG}is\\b`, "i").test(inner)) {
    return extractTextNodes(inner).trim();
  }
  const valueMatch = new RegExp(
    `<${TAG}v\\b[^>]*>([\\s\\S]*?)</${TAG}v>`,
    "i",
  ).exec(inner);
  const raw = decodeXmlText(valueMatch?.[1] ?? "").trim();
  if (type === "s") {
    const index = Number.parseInt(raw, 10);
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= sharedStrings.length
    ) {
      throw invalid(
        "malformed",
        "The spreadsheet shared string table is invalid.",
      );
    }
    return sharedStrings[index] ?? "";
  }
  if (type === "b") {
    return raw === "1" || raw.toLowerCase() === "true" ? "TRUE" : "FALSE";
  }
  return raw;
}

function extractTextNodes(xml: string): string {
  const pattern = new RegExp(`<${TAG}t\\b[^>]*>([\\s\\S]*?)</${TAG}t>`, "gi");
  const parts: string[] = [];
  for (const match of xml.matchAll(pattern)) {
    parts.push(decodeXmlText(match[1] ?? ""));
  }
  return parts.join("");
}

function worksheetPath(target: string): string {
  const normalized = target.replaceAll("\\", "/");
  if (normalized.startsWith("/")) {
    return normalized.slice(1);
  }
  if (normalized.startsWith("xl/")) {
    return normalized;
  }
  return `xl/${normalized.replace(/^\.\//, "")}`;
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([:\w.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of raw.matchAll(pattern)) {
    attrs[match[1] ?? ""] = decodeXmlText(match[2] ?? match[3] ?? "");
  }
  return attrs;
}

function decodeXmlText(value: string): string {
  if (
    /<!ENTITY|&[a-zA-Z][a-zA-Z0-9]+;/.test(value) &&
    !isSafeEntityOnly(value)
  ) {
    const unsafe = value.replace(
      /&(lt|gt|amp|quot|apos|#(?:x[0-9a-fA-F]+|\d+));/g,
      "",
    );
    if (/&[a-zA-Z]/.test(unsafe)) {
      throw invalid(
        "malformed",
        "The spreadsheet XML contains unsupported entities.",
      );
    }
  }
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return safeXmlChar(code);
    })
    .replace(/&#(\d+);/g, (_, dec: string) => {
      const code = Number.parseInt(dec, 10);
      return safeXmlChar(code);
    })
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function isSafeEntityOnly(value: string): boolean {
  return !/&(?!(lt|gt|amp|quot|apos|#(?:x[0-9a-fA-F]+|\d+));)/.test(value);
}

function safeXmlChar(code: number): string {
  if (
    !Number.isInteger(code) ||
    code < 9 ||
    code === 11 ||
    code === 12 ||
    code > 0x10ffff
  ) {
    throw invalid(
      "malformed",
      "The spreadsheet XML contains an invalid character.",
    );
  }
  if (code === 0) {
    throw invalid(
      "binary_text",
      "Spreadsheet cells may not contain NUL bytes.",
    );
  }
  return String.fromCodePoint(code);
}

function rejectUnsafeXml(xml: string): void {
  if (/<!DOCTYPE|<!ENTITY|SYSTEM\s+["']/i.test(xml)) {
    throw invalid(
      "malformed",
      "The spreadsheet XML contains prohibited declarations.",
    );
  }
}

function addAggregate(current: number, cell: string): number {
  const next = current + cell.length;
  if (next > TABULAR_MAX_AGGREGATE_CHARS) {
    throw invalid(
      "text_too_large",
      "The spreadsheet contains too much cell text.",
    );
  }
  return next;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
