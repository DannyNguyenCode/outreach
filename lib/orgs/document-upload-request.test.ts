/** @vitest-environment node */

import { describe, expect, it } from "vitest";

import {
  DOCUMENT_MAX_BYTES,
  DOCUMENT_UPLOAD_REQUEST_MAX_BYTES,
} from "@/lib/orgs/document-types";
import {
  assertDocumentUploadContentLength,
  getDocumentUploadFile,
  parseBoundedDocumentFormData,
} from "@/lib/orgs/document-upload-request";

describe("bounded document multipart requests", () => {
  it("parses a normal browser-compatible upload", async () => {
    const body = multipartBody(32);
    const form = await parseBoundedDocumentFormData(requestFor(body));
    expect(getDocumentUploadFile(form)).toMatchObject({
      name: "policy.txt",
      size: 32,
      type: "text/plain",
    });
  });

  it("rejects Content-Length above the request maximum before reading", () => {
    const request = new Request("http://localhost/upload", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=test-boundary",
        "content-length": String(DOCUMENT_UPLOAD_REQUEST_MAX_BYTES + 1),
      },
    });
    expect(() => assertDocumentUploadContentLength(request)).toThrowError(
      expect.objectContaining({ status: 413, code: "request_too_large" }),
    );
  });

  it("rejects oversized streaming requests without Content-Length", async () => {
    const bytes = new Uint8Array(DOCUMENT_UPLOAD_REQUEST_MAX_BYTES + 1);
    await expect(
      parseBoundedDocumentFormData(requestFor(bytes, false)),
    ).rejects.toMatchObject({ status: 413, code: "request_too_large" });
  });

  it("rejects invalid Content-Length deterministically", () => {
    const request = new Request("http://localhost/upload", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=test-boundary",
        "content-length": "not-a-number",
      },
    });
    expect(() => assertDocumentUploadContentLength(request)).toThrowError(
      expect.objectContaining({ status: 400, code: "invalid_request" }),
    );
  });

  it("accepts exactly the explicit multipart request allowance", async () => {
    const base = multipartBody(1, 0);
    const body = multipartBody(
      1,
      DOCUMENT_UPLOAD_REQUEST_MAX_BYTES - base.byteLength,
    );
    expect(body.byteLength).toBe(DOCUMENT_UPLOAD_REQUEST_MAX_BYTES);
    const form = await parseBoundedDocumentFormData(requestFor(body, false));
    expect(getDocumentUploadFile(form).size).toBe(1);
  });

  it("accepts a file at the 10 MiB document limit", async () => {
    const body = multipartBody(DOCUMENT_MAX_BYTES);
    const form = await parseBoundedDocumentFormData(requestFor(body, false));
    expect(getDocumentUploadFile(form).size).toBe(DOCUMENT_MAX_BYTES);
  });

  it("rejects a file one byte above the document limit with 413", async () => {
    const body = multipartBody(DOCUMENT_MAX_BYTES + 1);
    const form = await parseBoundedDocumentFormData(requestFor(body, false));
    expect(() => getDocumentUploadFile(form)).toThrowError(
      expect.objectContaining({ status: 413, code: "request_too_large" }),
    );
  });
});

function requestFor(bytes: Uint8Array, includeLength = true): Request {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const headers = new Headers({
    "content-type": "multipart/form-data; boundary=test-boundary",
  });
  if (includeLength) headers.set("content-length", String(bytes.byteLength));
  return new Request("http://localhost/upload", {
    method: "POST",
    headers,
    body: stream,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

function multipartBody(fileSize: number, paddingSize?: number): Uint8Array {
  const parts = [
    Buffer.from(
      "--test-boundary\r\n" +
        'Content-Disposition: form-data; name="file"; filename="policy.txt"\r\n' +
        "Content-Type: text/plain\r\n\r\n",
      "ascii",
    ),
    Buffer.alloc(fileSize, "a"),
    Buffer.from("\r\n", "ascii"),
  ];
  if (paddingSize !== undefined) {
    parts.push(
      Buffer.from(
        "--test-boundary\r\n" +
          'Content-Disposition: form-data; name="padding"\r\n\r\n',
        "ascii",
      ),
      Buffer.alloc(paddingSize, "p"),
      Buffer.from("\r\n", "ascii"),
    );
  }
  parts.push(Buffer.from("--test-boundary--\r\n", "ascii"));
  return new Uint8Array(Buffer.concat(parts));
}
