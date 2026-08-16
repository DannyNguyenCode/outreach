/** @vitest-environment node */

import { describe, expect, it } from "vitest";

import {
  assertCsvImportContentLength,
  CSV_IMPORT_REQUEST_MAX_BYTES,
  getCsvImportFile,
  parseBoundedCsvImportFormData,
  parseCsvImportFamily,
  parseCsvImportIntent,
} from "@/lib/orgs/csv-import-request";
import { TABULAR_MAX_BYTES } from "@/lib/orgs/tabular-types";

describe("bounded CSV multipart requests", () => {
  it("parses a normal browser-compatible upload", async () => {
    const body = csvMultipartBody(32);
    const form = await parseBoundedCsvImportFormData(requestFor(body));
    expect(getCsvImportFile(form)).toMatchObject({
      name: "knowledge.csv",
      size: 32,
      type: "text/csv",
    });
    expect(form.get("intent")).toBe("preview");
    expect(form.get("family")).toBe("knowledge");
  });

  it("rejects Content-Length above the request maximum before reading", () => {
    const request = new Request("http://localhost/csv", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=test-boundary",
        "content-length": String(CSV_IMPORT_REQUEST_MAX_BYTES + 1),
      },
    });
    expect(() => assertCsvImportContentLength(request)).toThrowError(
      expect.objectContaining({ status: 413, code: "request_too_large" }),
    );
  });

  it("rejects oversized streaming requests without Content-Length", async () => {
    const bytes = new Uint8Array(CSV_IMPORT_REQUEST_MAX_BYTES + 1);
    await expect(
      parseBoundedCsvImportFormData(requestFor(bytes, false)),
    ).rejects.toMatchObject({ status: 413, code: "request_too_large" });
  });

  it("rejects invalid Content-Length deterministically", () => {
    for (const value of ["not-a-number", "1.5", "-1", "1e6", ""]) {
      const request = new Request("http://localhost/csv", {
        method: "POST",
        headers: {
          "content-type": "multipart/form-data; boundary=test-boundary",
          "content-length": value,
        },
      });
      expect(() => assertCsvImportContentLength(request)).toThrowError(
        expect.objectContaining({ status: 400, code: "invalid_request" }),
      );
    }
  });

  it("accepts exactly the explicit multipart request allowance", async () => {
    const base = csvMultipartBody(1, 0);
    const body = csvMultipartBody(
      1,
      CSV_IMPORT_REQUEST_MAX_BYTES - base.byteLength,
    );
    expect(body.byteLength).toBe(CSV_IMPORT_REQUEST_MAX_BYTES);
    const form = await parseBoundedCsvImportFormData(requestFor(body, false));
    expect(getCsvImportFile(form).size).toBe(1);
  });

  it("accepts a file at the 5 MiB CSV limit", async () => {
    const body = csvMultipartBody(TABULAR_MAX_BYTES);
    const form = await parseBoundedCsvImportFormData(requestFor(body, false));
    expect(getCsvImportFile(form).size).toBe(TABULAR_MAX_BYTES);
  });

  it("rejects a file one byte above the CSV limit with 413", async () => {
    const body = csvMultipartBody(TABULAR_MAX_BYTES + 1);
    const form = await parseBoundedCsvImportFormData(requestFor(body, false));
    expect(() => getCsvImportFile(form)).toThrowError(
      expect.objectContaining({ status: 413, code: "request_too_large" }),
    );
  });
});

describe("CSV import intent and family", () => {
  it("accepts exactly preview, validate, and stage", () => {
    expect(parseCsvImportIntent("preview")).toBe("preview");
    expect(parseCsvImportIntent("validate")).toBe("validate");
    expect(parseCsvImportIntent("stage")).toBe("stage");
  });

  it("rejects unsupported intents fail-closed", () => {
    for (const value of ["", "activate", "confirm", "upload", "PREVIEW"]) {
      expect(() => parseCsvImportIntent(value)).toThrowError(
        expect.objectContaining({ status: 400, code: "invalid_request" }),
      );
    }
  });

  it("accepts exactly knowledge and offering", () => {
    expect(parseCsvImportFamily("knowledge")).toBe("knowledge");
    expect(parseCsvImportFamily("offering")).toBe("offering");
  });

  it("does not coerce unrecognized family values to knowledge", () => {
    for (const value of ["", "product", "admin", "KNOWLEDGE", "arbitrary"]) {
      expect(() => parseCsvImportFamily(value)).toThrowError(
        expect.objectContaining({ status: 400, code: "invalid_request" }),
      );
    }
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
  return new Request("http://localhost/csv", {
    method: "POST",
    headers,
    body: stream,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

function csvMultipartBody(fileSize: number, paddingSize?: number): Uint8Array {
  const parts = [
    Buffer.from(
      "--test-boundary\r\n" +
        'Content-Disposition: form-data; name="intent"\r\n\r\npreview\r\n',
      "ascii",
    ),
    Buffer.from(
      "--test-boundary\r\n" +
        'Content-Disposition: form-data; name="family"\r\n\r\nknowledge\r\n',
      "ascii",
    ),
    Buffer.from(
      "--test-boundary\r\n" +
        'Content-Disposition: form-data; name="file"; filename="knowledge.csv"\r\n' +
        "Content-Type: text/csv\r\n\r\n",
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
