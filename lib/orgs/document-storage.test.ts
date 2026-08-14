import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  PRIVATE_DOCUMENT_BUCKET,
  SIGNED_DOWNLOAD_MAX_SECONDS,
  SupabasePrivateDocumentStorage,
  organizationStoragePrefix,
} from "@/lib/orgs/document-storage";

describe("Supabase private document storage", () => {
  it("creates unpredictable organization-scoped keys", () => {
    const { storage } = makeStorage();
    const first = storage.createObjectKey("org-secret-id", "pdf");
    const second = storage.createObjectKey("org-secret-id", "pdf");

    expect(first).toMatch(
      new RegExp(`^${organizationStoragePrefix("org-secret-id")}.+\\.pdf$`),
    );
    expect(first).not.toContain("org-secret-id");
    expect(first).not.toBe(second);
  });

  it("uses the fixed private bucket and bounds download signatures", async () => {
    const { storage, bucket, from } = makeStorage();
    const key = storage.createObjectKey("org-1", "txt");
    const signed = await storage.createSignedDownload(
      { organizationId: "org-1", key },
      9_999,
    );

    expect(from).toHaveBeenCalledWith(PRIVATE_DOCUMENT_BUCKET);
    expect(bucket.createSignedUrl).toHaveBeenCalledWith(
      key,
      SIGNED_DOWNLOAD_MAX_SECONDS,
    );
    expect(signed.expiresAt.toISOString()).toBe("2026-08-14T12:05:00.000Z");
  });

  it("rejects cross-organization keys before calling storage", async () => {
    const { storage, bucket } = makeStorage();
    const key = storage.createObjectKey("org-1", "pdf");
    await expect(
      storage.download({ organizationId: "org-2", key }),
    ).rejects.toThrow(/outside the organization scope/i);
    expect(bucket.download).not.toHaveBeenCalled();
  });

  it("supports upload, download, head, and delete", async () => {
    const { storage, bucket } = makeStorage();
    const key = storage.createObjectKey("org-1", "txt");
    const ref = { organizationId: "org-1", key };

    await storage.upload(ref, Uint8Array.of(1, 2), "text/plain");
    await expect(storage.download(ref)).resolves.toEqual(Uint8Array.of(4, 5));
    await expect(storage.head(ref)).resolves.toEqual({
      size: 2,
      contentType: "text/plain",
      etag: "etag",
      updatedAt: new Date("2026-08-14T11:00:00.000Z"),
    });
    await storage.delete(ref);

    expect(bucket.upload).toHaveBeenCalledWith(
      key,
      Uint8Array.of(1, 2),
      expect.objectContaining({ upsert: false }),
    );
    expect(bucket.remove).toHaveBeenCalledWith([key]);
  });
});

function makeStorage() {
  const bucket = {
    createSignedUploadUrl: vi.fn(async () => ({
      data: {
        signedUrl: "https://upload.example",
        token: "token",
        path: "key",
      },
      error: null,
    })),
    createSignedUrl: vi.fn(async () => ({
      data: { signedUrl: "https://download.example" },
      error: null,
    })),
    upload: vi.fn(async () => ({
      data: { id: "id", path: "key", fullPath: "bucket/key" },
      error: null,
    })),
    download: vi.fn(async () => ({
      data: new Blob([Uint8Array.of(4, 5)]),
      error: null,
    })),
    info: vi.fn(async () => ({
      data: {
        size: 2,
        contentType: "text/plain",
        etag: "etag",
        lastModified: "2026-08-14T11:00:00.000Z",
      },
      error: null,
    })),
    remove: vi.fn(async () => ({ data: [], error: null })),
  };
  const from = vi.fn(() => bucket);
  const client = { storage: { from } } as unknown as SupabaseClient;
  return {
    storage: new SupabasePrivateDocumentStorage(
      client,
      () => new Date("2026-08-14T12:00:00.000Z"),
    ),
    bucket,
    from,
  };
}
