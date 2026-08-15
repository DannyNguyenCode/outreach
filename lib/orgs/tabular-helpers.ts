import "server-only";

import {
  TABULAR_MAX_PARSE_MS,
  type TabularIssue,
  type TabularIssueCode,
  type TabularIssueSeverity,
  type TabularValidationCode,
} from "@/lib/orgs/tabular-types";

export class TabularValidationError extends Error {
  constructor(
    readonly code: TabularValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "TabularValidationError";
  }
}

export function invalid(
  code: TabularValidationCode,
  message: string,
): TabularValidationError {
  return new TabularValidationError(code, message);
}

export type TabularNow = () => number;

export function enforceTabularDeadline(
  started: number,
  now: TabularNow = () => performance.now(),
): void {
  if (now() - started > TABULAR_MAX_PARSE_MS) {
    throw invalid("timeout", "Tabular validation exceeded its time limit.");
  }
}

export function normalizeMime(raw: string): string {
  return raw.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

export function sanitizeTabularFilename(raw: string): string {
  const leaf = raw.normalize("NFKC").split(/[\\/]/).pop()?.trim() ?? "";
  let value = leaf
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>:"|?*]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "");
  if (!value || value === "." || value === "..") {
    throw invalid("filename", "A valid filename is required.");
  }
  const dot = value.lastIndexOf(".");
  const extension = dot >= 0 ? value.slice(dot).toLowerCase() : "";
  const stem = (dot >= 0 ? value.slice(0, dot) : value).slice(0, 170);
  value = `${stem}${extension}`.slice(0, 180);
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) {
    value = `_${value}`;
  }
  if (!value.trim()) {
    throw invalid("filename", "A valid filename is required.");
  }
  return value;
}

export function issue(
  code: TabularIssueCode,
  severity: TabularIssueSeverity,
  location: Omit<TabularIssue, "code" | "severity"> = {},
): TabularIssue {
  const result: TabularIssue = { code, severity };
  if (location.sheetIndex !== undefined) {
    result.sheetIndex = location.sheetIndex;
  }
  if (location.sheetName !== undefined) {
    result.sheetName = location.sheetName;
  }
  if (location.row !== undefined) {
    result.row = location.row;
  }
  if (location.column !== undefined) {
    result.column = location.column;
  }
  return result;
}

export function isFormulaLike(value: string): boolean {
  const first = value.charAt(0);
  return (
    first === "=" ||
    first === "+" ||
    first === "-" ||
    first === "@" ||
    first === "\t" ||
    first === "\r" ||
    first === "\n"
  );
}

export function normalizeHeaderName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export function isArchiveSignature(bytes: Uint8Array): boolean {
  return (
    (bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07) &&
      (bytes[3] === 0x04 || bytes[3] === 0x06 || bytes[3] === 0x08)) ||
    (bytes[0] === 0x1f && bytes[1] === 0x8b) ||
    (bytes[0] === 0x37 &&
      bytes[1] === 0x7a &&
      bytes[2] === 0xbc &&
      bytes[3] === 0xaf)
  );
}

export function isOleSignature(bytes: Uint8Array): boolean {
  return (
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0
  );
}

export function isExecutableSignature(bytes: Uint8Array): boolean {
  return bytes[0] === 0x4d && bytes[1] === 0x5a;
}

export function isPdfSignature(bytes: Uint8Array): boolean {
  return (
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  );
}

export function columnLettersToIndex(letters: string): number {
  let index = 0;
  for (const character of letters) {
    const code = character.charCodeAt(0);
    if (code < 65 || code > 90) {
      throw invalid("malformed", "The spreadsheet contains an invalid cell.");
    }
    index = index * 26 + (code - 64);
  }
  return index;
}

export function parseCellRef(ref: string): { column: number; row: number } {
  const match = /^([A-Z]+)([1-9][0-9]*)$/.exec(ref.toUpperCase());
  if (!match) {
    throw invalid("malformed", "The spreadsheet contains an invalid cell.");
  }
  const row = Number.parseInt(match[2] ?? "", 10);
  if (!Number.isSafeInteger(row) || row < 1) {
    throw invalid("malformed", "The spreadsheet contains an invalid cell.");
  }
  return { column: columnLettersToIndex(match[1] ?? ""), row };
}
