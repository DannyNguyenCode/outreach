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
import {
  OOXML_NS,
  ooxmlAttr,
  parseOoxmlDocument,
  type OoxmlName,
} from "@/lib/orgs/tabular-xml";
import { inspectTabularZipDirectory } from "@/lib/orgs/tabular-zip";

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
  const parsedTypes = parseContentTypes(contentTypes, started);
  if (parsedTypes.macros) {
    throw invalid("macros", "Macro-enabled spreadsheets are not supported.");
  }
  if (parsedTypes.encrypted) {
    throw invalid("encrypted", "Encrypted spreadsheets are not supported.");
  }
  if (!parsedTypes.canonicalWorkbook) {
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

  const sheetTargets = parseWorkbookRelationships(rels, started);
  const sheetRefs = parseWorkbookSheets(workbook, sheetTargets, started);
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

function parseContentTypes(
  xml: string,
  started: number,
): { canonicalWorkbook: boolean; macros: boolean; encrypted: boolean } {
  const workbookTypes: string[] = [];
  let macros = false;
  let encrypted = false;
  const noteContentType = (contentType: string): void => {
    if (/macroEnabled|vbaProject|application\/vnd\.ms-/i.test(contentType)) {
      macros = true;
    }
    if (/encrypted/i.test(contentType)) {
      encrypted = true;
    }
  };
  parseOoxmlDocument({
    xml,
    rootLocalName: "Types",
    rootNamespace: OOXML_NS.contentTypes,
    started,
    onOpen(name, attrs, path) {
      if (isOoxmlName(name, "Types", OOXML_NS.contentTypes)) {
        if (path.length !== 1) {
          throw duplicateContainer();
        }
        return;
      }
      if (isOoxmlName(name, "Default", OOXML_NS.contentTypes)) {
        requireDirectChild(path, "Types", OOXML_NS.contentTypes);
        noteContentType(
          ooxmlAttr(attrs, "ContentType") || ooxmlAttr(attrs, "contentType"),
        );
        return;
      }
      if (!isOoxmlName(name, "Override", OOXML_NS.contentTypes)) {
        return;
      }
      requireDirectChild(path, "Types", OOXML_NS.contentTypes);
      const contentType =
        ooxmlAttr(attrs, "ContentType") || ooxmlAttr(attrs, "contentType");
      noteContentType(contentType);
      const partName = (
        ooxmlAttr(attrs, "PartName") || ooxmlAttr(attrs, "partName")
      )
        .replaceAll("\\", "/")
        .toLowerCase();
      if (partName === "/xl/workbook.xml") {
        workbookTypes.push(contentType);
      }
    },
  });
  if (workbookTypes.length > 1) {
    throw duplicateContainer();
  }
  return {
    canonicalWorkbook:
      workbookTypes.length === 1 &&
      (workbookTypes[0] ?? "").toLowerCase() ===
        WORKBOOK_MAIN_TYPE.toLowerCase(),
    macros,
    encrypted,
  };
}

function parseWorkbookRelationships(
  relsXml: string,
  started: number,
): Map<string, string> {
  const byId = new Map<string, string>();
  parseOoxmlDocument({
    xml: relsXml,
    rootLocalName: "Relationships",
    rootNamespace: OOXML_NS.relationships,
    started,
    onOpen(name, attrs, path) {
      if (isOoxmlName(name, "Relationships", OOXML_NS.relationships)) {
        if (path.length !== 1) {
          throw duplicateContainer();
        }
        return;
      }
      if (!isOoxmlName(name, "Relationship", OOXML_NS.relationships)) {
        return;
      }
      requireDirectChild(path, "Relationships", OOXML_NS.relationships);
      const type = ooxmlAttr(attrs, "Type") || ooxmlAttr(attrs, "type");
      const id = ooxmlAttr(attrs, "Id") || ooxmlAttr(attrs, "ID");
      const target = ooxmlAttr(attrs, "Target") || ooxmlAttr(attrs, "target");
      if (!id || !target) {
        return;
      }
      if (type === WORKSHEET_REL || type.endsWith("/worksheet")) {
        byId.set(id, target);
      }
    },
  });
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
  started: number,
): Array<TabularSheetInfo & { path: string }> {
  const sheets: Array<TabularSheetInfo & { path: string }> = [];
  let sawSheets = false;
  parseOoxmlDocument({
    xml: workbookXml,
    rootLocalName: "workbook",
    rootNamespace: OOXML_NS.spreadsheetml,
    started,
    onOpen(name, attrs, path) {
      if (isOoxmlName(name, "workbook", OOXML_NS.spreadsheetml)) {
        if (path.length !== 1) {
          throw duplicateContainer();
        }
        return;
      }
      if (isOoxmlName(name, "sheets", OOXML_NS.spreadsheetml)) {
        requireDirectChild(path, "workbook", OOXML_NS.spreadsheetml);
        if (sawSheets) {
          throw duplicateContainer();
        }
        sawSheets = true;
        return;
      }
      if (!isOoxmlName(name, "sheet", OOXML_NS.spreadsheetml)) {
        return;
      }
      requireDirectChild(path, "sheets", OOXML_NS.spreadsheetml);
      if (
        path[0]?.localName !== "workbook" ||
        path[0]?.namespace !== OOXML_NS.spreadsheetml
      ) {
        throw malformedXml();
      }
      const sheetName = ooxmlAttr(attrs, "name").trim();
      const rId =
        ooxmlAttr(attrs, "id", OOXML_NS.officeRel) || ooxmlAttr(attrs, "id");
      const target = rId ? rels.get(rId) : undefined;
      if (!sheetName || !target) {
        return;
      }
      const state = ooxmlAttr(attrs, "state").toLowerCase();
      const visibility: TabularSheetVisibility =
        state === "veryhidden"
          ? "veryHidden"
          : state === "hidden"
            ? "hidden"
            : "visible";
      sheets.push({
        name: sheetName,
        index: sheets.length,
        visibility,
        path: worksheetPath(target),
      });
    },
  });
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
  return parseSharedStrings(xml, started);
}

function parseSharedStrings(xml: string, started: number): string[] {
  const values: string[] = [];
  let current: string[] | null = null;
  parseOoxmlDocument({
    xml,
    rootLocalName: "sst",
    rootNamespace: OOXML_NS.spreadsheetml,
    started,
    onOpen(name, _attrs, path) {
      if (isOoxmlName(name, "sst", OOXML_NS.spreadsheetml)) {
        if (path.length !== 1) {
          throw duplicateContainer();
        }
        return;
      }
      if (!isOoxmlName(name, "si", OOXML_NS.spreadsheetml)) {
        return;
      }
      requireDirectChild(path, "sst", OOXML_NS.spreadsheetml);
      current = [];
    },
    onClose(name, text, path) {
      if (isOoxmlName(name, "t", OOXML_NS.spreadsheetml)) {
        consumeSharedStringText(text, path, current);
        return;
      }
      if (isOoxmlName(name, "si", OOXML_NS.spreadsheetml) && current) {
        values.push(current.join(""));
        current = null;
      }
    },
  });
  return values;
}

function parseWorksheet(
  sheetXml: string,
  info: TabularSheetInfo,
  sharedStrings: string[],
  started: number,
): ParsedTabularSheet {
  const issues: TabularIssue[] = [];
  const cells = new Map<string, string>();
  let maxRow = 0;
  let headerColumnCount = 0;
  let minRow = Number.POSITIVE_INFINITY;
  let sawSheetData = false;
  let currentCell: {
    ref: string;
    type: string;
    formula: boolean;
    inline: boolean;
    value: string | null;
    texts: string[];
  } | null = null;
  let scanned = 0;

  parseOoxmlDocument({
    xml: sheetXml,
    rootLocalName: "worksheet",
    rootNamespace: OOXML_NS.spreadsheetml,
    started,
    onOpen(name, attrs, path) {
      if (isOoxmlName(name, "worksheet", OOXML_NS.spreadsheetml)) {
        if (path.length !== 1) {
          throw duplicateContainer();
        }
        return;
      }
      if (isOoxmlName(name, "sheetData", OOXML_NS.spreadsheetml)) {
        requireDirectChild(path, "worksheet", OOXML_NS.spreadsheetml);
        if (sawSheetData) {
          throw duplicateContainer();
        }
        sawSheetData = true;
        return;
      }
      if (isOoxmlName(name, "row", OOXML_NS.spreadsheetml)) {
        requireDirectChild(path, "sheetData", OOXML_NS.spreadsheetml);
        return;
      }
      if (isOoxmlName(name, "c", OOXML_NS.spreadsheetml)) {
        requireDirectChild(path, "row", OOXML_NS.spreadsheetml);
        if (!hasAncestor(path, "sheetData", OOXML_NS.spreadsheetml)) {
          throw malformedXml();
        }
        currentCell = {
          ref: ooxmlAttr(attrs, "r"),
          type: ooxmlAttr(attrs, "t").toLowerCase(),
          formula: false,
          inline: false,
          value: null,
          texts: [],
        };
        return;
      }
      if (
        currentCell &&
        isOoxmlName(name, "f", OOXML_NS.spreadsheetml) &&
        parentIs(path, "c", OOXML_NS.spreadsheetml)
      ) {
        currentCell.formula = true;
        return;
      }
      if (
        currentCell &&
        isOoxmlName(name, "is", OOXML_NS.spreadsheetml) &&
        parentIs(path, "c", OOXML_NS.spreadsheetml)
      ) {
        currentCell.inline = true;
        return;
      }
      if (isOoxmlName(name, "hyperlink", OOXML_NS.spreadsheetml)) {
        issues.push(
          issue("hyperlink", "warning", {
            sheetIndex: info.index,
            sheetName: info.name,
          }),
        );
        return;
      }
      if (isOoxmlName(name, "mergeCell", OOXML_NS.spreadsheetml)) {
        issues.push(
          issue("merged_cells", "warning", {
            sheetIndex: info.index,
            sheetName: info.name,
          }),
        );
      }
    },
    onClose(name, text, path) {
      if (
        currentCell &&
        isOoxmlName(name, "v", OOXML_NS.spreadsheetml) &&
        parentIs(path, "c", OOXML_NS.spreadsheetml) &&
        currentCell.value === null
      ) {
        currentCell.value = text;
        return;
      }
      if (isOoxmlName(name, "t", OOXML_NS.spreadsheetml)) {
        consumeInlineStringText(text, path, currentCell);
        return;
      }
      if (!currentCell || !isOoxmlName(name, "c", OOXML_NS.spreadsheetml)) {
        return;
      }
      scanned += 1;
      if (scanned % 256 === 0) {
        enforceTabularDeadline(started);
      }
      finishCell(currentCell);
      currentCell = null;
    },
  });

  function finishCell(cell: {
    ref: string;
    type: string;
    formula: boolean;
    inline: boolean;
    value: string | null;
    texts: string[];
  }): void {
    if (!cell.ref) {
      return;
    }
    const { column, row } = parseCellRef(cell.ref);
    if (column > TABULAR_MAX_COLUMNS) {
      throw invalid(
        "too_many_columns",
        "The spreadsheet has too many columns.",
      );
    }
    if (row > TABULAR_MAX_ROWS) {
      throw invalid("too_many_rows", "The spreadsheet has too many rows.");
    }
    const rawValue = extractCachedValue(
      cell.type,
      cell.inline,
      cell.value ?? "",
      cell.texts,
      sharedStrings,
    );
    if (cell.formula) {
      issues.push(
        issue(
          rawValue.trim() !== "" ? "cached_formula" : "formula",
          "warning",
          {
            sheetIndex: info.index,
            sheetName: info.name,
            row,
            column,
          },
        ),
      );
    } else if (
      isLiteralStringCell(cell.type, cell.inline) &&
      isFormulaLike(rawValue)
    ) {
      issues.push(
        issue("formula_like", "warning", {
          sheetIndex: info.index,
          sheetName: info.name,
          row,
          column,
        }),
      );
    }
    const cachedValue = rawValue.trim();
    if (cachedValue.length > TABULAR_MAX_CELL_CHARS) {
      throw invalid(
        "cell_too_long",
        "A spreadsheet cell exceeds the permitted length.",
      );
    }
    const coordinate = `${row}:${column}`;
    if (cells.has(coordinate)) {
      throw invalid(
        "malformed",
        "The spreadsheet contains duplicate cell coordinates.",
      );
    }
    cells.set(coordinate, cachedValue);
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

  let aggregateChars = 0;
  for (const value of cells.values()) {
    aggregateChars = addAggregate(aggregateChars, value);
  }

  const headers: string[] = [];
  for (let column = 1; column <= headerColumnCount; column += 1) {
    headers.push(cells.get(`${minRow}:${column}`) ?? "");
  }

  const rows: ParsedTabularRow[] = [];
  for (let row = minRow + 1; row <= maxRow; row += 1) {
    enforceTabularDeadline(started);
    const rowCells: string[] = [];
    let wider = false;
    for (let column = 1; column <= headerColumnCount; column += 1) {
      rowCells.push(cells.get(`${row}:${column}`) ?? "");
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
  type: string,
  inline: boolean,
  value: string,
  texts: string[],
  sharedStrings: string[],
): string {
  if (type === "inlinestr" || inline) {
    return texts.join("");
  }
  if (type === "s") {
    const index = Number.parseInt(value.trim(), 10);
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
    const flag = value.trim();
    return flag === "1" || flag.toLowerCase() === "true" ? "TRUE" : "FALSE";
  }
  return value;
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

function isLiteralStringCell(type: string, inline: boolean): boolean {
  return type === "s" || type === "str" || type === "inlinestr" || inline;
}

function consumeSharedStringText(
  text: string,
  path: readonly OoxmlName[],
  current: string[] | null,
): void {
  if (hasAncestor(path, "rPh", OOXML_NS.spreadsheetml)) {
    return;
  }
  if (!current || !isLegalSharedStringTextPath(path)) {
    throw malformedXml();
  }
  current.push(text);
}

function consumeInlineStringText(
  text: string,
  path: readonly OoxmlName[],
  currentCell: { texts: string[] } | null,
): void {
  if (hasAncestor(path, "rPh", OOXML_NS.spreadsheetml)) {
    return;
  }
  if (!currentCell || !isLegalInlineStringTextPath(path)) {
    throw malformedXml();
  }
  currentCell.texts.push(text);
}

function isLegalSharedStringTextPath(path: readonly OoxmlName[]): boolean {
  const parent = path[path.length - 2];
  if (parent && isOoxmlName(parent, "si", OOXML_NS.spreadsheetml)) {
    return true;
  }
  const grandparent = path[path.length - 3];
  return (
    !!parent &&
    isOoxmlName(parent, "r", OOXML_NS.spreadsheetml) &&
    !!grandparent &&
    isOoxmlName(grandparent, "si", OOXML_NS.spreadsheetml)
  );
}

function isLegalInlineStringTextPath(path: readonly OoxmlName[]): boolean {
  const parent = path[path.length - 2];
  const grandparent = path[path.length - 3];
  if (
    parent &&
    isOoxmlName(parent, "is", OOXML_NS.spreadsheetml) &&
    grandparent &&
    isOoxmlName(grandparent, "c", OOXML_NS.spreadsheetml)
  ) {
    return true;
  }
  const greatGrandparent = path[path.length - 4];
  return (
    !!parent &&
    isOoxmlName(parent, "r", OOXML_NS.spreadsheetml) &&
    !!grandparent &&
    isOoxmlName(grandparent, "is", OOXML_NS.spreadsheetml) &&
    !!greatGrandparent &&
    isOoxmlName(greatGrandparent, "c", OOXML_NS.spreadsheetml)
  );
}

function isOoxmlName(
  name: OoxmlName,
  localName: string,
  namespace: string,
): boolean {
  return name.localName === localName && name.namespace === namespace;
}

function parentIs(
  path: readonly OoxmlName[],
  localName: string,
  namespace: string,
): boolean {
  const parent = path[path.length - 2];
  return parent?.localName === localName && parent.namespace === namespace;
}

function hasAncestor(
  path: readonly OoxmlName[],
  localName: string,
  namespace: string,
): boolean {
  return path.some(
    (item, index) =>
      index < path.length - 1 &&
      item.localName === localName &&
      item.namespace === namespace,
  );
}

function requireDirectChild(
  path: readonly OoxmlName[],
  parentLocalName: string,
  parentNamespace: string,
): void {
  if (!parentIs(path, parentLocalName, parentNamespace)) {
    throw malformedXml();
  }
}

function duplicateContainer(): Error {
  return invalid(
    "malformed",
    "The spreadsheet XML contains duplicate structural containers.",
  );
}

function malformedXml(): Error {
  return invalid("malformed", "The spreadsheet XML is malformed.");
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
