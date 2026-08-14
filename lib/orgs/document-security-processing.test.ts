import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  HttpMalwareScanner,
  MalwareDetectedError,
  MalwareScanUnavailableError,
  requireCleanDocument,
} from "@/lib/orgs/document-malware";
import {
  classifyDocumentProcessingError,
  documentRetryDelayMs,
  findNearDuplicates,
} from "@/lib/orgs/document-processing";
import { DocumentValidationError } from "@/lib/orgs/document-validation";
import type { CanonicalKnowledgeSection } from "@/lib/orgs/knowledge-validation";

describe("HTTP malware scanner", () => {
  it("sends and validates the exact SHA-256", async () => {
    const bytes = new TextEncoder().encode("safe document");
    const checksum = sha256(bytes);
    const fetcher = vi.fn(
      async (_url: URL | RequestInfo, init?: RequestInit) => {
        expect(new Headers(init?.headers).get("x-content-sha256")).toBe(
          checksum,
        );
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer scanner-secret",
        );
        return Response.json({ verdict: "clean", sha256: checksum });
      },
    );
    const scanner = new HttpMalwareScanner(
      {
        endpoint: "https://scanner.example/v1/scan",
        bearerToken: "scanner-secret",
      },
      fetcher as typeof fetch,
    );

    await expect(scanner.scan(bytes, checksum)).resolves.toEqual({
      verdict: "clean",
      sha256: checksum,
      scanner: "scanner.example",
    });
  });

  it("fails closed on transport, malformed, and checksum mismatch responses", async () => {
    const bytes = new TextEncoder().encode("safe document");
    const checksum = sha256(bytes);
    const responses = [
      vi.fn(async () => {
        throw new Error("offline");
      }),
      vi.fn(async () => new Response("not-json")),
      vi.fn(async () =>
        Response.json({ verdict: "clean", sha256: "a".repeat(64) }),
      ),
    ];

    for (const fetcher of responses) {
      const scanner = new HttpMalwareScanner(
        {
          endpoint: "https://scanner.example/v1/scan",
          bearerToken: "scanner-secret",
        },
        fetcher as typeof fetch,
      );
      await expect(scanner.scan(bytes, checksum)).rejects.toBeInstanceOf(
        MalwareScanUnavailableError,
      );
    }
  });

  it("blocks infected results and rejects non-HTTPS endpoints", async () => {
    expect(
      () =>
        new HttpMalwareScanner({
          endpoint: "http://scanner.example/scan",
          bearerToken: "secret",
        }),
    ).toThrow(/HTTPS/);

    const bytes = new TextEncoder().encode("infected");
    const checksum = sha256(bytes);
    const scanner = new HttpMalwareScanner(
      {
        endpoint: "https://scanner.example/scan",
        bearerToken: "secret",
      },
      vi.fn(async () =>
        Response.json({
          verdict: "infected",
          sha256: checksum,
          threat: "EICAR",
        }),
      ) as typeof fetch,
    );
    await expect(
      requireCleanDocument(scanner, bytes, checksum),
    ).rejects.toBeInstanceOf(MalwareDetectedError);
  });
});

describe("near duplicates and retries", () => {
  it("finds bounded normalized near duplicates deterministically", () => {
    const target = sections("Returns", "Returns accepted within thirty days.");
    const matches = findNearDuplicates(
      target,
      [
        {
          id: "same",
          sections: sections("RETURNS", "Returns accepted within thirty days!"),
        },
        {
          id: "different",
          sections: sections("Shipping", "Ships worldwide next business day."),
        },
      ],
      { threshold: 0.8 },
    );

    expect(matches).toEqual([{ id: "same", similarity: 1 }]);
  });

  it("classifies permanent and transient failures", () => {
    expect(
      classifyDocumentProcessingError(
        new DocumentValidationError("malformed", "bad"),
      ),
    ).toEqual({ retryable: false, reason: "validation" });
    expect(
      classifyDocumentProcessingError(new MalwareScanUnavailableError("down")),
    ).toEqual({ retryable: true, reason: "remote" });
    expect(classifyDocumentProcessingError({ status: 429 })).toEqual({
      retryable: true,
      reason: "rate_limit",
    });
    expect(classifyDocumentProcessingError({ statusCode: "503" })).toEqual({
      retryable: true,
      reason: "remote",
    });
    expect(
      classifyDocumentProcessingError(
        new Error("wrapped storage failure", {
          cause: { status: 503 },
        }),
      ),
    ).toEqual({ retryable: true, reason: "remote" });
    expect(
      classifyDocumentProcessingError(
        new Error("wrapped rate limit", {
          cause: { statusCode: 429 },
        }),
      ),
    ).toEqual({ retryable: true, reason: "rate_limit" });
    expect(classifyDocumentProcessingError({ status: 400 })).toEqual({
      retryable: false,
      reason: "permanent",
    });
  });

  it("uses capped exponential backoff with injectable jitter", () => {
    expect(documentRetryDelayMs(1, { jitterRatio: 0, random: () => 0 })).toBe(
      500,
    );
    expect(documentRetryDelayMs(4, { jitterRatio: 0, random: () => 0 })).toBe(
      4_000,
    );
    expect(
      documentRetryDelayMs(20, {
        maxMs: 10_000,
        jitterRatio: 0,
        random: () => 0,
      }),
    ).toBe(10_000);
  });
});

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sections(title: string, body: string): CanonicalKnowledgeSection[] {
  return [
    {
      citationKey: "sec",
      title,
      passages: [{ citationKey: "pas", body }],
    },
  ];
}
