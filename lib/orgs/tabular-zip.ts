import "server-only";

import {
  TABULAR_ZIP_MAX_ENTRIES,
  TABULAR_ZIP_MAX_ENTRY_BYTES,
  TABULAR_ZIP_MAX_EXPANDED_BYTES,
  TABULAR_ZIP_MAX_RATIO,
  TABULAR_ZIP_MAX_TOTAL_RATIO,
} from "@/lib/orgs/tabular-types";
import { invalid, TabularValidationError } from "@/lib/orgs/tabular-helpers";

export type TabularZipEntry = {
  name: string;
  compressedSize: number;
  expandedSize: number;
};

export function inspectTabularZipDirectory(
  bytes: Uint8Array,
): TabularZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = locateEocd(view);
  const entriesCount = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  const commentLength = view.getUint16(eocd + 20, true);
  if (
    entriesCount === 0xffff ||
    directoryOffset === 0xffffffff ||
    directorySize === 0xffffffff
  ) {
    throw invalid("zip_bomb", "ZIP64 spreadsheet files are not supported.");
  }
  if (entriesCount > TABULAR_ZIP_MAX_ENTRIES) {
    throw invalid("zip_bomb", "The spreadsheet contains too many ZIP entries.");
  }
  if (
    eocd + 22 + commentLength !== bytes.byteLength ||
    directoryOffset + directorySize !== eocd
  ) {
    throw invalid(
      "polyglot",
      "The spreadsheet contains data outside its ZIP archive.",
    );
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const entries: TabularZipEntry[] = [];
  const names = new Set<string>();
  let cursor = directoryOffset;
  let totalCompressed = 0;
  let totalExpanded = 0;
  try {
    for (let index = 0; index < entriesCount; index += 1) {
      if (view.getUint32(cursor, true) !== 0x02014b50) {
        throw invalid(
          "malformed",
          "The spreadsheet ZIP directory is malformed.",
        );
      }
      const flags = view.getUint16(cursor + 8, true);
      if ((flags & 0x1) !== 0) {
        throw invalid("encrypted", "Encrypted spreadsheets are not supported.");
      }
      const compressedSize = view.getUint32(cursor + 20, true);
      const expandedSize = view.getUint32(cursor + 24, true);
      const nameLength = view.getUint16(cursor + 28, true);
      const extraLength = view.getUint16(cursor + 30, true);
      const entryCommentLength = view.getUint16(cursor + 32, true);
      const end = cursor + 46 + nameLength + extraLength + entryCommentLength;
      if (end > eocd || nameLength === 0) {
        throw invalid("malformed", "The spreadsheet ZIP entry is malformed.");
      }
      const name = decoder.decode(
        bytes.subarray(cursor + 46, cursor + 46 + nameLength),
      );
      if (name.includes("\u0000")) {
        throw invalid("malformed", "The spreadsheet ZIP entry is malformed.");
      }
      const normalizedName = name.replaceAll("\\", "/").toLowerCase();
      if (names.has(normalizedName)) {
        throw invalid(
          "malformed",
          "The spreadsheet contains duplicate ZIP paths.",
        );
      }
      names.add(normalizedName);
      if (
        name.includes("\\") ||
        name.startsWith("/") ||
        name.split("/").includes("..")
      ) {
        throw invalid(
          "malformed",
          "The spreadsheet contains an unsafe ZIP path.",
        );
      }
      if (expandedSize > TABULAR_ZIP_MAX_ENTRY_BYTES) {
        throw invalid(
          "zip_bomb",
          "A spreadsheet ZIP entry expands beyond its limit.",
        );
      }
      if (
        compressedSize > 0 &&
        expandedSize / compressedSize > TABULAR_ZIP_MAX_RATIO
      ) {
        throw invalid(
          "zip_bomb",
          "A spreadsheet ZIP entry has an unsafe ratio.",
        );
      }
      totalCompressed += compressedSize;
      totalExpanded += expandedSize;
      entries.push({ name, compressedSize, expandedSize });
      cursor = end;
    }
  } catch (error) {
    if (error instanceof TabularValidationError) {
      throw error;
    }
    throw invalid("malformed", "The spreadsheet ZIP directory is malformed.");
  }
  if (cursor !== eocd || totalExpanded > TABULAR_ZIP_MAX_EXPANDED_BYTES) {
    throw invalid("zip_bomb", "The spreadsheet expands beyond its safe limit.");
  }
  if (
    totalCompressed > 0 &&
    totalExpanded / totalCompressed > TABULAR_ZIP_MAX_TOTAL_RATIO
  ) {
    throw invalid(
      "zip_bomb",
      "The spreadsheet has an unsafe compression ratio.",
    );
  }
  return entries.filter((entry) => !entry.name.endsWith("/"));
}

function locateEocd(view: DataView): number {
  const earliest = Math.max(0, view.byteLength - 65_557);
  for (let cursor = view.byteLength - 22; cursor >= earliest; cursor -= 1) {
    if (view.getUint32(cursor, true) === 0x06054b50) {
      return cursor;
    }
  }
  throw invalid("malformed", "The spreadsheet ZIP end record is missing.");
}
