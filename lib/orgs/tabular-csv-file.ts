import "server-only";

import {
  parseCsvRecords,
  type CsvParseDeadlineHooks,
} from "@/lib/orgs/tabular-csv";
import { enforceTabularDeadline, invalid } from "@/lib/orgs/tabular-helpers";
import {
  CsvMappingError,
  canonicalizeCsvMapping,
  mapCsvRows,
  parseCsvMappingInput,
  validateCsvMapping,
  type CsvMappedPreviewRow,
  type CsvMappedRowIssue,
  type CsvMappingInput,
  type CsvMappingTargetFamily,
} from "@/lib/orgs/tabular-mapping";
import { buildPreview, prepareTabularInput } from "@/lib/orgs/tabular-preview";
import {
  CSV_MAPPED_FILE_MAX_ISSUES,
  CSV_RECORD_BATCH_SIZE,
  TABULAR_MIME_BY_KIND,
  type ParsedTabularSheet,
} from "@/lib/orgs/tabular-types";

export { CSV_MAPPED_FILE_MAX_ISSUES, CSV_RECORD_BATCH_SIZE };

export type CsvMappedFileResult = {
  family: CsvMappingTargetFamily;
  mapping: CsvMappingInput;
  mappingIdentity: string;
  filename: string;
  mimeType: string;
  byteLength: number;
  sourceChecksum: string;
  totalRowCount: number;
  nonblankRowCount: number;
  validRowCount: number;
  invalidRowCount: number;
  skippedBlankRowCount: number;
  processedRowCount: number;
  validationComplete: boolean;
  persistenceEligible: boolean;
  rows: CsvMappedPreviewRow[];
  issues: CsvMappedRowIssue[];
  issueCount: number;
  hasMoreIssues: boolean;
};

export type ValidateMappedCsvFileInput = {
  bytes: Uint8Array;
  filename: string;
  declaredMimeType: string;
  mapping: unknown;
  now?: CsvParseDeadlineHooks["now"];
  shouldTimeout?: CsvParseDeadlineHooks["shouldTimeout"];
};

export async function validateMappedCsvFile(
  input: ValidateMappedCsvFileInput,
): Promise<CsvMappedFileResult> {
  const now = input.now ?? (() => performance.now());
  const hooks: CsvParseDeadlineHooks = {
    now,
    shouldTimeout: input.shouldTimeout,
  };
  const started = now();
  const prepared = prepareTabularInput({
    bytes: input.bytes,
    filename: input.filename,
    declaredMimeType: input.declaredMimeType,
  });
  if (prepared.kind !== "csv") {
    throw new CsvMappingError(
      "unsupported_kind",
      "Only CSV previews can be mapped.",
    );
  }

  let parsed: CsvMappingInput | null = null;
  let assignments: ReturnType<typeof validateCsvMapping> | null = null;
  let headerCount = 0;
  let headerPreview: ReturnType<typeof buildPreview> | null = null;

  const mappedRows: CsvMappedPreviewRow[] = [];
  const flattenedIssues: CsvMappedRowIssue[] = [];
  let validRowCount = 0;
  let invalidRowCount = 0;
  let skippedBlankRowCount = 0;
  let observedIssueCount = 0;
  let hasMoreIssues = false;
  let validationComplete = true;

  const ensureMapping = () => {
    if (assignments && parsed) {
      return { parsed, assignments };
    }
    if (!headerPreview) {
      throw new CsvMappingError(
        "invalid_mapping",
        "The mapping is not a valid CSV mapping object.",
      );
    }
    parsed = canonicalizeCsvMapping(parseCsvMappingInput(input.mapping));
    assignments = validateCsvMapping(headerPreview, parsed);
    return { parsed, assignments };
  };

  const parsedSheet = await parseCsvRecords(prepared.bytes, started, hooks, {
    onHeader(headers, headerIssues) {
      headerCount = headers.length;
      const sheet: ParsedTabularSheet = {
        info: { name: "Sheet1", index: 0, visibility: "visible" },
        headerRowNumber: 1,
        headers,
        rows: [],
        issues: headerIssues,
        aggregateChars: 0,
      };
      headerPreview = buildPreview({
        kind: "csv",
        filename: prepared.filename,
        bytes: prepared.bytes,
        sha256: prepared.sha256,
        sheets: [sheet.info],
        selected: sheet,
        extraIssues: [],
      });
    },
    onRow(row, rowIssues) {
      if (rowIssues.length > 0) {
        throw new CsvMappingError(
          "parser_not_ready",
          "The CSV preview is not ready for mapping until parser issues are resolved.",
        );
      }
      const ready = ensureMapping();
      const mapped = mapCsvRows(
        [row],
        headerCount,
        ready.assignments,
        ready.parsed.family,
      );
      skippedBlankRowCount += mapped.skippedBlankRowCount;
      for (const mappedRow of mapped.rows) {
        const accepted = appendMappedRow(
          mappedRow,
          flattenedIssues,
          observedIssueCount,
        );
        observedIssueCount = accepted.observedIssueCount;
        mappedRows.push(mappedRow);
        if (mappedRow.issues.length === 0) {
          validRowCount += 1;
        } else {
          invalidRowCount += 1;
        }
        if (accepted.hasMoreIssues) {
          hasMoreIssues = true;
          validationComplete = false;
          return "stop";
        }
      }
      return "continue";
    },
  });

  const ready = ensureMapping();

  if (hooks.shouldTimeout?.("before_return", parsedSheet.processedRowCount)) {
    throw invalid("timeout", "Tabular validation exceeded its time limit.");
  }
  enforceTabularDeadline(started, now);

  const persistenceEligible =
    validationComplete && invalidRowCount === 0 && !hasMoreIssues;

  return {
    family: ready.parsed.family,
    mapping: ready.parsed,
    mappingIdentity: JSON.stringify(ready.parsed),
    filename: prepared.filename,
    mimeType: TABULAR_MIME_BY_KIND.csv,
    byteLength: prepared.bytes.byteLength,
    sourceChecksum: prepared.sha256,
    totalRowCount: parsedSheet.processedRowCount,
    nonblankRowCount: mappedRows.length,
    validRowCount,
    invalidRowCount,
    skippedBlankRowCount,
    processedRowCount: parsedSheet.processedRowCount,
    validationComplete,
    persistenceEligible,
    rows: mappedRows,
    issues: flattenedIssues,
    issueCount: flattenedIssues.length,
    hasMoreIssues,
  };
}

function appendMappedRow(
  row: CsvMappedPreviewRow,
  flattenedIssues: CsvMappedRowIssue[],
  observedIssueCount: number,
): { observedIssueCount: number; hasMoreIssues: boolean } {
  for (const issue of row.issues) {
    observedIssueCount += 1;
    if (observedIssueCount > CSV_MAPPED_FILE_MAX_ISSUES) {
      return { observedIssueCount, hasMoreIssues: true };
    }
    flattenedIssues.push(issue);
  }
  return { observedIssueCount, hasMoreIssues: false };
}
