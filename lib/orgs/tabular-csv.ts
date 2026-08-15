import "server-only";

import {
  TABULAR_MAX_AGGREGATE_CHARS,
  TABULAR_MAX_CELL_CHARS,
  TABULAR_MAX_COLUMNS,
  TABULAR_MAX_ROWS,
  type ParsedTabularRow,
  type ParsedTabularSheet,
} from "@/lib/orgs/tabular-types";
import {
  enforceTabularDeadline,
  invalid,
  isFormulaLike,
  issue,
} from "@/lib/orgs/tabular-helpers";

export function parseCsvSheet(
  bytes: Uint8Array,
  started: number,
): ParsedTabularSheet {
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

  const records = parseCsvRecords(text, started);
  if (records.length === 0) {
    throw invalid("malformed", "The CSV file does not contain any records.");
  }
  if (records.length > TABULAR_MAX_ROWS) {
    throw invalid("too_many_rows", "The CSV file has too many rows.");
  }

  const headerRecord = records[0] ?? [];
  if (headerRecord.length > TABULAR_MAX_COLUMNS) {
    throw invalid("too_many_columns", "The CSV file has too many columns.");
  }
  if (headerRecord.length === 0) {
    throw invalid("malformed", "The CSV file does not contain any records.");
  }

  const issues = [];
  let aggregateChars = 0;
  const headers: string[] = [];
  for (const [index, raw] of headerRecord.entries()) {
    enforceTabularDeadline(started);
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

  const rows: ParsedTabularRow[] = [];
  for (let recordIndex = 1; recordIndex < records.length; recordIndex += 1) {
    enforceTabularDeadline(started);
    const record = records[recordIndex] ?? [];
    if (record.length > TABULAR_MAX_COLUMNS) {
      throw invalid("too_many_columns", "The CSV file has too many columns.");
    }
    if (record.length > headers.length) {
      issues.push(
        issue("extra_columns", "warning", {
          sheetIndex: 0,
          row: recordIndex + 1,
        }),
      );
    } else if (record.length !== headers.length) {
      issues.push(
        issue("inconsistent_columns", "warning", {
          sheetIndex: 0,
          row: recordIndex + 1,
        }),
      );
    }
    const cells: string[] = [];
    const fieldCount = Math.max(record.length, headers.length);
    for (let column = 0; column < fieldCount; column += 1) {
      const raw = record[column] ?? "";
      if (isFormulaLike(raw)) {
        issues.push(
          issue("formula_like", "warning", {
            sheetIndex: 0,
            row: recordIndex + 1,
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
    rows.push({ sourceRowNumber: recordIndex + 1, cells });
  }

  return {
    info: { name: "Sheet1", index: 0, visibility: "visible" },
    headerRowNumber: 1,
    headers,
    rows,
    issues,
    aggregateChars,
  };
}

function parseCsvRecords(text: string, started: number): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let afterQuotedField = false;
  let i = 0;

  const pushField = () => {
    if (field.length > TABULAR_MAX_CELL_CHARS) {
      throw invalid(
        "cell_too_long",
        "A CSV cell exceeds the permitted length.",
      );
    }
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    records.push(row);
    row = [];
    if (records.length > TABULAR_MAX_ROWS) {
      throw invalid("too_many_rows", "The CSV file has too many rows.");
    }
  };

  while (i < text.length) {
    if (i % 4096 === 0) {
      enforceTabularDeadline(started);
    }
    const character = text[i] ?? "";
    if (inQuotes) {
      if (character === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        afterQuotedField = true;
        i += 1;
        continue;
      }
      field += character;
      if (field.length > TABULAR_MAX_CELL_CHARS) {
        throw invalid(
          "cell_too_long",
          "A CSV cell exceeds the permitted length.",
        );
      }
      i += 1;
      continue;
    }
    if (afterQuotedField) {
      if (character !== "," && character !== "\n" && character !== "\r") {
        throw invalid("malformed", "The CSV quoting is invalid.");
      }
      afterQuotedField = false;
    }
    if (character === '"') {
      if (field.length > 0) {
        throw invalid("malformed", "The CSV quoting is invalid.");
      }
      inQuotes = true;
      i += 1;
      continue;
    }
    if (character === ",") {
      pushField();
      i += 1;
      continue;
    }
    if (character === "\n" || character === "\r") {
      pushField();
      pushRow();
      if (character === "\r" && text[i + 1] === "\n") {
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }
    field += character;
    if (field.length > TABULAR_MAX_CELL_CHARS) {
      throw invalid(
        "cell_too_long",
        "A CSV cell exceeds the permitted length.",
      );
    }
    i += 1;
  }

  if (inQuotes) {
    throw invalid(
      "malformed",
      "The CSV file has an unterminated quoted field.",
    );
  }
  if (field.length > 0 || row.length > 0) {
    pushField();
    pushRow();
  }

  while (
    records.length > 0 &&
    (records[records.length - 1] ?? []).every((value) => value.trim() === "")
  ) {
    records.pop();
  }
  return records;
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
