import "server-only";

import { TABULAR_MAX_BYTES } from "@/lib/orgs/tabular-types";

export const CSV_IMPORT_MULTIPART_OVERHEAD_BYTES = 256 * 1024;
export const CSV_IMPORT_REQUEST_MAX_BYTES =
  TABULAR_MAX_BYTES + CSV_IMPORT_MULTIPART_OVERHEAD_BYTES;

export const CSV_IMPORT_INTENTS = ["preview", "validate", "stage"] as const;
export type CsvImportIntent = (typeof CSV_IMPORT_INTENTS)[number];

export const CSV_IMPORT_FAMILIES = ["knowledge", "offering"] as const;
export type CsvImportFamily = (typeof CSV_IMPORT_FAMILIES)[number];

export class CsvImportRequestError extends Error {
  constructor(
    readonly code: "invalid_request" | "request_too_large",
    readonly status: 400 | 413,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CsvImportRequestError";
  }
}

/**
 * Cheap declared-size rejection. Missing Content-Length is allowed; the
 * streaming reader in `parseBoundedCsvImportFormData` is the authoritative
 * bound for chunked, spoofed, or omitted lengths.
 */
export function assertCsvImportContentLength(request: Request): void {
  const raw = request.headers.get("content-length");
  if (raw === null) return;
  if (!/^\d+$/.test(raw)) {
    throw new CsvImportRequestError(
      "invalid_request",
      400,
      "The upload request has an invalid Content-Length.",
    );
  }
  const length = Number(raw);
  if (!Number.isSafeInteger(length)) {
    throw new CsvImportRequestError(
      "invalid_request",
      400,
      "The upload request has an invalid Content-Length.",
    );
  }
  if (length > CSV_IMPORT_REQUEST_MAX_BYTES) {
    throw csvImportRequestTooLarge();
  }
}

export function parseCsvImportIntent(raw: string): CsvImportIntent {
  if ((CSV_IMPORT_INTENTS as readonly string[]).includes(raw)) {
    return raw as CsvImportIntent;
  }
  throw new CsvImportRequestError(
    "invalid_request",
    400,
    "The CSV import request is invalid.",
  );
}

export function parseCsvImportFamily(raw: string): CsvImportFamily {
  if ((CSV_IMPORT_FAMILIES as readonly string[]).includes(raw)) {
    return raw as CsvImportFamily;
  }
  throw new CsvImportRequestError(
    "invalid_request",
    400,
    "The CSV import request is invalid.",
  );
}

/**
 * Read at most the CSV request maximum before invoking the platform multipart
 * parser. Call this only after authentication, membership, permission, and
 * rate limiting. Content-Length is not the actual body bound.
 */
export async function parseBoundedCsvImportFormData(
  request: Request,
): Promise<FormData> {
  assertCsvImportContentLength(request);
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data(?:;|$)/i.test(contentType)) {
    throw new CsvImportRequestError(
      "invalid_request",
      400,
      "The upload request must use multipart form data.",
    );
  }
  if (!request.body) {
    throw new CsvImportRequestError(
      "invalid_request",
      400,
      "The upload request is malformed.",
    );
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > CSV_IMPORT_REQUEST_MAX_BYTES) {
        await reader.cancel();
        throw csvImportRequestTooLarge();
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof CsvImportRequestError) throw error;
    throw new CsvImportRequestError(
      "invalid_request",
      400,
      "The upload request is malformed.",
      { cause: error },
    );
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const headers = new Headers(request.headers);
  headers.set("content-length", String(total));
  try {
    return await new Request(request.url, {
      method: request.method,
      headers,
      body: body as BodyInit,
    }).formData();
  } catch (error) {
    throw new CsvImportRequestError(
      "invalid_request",
      400,
      "The upload request is malformed.",
      { cause: error },
    );
  }
}

export function getCsvImportFile(formData: FormData): File {
  const file = formData.get("file");
  if (!(file instanceof File)) {
    throw new CsvImportRequestError(
      "invalid_request",
      400,
      "Choose a CSV file.",
    );
  }
  if (file.size < 1) {
    throw new CsvImportRequestError(
      "invalid_request",
      400,
      "CSV files must be between 1 byte and 5 MiB.",
    );
  }
  if (file.size > TABULAR_MAX_BYTES) {
    throw new CsvImportRequestError(
      "request_too_large",
      413,
      "CSV files may not exceed 5 MiB.",
    );
  }
  return file;
}

function csvImportRequestTooLarge(): CsvImportRequestError {
  return new CsvImportRequestError(
    "request_too_large",
    413,
    "The upload request is too large.",
  );
}
