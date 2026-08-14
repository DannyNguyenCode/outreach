import "server-only";

import { createHash } from "node:crypto";

import JSZip from "jszip";

import {
  DOCUMENT_MAX_BYTES,
  type DocumentKind,
  type ValidatedDocument,
} from "@/lib/orgs/document-types";

const MIME_BY_KIND: Record<DocumentKind, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
};

const ZIP_MAX_ENTRIES = 1_000;
const ZIP_MAX_EXPANDED_BYTES = 50 * 1024 * 1024;
const ZIP_MAX_ENTRY_BYTES = 20 * 1024 * 1024;
const ZIP_MAX_RATIO = 100;
const ZIP_MAX_TOTAL_RATIO = 50;
const ZIP_VALIDATION_MAX_MS = 2_000;

export type DocumentValidationCode =
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
  | "binary_text";

export class DocumentValidationError extends Error {
  constructor(
    readonly code: DocumentValidationCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DocumentValidationError";
  }
}

export async function validateDocument(input: {
  bytes: Uint8Array;
  filename: string;
  declaredMimeType: string;
}): Promise<ValidatedDocument> {
  const bytes = new Uint8Array(input.bytes);
  if (bytes.byteLength === 0) {
    throw invalid("empty", "The document is empty.");
  }
  if (bytes.byteLength > DOCUMENT_MAX_BYTES) {
    throw invalid("too_large", "Documents may not exceed 10 MiB.");
  }

  const filename = sanitizeDocumentFilename(input.filename);
  const extension = filename.split(".").pop()?.toLowerCase();
  if (extension !== "pdf" && extension !== "docx" && extension !== "txt") {
    throw invalid("unsupported_type", "Only PDF, DOCX, and TXT are supported.");
  }
  const kind = extension;
  const declaredMimeType = normalizeMime(input.declaredMimeType);
  if (declaredMimeType !== MIME_BY_KIND[kind]) {
    throw invalid(
      "type_mismatch",
      "Filename extension and declared content type do not agree.",
    );
  }

  if (kind === "pdf") {
    validatePdf(bytes);
  } else if (kind === "docx") {
    await validateDocx(bytes);
  } else {
    validateText(bytes);
  }

  return {
    bytes,
    kind,
    filename,
    mimeType: MIME_BY_KIND[kind],
    byteLength: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function sanitizeDocumentFilename(raw: string): string {
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

function validatePdf(bytes: Uint8Array): void {
  const prefix = Buffer.from(bytes.subarray(0, 8)).toString("ascii");
  if (!/^%PDF-1\.[0-9]/.test(prefix)) {
    throw invalid("invalid_signature", "The file is not a valid PDF.");
  }
  const text = Buffer.from(bytes).toString("latin1");
  if (/\/Encrypt\b/.test(text)) {
    throw invalid("encrypted", "Encrypted PDFs are not supported.");
  }
  const eof = text.lastIndexOf("%%EOF");
  if (eof < 0) {
    throw invalid("malformed", "The PDF is missing its end marker.");
  }
  if (!/^[\u0000\u0009\u000a\u000c\u000d\u0020]*$/.test(text.slice(eof + 5))) {
    throw invalid("polyglot", "The PDF contains data after its end marker.");
  }
}

async function validateDocx(bytes: Uint8Array): Promise<void> {
  if (
    bytes[0] !== 0x50 ||
    bytes[1] !== 0x4b ||
    bytes[2] !== 0x03 ||
    bytes[3] !== 0x04
  ) {
    throw invalid("invalid_signature", "The file is not a valid DOCX archive.");
  }
  const centralEntries = inspectZipDirectory(bytes);
  const started = performance.now();
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes, {
      checkCRC32: true,
      createFolders: false,
    });
  } catch (error) {
    throw invalid("malformed", "The DOCX ZIP archive is malformed.", error);
  }
  enforceDeadline(started);

  const files = Object.values(zip.files).filter((entry) => !entry.dir);
  if (files.length !== centralEntries.length) {
    throw invalid("malformed", "The DOCX ZIP directory is inconsistent.");
  }
  const documentXml = zip.file("word/document.xml");
  const contentTypesXml = zip.file("[Content_Types].xml");
  if (!documentXml || !contentTypesXml) {
    throw invalid(
      "malformed",
      "The DOCX is missing required Word document parts.",
    );
  }

  for (const entry of files) {
    enforceDeadline(started);
    const original = entry.unsafeOriginalName ?? entry.name;
    if (
      original.includes("\\") ||
      original.startsWith("/") ||
      original.split("/").includes("..")
    ) {
      throw invalid("malformed", "The DOCX contains an unsafe ZIP path.");
    }
    if (
      /(^|\/)(vbaProject\.bin|activeX\/|embeddings\/)/i.test(entry.name) ||
      /\.(docm|dotm|xlsm|pptm)$/i.test(entry.name)
    ) {
      throw invalid("macros", "Macro-enabled documents are not supported.");
    }
    const expanded = await entry.async("uint8array");
    enforceDeadline(started);
    if (
      /\.(zip|7z|rar|gz|tar|docx|xlsx|pptx)$/i.test(entry.name) ||
      isArchiveSignature(expanded)
    ) {
      throw invalid(
        "polyglot",
        "Nested archives are not permitted inside DOCX files.",
      );
    }
  }

  const [contentTypes, document] = await Promise.all([
    contentTypesXml.async("string"),
    documentXml.async("string"),
  ]);
  enforceDeadline(started);
  if (
    !/<Override\b[^>]*PartName=["']\/word\/document\.xml["'][^>]*ContentType=["']application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document\.main\+xml["'][^>]*\/?>/i.test(
      contentTypes,
    ) &&
    !/<Override\b[^>]*ContentType=["']application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document\.main\+xml["'][^>]*PartName=["']\/word\/document\.xml["'][^>]*\/?>/i.test(
      contentTypes,
    )
  ) {
    throw invalid("type_mismatch", "The ZIP is not a standard DOCX document.");
  }
  if (/macroEnabled|vbaProject|application\/vnd\.ms-/i.test(contentTypes)) {
    throw invalid("macros", "Macro-enabled documents are not supported.");
  }
  if (!/<w:document\b/i.test(document) || !/<w:body\b/i.test(document)) {
    throw invalid("malformed", "The main DOCX document XML is malformed.");
  }
}

type CentralEntry = {
  name: string;
  compressedSize: number;
  expandedSize: number;
};

function inspectZipDirectory(bytes: Uint8Array): CentralEntry[] {
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
    throw invalid("zip_bomb", "ZIP64 DOCX files are not supported.");
  }
  if (entriesCount > ZIP_MAX_ENTRIES) {
    throw invalid("zip_bomb", "The DOCX contains too many ZIP entries.");
  }
  if (
    eocd + 22 + commentLength !== bytes.byteLength ||
    directoryOffset + directorySize !== eocd
  ) {
    throw invalid(
      "polyglot",
      "The DOCX contains data outside its ZIP archive.",
    );
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const entries: CentralEntry[] = [];
  const names = new Set<string>();
  let cursor = directoryOffset;
  let totalCompressed = 0;
  let totalExpanded = 0;
  try {
    for (let index = 0; index < entriesCount; index += 1) {
      if (view.getUint32(cursor, true) !== 0x02014b50) {
        throw invalid("malformed", "The DOCX ZIP directory is malformed.");
      }
      const flags = view.getUint16(cursor + 8, true);
      if ((flags & 0x1) !== 0) {
        throw invalid(
          "encrypted",
          "Encrypted DOCX archives are not supported.",
        );
      }
      const compressedSize = view.getUint32(cursor + 20, true);
      const expandedSize = view.getUint32(cursor + 24, true);
      const nameLength = view.getUint16(cursor + 28, true);
      const extraLength = view.getUint16(cursor + 30, true);
      const entryCommentLength = view.getUint16(cursor + 32, true);
      const end = cursor + 46 + nameLength + extraLength + entryCommentLength;
      if (end > eocd || nameLength === 0) {
        throw invalid("malformed", "The DOCX ZIP entry is malformed.");
      }
      const name = decoder.decode(
        bytes.subarray(cursor + 46, cursor + 46 + nameLength),
      );
      const normalizedName = name.toLowerCase();
      if (names.has(normalizedName)) {
        throw invalid("malformed", "The DOCX contains duplicate ZIP paths.");
      }
      names.add(normalizedName);
      if (expandedSize > ZIP_MAX_ENTRY_BYTES) {
        throw invalid("zip_bomb", "A DOCX ZIP entry expands beyond its limit.");
      }
      if (compressedSize > 0 && expandedSize / compressedSize > ZIP_MAX_RATIO) {
        throw invalid("zip_bomb", "A DOCX ZIP entry has an unsafe ratio.");
      }
      totalCompressed += compressedSize;
      totalExpanded += expandedSize;
      entries.push({ name, compressedSize, expandedSize });
      cursor = end;
    }
  } catch (error) {
    if (error instanceof DocumentValidationError) {
      throw error;
    }
    throw invalid("malformed", "The DOCX ZIP directory is malformed.", error);
  }
  if (cursor !== eocd || totalExpanded > ZIP_MAX_EXPANDED_BYTES) {
    throw invalid("zip_bomb", "The DOCX expands beyond its safe limit.");
  }
  if (
    totalCompressed > 0 &&
    totalExpanded / totalCompressed > ZIP_MAX_TOTAL_RATIO
  ) {
    throw invalid("zip_bomb", "The DOCX has an unsafe compression ratio.");
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
  throw invalid("malformed", "The DOCX ZIP end record is missing.");
}

function validateText(bytes: Uint8Array): void {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw invalid("binary_text", "TXT documents must use valid UTF-8.", error);
  }
  const nulCount = countMatches(text, /\u0000/g);
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
  if (nulCount > 0 || controls > Math.max(2, Math.floor(text.length * 0.01))) {
    throw invalid(
      "binary_text",
      "The TXT file appears to contain binary data.",
    );
  }
}

function normalizeMime(raw: string): string {
  return raw.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function isArchiveSignature(bytes: Uint8Array): boolean {
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

function enforceDeadline(started: number): void {
  if (performance.now() - started > ZIP_VALIDATION_MAX_MS) {
    throw invalid("zip_bomb", "DOCX validation exceeded its time limit.");
  }
}

function countMatches(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}

function invalid(
  code: DocumentValidationCode,
  message: string,
  cause?: unknown,
): DocumentValidationError {
  return new DocumentValidationError(code, message, { cause });
}
