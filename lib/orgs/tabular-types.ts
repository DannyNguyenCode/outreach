export const TABULAR_MAX_BYTES = 5 * 1024 * 1024;
export const TABULAR_MAX_SHEETS = 16;
export const TABULAR_MAX_ROWS = 10_000;
export const TABULAR_MAX_COLUMNS = 100;
export const TABULAR_MAX_CELL_CHARS = 4_000;
export const TABULAR_MAX_AGGREGATE_CHARS = 1_000_000;
export const TABULAR_PREVIEW_ROWS = 50;
export const TABULAR_MAX_PARSE_MS = 2_000;
export const CSV_MAPPED_FILE_MAX_ISSUES = 1_000;

export const TABULAR_ZIP_MAX_ENTRIES = 1_000;
export const TABULAR_ZIP_MAX_EXPANDED_BYTES = 50 * 1024 * 1024;
export const TABULAR_ZIP_MAX_ENTRY_BYTES = 20 * 1024 * 1024;
export const TABULAR_ZIP_MAX_RATIO = 100;
export const TABULAR_ZIP_MAX_TOTAL_RATIO = 50;

export const TABULAR_KINDS = ["csv", "xlsx"] as const;
export type TabularFileKind = (typeof TABULAR_KINDS)[number];

export const TABULAR_MIME_BY_KIND: Record<TabularFileKind, string> = {
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export type TabularValidationCode =
  | "empty"
  | "too_large"
  | "filename"
  | "unsupported_type"
  | "type_mismatch"
  | "invalid_signature"
  | "malformed"
  | "encrypted"
  | "macros"
  | "polyglot"
  | "zip_bomb"
  | "binary_text"
  | "invalid_encoding"
  | "too_many_rows"
  | "too_many_columns"
  | "too_many_sheets"
  | "cell_too_long"
  | "text_too_large"
  | "timeout";

export type TabularIssueCode =
  | "ambiguous_sheet"
  | "blank_header"
  | "cached_formula"
  | "duplicate_header"
  | "empty_sheet"
  | "external_link"
  | "extra_columns"
  | "formula"
  | "formula_like"
  | "hidden_sheet"
  | "hyperlink"
  | "inconsistent_columns"
  | "merged_cells"
  | "no_usable_sheet";

export type TabularIssueSeverity = "error" | "warning";

export type TabularIssue = {
  code: TabularIssueCode;
  severity: TabularIssueSeverity;
  sheetIndex?: number;
  sheetName?: string;
  row?: number;
  column?: number;
};

export type TabularSheetVisibility = "visible" | "hidden" | "veryHidden";

export type TabularSheetInfo = {
  name: string;
  index: number;
  visibility: TabularSheetVisibility;
};

export type TabularHeader = {
  sourceColumn: number;
  name: string;
  normalizedName: string;
};

export type TabularPreviewRow = {
  sourceRowNumber: number;
  cells: string[];
};

export type TabularValidationOutcome = "ready" | "needs_attention";

export type TabularNormalizedPreview = {
  outcome: TabularValidationOutcome;
  kind: TabularFileKind;
  filename: string;
  mimeType: string;
  byteLength: number;
  sha256: string;
  sheets: TabularSheetInfo[];
  selectedSheet: { name: string; index: number } | null;
  headers: TabularHeader[];
  previewRows: TabularPreviewRow[];
  totalRowCount: number;
  totalColumnCount: number;
  issues: TabularIssue[];
};

export type ParsedTabularRow = {
  sourceRowNumber: number;
  cells: string[];
};

export type ParsedTabularSheet = {
  info: TabularSheetInfo;
  headerRowNumber: number;
  headers: string[];
  rows: ParsedTabularRow[];
  issues: TabularIssue[];
  aggregateChars: number;
};
