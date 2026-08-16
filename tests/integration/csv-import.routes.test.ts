import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUserMock = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: (...args: unknown[]) => getCurrentUserMock(...args),
}));

import { POST as postCsvImport } from "@/app/api/orgs/[slug]/knowledge/csv/route";
import { buildRateLimitBucketKey, ROUTE_LIMITS } from "@/lib/auth/rate-limit";
import * as csvImportRequest from "@/lib/orgs/csv-import-request";
import { CSV_IMPORT_REQUEST_MAX_BYTES } from "@/lib/orgs/csv-import-request";
import {
  addMember,
  createOrgWithOwner,
  knowledgeCsvBytes,
  knowledgeMapping,
} from "@/tests/integration/helpers/csv-import";
import { resetApplicationData } from "@/tests/integration/reset";

describe("Phase 4D CSV import request-boundary ordering", () => {
  const prisma = new PrismaClient();

  beforeEach(async () => {
    await resetApplicationData(prisma);
    getCurrentUserMock.mockReset();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rejects unauthenticated callers without consuming the multipart body", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    const parseSpy = vi.spyOn(
      csvImportRequest,
      "parseBoundedCsvImportFormData",
    );
    const prepared = instrumentedCsvRequest({
      slug: "missing-org",
      csv: paddedCsvBytes(),
      fields: { intent: "preview", family: "knowledge" },
    });

    const response = await postCsvImport(prepared.request, {
      params: Promise.resolve({ slug: "missing-org" }),
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      reason: "unauthenticated",
      message: "Authentication is required.",
    });
    expect(parseSpy).not.toHaveBeenCalled();
    expectHandlerDidNotReadBody(prepared);
    parseSpy.mockRestore();
  });

  it("rejects members without org.knowledge.manage before parsing the body", async () => {
    const ctx = await createOrgWithOwner(prisma, "csv-route-member");
    const member = await addMember(
      prisma,
      ctx.organizationId,
      "csv-route-member-user",
      "MEMBER",
    );
    getCurrentUserMock.mockResolvedValue(member);
    const parseSpy = vi.spyOn(
      csvImportRequest,
      "parseBoundedCsvImportFormData",
    );
    const prepared = instrumentedCsvRequest({
      slug: ctx.slug,
      csv: paddedCsvBytes(),
      fields: { intent: "preview", family: "knowledge" },
    });

    const response = await postCsvImport(prepared.request, {
      params: Promise.resolve({ slug: ctx.slug }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      reason: "not_found",
      message: "You do not have access to this organization.",
    });
    expect(parseSpy).not.toHaveBeenCalled();
    expectHandlerDidNotReadBody(prepared);
    parseSpy.mockRestore();
  });

  it("rejects a rate-limited caller without consuming the CSV body", async () => {
    const ctx = await createOrgWithOwner(prisma, "csv-route-rl");
    getCurrentUserMock.mockResolvedValue(ctx.owner);
    await prisma.rateLimitBucket.create({
      data: {
        bucketKey: buildRateLimitBucketKey({
          route: "csv-import",
          emailNormalized: null,
          ip: { kind: "missing" },
          missingIpSalt: `user:${ctx.owner.id}:org:${ctx.organizationId}`,
        }),
        count: ROUTE_LIMITS["csv-import"].limit,
        windowStart: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    });
    const parseSpy = vi.spyOn(
      csvImportRequest,
      "parseBoundedCsvImportFormData",
    );
    const prepared = instrumentedCsvRequest({
      slug: ctx.slug,
      csv: paddedCsvBytes(),
      fields: { intent: "preview", family: "knowledge" },
    });

    const response = await postCsvImport(prepared.request, {
      params: Promise.resolve({ slug: ctx.slug }),
    });

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      reason: "rate_limited",
      message: "Too many requests. Please try again later.",
    });
    expect(parseSpy).not.toHaveBeenCalled();
    expectHandlerDidNotReadBody(prepared);
    parseSpy.mockRestore();
  });

  it("returns 413 for an oversized declared Content-Length without reading the body", async () => {
    const parseSpy = vi.spyOn(
      csvImportRequest,
      "parseBoundedCsvImportFormData",
    );
    const prepared = instrumentedCsvRequest({
      slug: "unused",
      csv: paddedCsvBytes(),
      fields: { intent: "preview", family: "knowledge" },
      contentLength: String(CSV_IMPORT_REQUEST_MAX_BYTES + 1),
    });

    const response = await postCsvImport(prepared.request, {
      params: Promise.resolve({ slug: "unused" }),
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      reason: "request_too_large",
    });
    expect(getCurrentUserMock).not.toHaveBeenCalled();
    expect(parseSpy).not.toHaveBeenCalled();
    expectHandlerDidNotReadBody(prepared);
    parseSpy.mockRestore();
  });

  it("returns 400 for invalid Content-Length without reading the body", async () => {
    const prepared = instrumentedCsvRequest({
      slug: "unused",
      csv: paddedCsvBytes(),
      fields: { intent: "preview", family: "knowledge" },
      contentLength: "not-a-number",
    });

    const response = await postCsvImport(prepared.request, {
      params: Promise.resolve({ slug: "unused" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      reason: "invalid_request",
    });
    expect(getCurrentUserMock).not.toHaveBeenCalled();
    expectHandlerDidNotReadBody(prepared);
  });

  it("stops an authenticated oversized chunked body at the streaming request limit", async () => {
    const ctx = await createOrgWithOwner(prisma, "csv-route-chunk");
    getCurrentUserMock.mockResolvedValue(ctx.owner);
    const chunkSize = 64 * 1024;
    const totalSize = CSV_IMPORT_REQUEST_MAX_BYTES + chunkSize * 4;
    const { request, consumption } = oversizedChunkedRequest({
      slug: ctx.slug,
      totalSize,
      chunkSize,
    });

    const response = await postCsvImport(request, {
      params: Promise.resolve({ slug: ctx.slug }),
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      reason: "request_too_large",
    });
    const seen = consumption();
    expect(seen.cancelled).toBe(true);
    expect(seen.bytesRead).toBeGreaterThan(CSV_IMPORT_REQUEST_MAX_BYTES);
    expect(seen.bytesRead).toBeLessThan(totalSize);
    expect(seen.bytesRead).toBeLessThanOrEqual(
      CSV_IMPORT_REQUEST_MAX_BYTES + chunkSize * 2,
    );
  });

  it("rejects unrecognized family values instead of defaulting to knowledge", async () => {
    const ctx = await createOrgWithOwner(prisma, "csv-route-family");
    getCurrentUserMock.mockResolvedValue(ctx.owner);

    for (const family of ["", "product", "admin", "arbitrary"]) {
      const response = await postCsvImport(
        instrumentedCsvRequest({
          slug: ctx.slug,
          csv: knowledgeCsvBytes(),
          fields: { intent: "preview", family },
        }).request,
        { params: Promise.resolve({ slug: ctx.slug }) },
      );
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        ok: false,
        reason: "invalid_request",
        message: "The CSV import request is invalid.",
      });
      expect(await prisma.csvImport.count()).toBe(0);
    }
  });

  it("rejects unsupported intent values fail-closed", async () => {
    const ctx = await createOrgWithOwner(prisma, "csv-route-intent");
    getCurrentUserMock.mockResolvedValue(ctx.owner);

    for (const intent of ["", "activate", "confirm", "upload"]) {
      const response = await postCsvImport(
        instrumentedCsvRequest({
          slug: ctx.slug,
          csv: knowledgeCsvBytes(),
          fields: { intent, family: "knowledge" },
        }).request,
        { params: Promise.resolve({ slug: ctx.slug }) },
      );
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        ok: false,
        reason: "invalid_request",
        message: "The CSV import request is invalid.",
      });
      expect(await prisma.csvImport.count()).toBe(0);
    }
  });

  it("previews, validates, and stages an authenticated knowledge CSV", async () => {
    const ctx = await createOrgWithOwner(prisma, "csv-route-ok");
    getCurrentUserMock.mockResolvedValue(ctx.owner);
    const csv = knowledgeCsvBytes();
    const mapping = JSON.stringify(knowledgeMapping());

    const preview = await postCsvImport(
      instrumentedCsvRequest({
        slug: ctx.slug,
        csv,
        fields: { intent: "preview", family: "knowledge" },
      }).request,
      { params: Promise.resolve({ slug: ctx.slug }) },
    );
    expect(preview.status).toBe(200);
    const previewBody = (await preview.json()) as {
      ok: boolean;
      preview: { filename: string; headers: Array<{ name: string }> };
    };
    expect(previewBody.ok).toBe(true);
    expect(previewBody.preview.filename).toBe("knowledge.csv");
    expect(previewBody.preview.headers.map((header) => header.name)).toEqual([
      "Title",
      "Section",
      "Body",
    ]);
    expect(await prisma.csvImport.count()).toBe(0);

    const validate = await postCsvImport(
      instrumentedCsvRequest({
        slug: ctx.slug,
        csv,
        fields: {
          intent: "validate",
          family: "knowledge",
          mapping,
        },
      }).request,
      { params: Promise.resolve({ slug: ctx.slug }) },
    );
    expect(validate.status).toBe(200);
    await expect(validate.json()).resolves.toMatchObject({
      ok: true,
      validationComplete: true,
      persistenceEligible: true,
      family: "knowledge",
    });
    expect(await prisma.csvImport.count()).toBe(0);

    const stage = await postCsvImport(
      instrumentedCsvRequest({
        slug: ctx.slug,
        csv,
        fields: {
          intent: "stage",
          family: "knowledge",
          mapping,
        },
      }).request,
      { params: Promise.resolve({ slug: ctx.slug }) },
    );
    expect(stage.status).toBe(200);
    const staged = (await stage.json()) as {
      ok: boolean;
      created: boolean;
      importId: string;
      status: string;
    };
    expect(staged).toMatchObject({
      ok: true,
      created: true,
      status: "READY_TO_CONFIRM",
    });
    expect(await prisma.csvImport.count()).toBe(1);
    expect(
      await prisma.csvImport.findUnique({ where: { id: staged.importId } }),
    ).toMatchObject({ organizationId: ctx.organizationId });
  });
});

const BODY_CHUNK_SIZE = 8 * 1024;
const PADDED_CSV_BYTES = 256 * 1024;

function paddedCsvBytes(): Uint8Array {
  const prefix = knowledgeCsvBytes();
  const padded = new Uint8Array(PADDED_CSV_BYTES);
  padded.set(prefix);
  padded.fill(0x20, prefix.byteLength);
  return padded;
}

function expectHandlerDidNotReadBody(prepared: InstrumentedRequest): void {
  const after = prepared.consumption();
  expect(after.pullCount).toBe(prepared.baseline.pullCount);
  expect(after.bytesRead).toBe(prepared.baseline.bytesRead);
  expect(after.bytesRead).toBeLessThan(prepared.totalBytes);
}

function instrumentedCsvRequest(input: {
  slug: string;
  csv: Uint8Array;
  fields: Record<string, string>;
  contentLength?: string;
}): InstrumentedRequest {
  const body = csvMultipart(input.csv, input.fields);
  return streamRequest({
    slug: input.slug,
    body,
    includeLength: input.contentLength === undefined,
    contentLength: input.contentLength,
  });
}

function oversizedChunkedRequest(input: {
  slug: string;
  totalSize: number;
  chunkSize: number;
}): { request: Request; consumption: () => Consumption } {
  const state: MutableConsumption = {
    pullCount: 0,
    bytesRead: 0,
    cancelled: false,
    offset: 0,
  };
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        state.pullCount += 1;
        if (state.cancelled || state.offset >= input.totalSize) {
          controller.close();
          return;
        }
        const size = Math.min(input.chunkSize, input.totalSize - state.offset);
        state.offset += size;
        state.bytesRead += size;
        controller.enqueue(new Uint8Array(size));
      },
      cancel() {
        state.cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const headers = new Headers({
    "content-type": "multipart/form-data; boundary=test-boundary",
  });
  return {
    request: new Request(
      `http://127.0.0.1/api/orgs/${input.slug}/knowledge/csv`,
      {
        method: "POST",
        headers,
        body: stream,
        duplex: "half",
      } as RequestInit & { duplex: "half" },
    ),
    consumption: () => ({
      pullCount: state.pullCount,
      bytesRead: state.bytesRead,
      cancelled: state.cancelled,
    }),
  };
}

function streamRequest(input: {
  slug: string;
  body: Uint8Array;
  includeLength: boolean;
  contentLength?: string;
}): InstrumentedRequest {
  const state: MutableConsumption = {
    pullCount: 0,
    bytesRead: 0,
    cancelled: false,
    offset: 0,
  };
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        state.pullCount += 1;
        if (state.cancelled || state.offset >= input.body.byteLength) {
          controller.close();
          return;
        }
        const end = Math.min(
          state.offset + BODY_CHUNK_SIZE,
          input.body.byteLength,
        );
        const chunk = input.body.subarray(state.offset, end);
        state.offset = end;
        state.bytesRead += chunk.byteLength;
        controller.enqueue(chunk);
      },
      cancel() {
        state.cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const headers = new Headers({
    "content-type": "multipart/form-data; boundary=test-boundary",
  });
  if (input.contentLength !== undefined) {
    headers.set("content-length", input.contentLength);
  } else if (input.includeLength) {
    headers.set("content-length", String(input.body.byteLength));
  }
  const request = new Request(
    `http://127.0.0.1/api/orgs/${input.slug}/knowledge/csv`,
    {
      method: "POST",
      headers,
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" },
  );
  const consumption = (): Consumption => ({
    pullCount: state.pullCount,
    bytesRead: state.bytesRead,
    cancelled: state.cancelled,
  });
  return {
    request,
    consumption,
    baseline: consumption(),
    totalBytes: input.body.byteLength,
  };
}

function csvMultipart(
  csv: Uint8Array,
  fields: Record<string, string>,
): Uint8Array {
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--test-boundary\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
        "utf8",
      ),
    );
  }
  parts.push(
    Buffer.from(
      '--test-boundary\r\nContent-Disposition: form-data; name="file"; filename="knowledge.csv"\r\nContent-Type: text/csv\r\n\r\n',
      "ascii",
    ),
    Buffer.from(csv),
    Buffer.from("\r\n--test-boundary--\r\n", "ascii"),
  );
  return new Uint8Array(Buffer.concat(parts));
}

type Consumption = {
  pullCount: number;
  bytesRead: number;
  cancelled: boolean;
};

type MutableConsumption = Consumption & { offset: number };

type InstrumentedRequest = {
  request: Request;
  consumption: () => Consumption;
  baseline: Consumption;
  totalBytes: number;
};
