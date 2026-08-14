import "server-only";

import {
  DOCUMENT_MAX_BYTES,
  DOCUMENT_UPLOAD_REQUEST_MAX_BYTES,
} from "@/lib/orgs/document-types";

export class DocumentUploadRequestError extends Error {
  constructor(
    readonly code: "invalid_request" | "request_too_large",
    readonly status: 400 | 413,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DocumentUploadRequestError";
  }
}

export function assertDocumentUploadContentLength(request: Request): void {
  const raw = request.headers.get("content-length");
  if (raw === null) return;
  if (!/^\d+$/.test(raw)) {
    throw new DocumentUploadRequestError(
      "invalid_request",
      400,
      "The upload request has an invalid Content-Length.",
    );
  }
  const length = Number(raw);
  if (!Number.isSafeInteger(length)) {
    throw new DocumentUploadRequestError(
      "invalid_request",
      400,
      "The upload request has an invalid Content-Length.",
    );
  }
  if (length > DOCUMENT_UPLOAD_REQUEST_MAX_BYTES) {
    throw tooLarge();
  }
}

/**
 * Read at most the document limit plus explicit multipart overhead before
 * invoking the platform multipart parser. This also bounds chunked requests
 * and requests without Content-Length.
 */
export async function parseBoundedDocumentFormData(
  request: Request,
): Promise<FormData> {
  assertDocumentUploadContentLength(request);
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data(?:;|$)/i.test(contentType)) {
    throw new DocumentUploadRequestError(
      "invalid_request",
      400,
      "The upload request must use multipart form data.",
    );
  }
  if (!request.body) {
    throw new DocumentUploadRequestError(
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
      if (total > DOCUMENT_UPLOAD_REQUEST_MAX_BYTES) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof DocumentUploadRequestError) throw error;
    throw new DocumentUploadRequestError(
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
    throw new DocumentUploadRequestError(
      "invalid_request",
      400,
      "The upload request is malformed.",
      { cause: error },
    );
  }
}

export function getDocumentUploadFile(formData: FormData): File {
  const file = formData.get("file");
  if (!(file instanceof File)) {
    throw new DocumentUploadRequestError(
      "invalid_request",
      400,
      "Choose a PDF, DOCX, or TXT document.",
    );
  }
  if (file.size < 1) {
    throw new DocumentUploadRequestError(
      "invalid_request",
      400,
      `Documents must be between 1 byte and ${DOCUMENT_MAX_BYTES} bytes.`,
    );
  }
  if (file.size > DOCUMENT_MAX_BYTES) {
    throw new DocumentUploadRequestError(
      "request_too_large",
      413,
      `Documents must not exceed ${DOCUMENT_MAX_BYTES} bytes.`,
    );
  }
  return file;
}

function tooLarge(): DocumentUploadRequestError {
  return new DocumentUploadRequestError(
    "request_too_large",
    413,
    "The upload request is too large.",
  );
}
