import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { DocumentKind } from "@/lib/orgs/document-types";

export const PRIVATE_DOCUMENT_BUCKET = "knowledge-documents-private";
export const SIGNED_DOWNLOAD_MAX_SECONDS = 5 * 60;

export type PrivateDocumentRef = {
  organizationId: string;
  key: string;
  /** Persisted bucket for this object. Must match the adapter bucket. */
  bucket?: string;
};

export type SignedObjectUrl = {
  url: string;
  expiresAt: Date;
  key: string;
  token?: string;
};

export type PrivateObjectHead = {
  size: number;
  contentType: string | null;
  etag: string | null;
  updatedAt: Date | null;
};

export interface PrivateDocumentStorage {
  readonly bucketName?: string;
  createObjectKey(organizationId: string, kind: DocumentKind): string;
  createSignedDownload(
    ref: PrivateDocumentRef,
    expiresInSeconds?: number,
  ): Promise<SignedObjectUrl>;
  upload(
    ref: PrivateDocumentRef,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<void>;
  download(ref: PrivateDocumentRef): Promise<Uint8Array>;
  head(ref: PrivateDocumentRef): Promise<PrivateObjectHead | null>;
  delete(ref: PrivateDocumentRef): Promise<void>;
}

export function organizationStoragePrefix(organizationId: string): string {
  if (!organizationId.trim()) {
    throw new Error("Organization id is required.");
  }
  return `org/${createHash("sha256")
    .update(organizationId, "utf8")
    .digest("hex")
    .slice(0, 32)}/`;
}

export class SupabasePrivateDocumentStorage implements PrivateDocumentStorage {
  constructor(
    private readonly client: SupabaseClient,
    private readonly now: () => Date = () => new Date(),
    readonly bucketName = PRIVATE_DOCUMENT_BUCKET,
  ) {}

  createObjectKey(organizationId: string, kind: DocumentKind): string {
    const nonce = randomBytes(24).toString("base64url");
    return `${organizationStoragePrefix(organizationId)}${nonce}.${kind}`;
  }

  async createSignedDownload(
    ref: PrivateDocumentRef,
    expiresInSeconds = 60,
  ): Promise<SignedObjectUrl> {
    this.assertScoped(ref);
    const expires = boundedExpiry(expiresInSeconds);
    const { data, error } = await this.bucket(ref).createSignedUrl(
      ref.key,
      expires,
    );
    if (error) {
      throw new Error(`Could not sign document download: ${error.message}`, {
        cause: error,
      });
    }
    return {
      url: data.signedUrl,
      key: ref.key,
      expiresAt: new Date(this.now().getTime() + expires * 1_000),
    };
  }

  async upload(
    ref: PrivateDocumentRef,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<void> {
    this.assertScoped(ref);
    const { error } = await this.bucket(ref).upload(ref.key, bytes, {
      contentType,
      cacheControl: "no-store",
      upsert: false,
    });
    if (error) {
      throw new Error(`Could not upload document: ${error.message}`, {
        cause: error,
      });
    }
  }

  async download(ref: PrivateDocumentRef): Promise<Uint8Array> {
    this.assertScoped(ref);
    const { data, error } = await this.bucket(ref).download(ref.key);
    if (error) {
      throw new Error(`Could not download document: ${error.message}`, {
        cause: error,
      });
    }
    return new Uint8Array(await data.arrayBuffer());
  }

  async head(ref: PrivateDocumentRef): Promise<PrivateObjectHead | null> {
    this.assertScoped(ref);
    const { data, error } = await this.bucket(ref).info(ref.key);
    if (error) {
      const status = Number(
        (error as { status?: number; statusCode?: string }).status ??
          (error as { statusCode?: string }).statusCode,
      );
      if (status === 404) {
        return null;
      }
      throw new Error(`Could not inspect document: ${error.message}`, {
        cause: error,
      });
    }
    return {
      size: data.size ?? 0,
      contentType:
        data.contentType ??
        (typeof data.metadata?.mimetype === "string"
          ? data.metadata.mimetype
          : null),
      etag: data.etag ?? null,
      updatedAt: data.lastModified ? new Date(data.lastModified) : null,
    };
  }

  async delete(ref: PrivateDocumentRef): Promise<void> {
    this.assertScoped(ref);
    const { error } = await this.bucket(ref).remove([ref.key]);
    if (error) {
      throw new Error(`Could not delete document: ${error.message}`, {
        cause: error,
      });
    }
  }

  private bucket(ref: PrivateDocumentRef) {
    return this.client.storage.from(this.resolveBucket(ref));
  }

  private resolveBucket(ref: PrivateDocumentRef): string {
    const requested = ref.bucket ?? this.bucketName;
    if (requested !== this.bucketName) {
      throw new Error("Document storage bucket is not available.");
    }
    return requested;
  }

  private assertScoped(ref: PrivateDocumentRef): void {
    this.resolveBucket(ref);
    if (!ref.key.startsWith(organizationStoragePrefix(ref.organizationId))) {
      throw new Error("Document key is outside the organization scope.");
    }
    if (
      ref.key.includes("..") ||
      ref.key.includes("\\") ||
      ref.key
        .slice(organizationStoragePrefix(ref.organizationId).length)
        .includes("/")
    ) {
      throw new Error("Document key is invalid.");
    }
  }
}

/**
 * Explicit local/CI substitute for private object storage. Production runtime
 * rejects this adapter; tests inject it without contacting Supabase.
 */
export class FileSystemPrivateDocumentStorage implements PrivateDocumentStorage {
  readonly bucketName = "ci-private-knowledge-documents";

  constructor(
    private readonly root = path.join(
      tmpdir(),
      "outreach-ci-private-knowledge-documents",
    ),
  ) {}

  createObjectKey(organizationId: string, kind: DocumentKind): string {
    return `${organizationStoragePrefix(organizationId)}${randomBytes(24).toString("base64url")}.${kind}`;
  }

  async createSignedDownload(
    ref: PrivateDocumentRef,
    expiresInSeconds = 60,
  ): Promise<SignedObjectUrl> {
    this.assertScoped(ref);
    const expires = boundedExpiry(expiresInSeconds);
    return {
      url: `fake-private://${encodeURIComponent(ref.key)}`,
      key: ref.key,
      expiresAt: new Date(Date.now() + expires * 1_000),
    };
  }

  async upload(
    ref: PrivateDocumentRef,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<void> {
    void contentType;
    const filename = this.filename(ref);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, bytes, { flag: "wx" });
  }

  async download(ref: PrivateDocumentRef): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.filename(ref)));
  }

  async head(ref: PrivateDocumentRef): Promise<PrivateObjectHead | null> {
    try {
      const info = await stat(this.filename(ref));
      return {
        size: info.size,
        contentType: null,
        etag: null,
        updatedAt: info.mtime,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async delete(ref: PrivateDocumentRef): Promise<void> {
    await rm(this.filename(ref), { force: true });
  }

  private filename(ref: PrivateDocumentRef): string {
    this.assertScoped(ref);
    return path.join(this.root, ...ref.key.split("/"));
  }

  private assertScoped(ref: PrivateDocumentRef): void {
    const requested = ref.bucket ?? this.bucketName;
    if (requested !== this.bucketName) {
      throw new Error("Document storage bucket is not available.");
    }
    const prefix = organizationStoragePrefix(ref.organizationId);
    if (
      !ref.key.startsWith(prefix) ||
      ref.key.includes("..") ||
      ref.key.includes("\\") ||
      ref.key.slice(prefix.length).includes("/")
    ) {
      throw new Error("Document key is outside the organization scope.");
    }
  }
}

export function createSupabasePrivateDocumentStorage(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  now?: () => Date;
  bucketName?: string;
}): SupabasePrivateDocumentStorage {
  if (!input.supabaseUrl.trim() || !input.serviceRoleKey.trim()) {
    throw new Error("Supabase URL and service role key are required.");
  }
  const client = createClient(input.supabaseUrl, input.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  const bucketName = input.bucketName ?? PRIVATE_DOCUMENT_BUCKET;
  if (!/^[a-z0-9][a-z0-9_-]{2,62}$/.test(bucketName)) {
    throw new Error("Private document bucket name is invalid.");
  }
  return new SupabasePrivateDocumentStorage(client, input.now, bucketName);
}

function boundedExpiry(value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error("Signed URL expiry must be a positive whole number.");
  }
  return Math.min(value, SIGNED_DOWNLOAD_MAX_SECONDS);
}
