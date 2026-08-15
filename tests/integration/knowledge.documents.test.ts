import { createHash, randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  MalwareScanUnavailableError,
  type MalwareScanner,
  type MalwareScanResult,
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
import {
  archiveKnowledgeSource,
  confirmKnowledgeVersion,
} from "@/lib/orgs/knowledge";
import {
  claimKnowledgeDocumentJob,
  compensateFailedDocumentUpload,
  createAuthorizedDocumentDownload,
  DOCUMENT_JOB_MAX_ATTEMPTS,
  failExpiredExhaustedKnowledgeDocumentJobs,
  getKnowledgeDocument,
  processNextKnowledgeDocumentJob,
  requestKnowledgeDocumentRetry,
  restoreKnowledgeDocumentVersion,
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

    const download = await createAuthorizedDocumentDownload({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      sourceId: uploaded.value.source.id,
      versionId: uploaded.value.version.id,
      storage,
    });
    expect(download.ok).toBe(false);
  });

  it("denies private download until scan evidence is clean and matching", async () => {
    const ctx = await createOrgWithOwner(prisma, "doc-download-gate");
    const storage = new MemoryPrivateStorage();
    const uploaded = await uploadValidatedKnowledgeDocument({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      originalFilename: "pending.txt",
      document: await sampleTxt(),
      storage,
    });
    if (!uploaded.ok) throw new Error(uploaded.message);

    const pending = await createAuthorizedDocumentDownload({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      sourceId: uploaded.value.source.id,
      versionId: uploaded.value.version.id,
      storage,
    });
    expect(pending.ok).toBe(false);

    const processed = await processNextKnowledgeDocumentJob({
      workerId: "worker-download-gate",
      dependencies: {
        storage,
        scanner: new CleanScanner(),
        scannerName: "test-clean",
        scannerVersion: "1",
        extract: extractDocument,
      },
    });
    expect(processed).toMatchObject({ claimed: true, outcome: "published" });

    const allowed = await createAuthorizedDocumentDownload({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      sourceId: uploaded.value.source.id,
      versionId: uploaded.value.version.id,
      storage,
    });
    expect(allowed.ok).toBe(true);
    if (!allowed.ok) throw new Error(allowed.message);
    expect(allowed.objectBucket).toBe(storage.bucketName);
  });

  it("denies CLEAN scan evidence when scanned and binary checksums differ", async () => {
    const ctx = await createOrgWithOwner(prisma, "doc-checksum-mismatch");
    const storage = new MemoryPrivateStorage();
    const uploaded = await uploadValidatedKnowledgeDocument({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      originalFilename: "mismatch.txt",
      document: await sampleTxt(),
      storage,
    });
    if (!uploaded.ok) throw new Error(uploaded.message);

    const mismatched = "b".repeat(64);
    expect(mismatched).not.toBe(uploaded.value.document.binaryChecksum);
    await prisma.$executeRaw`
      ALTER TABLE "KnowledgeDocument"
      DROP CONSTRAINT "KnowledgeDocument_clean_checksum_check"
    `;
    try {
      await prisma.knowledgeDocument.update({
        where: { id: uploaded.value.document.id },
        data: {
          scanState: "CLEAN",
          finalizedAt: new Date("2026-08-15T00:00:00.000Z"),
          scannedAt: new Date("2026-08-15T00:00:00.000Z"),
          scannerName: "test-clean",
          scannerVersion: "1",
          scannedChecksum: mismatched,
        },
      });

      const signedBefore = storage.signedDownloadCalls;
      const downloadBefore = storage.downloadCalls;
      const denied = await createAuthorizedDocumentDownload({
        actor: ctx.owner,
        organizationId: ctx.organizationId,
        sourceId: uploaded.value.source.id,
        versionId: uploaded.value.version.id,
        storage,
      });
      expect(denied.ok).toBe(false);
      if (!denied.ok) {
        expect(denied.reason).toBe("not_confirmable");
      }
      expect(storage.signedDownloadCalls).toBe(signedBefore);
      expect(storage.downloadCalls).toBe(downloadBefore);
    } finally {
      await prisma.knowledgeDocument.update({
        where: { id: uploaded.value.document.id },
        data: {
          scanState: "PENDING",
          scannedChecksum: null,
          scannedAt: null,
          scannerName: null,
          scannerVersion: null,
        },
      });
      await prisma.$executeRaw`
        ALTER TABLE "KnowledgeDocument"
        ADD CONSTRAINT "KnowledgeDocument_clean_checksum_check"
        CHECK ("scanState" <> 'CLEAN' OR ("scannedChecksum" IS NOT NULL AND "scannedChecksum" = "binaryChecksum"))
      `;
    }
  });

  it("terminalizes expired leases after the final attempt", async () => {
    const ctx = await createOrgWithOwner(prisma, "doc-lease-exhaust");
    const storage = new MemoryPrivateStorage();
    const uploaded = await uploadValidatedKnowledgeDocument({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      originalFilename: "lease.txt",
      document: await sampleTxt(),
      storage,
    });
    if (!uploaded.ok) throw new Error(uploaded.message);

    const expired = new Date("2020-01-01T00:00:00.000Z");
    await prisma.knowledgeDocumentJob.update({
      where: { id: uploaded.value.job.id },
      data: {
        state: "RUNNING",
        attempts: DOCUMENT_JOB_MAX_ATTEMPTS,
        leaseOwner: "dead-worker",
        leaseExpiresAt: expired,
      },
    });
    await prisma.knowledgeDocument.update({
      where: { id: uploaded.value.document.id },
      data: {
        processingState: "SCANNING",
        leaseOwner: "dead-worker",
        leaseExpiresAt: expired,
      },
    });

    expect(
      await failExpiredExhaustedKnowledgeDocumentJobs({
        now: new Date("2026-08-14T12:00:00.000Z"),
      }),
    ).toBe(1);

    const job = await prisma.knowledgeDocumentJob.findUniqueOrThrow({
      where: { id: uploaded.value.job.id },
    });
    expect(job).toMatchObject({
      state: "FAILED",
      leaseOwner: null,
      lastSafeErrorCode: "lease_exhausted",
    });
    const document = await prisma.knowledgeDocument.findUniqueOrThrow({
      where: { id: uploaded.value.document.id },
    });
    expect(document).toMatchObject({
      processingState: "FAILED",
      leaseOwner: null,
      lastSafeErrorCode: "lease_exhausted",
    });
    const version = await prisma.knowledgeVersion.findUniqueOrThrow({
      where: { id: uploaded.value.version.id },
    });
    expect(version.state).toBe("FAILED");

    const next = await processNextKnowledgeDocumentJob({
      workerId: "worker-after-exhaust",
      dependencies: {
        storage,
        scanner: new CleanScanner(),
        scannerName: "test-clean",
        scannerVersion: "1",
        extract: extractDocument,
        now: () => new Date("2026-08-14T12:01:00.000Z"),
      },
    });
    expect(next).toEqual({ claimed: false });

    const retried = await requestKnowledgeDocumentRetry({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      sourceId: uploaded.value.source.id,
      versionId: uploaded.value.version.id,
    });
    expect(retried.ok).toBe(true);
    const recovered = await processNextKnowledgeDocumentJob({
      workerId: "worker-after-retry",
      dependencies: {
        storage,
        scanner: new CleanScanner(),
        scannerName: "test-clean",
        scannerVersion: "1",
        extract: extractDocument,
      },
    });
    expect(recovered).toMatchObject({ claimed: true, outcome: "published" });
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

  it("compensates storage upload failure and permits a later upload", async () => {
    const ctx = await createOrgWithOwner(prisma, "doc-upload-fail");
    const storage = new MemoryPrivateStorage();
    storage.failUpload = true;

    const failed = await uploadValidatedKnowledgeDocument({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      originalFilename: "failed.txt",
      document: await sampleTxt(),
      storage,
    });
    expect(failed.ok).toBe(false);
    await expectNoUnfinishedUpload(prisma, ctx.organizationId);
    expect(
      await prisma.organizationAuditEvent.count({
        where: {
          organizationId: ctx.organizationId,
          action: {
            in: [
              "KNOWLEDGE_DOCUMENT_UPLOAD_FAILED",
              "KNOWLEDGE_DOCUMENT_UPLOAD_CLEANED",
            ],
          },
        },
      }),
    ).toBe(2);
    expect(
      await retrieveActiveKnowledge({
        actor: ctx.owner,
        organizationId: ctx.organizationId,
      }),
    ).toMatchObject({ ok: true, items: [] });

    storage.failUpload = false;
    const retry = await uploadValidatedKnowledgeDocument({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      originalFilename: "retry.txt",
      document: await sampleTxt(),
      storage,
    });
    expect(retry.ok).toBe(true);
  });

  it("deletes a written object when verification download fails", async () => {
    const ctx = await createOrgWithOwner(prisma, "doc-download-fail");
    const storage = new MemoryPrivateStorage();
    storage.failDownload = true;

    const failed = await uploadValidatedKnowledgeDocument({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      originalFilename: "failed.txt",
      document: await sampleTxt(),
      storage,
    });
    expect(failed.ok).toBe(false);
    expect(storage.deletedKeys).toHaveLength(1);
    expect(storage.objectCount).toBe(0);
    await expectNoUnfinishedUpload(prisma, ctx.organizationId);
  });

  it("fails closed and removes the graph on stored checksum mismatch", async () => {
    const ctx = await createOrgWithOwner(prisma, "doc-checksum-fail");
    const storage = new MemoryPrivateStorage();
    storage.returnMismatchedBytes = true;

    const failed = await uploadValidatedKnowledgeDocument({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      originalFilename: "failed.txt",
      document: await sampleTxt(),
      storage,
    });
    expect(failed.ok).toBe(false);
    expect(storage.objectCount).toBe(0);
    expect(
      await prisma.knowledgeDocumentJob.count({
        where: { organizationId: ctx.organizationId },
      }),
    ).toBe(0);
    await expectNoUnfinishedUpload(prisma, ctx.organizationId);
  });

  it("compensates a deterministic failure before finalization", async () => {
    const ctx = await createOrgWithOwner(prisma, "doc-finalize-fail");
    const storage = new MemoryPrivateStorage();

    const failed = await uploadValidatedKnowledgeDocument(
      {
        actor: ctx.owner,
        organizationId: ctx.organizationId,
        originalFilename: "failed.txt",
        document: await sampleTxt(),
        storage,
      },
      {
        testBeforeDocumentUploadFinalization: async () => {
          throw new Error("deterministic finalization failure");
        },
      },
    );
    expect(failed.ok).toBe(false);
    expect(storage.objectCount).toBe(0);
    await expectNoUnfinishedUpload(prisma, ctx.organizationId);
  });

  it("preserves the active original and OCC after failed replacement", async () => {
    const ctx = await createOrgWithOwner(prisma, "doc-replace-fail");
    const storage = new MemoryPrivateStorage();
    const original = await uploadAndActivate(prisma, ctx, storage);
    const sourceBefore = await prisma.knowledgeSource.findUniqueOrThrow({
      where: { id: original.sourceId },
    });

    storage.failDownload = true;
    const failed = await uploadValidatedKnowledgeDocument({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      originalFilename: "replacement.txt",
      document: await sampleTxt(),
      storage,
      replacement: {
        sourceId: original.sourceId,
        expectedSourceVersion: sourceBefore.version,
      },
    });
    expect(failed.ok).toBe(false);
    const sourceAfter = await prisma.knowledgeSource.findUniqueOrThrow({
      where: { id: original.sourceId },
    });
    expect(sourceAfter.version).toBe(sourceBefore.version);
    expect(
      await prisma.knowledgeVersion.count({
        where: {
          organizationId: ctx.organizationId,
          sourceId: original.sourceId,
          state: "ACTIVE",
        },
      }),
    ).toBe(1);

    storage.failDownload = false;
    const retry = await uploadValidatedKnowledgeDocument({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      originalFilename: "replacement.txt",
      document: await sampleTxt(),
      storage,
      replacement: {
        sourceId: original.sourceId,
        expectedSourceVersion: sourceBefore.version,
      },
    });
    expect(retry.ok).toBe(true);
  });

  it("retries compensation idempotently without cross-tenant effects", async () => {
    const owner = await createOrgWithOwner(prisma, "doc-cleanup-owner");
    const outsider = await createOrgWithOwner(prisma, "doc-cleanup-outsider");
    const storage = new MemoryPrivateStorage();
    const outsiderUpload = await uploadValidatedKnowledgeDocument({
      actor: outsider.owner,
      organizationId: outsider.organizationId,
      originalFilename: "outsider.txt",
      document: await sampleTxt(),
      storage,
    });
    if (!outsiderUpload.ok) throw new Error(outsiderUpload.message);

    storage.failDelete = true;
    storage.failDownload = true;
    const failed = await uploadValidatedKnowledgeDocument({
      actor: owner.owner,
      organizationId: owner.organizationId,
      originalFilename: "owner.txt",
      document: await sampleTxt(),
      storage,
    });
    expect(failed.ok).toBe(false);
    const abandoned = await prisma.knowledgeDocument.findFirstOrThrow({
      where: { organizationId: owner.organizationId },
    });
    expect(abandoned.processingState).toBe("ABANDONED");

    storage.failDelete = false;
    const input = {
      storage,
      organizationId: owner.organizationId,
      sourceId: abandoned.sourceId,
      versionId: abandoned.versionId,
      documentId: abandoned.id,
      actorUserId: owner.owner.id,
    };
    await expect(compensateFailedDocumentUpload(input)).resolves.toBe(
      "cleaned",
    );
    await expect(compensateFailedDocumentUpload(input)).resolves.toBe(
      "already_clean",
    );
    expect(
      await prisma.knowledgeDocument.findUnique({
        where: { id: outsiderUpload.value.document.id },
      }),
    ).not.toBeNull();
  });

  it("compensates a failed restore copy and preserves restore OCC", async () => {
    const ctx = await createOrgWithOwner(prisma, "doc-restore-fail");
    const storage = new MemoryPrivateStorage();
    const original = await uploadAndActivate(prisma, ctx, storage);
    const source = await prisma.knowledgeSource.findUniqueOrThrow({
      where: { id: original.sourceId },
    });
    const archived = await archiveKnowledgeSource({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: {
        sourceId: original.sourceId,
        expectedVersion: source.version,
      },
    });
    if (!archived.ok) throw new Error(archived.message);

    storage.failUpload = true;
    const failed = await restoreKnowledgeDocumentVersion({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      sourceId: original.sourceId,
      versionId: original.versionId,
      expectedSourceVersion: archived.source.version,
      storage,
    });
    expect(failed.ok).toBe(false);
    expect(
      await prisma.knowledgeSource.findUniqueOrThrow({
        where: { id: original.sourceId },
      }),
    ).toMatchObject({
      version: archived.source.version,
      archivedAt: expect.any(Date),
    });
    await expectNoUnfinishedUpload(prisma, ctx.organizationId);

    storage.failUpload = false;
    const retry = await restoreKnowledgeDocumentVersion({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      sourceId: original.sourceId,
      versionId: original.versionId,
      expectedSourceVersion: archived.source.version,
      storage,
    });
    expect(retry.ok).toBe(true);
  });

  it("retries a bounded remote scanner failure without terminalizing the graph", async () => {
    const ctx = await createOrgWithOwner(prisma, "doc-bounded-retry");
    const storage = new MemoryPrivateStorage();
    const uploaded = await uploadValidatedKnowledgeDocument({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      originalFilename: "retry.txt",
      document: await sampleTxt(),
      storage,
    });
    if (!uploaded.ok) throw new Error(uploaded.message);

    const retried = await processNextKnowledgeDocumentJob({
      workerId: "worker-retry",
      dependencies: {
        storage,
        scanner: new UnavailableScanner(),
        scannerName: "test-unavailable",
        scannerVersion: "1",
        extract: extractDocument,
      },
    });
    expect(retried).toMatchObject({ claimed: true, outcome: "retry" });

    const job = await prisma.knowledgeDocumentJob.findUniqueOrThrow({
      where: { id: uploaded.value.job.id },
    });
    expect(job.state).toBe("RETRY");
    expect(job.attempts).toBe(1);
    expect(job.leaseOwner).toBeNull();
    const document = await prisma.knowledgeDocument.findUniqueOrThrow({
      where: { id: uploaded.value.document.id },
    });
    expect(document.processingState).toBe("QUEUED");
    const version = await prisma.knowledgeVersion.findUniqueOrThrow({
      where: { id: uploaded.value.version.id },
    });
    expect(version.state).toBe("PROCESSING");
    expect(
      await prisma.organizationAuditEvent.count({
        where: {
          organizationId: ctx.organizationId,
          action: "KNOWLEDGE_DOCUMENT_PROCESSING_FAILED",
        },
      }),
    ).toBe(0);
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

async function expectNoUnfinishedUpload(
  prisma: PrismaClient,
  organizationId: string,
) {
  expect(
    await prisma.knowledgeVersion.count({
      where: { organizationId, state: "PROCESSING" },
    }),
  ).toBe(0);
  expect(
    await prisma.knowledgeDocument.count({
      where: { organizationId, processingState: "UPLOADING" },
    }),
  ).toBe(0);
}

async function uploadAndActivate(
  prisma: PrismaClient,
  ctx: Awaited<ReturnType<typeof createOrgWithOwner>>,
  storage: MemoryPrivateStorage,
) {
  const uploaded = await uploadValidatedKnowledgeDocument({
    actor: ctx.owner,
    organizationId: ctx.organizationId,
    originalFilename: "original.txt",
    document: await sampleTxt(),
    storage,
  });
  if (!uploaded.ok) throw new Error(uploaded.message);
  const processed = await processNextKnowledgeDocumentJob({
    workerId: `worker-${randomUUID()}`,
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
  });
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
  return {
    sourceId: uploaded.value.source.id,
    versionId: uploaded.value.version.id,
  };
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

class UnavailableScanner implements MalwareScanner {
  async scan(): Promise<MalwareScanResult> {
    throw new MalwareScanUnavailableError("scanner offline");
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
  readonly deletedKeys: string[] = [];
  signedDownloadCalls = 0;
  downloadCalls = 0;
  failUpload = false;
  failDownload = false;
  failDelete = false;
  returnMismatchedBytes = false;

  get objectCount() {
    return this.objects.size;
  }

  createObjectKey(organizationId: string, kind: "pdf" | "docx" | "txt") {
    return `${organizationStoragePrefix(organizationId)}${randomUUID()}.${kind}`;
  }

  async createSignedDownload(
    ref: PrivateDocumentRef,
  ): Promise<SignedObjectUrl> {
    this.assertScoped(ref);
    this.signedDownloadCalls += 1;
    return this.signed(ref);
  }

  async upload(ref: PrivateDocumentRef, bytes: Uint8Array) {
    this.assertScoped(ref);
    if (this.failUpload) throw new Error("upload unavailable");
    this.objects.set(ref.key, bytes.slice());
  }

  async download(ref: PrivateDocumentRef) {
    this.assertScoped(ref);
    this.downloadCalls += 1;
    if (this.failDownload) throw new Error("download unavailable");
    const bytes = this.objects.get(ref.key);
    if (!bytes) throw new Error("missing");
    if (this.returnMismatchedBytes) {
      return new TextEncoder().encode("mismatched stored bytes");
    }
    return bytes.slice();
  }

  async head(ref: PrivateDocumentRef): Promise<PrivateObjectHead | null> {
    this.assertScoped(ref);
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
    this.assertScoped(ref);
    if (this.failDelete) throw new Error("delete unavailable");
    this.deletedKeys.push(ref.key);
    this.objects.delete(ref.key);
  }

  private assertScoped(ref: PrivateDocumentRef) {
    const requested = ref.bucket ?? this.bucketName;
    if (requested !== this.bucketName) {
      throw new Error("Document storage bucket is not available.");
    }
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
