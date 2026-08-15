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
import { archiveKnowledgeSource } from "@/lib/orgs/knowledge";
import {
  claimKnowledgeDocumentJob,
  DOCUMENT_JOB_MAX_ATTEMPTS,
  failExpiredExhaustedKnowledgeDocumentJobs,
  processNextKnowledgeDocumentJob,
  uploadValidatedKnowledgeDocument,
} from "@/lib/orgs/knowledge-documents";
import {
  createGate,
  createOrgWithOwner,
} from "@/tests/integration/helpers/knowledge";
import { resetApplicationData } from "@/tests/integration/reset";

describe("Phase 4B document worker concurrency", () => {
  const prisma = new PrismaClient();

  beforeEach(async () => {
    await resetApplicationData(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("terminalizes one exhausted lease exactly once across concurrent sweepers", async () => {
    const ctx = await createOrgWithOwner(prisma, "doc-sweep-once");
    const uploaded = await uploadQueued(ctx);
    await markLeaseExhausted(prisma, uploaded);

    const firstReserved = createGate();
    const firstMayContinue = createGate();
    const secondReserved = createGate();

    const first = failExpiredExhaustedKnowledgeDocumentJobs(
      { now: new Date("2026-08-15T12:00:00.000Z") },
      {
        testAfterJobReservation: async () => {
          firstReserved.markReached();
          await firstMayContinue.waitForRelease();
        },
      },
    );
    await firstReserved.waitUntilReached();

    const second = failExpiredExhaustedKnowledgeDocumentJobs(
      { now: new Date("2026-08-15T12:00:00.000Z") },
      {
        testAfterJobReservation: async () => {
          secondReserved.markReached();
        },
      },
    );
    await secondReserved.waitUntilReached();
    firstMayContinue.release();

    const [firstCount, secondCount] = await Promise.all([first, second]);
    expect(firstCount + secondCount).toBe(1);
    await expectTerminalizedOnce(prisma, ctx.organizationId, uploaded);
  });

  it("does not let a stale exhausted sweep overwrite a newer retry-equivalent transition", async () => {
    const ctx = await createOrgWithOwner(prisma, "doc-stale-sweep");
    const uploaded = await uploadQueued(ctx);
    await markLeaseExhausted(prisma, uploaded);

    const reserved = createGate();
    const mayMutate = createGate();
    const sweep = failExpiredExhaustedKnowledgeDocumentJobs(
      { now: new Date("2026-08-15T12:00:00.000Z") },
      {
        testAfterJobReservation: async () => {
          reserved.markReached();
          await mayMutate.waitForRelease();
        },
      },
    );
    await reserved.waitUntilReached();

    await prisma.knowledgeDocumentJob.update({
      where: { id: uploaded.job.id },
      data: {
        state: "QUEUED",
        attempts: 0,
        availableAt: new Date("2026-08-15T12:00:00.000Z"),
        leaseOwner: null,
        leaseExpiresAt: null,
        lastSafeErrorCode: null,
        completedAt: null,
      },
    });
    await prisma.knowledgeDocument.update({
      where: { id: uploaded.document.id },
      data: {
        processingState: "QUEUED",
        leaseOwner: null,
        leaseExpiresAt: null,
        lastSafeErrorCode: null,
      },
    });
    await prisma.knowledgeVersion.update({
      where: { id: uploaded.version.id },
      data: { state: "PROCESSING" },
    });
    mayMutate.release();

    expect(await sweep).toBe(0);
    expect(
      await prisma.knowledgeDocumentJob.findUniqueOrThrow({
        where: { id: uploaded.job.id },
      }),
    ).toMatchObject({
      state: "QUEUED",
      attempts: 0,
      lastSafeErrorCode: null,
    });
    expect(
      await prisma.knowledgeDocument.findUniqueOrThrow({
        where: { id: uploaded.document.id },
      }),
    ).toMatchObject({
      processingState: "QUEUED",
      lastSafeErrorCode: null,
    });
    expect(
      (
        await prisma.knowledgeVersion.findUniqueOrThrow({
          where: { id: uploaded.version.id },
        })
      ).state,
    ).toBe("PROCESSING");
    expect(
      await prisma.organizationAuditEvent.count({
        where: {
          organizationId: ctx.organizationId,
          action: "KNOWLEDGE_DOCUMENT_PROCESSING_FAILED",
        },
      }),
    ).toBe(0);
  });

  it("serializes exhausted-lease sweep and archive without deadlock", async () => {
    const ctx = await createOrgWithOwner(prisma, "doc-sweep-archive");
    const uploaded = await uploadQueued(ctx);
    await markLeaseExhausted(prisma, uploaded);
    const source = await prisma.knowledgeSource.findUniqueOrThrow({
      where: { id: uploaded.source.id },
    });

    const archiveHeld = createGate();
    const sweepBeforeLock = createGate();
    const archive = archiveKnowledgeSource(
      {
        actor: ctx.owner,
        organizationId: ctx.organizationId,
        raw: {
          sourceId: uploaded.source.id,
          expectedVersion: String(source.version),
        },
      },
      {
        testAfterKnowledgeLock: async () => {
          archiveHeld.markReached();
          await archiveHeld.waitForRelease();
        },
      },
    );
    await archiveHeld.waitUntilReached();

    const sweep = failExpiredExhaustedKnowledgeDocumentJobs(
      { now: new Date("2026-08-15T12:00:00.000Z") },
      {
        testBeforeKnowledgeLock: async () => {
          sweepBeforeLock.markReached();
        },
      },
    );
    await sweepBeforeLock.waitUntilReached();
    archiveHeld.release();

    const [archiveResult, sweepCount] = await Promise.all([archive, sweep]);
    expect(archiveResult.ok).toBe(true);
    expect(sweepCount).toBeGreaterThanOrEqual(0);
    expect(sweepCount).toBeLessThanOrEqual(1);

    const version = await prisma.knowledgeVersion.findUniqueOrThrow({
      where: { id: uploaded.version.id },
    });
    const job = await prisma.knowledgeDocumentJob.findUniqueOrThrow({
      where: { id: uploaded.job.id },
    });
    const document = await prisma.knowledgeDocument.findUniqueOrThrow({
      where: { id: uploaded.document.id },
    });
    expect(version.state).toBe("ARCHIVED");
    expect(["RUNNING", "FAILED"]).toContain(job.state);
    if (job.state === "FAILED") {
      expect(["FAILED", "SCANNING"]).toContain(document.processingState);
    }
    expect(
      await prisma.knowledgeSource.findUniqueOrThrow({
        where: { id: uploaded.source.id },
      }),
    ).toMatchObject({ archivedAt: expect.any(Date) });
  });

  it("serializes claim attach and archive without deadlock", async () => {
    const ctx = await createOrgWithOwner(prisma, "doc-claim-archive");
    const uploaded = await uploadQueued(ctx);
    const source = await prisma.knowledgeSource.findUniqueOrThrow({
      where: { id: uploaded.source.id },
    });

    const archiveHeld = createGate();
    const claimBeforeLock = createGate();
    const archive = archiveKnowledgeSource(
      {
        actor: ctx.owner,
        organizationId: ctx.organizationId,
        raw: {
          sourceId: uploaded.source.id,
          expectedVersion: String(source.version),
        },
      },
      {
        testAfterKnowledgeLock: async () => {
          archiveHeld.markReached();
          await archiveHeld.waitForRelease();
        },
      },
    );
    await archiveHeld.waitUntilReached();

    const claim = claimKnowledgeDocumentJob(
      { workerId: "worker-claim-archive" },
      {
        testBeforeKnowledgeLock: async () => {
          claimBeforeLock.markReached();
        },
      },
    );
    await claimBeforeLock.waitUntilReached();
    archiveHeld.release();

    const [archiveResult, claimed] = await Promise.all([archive, claim]);
    expect(archiveResult.ok).toBe(true);
    const version = await prisma.knowledgeVersion.findUniqueOrThrow({
      where: { id: uploaded.version.id },
    });
    expect(version.state).toBe("ARCHIVED");
    if (claimed) {
      expect(claimed.version.id).toBe(uploaded.version.id);
    } else {
      const job = await prisma.knowledgeDocumentJob.findUniqueOrThrow({
        where: { id: uploaded.job.id },
      });
      expect(["QUEUED", "FAILED", "SUCCEEDED"]).toContain(job.state);
    }
  });

  it("serializes worker failure/retry and archive without deadlock", async () => {
    const ctx = await createOrgWithOwner(prisma, "doc-fail-archive");
    const storage = new MemoryPrivateStorage();
    const uploaded = await uploadQueued(ctx, storage);
    const source = await prisma.knowledgeSource.findUniqueOrThrow({
      where: { id: uploaded.source.id },
    });

    let workerLocks = 0;
    const failureHeld = createGate();
    const archiveBeforeLock = createGate();
    const processed = processNextKnowledgeDocumentJob(
      {
        workerId: "worker-fail-archive",
        dependencies: {
          storage,
          scanner: new UnavailableScanner(),
          scannerName: "test-unavailable",
          scannerVersion: "1",
          extract: extractDocument,
        },
      },
      {
        testBeforeKnowledgeLock: async () => {
          workerLocks += 1;
          if (workerLocks === 2) {
            failureHeld.markReached();
            await failureHeld.waitForRelease();
          }
        },
      },
    );
    await failureHeld.waitUntilReached();

    const archive = archiveKnowledgeSource(
      {
        actor: ctx.owner,
        organizationId: ctx.organizationId,
        raw: {
          sourceId: uploaded.source.id,
          expectedVersion: String(source.version),
        },
      },
      {
        testBeforeKnowledgeLock: async () => {
          archiveBeforeLock.markReached();
        },
      },
    );
    await archiveBeforeLock.waitUntilReached();
    failureHeld.release();

    const [processedResult, archiveResult] = await Promise.all([
      processed,
      archive,
    ]);
    expect(processedResult).toMatchObject({ claimed: true, outcome: "retry" });
    expect(archiveResult.ok).toBe(true);
    const version = await prisma.knowledgeVersion.findUniqueOrThrow({
      where: { id: uploaded.version.id },
    });
    expect(version.state).toBe("ARCHIVED");
    const job = await prisma.knowledgeDocumentJob.findUniqueOrThrow({
      where: { id: uploaded.job.id },
    });
    expect(["RETRY", "FAILED"]).toContain(job.state);
  });

  it("keeps exhausted-lease terminalization tenant-scoped", async () => {
    const owner = await createOrgWithOwner(prisma, "doc-sweep-tenant-a");
    const outsider = await createOrgWithOwner(prisma, "doc-sweep-tenant-b");
    const owned = await uploadQueued(owner);
    const foreign = await uploadQueued(outsider);
    await markLeaseExhausted(prisma, owned);
    await markLeaseExhausted(prisma, foreign);

    expect(
      await failExpiredExhaustedKnowledgeDocumentJobs({
        now: new Date("2026-08-15T12:00:00.000Z"),
        limit: 1,
      }),
    ).toBe(1);

    const ownedJob = await prisma.knowledgeDocumentJob.findUniqueOrThrow({
      where: { id: owned.job.id },
    });
    const foreignJob = await prisma.knowledgeDocumentJob.findUniqueOrThrow({
      where: { id: foreign.job.id },
    });
    expect([ownedJob.state, foreignJob.state].sort()).toEqual([
      "FAILED",
      "RUNNING",
    ]);
    expect(
      await prisma.organizationAuditEvent.count({
        where: {
          organizationId: owner.organizationId,
          action: "KNOWLEDGE_DOCUMENT_PROCESSING_FAILED",
        },
      }),
    ).toBe(ownedJob.state === "FAILED" ? 1 : 0);
    expect(
      await prisma.organizationAuditEvent.count({
        where: {
          organizationId: outsider.organizationId,
          action: "KNOWLEDGE_DOCUMENT_PROCESSING_FAILED",
        },
      }),
    ).toBe(foreignJob.state === "FAILED" ? 1 : 0);
    expect(
      await prisma.knowledgeDocument.findUniqueOrThrow({
        where: { id: foreign.document.id },
      }),
    ).toMatchObject({
      processingState:
        foreignJob.state === "FAILED" ? "FAILED" : "SCANNING",
    });
    expect(
      await prisma.knowledgeDocument.findUniqueOrThrow({
        where: { id: owned.document.id },
      }),
    ).toMatchObject({
      processingState: ownedJob.state === "FAILED" ? "FAILED" : "SCANNING",
    });
  });
});

async function uploadQueued(
  ctx: Awaited<ReturnType<typeof createOrgWithOwner>>,
  storage: MemoryPrivateStorage = new MemoryPrivateStorage(),
) {
  const uploaded = await uploadValidatedKnowledgeDocument({
    actor: ctx.owner,
    organizationId: ctx.organizationId,
    originalFilename: "queued.txt",
    document: await sampleTxt(),
    storage,
  });
  if (!uploaded.ok) throw new Error(uploaded.message);
  return uploaded.value;
}

async function markLeaseExhausted(
  prisma: PrismaClient,
  uploaded: Awaited<ReturnType<typeof uploadQueued>>,
) {
  const expired = new Date("2020-01-01T00:00:00.000Z");
  await prisma.knowledgeDocumentJob.update({
    where: { id: uploaded.job.id },
    data: {
      state: "RUNNING",
      attempts: DOCUMENT_JOB_MAX_ATTEMPTS,
      leaseOwner: "dead-worker",
      leaseExpiresAt: expired,
    },
  });
  await prisma.knowledgeDocument.update({
    where: { id: uploaded.document.id },
    data: {
      processingState: "SCANNING",
      leaseOwner: "dead-worker",
      leaseExpiresAt: expired,
    },
  });
}

async function expectTerminalizedOnce(
  prisma: PrismaClient,
  organizationId: string,
  uploaded: Awaited<ReturnType<typeof uploadQueued>>,
) {
  const job = await prisma.knowledgeDocumentJob.findUniqueOrThrow({
    where: { id: uploaded.job.id },
  });
  expect(job).toMatchObject({
    state: "FAILED",
    leaseOwner: null,
    lastSafeErrorCode: "lease_exhausted",
  });
  expect(
    await prisma.knowledgeDocument.findUniqueOrThrow({
      where: { id: uploaded.document.id },
    }),
  ).toMatchObject({
    processingState: "FAILED",
    leaseOwner: null,
    lastSafeErrorCode: "lease_exhausted",
  });
  expect(
    (
      await prisma.knowledgeVersion.findUniqueOrThrow({
        where: { id: uploaded.version.id },
      })
    ).state,
  ).toBe("FAILED");
  expect(
    await prisma.organizationAuditEvent.count({
      where: {
        organizationId,
        action: "KNOWLEDGE_DOCUMENT_PROCESSING_FAILED",
      },
    }),
  ).toBe(1);
}

async function sampleTxt() {
  return validateDocument({
    bytes: new TextEncoder().encode(
      "# Refund policy\n\nCustomers may request a refund within 30 days.",
    ),
    filename: "policies.txt",
    declaredMimeType: "text/plain",
  });
}

class UnavailableScanner implements MalwareScanner {
  async scan(): Promise<MalwareScanResult> {
    throw new MalwareScanUnavailableError("scanner offline");
  }
}

class MemoryPrivateStorage implements PrivateDocumentStorage {
  readonly bucketName = "test-private";
  private readonly objects = new Map<string, Uint8Array>();

  createObjectKey(organizationId: string, kind: "pdf" | "docx" | "txt") {
    return `${organizationStoragePrefix(organizationId)}${randomUUID()}.${kind}`;
  }

  async createSignedDownload(
    ref: PrivateDocumentRef,
  ): Promise<SignedObjectUrl> {
    return {
      url: `https://private.invalid/${encodeURIComponent(ref.key)}`,
      key: ref.key,
      expiresAt: new Date(Date.now() + 60_000),
    };
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
          etag: createHash("sha256").update(bytes).digest("hex"),
          updatedAt: new Date("2026-08-14T00:00:00.000Z"),
        }
      : null;
  }

  async delete(ref: PrivateDocumentRef) {
    this.objects.delete(ref.key);
  }
}
