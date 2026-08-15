import "server-only";

import { createHash } from "node:crypto";

import {
  TABULAR_MAX_BYTES,
  TABULAR_MIME_BY_KIND,
  TABULAR_PREVIEW_ROWS,
  type ParsedTabularSheet,
  type TabularFileKind,
  type TabularHeader,
  type TabularIssue,
  type TabularNormalizedPreview,
  type TabularPreviewRow,
  type TabularSheetInfo,
} from "@/lib/orgs/tabular-types";
import { parseCsvSheet } from "@/lib/orgs/tabular-csv";
import {
  invalid,
  isArchiveSignature,
  isExecutableSignature,
  isOleSignature,
  isPdfSignature,
  issue,
  normalizeHeaderName,
  normalizeMime,
  sanitizeTabularFilename,
} from "@/lib/orgs/tabular-helpers";
import { parseXlsxWorkbook } from "@/lib/orgs/tabular-xlsx";

const UNSUPPORTED_EXTENSIONS = new Set([
  "xls",
  "xlsm",
  "xlsb",
  "xlt",
  "xltm",
  "xltx",
  "xml",
  "ods",
  "zip",
  "7z",
  "rar",
  "gz",
  "tar",
  "exe",
  "dll",
  "pdf",
  "docx",
  "docm",
  "doc",
  "txt",
]);

const ATTENTION_CODES = new Set<TabularIssue["code"]>([
  "ambiguous_sheet",
  "blank_header",
  "cached_formula",
  "duplicate_header",
  "empty_sheet",
  "external_link",
  "extra_columns",
  "formula",
  "formula_like",
  "hidden_sheet",
  "hyperlink",
  "inconsistent_columns",
  "merged_cells",
  "no_usable_sheet",
]);

export {
  TabularValidationError,
  sanitizeTabularFilename,
} from "@/lib/orgs/tabular-helpers";
export {
  TABULAR_MAX_AGGREGATE_CHARS,
  TABULAR_MAX_BYTES,
  TABULAR_MAX_CELL_CHARS,
  TABULAR_MAX_COLUMNS,
  TABULAR_MAX_PARSE_MS,
  TABULAR_MAX_ROWS,
  TABULAR_MAX_SHEETS,
  TABULAR_MIME_BY_KIND,
  TABULAR_PREVIEW_ROWS,
} from "@/lib/orgs/tabular-types";
export type {
  TabularFileKind,
  TabularHeader,
  TabularIssue,
  TabularNormalizedPreview,
  TabularPreviewRow,
  TabularSheetInfo,
  TabularValidationCode,
  TabularValidationOutcome,
} from "@/lib/orgs/tabular-types";

export async function validateTabularImport(input: {
  bytes: Uint8Array;
  filename: string;
  declaredMimeType: string;
}): Promise<TabularNormalizedPreview> {
  const bytes = new Uint8Array(input.bytes);
  if (bytes.byteLength === 0) {
    throw invalid("empty", "The file is empty.");
  }
  if (bytes.byteLength > TABULAR_MAX_BYTES) {
    throw invalid("too_large", "Tabular files may not exceed 5 MiB.");
  }

  const filename = sanitizeTabularFilename(input.filename);
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  if (
    UNSUPPORTED_EXTENSIONS.has(extension) ||
    (extension !== "csv" && extension !== "xlsx")
  ) {
    throw invalid(
      "unsupported_type",
      "Only CSV and non-macro XLSX files are supported.",
    );
  }
  const kind: TabularFileKind = extension;
  const declaredMimeType = normalizeMime(input.declaredMimeType);
  if (declaredMimeType !== TABULAR_MIME_BY_KIND[kind]) {
    throw invalid(
      "type_mismatch",
      "Filename extension and declared content type do not agree.",
    );
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const started = performance.now();

  if (kind === "csv") {
    assertCsvSignature(bytes);
    const sheet = parseCsvSheet(bytes, started);
    return buildPreview({
      kind,
      filename,
      bytes,
      sha256,
      sheets: [sheet.info],
      selected: sheet,
      extraIssues: [],
    });
  }

  assertXlsxSignature(bytes);
  const workbook = await parseXlsxWorkbook(bytes, started);
  const candidates = workbook.parsedSheets.filter(
    (sheet) =>
      sheet.info.visibility === "visible" &&
      sheet.headers.length > 0 &&
      !sheet.issues.some((item) => item.code === "empty_sheet"),
  );
  const extraIssues: TabularIssue[] = [...workbook.issues];
  let selected: ParsedTabularSheet | null = null;
  if (candidates.length === 1) {
    selected = candidates[0] ?? null;
  } else if (candidates.length === 0) {
    extraIssues.push(issue("no_usable_sheet", "error"));
  } else {
    extraIssues.push(issue("ambiguous_sheet", "error"));
  }

  return buildPreview({
    kind,
    filename,
    bytes,
    sha256,
    sheets: workbook.sheets,
    selected,
    extraIssues,
  });
}

function buildPreview(input: {
  kind: TabularFileKind;
  filename: string;
  bytes: Uint8Array;
  sha256: string;
  sheets: TabularSheetInfo[];
  selected: ParsedTabularSheet | null;
  extraIssues: TabularIssue[];
}): TabularNormalizedPreview {
  const issues: TabularIssue[] = [...input.extraIssues];
  const headers: TabularHeader[] = [];
  const previewRows: TabularPreviewRow[] = [];
  let totalRowCount = 0;
  let totalColumnCount = 0;

  if (input.selected) {
    issues.push(...input.selected.issues);
    totalColumnCount = input.selected.headers.length;
    totalRowCount = input.selected.rows.length;
    const seen = new Map<string, number>();
    for (const [index, name] of input.selected.headers.entries()) {
      const normalizedName = normalizeHeaderName(name);
      headers.push({
        sourceColumn: index + 1,
        name,
        normalizedName,
      });
      const location = {
        sheetIndex: input.selected.info.index,
        sheetName: input.selected.info.name,
        row: input.selected.headerRowNumber,
        column: index + 1,
      };
      if (!normalizedName) {
        issues.push(issue("blank_header", "error", location));
        continue;
      }
      const previous = seen.get(normalizedName);
      if (previous !== undefined) {
        issues.push(issue("duplicate_header", "error", location));
      } else {
        seen.set(normalizedName, index + 1);
      }
    }
    if (totalColumnCount === 0) {
      issues.push(
        issue("empty_sheet", "error", {
          sheetIndex: input.selected.info.index,
          sheetName: input.selected.info.name,
        }),
      );
    }
    for (const row of input.selected.rows.slice(0, TABULAR_PREVIEW_ROWS)) {
      previewRows.push({
        sourceRowNumber: row.sourceRowNumber,
        cells: row.cells.slice(0, totalColumnCount),
      });
    }
  }

  const uniqueIssues = dedupeIssues(issues);
  const needsAttention =
    !input.selected ||
    uniqueIssues.some((item) => ATTENTION_CODES.has(item.code));

  return {
    outcome: needsAttention ? "needs_attention" : "ready",
    kind: input.kind,
    filename: input.filename,
    mimeType: TABULAR_MIME_BY_KIND[input.kind],
    byteLength: input.bytes.byteLength,
    sha256: input.sha256,
    sheets: input.sheets,
    selectedSheet: input.selected
      ? { name: input.selected.info.name, index: input.selected.info.index }
      : null,
    headers,
    previewRows,
    totalRowCount,
    totalColumnCount,
    issues: uniqueIssues,
  };
}

function dedupeIssues(issues: TabularIssue[]): TabularIssue[] {
  const seen = new Set<string>();
  const result: TabularIssue[] = [];
  for (const item of issues) {
    const key = [
      item.code,
      item.severity,
      item.sheetIndex ?? "",
      item.sheetName ?? "",
      item.row ?? "",
      item.column ?? "",
    ].join(":");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}

function assertCsvSignature(bytes: Uint8Array): void {
  if (
    isArchiveSignature(bytes) ||
    isOleSignature(bytes) ||
    isPdfSignature(bytes)
  ) {
    throw invalid(
      "invalid_signature",
      "The file signature does not match a CSV document.",
    );
  }
  if (isExecutableSignature(bytes)) {
    throw invalid("unsupported_type", "Executable files are not supported.");
  }
}

function assertXlsxSignature(bytes: Uint8Array): void {
  if (isOleSignature(bytes)) {
    throw invalid(
      "invalid_signature",
      "Legacy XLS workbooks are not supported.",
    );
  }
  if (isExecutableSignature(bytes) || isPdfSignature(bytes)) {
    throw invalid(
      "invalid_signature",
      "The file signature does not match an XLSX workbook.",
    );
  }
  if (
    bytes[0] !== 0x50 ||
    bytes[1] !== 0x4b ||
    bytes[2] !== 0x03 ||
    bytes[3] !== 0x04
  ) {
    throw invalid("invalid_signature", "The file is not a valid XLSX archive.");
  }
}
