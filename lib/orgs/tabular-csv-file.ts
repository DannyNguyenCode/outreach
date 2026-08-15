import "server-only";

import { enforceTabularDeadline } from "@/lib/orgs/tabular-helpers";
import {
  CsvMappingError,
  mapCsvRows,
  parseCsvMappingInput,
  validateCsvMapping,
  type CsvMappedPreviewRow,
  type CsvMappedRowIssue,
  type CsvMappingInput,
  type CsvMappingTargetFamily,
} from "@/lib/orgs/tabular-mapping";
import {
  inspectPreparedCsv,
  prepareTabularInput,
} from "@/lib/orgs/tabular-preview";
import { CSV_MAPPED_FILE_MAX_ISSUES } from "@/lib/orgs/tabular-types";

export { CSV_MAPPED_FILE_MAX_ISSUES } from "@/lib/orgs/tabular-types";

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
  rows: CsvMappedPreviewRow[];
  issues: CsvMappedRowIssue[];
  issueCount: number;
  hasMoreIssues: boolean;
};

export function validateMappedCsvFile(input: {
  bytes: Uint8Array;
  filename: string;
  declaredMimeType: string;
  mapping: unknown;
}): CsvMappedFileResult {
  const started = performance.now();
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

  const inspection = inspectPreparedCsv(prepared, started);
  const parsed = parseCsvMappingInput(input.mapping);
  const assignments = validateCsvMapping(inspection.preview, parsed);
  enforceTabularDeadline(started);
  const mapped = mapCsvRows(
    inspection.rows,
    inspection.preview.headers.length,
    assignments,
    parsed.family,
  );
  enforceTabularDeadline(started);

  let validRowCount = 0;
  let invalidRowCount = 0;
  const allIssues: CsvMappedRowIssue[] = [];
  for (const row of mapped.rows) {
    if (row.issues.length === 0) {
      validRowCount += 1;
    } else {
      invalidRowCount += 1;
      allIssues.push(...row.issues);
    }
  }

  const issueCount = allIssues.length;
  const mapping = canonicalizeMapping(parsed);

  return {
    family: parsed.family,
    mapping,
    mappingIdentity: JSON.stringify(mapping),
    filename: inspection.preview.filename,
    mimeType: inspection.preview.mimeType,
    byteLength: inspection.preview.byteLength,
    sourceChecksum: inspection.preview.sha256,
    totalRowCount: inspection.preview.totalRowCount,
    nonblankRowCount: mapped.rows.length,
    validRowCount,
    invalidRowCount,
    skippedBlankRowCount: mapped.skippedBlankRowCount,
    rows: mapped.rows,
    issues: allIssues.slice(0, CSV_MAPPED_FILE_MAX_ISSUES),
    issueCount,
    hasMoreIssues: issueCount > CSV_MAPPED_FILE_MAX_ISSUES,
  };
}

function canonicalizeMapping(mapping: CsvMappingInput): CsvMappingInput {
  return {
    family: mapping.family,
    columns: mapping.columns.map((column) => ({
      sourceColumn: column.sourceColumn,
      target: column.target,
    })),
  };
}
