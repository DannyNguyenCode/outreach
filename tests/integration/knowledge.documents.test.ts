import { createHash, randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type {
  MalwareScanner,
  MalwareScanResult,
} from "@/lib/orgs/document-malware";
import { extractDocument } from "@/lib/orgs/document-extraction";
import type {
  PrivateDocumentRef,
  PrivateDocumentStorage,
  PrivateObjectHead,
  SignedObjectUrl,
} from "@/lib/orgs/document-storage";
import { organizationStoragePrefix } from "@/lib/orgs/document-storage";
import { validateDocument } from "@/lib/orgs/document-validation";
import { confirmKnowledgeVersion } from "@/lib/orgs/knowledge";
import {
  claimKnowledgeDocumentJob,
  getKnowledgeDocument,
  processNextKnowledgeDocumentJob,
  uploadValidatedKnowledgeDocument,
} from "@/lib/orgs/knowledge-documents";
import { retrieveActiveKnowledge } from "@/lib/orgs/knowledge-retrieval";
import { createOrgWithOwner } from "@/tests/integration/helpers/knowledge";
import { resetApplicationData } from "@/tests/integration/reset";

describe("Phase 4B private document processing", () => {
  const prisma = new PrismaClient();

  beforeEach(async () => {
    await resetApplicationData(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("uploads, processes, confirms, and retrieves deterministic TXT citations", async () => {
    const ctx = await createOrgWithOwner(prisma, "doc-happy");
    const storage = new MemoryPrivateStorage();
    const document = await sampleTxt();
    const uploaded = await uploadValidatedKnowledgeDocument({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      originalFilename: "policies.txt",
      document,
      storage,
    });
    expect(uploaded.ok).toBe(true);
    if (!uploaded.ok) throw new Error(uploaded.message);
    expect(uploaded.value.document.processingState).toBe("QUEUED");
    expect(uploaded.value.document.storageObjectKey).toMatch(
      new RegExp(`^${organizationStoragePrefix(ctx.organizationId)}`),
    );

    const hidden = await retrieveActiveKnowledge({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
    });
    expect(hidden.ok && hidden.items).toHaveLength(0);

    const processed = await processNextKnowledgeDocumentJob({
      workerId: "worker-happy",
      dependencies: {
        storage,
        scanner: new CleanScanner(),
        scannerName: "test-clean",
        scannerVersion: "1",
        extract: extractDocument,
      },
    });
    expect(processed).toMatchObject({ claimed: true, outcome: "published" });

    const draft = await prisma.knowledgeVersion.findUniqueOrThrow({
      where: { id: uploaded.value.version.id },
      include: { sections: { include: { passages: true } } },
    });
    expect(draft.state).toBe("DRAFT");
    expect(draft.sections[0]?.citationKey).toBe("txt_s0001");
    expect(draft.sections[0]?.passages[0]?.citationKey).toBe("txt_s0001_p0001");
    const confirmed = await confirmKnowledgeVersion({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: {
        sourceId: uploaded.value.source.id,
        versionId: draft.id,
        expectedDraftRevision: draft.draftRevision,
        expectedChecksum: draft.contentChecksum,
        confirmAccuracy: "on",
      },
    });
    expect(confirmed.ok).toBe(true);

    const retrieved = await retrieveActiveKnowledge({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      query: "refund",
    });
    expect(retrieved.ok).toBe(true);
    if (!retrieved.ok) throw new Error(retrieved.message);
    expect(retrieved.items).toHaveLength(1);
    expect(retrieved.items[0]?.body).toContain("refund");
    expect(retrieved.items[0]?.citation.passageCitationKey).toBe(
      "txt_s0001_p0001",
    );
    expect(
      await prisma.organizationAuditEvent.count({
        where: {
          organizationId: ctx.organizationId,
          action: "KNOWLEDGE_DOCUMENT_CONFIRMED",
        },
      }),
    ).toBe(1);
  });

  it("fails closed for infected files and excludes them from confirmation", async () => {
    const ctx = await createOrgWithOwner(prisma, "doc-infected");
    const storage = new MemoryPrivateStorage();
    const uploaded = await uploadValidatedKnowledgeDocument({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      originalFilename: "unsafe.txt",
      document: await sampleTxt(),
      storage,
    });
    if (!uploaded.ok) throw new Error(uploaded.message);
    const processed = await processNextKnowledgeDocumentJob({
      workerId: "worker-infected",
      dependencies: {
        storage,
        scanner: new InfectedScanner(),
        scannerName: "test-infected",
        scannerVersion: "1",
        extract: extractDocument,
      },
    });
    expect(processed).toMatchObject({ claimed: true, outcome: "failed" });
    const stored = await prisma.knowledgeDocument.findUniqueOrThrow({
      where: { id: uploaded.value.document.id },
    });
    expect(stored.scanState).toBe("INFECTED");
    expect(stored.processingState).toBe("FAILED");
    const version = await prisma.knowledgeVersion.findUniqueOrThrow({
      where: { id: uploaded.value.version.id },
    });
    expect(version.state).toBe("FAILED");
    const confirmation = await confirmKnowledgeVersion({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: {
        sourceId: uploaded.value.source.id,
        versionId: version.id,
        expectedDraftRevision: version.draftRevision,
        expectedChecksum: version.contentChecksum,
        confirmAccuracy: "on",
      },
    });
    expect(confirmation.ok).toBe(false);
  });

  it("denies cross-tenant document status and atomically claims one job once", async () => {
    const owner = await createOrgWithOwner(prisma, "doc-claim-a");
    const outsider = await createOrgWithOwner(prisma, "doc-claim-b");
    const storage = new MemoryPrivateStorage();
    const uploaded = await uploadValidatedKnowledgeDocument({
      actor: owner.owner,
      organizationId: owner.organizationId,
      originalFilename: "claim.txt",
      document: await sampleTxt(),
      storage,
    });
    if (!uploaded.ok) throw new Error(uploaded.message);

    const denied = await getKnowledgeDocument({
      actor: outsider.owner,
      organizationId: owner.organizationId,
      sourceId: uploaded.value.source.id,
      versionId: uploaded.value.version.id,
    });
    expect(denied.ok).toBe(false);

    const [left, right] = await Promise.all([
      claimKnowledgeDocumentJob({ workerId: "worker-left" }),
      claimKnowledgeDocumentJob({ workerId: "worker-right" }),
    ]);
    expect([left, right].filter(Boolean)).toHaveLength(1);
    expect(
      await prisma.knowledgeDocumentJob.count({
        where: { versionId: uploaded.value.version.id },
      }),
    ).toBe(1);
  });
});

async function sampleTxt() {
  return validateDocument({
    bytes: new TextEncoder().encode(
      "# Refund policy\n\nCustomers may request a refund within 30 days.",
    ),
    filename: "policies.txt",
    declaredMimeType: "text/plain",
  });
}

class CleanScanner implements MalwareScanner {
  async scan(
    bytes: Uint8Array,
    expectedSha256: string,
  ): Promise<MalwareScanResult> {
    expect(hash(bytes)).toBe(expectedSha256);
    return { verdict: "clean", sha256: expectedSha256, scanner: "test" };
  }
}

class InfectedScanner implements MalwareScanner {
  async scan(
    _bytes: Uint8Array,
    expectedSha256: string,
  ): Promise<MalwareScanResult> {
    return {
      verdict: "infected",
      sha256: expectedSha256,
      scanner: "test",
      threat: "test-signature",
    };
  }
}

class MemoryPrivateStorage implements PrivateDocumentStorage {
  readonly bucketName = "test-private";
  private readonly objects = new Map<string, Uint8Array>();

  createObjectKey(organizationId: string, kind: "pdf" | "docx" | "txt") {
    return `${organizationStoragePrefix(organizationId)}${randomUUID()}.${kind}`;
  }

  async createSignedUpload(ref: PrivateDocumentRef): Promise<SignedObjectUrl> {
    return this.signed(ref);
  }

  async createSignedDownload(
    ref: PrivateDocumentRef,
  ): Promise<SignedObjectUrl> {
    return this.signed(ref);
  }

  async upload(ref: PrivateDocumentRef, bytes: Uint8Array) {
    this.objects.set(ref.key, bytes.slice());
  }

  async download(ref: PrivateDocumentRef) {
    const bytes = this.objects.get(ref.key);
    if (!bytes) throw new Error("missing");
    return bytes.slice();
  }

  async head(ref: PrivateDocumentRef): Promise<PrivateObjectHead | null> {
    const bytes = this.objects.get(ref.key);
    return bytes
      ? {
          size: bytes.byteLength,
          contentType: null,
          etag: hash(bytes),
          updatedAt: new Date("2026-08-14T00:00:00.000Z"),
        }
      : null;
  }

  async delete(ref: PrivateDocumentRef) {
    this.objects.delete(ref.key);
  }

  private signed(ref: PrivateDocumentRef): SignedObjectUrl {
    return {
      url: `https://private.invalid/${encodeURIComponent(ref.key)}`,
      key: ref.key,
      expiresAt: new Date(Date.now() + 60_000),
    };
  }
}

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
