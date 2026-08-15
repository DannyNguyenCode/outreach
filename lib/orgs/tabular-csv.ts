import "server-only";

import { parse } from "csv-parse";
import { Readable } from "node:stream";

import {
  enforceTabularDeadline,
  invalid,
  isFormulaLike,
  issue,
  type TabularNow,
} from "@/lib/orgs/tabular-helpers";
import {
  CSV_MAX_RECORD_SIZE,
  CSV_RECORD_BATCH_SIZE,
  TABULAR_MAX_AGGREGATE_CHARS,
  TABULAR_MAX_CELL_CHARS,
  TABULAR_MAX_COLUMNS,
  TABULAR_MAX_ROWS,
  type ParsedTabularRow,
  type ParsedTabularSheet,
  type TabularIssue,
} from "@/lib/orgs/tabular-types";

export { CSV_MAX_RECORD_SIZE, CSV_RECORD_BATCH_SIZE };

export const CSV_PARSE_PACKAGE = "csv-parse";
export const CSV_PARSE_VERSION = "7.0.2";

const CSV_TEXT_CHUNK_CHARS = 64 * 1024;

export type CsvDeadlineCheckpoint =
  "before_parse" | "batch" | "final_partial_batch" | "before_return";

export type CsvParseDeadlineHooks = {
  now?: TabularNow;
  shouldTimeout?: (
    checkpoint: CsvDeadlineCheckpoint,
    processedRowCount: number,
  ) => boolean;
};

export type CsvRecordDecision = "continue" | "stop";

export type CsvParsedRecordHandler = {
  onHeader: (
    headers: string[],
    issues: TabularIssue[],
  ) => CsvRecordDecision | void;
  onRow: (
    row: ParsedTabularRow,
    issues: TabularIssue[],
  ) => CsvRecordDecision | void;
};

export async function parseCsvSheet(
  bytes: Uint8Array,
  started: number,
  hooks: CsvParseDeadlineHooks = {},
): Promise<ParsedTabularSheet> {
  const issues: TabularIssue[] = [];
  const rows: ParsedTabularRow[] = [];
  let headers: string[] = [];

  const parsed = await parseCsvRecords(bytes, started, hooks, {
    onHeader(nextHeaders, headerIssues) {
      headers = nextHeaders;
      issues.push(...headerIssues);
    },
    onRow(row, rowIssues) {
      rows.push(row);
      issues.push(...rowIssues);
    },
  });

  if (headers.length === 0) {
    throw invalid("malformed", "The CSV file does not contain any records.");
  }

  return {
    info: { name: "Sheet1", index: 0, visibility: "visible" },
    headerRowNumber: 1,
    headers,
    rows,
    issues,
    aggregateChars: parsed.aggregateChars,
  };
}

export async function parseCsvRecords(
  bytes: Uint8Array,
  started: number,
  hooks: CsvParseDeadlineHooks,
  handler: CsvParsedRecordHandler,
): Promise<{
  stoppedEarly: boolean;
  processedRowCount: number;
  aggregateChars: number;
}> {
  const now = hooks.now ?? (() => performance.now());
  checkDeadline(started, hooks, now, "before_parse", 0);

  const text = decodeCsvText(bytes);
  const parser = createCsvParser();
  const input = createCsvTextStream(text);
  const pipeline = input.pipe(parser);

  let headers: string[] | null = null;
  let aggregateChars = 0;
  let recordCount = 0;
  let processedRowCount = 0;
  let stoppedEarly = false;
  const pendingBlank: string[][] = [];

  const stopParser = () => {
    stoppedEarly = true;
    destroyQuietly(input);
    destroyQuietly(pipeline);
  };

  const flushPendingBlanks = (): CsvRecordDecision => {
    for (const record of pendingBlank) {
      const processed = processDataRecord(
        record,
        headers ?? [],
        recordCountToSourceRow(processedRowCount),
        aggregateChars,
      );
      aggregateChars = processed.aggregateChars;
      processedRowCount += 1;
      const decision =
        handler.onRow(processed.row, processed.issues) ?? "continue";
      if (decision === "stop") {
        return "stop";
      }
      checkBatchDeadline(started, hooks, now, processedRowCount);
    }
    pendingBlank.length = 0;
    return "continue";
  };

  try {
    for await (const record of pipeline) {
      if (!Array.isArray(record)) {
        throw invalid("malformed", "The CSV quoting is invalid.");
      }
      const fields = record.map((value) => String(value));
      recordCount += 1;
      if (recordCount > TABULAR_MAX_ROWS) {
        stopParser();
        throw invalid("too_many_rows", "The CSV file has too many rows.");
      }

      if (headers === null) {
        const processed = processHeaderRecord(fields, aggregateChars);
        aggregateChars = processed.aggregateChars;
        headers = processed.headers;
        const decision =
          handler.onHeader(headers, processed.issues) ?? "continue";
        if (decision === "stop") {
          stopParser();
          break;
        }
        continue;
      }

      if (isRawBlankRecord(fields)) {
        pendingBlank.push(fields);
        continue;
      }

      if (flushPendingBlanks() === "stop") {
        stopParser();
        break;
      }

      const processed = processDataRecord(
        fields,
        headers,
        recordCountToSourceRow(processedRowCount),
        aggregateChars,
      );
      aggregateChars = processed.aggregateChars;
      processedRowCount += 1;
      const decision =
        handler.onRow(processed.row, processed.issues) ?? "continue";
      if (decision === "stop") {
        stopParser();
        break;
      }
      checkBatchDeadline(started, hooks, now, processedRowCount);
    }
  } catch (error) {
    stopParser();
    if (
      error instanceof Error &&
      (error.name === "TabularValidationError" ||
        error.name === "CsvMappingError")
    ) {
      throw error;
    }
    if (stoppedEarly && isPrematureClose(error)) {
      return { stoppedEarly: true, processedRowCount, aggregateChars };
    }
    throw mapCsvParseError(error);
  } finally {
    destroyQuietly(input);
    destroyQuietly(pipeline);
  }

  if (!stoppedEarly && pendingBlank.length > 0) {
    // Trailing blank records are discarded without cell processing, matching
    // the historical RFC 4180 parser's post-parse trailing-strip.
    pendingBlank.length = 0;
  }

  if (!stoppedEarly && processedRowCount % CSV_RECORD_BATCH_SIZE !== 0) {
    checkDeadline(
      started,
      hooks,
      now,
      "final_partial_batch",
      processedRowCount,
    );
  } else if (!stoppedEarly && processedRowCount === 0) {
    checkDeadline(
      started,
      hooks,
      now,
      "final_partial_batch",
      processedRowCount,
    );
  }

  if (headers === null) {
    throw invalid("malformed", "The CSV file does not contain any records.");
  }

  return { stoppedEarly, processedRowCount, aggregateChars };
}

function recordCountToSourceRow(processedRowCount: number): number {
  return processedRowCount + 2;
}

function processHeaderRecord(
  record: string[],
  startingAggregate: number,
): { headers: string[]; issues: TabularIssue[]; aggregateChars: number } {
  if (record.length > TABULAR_MAX_COLUMNS) {
    throw invalid("too_many_columns", "The CSV file has too many columns.");
  }
  if (record.length === 0) {
    throw invalid("malformed", "The CSV file does not contain any records.");
  }

  const issues: TabularIssue[] = [];
  let aggregateChars = startingAggregate;
  const headers: string[] = [];
  for (const [index, raw] of record.entries()) {
    if (raw.length > TABULAR_MAX_CELL_CHARS) {
      throw invalid(
        "cell_too_long",
        "A CSV cell exceeds the permitted length.",
      );
    }
    if (isFormulaLike(raw)) {
      issues.push(
        issue("formula_like", "warning", {
          sheetIndex: 0,
          row: 1,
          column: index + 1,
        }),
      );
    }
    const cell = normalizeCell(raw);
    aggregateChars = addAggregate(aggregateChars, cell);
    headers.push(cell);
  }
  return { headers, issues, aggregateChars };
}

function processDataRecord(
  record: string[],
  headers: string[],
  sourceRowNumber: number,
  startingAggregate: number,
): { row: ParsedTabularRow; issues: TabularIssue[]; aggregateChars: number } {
  if (record.length > TABULAR_MAX_COLUMNS) {
    throw invalid("too_many_columns", "The CSV file has too many columns.");
  }

  const issues: TabularIssue[] = [];
  let aggregateChars = startingAggregate;
  if (record.length > headers.length) {
    issues.push(
      issue("extra_columns", "warning", {
        sheetIndex: 0,
        row: sourceRowNumber,
      }),
    );
  } else if (record.length !== headers.length) {
    issues.push(
      issue("inconsistent_columns", "warning", {
        sheetIndex: 0,
        row: sourceRowNumber,
      }),
    );
  }

  const cells: string[] = [];
  const fieldCount = Math.max(record.length, headers.length);
  for (let column = 0; column < fieldCount; column += 1) {
    const raw = record[column] ?? "";
    if (raw.length > TABULAR_MAX_CELL_CHARS) {
      throw invalid(
        "cell_too_long",
        "A CSV cell exceeds the permitted length.",
      );
    }
    if (isFormulaLike(raw)) {
      issues.push(
        issue("formula_like", "warning", {
          sheetIndex: 0,
          row: sourceRowNumber,
          column: column + 1,
        }),
      );
    }
    const cell = normalizeCell(raw);
    aggregateChars = addAggregate(aggregateChars, cell);
    if (column < headers.length) {
      cells.push(cell);
    }
  }

  return {
    row: { sourceRowNumber, cells },
    issues,
    aggregateChars,
  };
}

function decodeCsvText(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw invalid("invalid_encoding", "CSV files must use valid UTF-8.");
  }
  if (text.startsWith("\uFEFF")) {
    text = text.slice(1);
  }
  rejectBinaryCsv(text);
  text = text.replace(/[ \t\r\n]*$/u, "");
  if (!text) {
    throw invalid("malformed", "The CSV file does not contain any records.");
  }
  return text;
}

function createCsvParser() {
  return parse({
    bom: true,
    columns: false,
    delimiter: ",",
    escape: '"',
    info: false,
    ltrim: false,
    max_record_size: CSV_MAX_RECORD_SIZE,
    quote: '"',
    raw: false,
    record_delimiter: ["\n", "\r\n", "\r"],
    relax_column_count: true,
    relax_quotes: false,
    rtrim: false,
    skip_empty_lines: false,
    skip_records_with_error: false,
    trim: false,
  });
}

function createCsvTextStream(text: string): Readable {
  let offset = 0;
  return new Readable({
    read() {
      if (offset >= text.length) {
        this.push(null);
        return;
      }
      const next = text.slice(offset, offset + CSV_TEXT_CHUNK_CHARS);
      offset += next.length;
      this.push(next);
    },
  });
}

function checkDeadline(
  started: number,
  hooks: CsvParseDeadlineHooks,
  now: TabularNow,
  checkpoint: CsvDeadlineCheckpoint,
  processedRowCount: number,
): void {
  if (hooks.shouldTimeout?.(checkpoint, processedRowCount)) {
    throw invalid("timeout", "Tabular validation exceeded its time limit.");
  }
  enforceTabularDeadline(started, now);
}

function checkBatchDeadline(
  started: number,
  hooks: CsvParseDeadlineHooks,
  now: TabularNow,
  processedRowCount: number,
): void {
  if (
    processedRowCount === 0 ||
    processedRowCount % CSV_RECORD_BATCH_SIZE !== 0
  ) {
    return;
  }
  checkDeadline(started, hooks, now, "batch", processedRowCount);
}

function mapCsvParseError(error: unknown): never {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  if (code === "CSV_QUOTE_NOT_CLOSED") {
    throw invalid(
      "malformed",
      "The CSV file has an unterminated quoted field.",
    );
  }
  if (code === "CSV_MAX_RECORD_SIZE") {
    throw invalid("cell_too_long", "A CSV cell exceeds the permitted length.");
  }
  if (
    code === "CSV_INVALID_CLOSING_QUOTE" ||
    code === "CSV_INVALID_OPENING_QUOTE" ||
    code === "INVALID_OPENING_QUOTE"
  ) {
    throw invalid("malformed", "The CSV quoting is invalid.");
  }
  throw invalid("malformed", "The CSV quoting is invalid.");
}

function isPrematureClose(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  return (
    String((error as { code?: unknown }).code) === "ERR_STREAM_PREMATURE_CLOSE"
  );
}

function destroyQuietly(stream: { destroy?: () => void; destroyed?: boolean }) {
  if (stream.destroyed) return;
  try {
    stream.destroy?.();
  } catch {
    // Parser shutdown must not leak csv-parse or stream diagnostics.
  }
}

function isRawBlankRecord(record: string[]): boolean {
  return record.every((value) => value.trim() === "");
}

function normalizeCell(value: string): string {
  return value.trim();
}

function addAggregate(current: number, cell: string): number {
  const next = current + cell.length;
  if (next > TABULAR_MAX_AGGREGATE_CHARS) {
    throw invalid(
      "text_too_large",
      "The CSV file contains too much cell text.",
    );
  }
  return next;
}

function rejectBinaryCsv(text: string): void {
  if (text.includes("\u0000")) {
    throw invalid("binary_text", "CSV files may not contain NUL bytes.");
  }
  let controls = 0;
  for (const character of text) {
    const code = character.charCodeAt(0);
    if (
      (code < 32 && code !== 9 && code !== 10 && code !== 13) ||
      code === 127
    ) {
      controls += 1;
    }
  }
  if (controls > Math.max(2, Math.floor(text.length * 0.01))) {
    throw invalid(
      "binary_text",
      "The CSV file appears to contain binary data.",
    );
  }
}
