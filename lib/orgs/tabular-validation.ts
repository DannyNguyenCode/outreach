import "server-only";

import type {
  ParsedTabularSheet,
  TabularIssue,
  TabularNormalizedPreview,
} from "@/lib/orgs/tabular-types";
import {
  invalid,
  isExecutableSignature,
  isOleSignature,
  isPdfSignature,
  issue,
} from "@/lib/orgs/tabular-helpers";
import {
  buildPreview,
  inspectPreparedCsv,
  prepareTabularInput,
} from "@/lib/orgs/tabular-preview";
import { parseXlsxWorkbook } from "@/lib/orgs/tabular-xlsx";

export {
  TabularValidationError,
  sanitizeTabularFilename,
} from "@/lib/orgs/tabular-helpers";
export {
  CSV_MAPPED_FILE_MAX_ISSUES,
  CSV_MAX_RECORD_SIZE,
  CSV_RECORD_BATCH_SIZE,
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
  const prepared = prepareTabularInput(input);
  const started = performance.now();

  if (prepared.kind === "csv") {
    return (await inspectPreparedCsv(prepared, started)).preview;
  }

  assertXlsxSignature(prepared.bytes);
  const workbook = await parseXlsxWorkbook(prepared.bytes, started);
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
    kind: prepared.kind,
    filename: prepared.filename,
    bytes: prepared.bytes,
    sha256: prepared.sha256,
    sheets: workbook.sheets,
    selected,
    extraIssues,
  });
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
