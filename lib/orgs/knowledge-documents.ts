import "server-only";

import { createHash } from "node:crypto";

import type {
  KnowledgeDocument,
  KnowledgeDocumentIssue,
  KnowledgeDocumentJob,
  KnowledgeSource,
  KnowledgeVersion,
  Prisma,
} from "@prisma/client";

import type { SafeUser } from "@/lib/auth/users";
import type { MalwareScanner } from "@/lib/orgs/document-malware";
import {
  MalwareDetectedError,
  MalwareScanUnavailableError,
  requireCleanDocument,
} from "@/lib/orgs/document-malware";
import {
  checksumSections,
  DocumentExtractionError,
} from "@/lib/orgs/document-extraction";
import {
  classifyDocumentProcessingError,
  documentRetryDelayMs,
  findNearDuplicates,
} from "@/lib/orgs/document-processing";
import type {
  PrivateDocumentStorage,
  PrivateDocumentRef,
} from "@/lib/orgs/document-storage";
import { PRIVATE_DOCUMENT_BUCKET } from "@/lib/orgs/document-storage";
import type {
  ExtractedDocument,
  ValidatedDocument,
} from "@/lib/orgs/document-types";
import { validateDocument } from "@/lib/orgs/document-validation";
import { recordOrganizationAuditEvent } from "@/lib/orgs/audit";
import { requireOrganizationPermission } from "@/lib/orgs/authorization";
import {
  acquireOrganizationKnowledgeLock,
  ConflictError,
  isInFlightDocumentProcessingState,
  KnowledgeLifecycleError,
  KnowledgeNotFoundError,
  lockKnowledgeDocumentForUpdate,
  lockKnowledgeDocumentJobForUpdate,
  lockKnowledgeSourceForUpdate,
  lockKnowledgeVersionForUpdate,
  lockKnowledgeWorkerGraphForUpdate,
  mapKnowledgeError,
  requireActiveActorInTx,
  type AuthFailure,
  type KnowledgeMutationTestHooks,
} from "@/lib/orgs/knowledge-access";
import {
  publishDocumentExtraction,
  type DocumentProcessingIssueInput,
} from "@/lib/orgs/knowledge";
import { KNOWLEDGE_ACTIVATABLE_CATEGORY } from "@/lib/orgs/knowledge-validation";
import { prisma } from "@/lib/prisma";

export const DOCUMENT_EXTRACTOR_NAME = "outreach-deterministic-document";
export const DOCUMENT_EXTRACTOR_VERSION = "phase-4b.v1";
export const DOCUMENT_JOB_LEASE_MS = 2 * 60_000;
export const DOCUMENT_JOB_MAX_ATTEMPTS = 5;

export type DocumentGraph = KnowledgeDocument & {
  issues: KnowledgeDocumentIssue[];
  jobs: KnowledgeDocumentJob[];
};

export type DocumentProcessingDependencies = {
  storage: PrivateDocumentStorage;
  scanner: MalwareScanner;
  extract: (document: ValidatedDocument) => Promise<ExtractedDocument>;
  scannerName: string;
  scannerVersion: string;
  now?: () => Date;
};

type UploadedDocument = {
  source: KnowledgeSource;
  version: KnowledgeVersion;
  document: KnowledgeDocument;
  job: KnowledgeDocumentJob;
};

export async function uploadValidatedKnowledgeDocument(
  input: {
    actor: SafeUser;
    organizationId: string;
    originalFilename: string;
    document: ValidatedDocument;
    storage: PrivateDocumentStorage;
    replacement?: { sourceId: string; expectedSourceVersion: number };
  },
  hooks: KnowledgeMutationTestHooks = {},
): Promise<{ ok: true; value: UploadedDocument } | AuthFailure> {
  let initiated:
    | {
        source: KnowledgeSource;
        version: KnowledgeVersion;
        document: KnowledgeDocument;
      }
    | undefined;

  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.knowledge.manage",
    });
    const objectKey = input.storage.createObjectKey(
      input.organizationId,
      input.document.kind,
    );
    const title =
      input.document.filename.replace(/\.(pdf|docx|txt)$/i, "").trim() ||
      "Uploaded document";

    initiated = await prisma.$transaction(async (tx) => {
      await acquireOrganizationKnowledgeLock(tx, input.organizationId, hooks);
      await requireActiveActorInTx(
        tx,
        {
          organizationId: input.organizationId,
          userId: input.actor.id,
          permission: "org.knowledge.manage",
        },
        hooks,
      );

      let source: KnowledgeSource;
      if (input.replacement) {
        const locked = await lockKnowledgeSourceForUpdate(
          tx,
          {
            organizationId: input.organizationId,
            sourceId: input.replacement.sourceId,
          },
          hooks,
        );
        if (!locked) throw new KnowledgeNotFoundError();
        if (
          locked.archivedAt ||
          locked.inputKind !== "DOCUMENT" ||
          locked.version !== input.replacement.expectedSourceVersion
        ) {
          throw new ConflictError();
        }
        const unfinished = await tx.knowledgeVersion.findFirst({
          where: {
            organizationId: input.organizationId,
            sourceId: locked.id,
            OR: [
              { state: { in: ["DRAFT", "PROCESSING", "NEEDS_ATTENTION"] } },
              {
                state: "FAILED",
                document: {
                  is: { processingState: { not: "ABANDONED" } },
                },
              },
            ],
          },
          select: { id: true },
        });
        if (unfinished) {
          throw new KnowledgeLifecycleError(
            "draft_exists",
            "Finish or archive the current document draft before replacing it.",
          );
        }
        source = await tx.knowledgeSource.findFirstOrThrow({
          where: { id: locked.id, organizationId: input.organizationId },
        });
      } else {
        source = await tx.knowledgeSource.create({
          data: {
            organizationId: input.organizationId,
            inputKind: "DOCUMENT",
            category: KNOWLEDGE_ACTIVATABLE_CATEGORY,
            title,
            createdByUserId: input.actor.id,
          },
        });
      }

      const version = await tx.knowledgeVersion.create({
        data: {
          organizationId: input.organizationId,
          sourceId: source.id,
          state: "PROCESSING",
          title,
          contentChecksum: input.document.sha256,
          createdByUserId: input.actor.id,
        },
      });
      const document = await tx.knowledgeDocument.create({
        data: {
          organizationId: input.organizationId,
          sourceId: source.id,
          versionId: version.id,
          originalFilename: input.originalFilename.slice(0, 512),
          displayFilename: input.document.filename,
          storageBucket: input.storage.bucketName ?? PRIVATE_DOCUMENT_BUCKET,
          storageObjectKey: objectKey,
          declaredMimeType: input.document.mimeType,
          uploadedByUserId: input.actor.id,
        },
      });
      if (input.replacement) {
        const bumped = await tx.knowledgeSource.updateMany({
          where: {
            id: source.id,
            organizationId: input.organizationId,
            version: input.replacement.expectedSourceVersion,
          },
          data: { version: { increment: 1 } },
        });
        if (bumped.count !== 1) throw new ConflictError();
      }
      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "KNOWLEDGE_DOCUMENT_UPLOAD_INITIATED",
        metadata: {
          sourceId: source.id,
          versionId: version.id,
          documentId: document.id,
          replacement: Boolean(input.replacement),
        },
      });
      return { source, version, document };
    });

    const ref = documentStorageRef(initiated.document);
    await input.storage.upload(
      ref,
      input.document.bytes,
      input.document.mimeType,
    );
    const [storedBytes, objectHead] = await Promise.all([
      input.storage.download(ref),
      input.storage.head(ref),
    ]);
    const stored = await validateDocument({
      bytes: storedBytes,
      filename: input.document.filename,
      declaredMimeType: input.document.mimeType,
    });
    if (
      stored.sha256 !== input.document.sha256 ||
      stored.byteLength !== input.document.byteLength
    ) {
      throw new Error("Stored object checksum does not match the upload.");
    }
    await hooks.testBeforeDocumentUploadFinalization?.();

    const finalized = await prisma.$transaction(async (tx) => {
      await acquireOrganizationKnowledgeLock(tx, input.organizationId, hooks);
      await requireActiveActorInTx(
        tx,
        {
          organizationId: input.organizationId,
          userId: input.actor.id,
          permission: "org.knowledge.manage",
        },
        hooks,
      );
      const source = await lockKnowledgeSourceForUpdate(
        tx,
        {
          organizationId: input.organizationId,
          sourceId: initiated!.source.id,
        },
        hooks,
      );
      const version = await lockKnowledgeVersionForUpdate(tx, {
        organizationId: input.organizationId,
        sourceId: initiated!.source.id,
        versionId: initiated!.version.id,
      });
      const document = await lockKnowledgeDocumentForUpdate(tx, {
        organizationId: input.organizationId,
        sourceId: initiated!.source.id,
        versionId: initiated!.version.id,
        documentId: initiated!.document.id,
      });
      if (
        !source ||
        source.archivedAt ||
        source.inputKind !== "DOCUMENT" ||
        !version ||
        version.state !== "PROCESSING" ||
        !document ||
        document.processingState !== "UPLOADING"
      ) {
        throw new ConflictError();
      }

      const finalizedAt = new Date();
      const updated = await tx.knowledgeDocument.update({
        where: { id: initiated!.document.id },
        data: {
          detectedMimeType: stored.mimeType,
          byteSize: BigInt(stored.byteLength),
          binaryChecksum: stored.sha256,
          objectEtag: objectHead?.etag ?? null,
          objectVersion: objectHead?.updatedAt?.toISOString() ?? null,
          finalizedAt,
          processingState: "QUEUED",
        },
      });
      const idempotencyKey = documentJobIdempotencyKey(
        initiated!.version.id,
        stored.sha256,
      );
      const job = await tx.knowledgeDocumentJob.upsert({
        where: { idempotencyKey },
        create: {
          organizationId: input.organizationId,
          sourceId: initiated!.source.id,
          versionId: initiated!.version.id,
          documentId: initiated!.document.id,
          idempotencyKey,
          maxAttempts: DOCUMENT_JOB_MAX_ATTEMPTS,
        },
        update: {},
      });
      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "KNOWLEDGE_DOCUMENT_UPLOAD_FINALIZED",
        metadata: {
          sourceId: initiated!.source.id,
          versionId: initiated!.version.id,
          documentId: initiated!.document.id,
          jobId: job.id,
          byteSize: stored.byteLength,
          checksum: stored.sha256,
        },
      });
      if (input.replacement) {
        await recordOrganizationAuditEvent(tx, {
          organizationId: input.organizationId,
          actorUserId: input.actor.id,
          action: "KNOWLEDGE_DOCUMENT_REPLACED",
          metadata: {
            sourceId: initiated!.source.id,
            versionId: initiated!.version.id,
            documentId: initiated!.document.id,
          },
        });
      }
      return { document: updated, job };
    });

    return {
      ok: true,
      value: {
        source: initiated.source,
        version: initiated.version,
        document: finalized.document,
        job: finalized.job,
      },
    };
  } catch (error) {
    if (initiated) {
      await compensateFailedDocumentUpload({
        storage: input.storage,
        organizationId: input.organizationId,
        sourceId: initiated.source.id,
        versionId: initiated.version.id,
        documentId: initiated.document.id,
        actorUserId: input.actor.id,
      }).catch(() => {
        // The durable stale-upload sweep retries compensation. Never replace
        // the original safe client failure with cleanup internals.
      });
    }
    return (
      mapKnowledgeError(error) ?? {
        ok: false,
        reason: "failed",
        message: initiated
          ? "The upload could not be finalized. No document was activated."
          : "The document could not be uploaded.",
      }
    );
  }
}

type ReservedDocumentJob = {
  id: string;
  organizationId: string;
  sourceId: string;
  versionId: string;
  documentId: string;
  attempts: number;
  maxAttempts: number;
};

/**
 * Terminalize RUNNING jobs whose lease expired after the final attempt.
 *
 * Two-stage protocol: a short SKIP LOCKED reservation reads a candidate and
 * commits (releasing the job row) before the graph-mutation transaction
 * waits on the organization knowledge lock. Mutation then locks
 * source → version → document → job, revalidates, and applies one
 * conditional terminal state.
 */
export async function failExpiredExhaustedKnowledgeDocumentJobs(
  input: {
    now?: Date;
    limit?: number;
  } = {},
  hooks: KnowledgeMutationTestHooks = {},
): Promise<number> {
  const now = input.now ?? new Date();
  const limit = input.limit ?? 20;
  const seen = new Set<string>();
  let failed = 0;
  for (let count = 0; count < limit; count += 1) {
    const candidate = await reserveExpiredExhaustedKnowledgeDocumentJob(
      now,
      seen,
    );
    if (!candidate) break;
    seen.add(candidate.id);
    if (hooks.testAfterJobReservation) {
      await hooks.testAfterJobReservation();
    }
    const terminalized = await terminalizeReservedExhaustedJob(
      candidate,
      now,
      hooks,
    );
    if (terminalized) failed += 1;
  }
  return failed;
}

async function reserveExpiredExhaustedKnowledgeDocumentJob(
  now: Date,
  seen: ReadonlySet<string>,
): Promise<ReservedDocumentJob | null> {
  return prisma.$transaction(async (tx) => {
    const seenIds = [...seen];
    const rows =
      seenIds.length === 0
        ? await tx.$queryRaw<ReservedDocumentJob[]>`
            SELECT id,
                   "organizationId",
                   "sourceId",
                   "versionId",
                   "documentId",
                   attempts,
                   "maxAttempts"
            FROM "KnowledgeDocumentJob"
            WHERE state = 'RUNNING'
              AND "leaseExpiresAt" < ${now}
              AND attempts >= "maxAttempts"
            ORDER BY "leaseExpiresAt" ASC, id ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
          `
        : await tx.$queryRaw<ReservedDocumentJob[]>`
            SELECT id,
                   "organizationId",
                   "sourceId",
                   "versionId",
                   "documentId",
                   attempts,
                   "maxAttempts"
            FROM "KnowledgeDocumentJob"
            WHERE state = 'RUNNING'
              AND "leaseExpiresAt" < ${now}
              AND attempts >= "maxAttempts"
              AND NOT (id = ANY(${seenIds}))
            ORDER BY "leaseExpiresAt" ASC, id ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
          `;
    return rows[0] ?? null;
  });
}

async function terminalizeReservedExhaustedJob(
  candidate: ReservedDocumentJob,
  now: Date,
  hooks: KnowledgeMutationTestHooks,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const graph = await lockKnowledgeWorkerGraphForUpdate(
      tx,
      {
        organizationId: candidate.organizationId,
        sourceId: candidate.sourceId,
        versionId: candidate.versionId,
        documentId: candidate.documentId,
        jobId: candidate.id,
      },
      hooks,
    );
    if (
      !graph.job ||
      graph.job.sourceId !== candidate.sourceId ||
      graph.job.versionId !== candidate.versionId ||
      graph.job.documentId !== candidate.documentId ||
      graph.job.state !== "RUNNING" ||
      graph.job.attempts < graph.job.maxAttempts ||
      !graph.job.leaseExpiresAt ||
      graph.job.leaseExpiresAt >= now
    ) {
      return false;
    }
    if (
      !graph.source ||
      graph.source.inputKind !== "DOCUMENT" ||
      !graph.version ||
      !graph.document
    ) {
      return false;
    }

    const jobUpdated = await tx.knowledgeDocumentJob.updateMany({
      where: {
        id: candidate.id,
        organizationId: candidate.organizationId,
        sourceId: candidate.sourceId,
        versionId: candidate.versionId,
        documentId: candidate.documentId,
        state: "RUNNING",
        attempts: { gte: graph.job.maxAttempts },
        leaseExpiresAt: { lt: now },
      },
      data: {
        state: "FAILED",
        leaseOwner: null,
        leaseExpiresAt: null,
        lastSafeErrorCode: "lease_exhausted",
        completedAt: now,
      },
    });
    if (jobUpdated.count !== 1) return false;

    if (isInFlightDocumentProcessingState(graph.document.processingState)) {
      await tx.knowledgeDocument.updateMany({
        where: {
          id: candidate.documentId,
          organizationId: candidate.organizationId,
          sourceId: candidate.sourceId,
          versionId: candidate.versionId,
          processingState: { in: ["QUEUED", "SCANNING", "EXTRACTING"] },
        },
        data: {
          processingState: "FAILED",
          leaseOwner: null,
          leaseExpiresAt: null,
          lastSafeErrorCode: "lease_exhausted",
        },
      });
    }
    if (graph.version.state === "PROCESSING") {
      await tx.knowledgeVersion.updateMany({
        where: {
          id: candidate.versionId,
          organizationId: candidate.organizationId,
          sourceId: candidate.sourceId,
          state: "PROCESSING",
        },
        data: { state: "FAILED" },
      });
    }
    await recordOrganizationAuditEvent(tx, {
      organizationId: candidate.organizationId,
      actorUserId: null,
      action: "KNOWLEDGE_DOCUMENT_PROCESSING_FAILED",
      metadata: {
        sourceId: candidate.sourceId,
        versionId: candidate.versionId,
        documentId: candidate.documentId,
        jobId: candidate.id,
        safeErrorCode: "lease_exhausted",
        attempts: graph.job.attempts,
      },
    });
    return true;
  });
}

export async function claimKnowledgeDocumentJob(
  input: {
    workerId: string;
    now?: Date;
    leaseMs?: number;
  },
  hooks: KnowledgeMutationTestHooks = {},
): Promise<
  | (KnowledgeDocumentJob & {
      document: KnowledgeDocument;
      version: KnowledgeVersion;
    })
  | null
> {
  const now = input.now ?? new Date();
  const leaseExpiresAt = new Date(
    now.getTime() + (input.leaseMs ?? DOCUMENT_JOB_LEASE_MS),
  );
  const reserved = await reserveKnowledgeDocumentJob({
    workerId: input.workerId,
    now,
    leaseExpiresAt,
  });
  if (!reserved) return null;
  if (hooks.testAfterJobReservation) {
    await hooks.testAfterJobReservation();
  }
  return attachClaimedKnowledgeDocumentJob(
    reserved,
    {
      workerId: input.workerId,
      now,
      leaseExpiresAt,
    },
    hooks,
  );
}

async function reserveKnowledgeDocumentJob(input: {
  workerId: string;
  now: Date;
  leaseExpiresAt: Date;
}): Promise<ReservedDocumentJob | null> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<ReservedDocumentJob[]>`
      WITH candidate AS (
        SELECT id
        FROM "KnowledgeDocumentJob"
        WHERE (
          (state IN ('QUEUED', 'RETRY') AND "availableAt" <= ${input.now})
          OR (state = 'RUNNING' AND "leaseExpiresAt" < ${input.now})
        )
          AND attempts < "maxAttempts"
        ORDER BY "availableAt" ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE "KnowledgeDocumentJob" AS job
      SET state = 'RUNNING',
          attempts = job.attempts + 1,
          "leaseOwner" = ${input.workerId},
          "leaseExpiresAt" = ${input.leaseExpiresAt},
          "updatedAt" = ${input.now}
      FROM candidate
      WHERE job.id = candidate.id
      RETURNING job.id,
                job."organizationId",
                job."sourceId",
                job."versionId",
                job."documentId",
                job.attempts,
                job."maxAttempts"
    `;
    return rows[0] ?? null;
  });
}

async function attachClaimedKnowledgeDocumentJob(
  reserved: ReservedDocumentJob,
  input: { workerId: string; now: Date; leaseExpiresAt: Date },
  hooks: KnowledgeMutationTestHooks,
): Promise<
  | (KnowledgeDocumentJob & {
      document: KnowledgeDocument;
      version: KnowledgeVersion;
    })
  | null
> {
  return prisma.$transaction(async (tx) => {
    const graph = await lockKnowledgeWorkerGraphForUpdate(
      tx,
      {
        organizationId: reserved.organizationId,
        sourceId: reserved.sourceId,
        versionId: reserved.versionId,
        documentId: reserved.documentId,
        jobId: reserved.id,
      },
      hooks,
    );
    const jobStillOurs =
      graph.job &&
      graph.job.state === "RUNNING" &&
      graph.job.leaseOwner === input.workerId &&
      graph.job.sourceId === reserved.sourceId &&
      graph.job.versionId === reserved.versionId &&
      graph.job.documentId === reserved.documentId;
    const graphProcessable =
      Boolean(graph.source) &&
      graph.source?.inputKind === "DOCUMENT" &&
      !graph.source?.archivedAt &&
      graph.version?.state === "PROCESSING" &&
      isInFlightDocumentProcessingState(graph.document?.processingState);

    if (!jobStillOurs) {
      return null;
    }
    if (!graphProcessable) {
      await releaseStaleReservedJob(tx, {
        reserved,
        workerId: input.workerId,
        now: input.now,
        documentState: graph.document?.processingState ?? null,
        versionState: graph.version?.state ?? null,
      });
      return null;
    }

    const claimedDocument = await tx.knowledgeDocument.updateMany({
      where: {
        id: reserved.documentId,
        organizationId: reserved.organizationId,
        sourceId: reserved.sourceId,
        versionId: reserved.versionId,
        processingState: {
          in: ["QUEUED", "SCANNING", "EXTRACTING"],
        },
      },
      data: {
        processingState: "SCANNING",
        processingAttempts: { increment: 1 },
        leaseOwner: input.workerId,
        leaseExpiresAt: input.leaseExpiresAt,
        retryAt: null,
      },
    });
    if (claimedDocument.count !== 1) {
      await releaseStaleReservedJob(tx, {
        reserved,
        workerId: input.workerId,
        now: input.now,
        documentState: graph.document?.processingState ?? null,
        versionState: graph.version?.state ?? null,
      });
      return null;
    }

    return tx.knowledgeDocumentJob.findFirstOrThrow({
      where: {
        id: reserved.id,
        organizationId: reserved.organizationId,
      },
      include: { document: true, version: true },
    });
  });
}

async function releaseStaleReservedJob(
  tx: Prisma.TransactionClient,
  input: {
    reserved: ReservedDocumentJob;
    workerId: string;
    now: Date;
    documentState: string | null;
    versionState: string | null;
  },
): Promise<void> {
  const completed =
    input.documentState === "COMPLETE" ||
    input.versionState === "DRAFT" ||
    input.versionState === "NEEDS_ATTENTION" ||
    input.versionState === "ACTIVE";
  await tx.knowledgeDocumentJob.updateMany({
    where: {
      id: input.reserved.id,
      organizationId: input.reserved.organizationId,
      state: "RUNNING",
      leaseOwner: input.workerId,
    },
    data: completed
      ? {
          state: "SUCCEEDED",
          leaseOwner: null,
          leaseExpiresAt: null,
          completedAt: input.now,
          lastSafeErrorCode: null,
        }
      : {
          state: "FAILED",
          leaseOwner: null,
          leaseExpiresAt: null,
          completedAt: input.now,
          lastSafeErrorCode: "stale_claim",
        },
  });
}

export async function processNextKnowledgeDocumentJob(
  input: {
    workerId: string;
    dependencies: DocumentProcessingDependencies;
  },
  hooks: KnowledgeMutationTestHooks = {},
): Promise<
  | { claimed: false }
  | {
      claimed: true;
      jobId: string;
      outcome: "published" | "needs_attention" | "retry" | "failed" | "stale";
    }
> {
  await failExpiredExhaustedKnowledgeDocumentJobs(
    {
      now: input.dependencies.now?.(),
    },
    hooks,
  );
  const job = await claimKnowledgeDocumentJob(
    {
      workerId: input.workerId,
      now: input.dependencies.now?.(),
    },
    hooks,
  );
  if (!job) return { claimed: false };
  const now = input.dependencies.now ?? (() => new Date());

  try {
    const ref = documentStorageRef(job.document);
    const bytes = await input.dependencies.storage.download(ref);
    const checksum = sha256(bytes);
    if (
      !job.document.binaryChecksum ||
      checksum !== job.document.binaryChecksum
    ) {
      throw new Error("storage_checksum_mismatch");
    }
    const clean = await requireCleanDocument(
      input.dependencies.scanner,
      bytes,
      checksum,
    );

    await recordCleanDocumentScan({
      job,
      workerId: input.workerId,
      checksum: clean.sha256,
      scannerName: input.dependencies.scannerName,
      scannerVersion: input.dependencies.scannerVersion,
      now: now(),
      hooks,
    });

    const validated = await validateDocument({
      bytes,
      filename: job.document.displayFilename,
      declaredMimeType: job.document.declaredMimeType,
    });
    let extracted: ExtractedDocument;
    try {
      extracted = await input.dependencies.extract(validated);
    } catch (error) {
      if (!(error instanceof DocumentExtractionError)) throw error;
      const attentionSections = [
        {
          citationKey: "document_attention",
          title: "Document requires correction",
          passages: [
            {
              citationKey: "document_attention_p0001",
              body: "No usable text was extracted. Replace this placeholder with reviewed text or retry with a readable document.",
            },
          ],
        },
      ];
      const attention = await publishDocumentExtraction({
        organizationId: job.organizationId,
        sourceId: job.sourceId,
        versionId: job.versionId,
        documentId: job.documentId,
        jobId: job.id,
        workerId: input.workerId,
        extractorName: DOCUMENT_EXTRACTOR_NAME,
        extractorVersion: DOCUMENT_EXTRACTOR_VERSION,
        normalizedContentChecksum: checksumSections(attentionSections),
        sections: attentionSections,
        issues: [
          {
            code: "EXTRACTION_REQUIRES_CORRECTION",
            severity: "BLOCKING",
            safeMessage:
              "The document did not contain usable extractable text. Correct the draft or upload a readable replacement.",
          },
        ],
      });
      if (!attention.ok) throw new ConflictError();
      return {
        claimed: true,
        jobId: job.id,
        outcome: "needs_attention",
      };
    }
    if (
      extracted.sourceSha256 !== checksum ||
      extracted.sections.length === 0
    ) {
      throw new Error("extraction_checksum_mismatch");
    }
    const duplicates = await findDocumentDuplicates({
      organizationId: job.organizationId,
      documentId: job.documentId,
      binaryChecksum: checksum,
      contentChecksum: extracted.contentSha256,
      sections: extracted.sections,
    });
    const issues: DocumentProcessingIssueInput[] = [];
    if (duplicates.exact) {
      issues.push({
        code: "EXACT_DUPLICATE",
        severity: "WARNING",
        safeMessage:
          "This document may duplicate an existing knowledge version.",
      });
    }
    if (duplicates.near) {
      issues.push({
        code: "NEAR_DUPLICATE",
        severity: "WARNING",
        safeMessage:
          "This document is very similar to an existing knowledge version.",
      });
    }

    const published = await publishDocumentExtraction({
      organizationId: job.organizationId,
      sourceId: job.sourceId,
      versionId: job.versionId,
      documentId: job.documentId,
      jobId: job.id,
      workerId: input.workerId,
      extractorName: DOCUMENT_EXTRACTOR_NAME,
      extractorVersion: DOCUMENT_EXTRACTOR_VERSION,
      normalizedContentChecksum: extracted.contentSha256,
      sections: extracted.sections,
      issues,
      exactDuplicate: duplicates.exact,
      nearDuplicate: duplicates.near,
    });
    if (!published.ok) throw new ConflictError();
    return {
      claimed: true,
      jobId: job.id,
      outcome: published.state === "DRAFT" ? "published" : "needs_attention",
    };
  } catch (error) {
    const outcome = await failOrRetryDocumentJob(
      {
        job,
        workerId: input.workerId,
        error,
        scannerName: input.dependencies.scannerName,
        scannerVersion: input.dependencies.scannerVersion,
        now: now(),
      },
      hooks,
    );
    return { claimed: true, jobId: job.id, outcome };
  }
}

async function recordCleanDocumentScan(input: {
  job: KnowledgeDocumentJob;
  workerId: string;
  checksum: string;
  scannerName: string;
  scannerVersion: string;
  now: Date;
  hooks: KnowledgeMutationTestHooks;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const graph = await lockKnowledgeWorkerGraphForUpdate(
      tx,
      {
        organizationId: input.job.organizationId,
        sourceId: input.job.sourceId,
        versionId: input.job.versionId,
        documentId: input.job.documentId,
        jobId: input.job.id,
      },
      input.hooks,
    );
    if (
      !graph.source ||
      graph.source.archivedAt ||
      graph.source.inputKind !== "DOCUMENT" ||
      graph.version?.state !== "PROCESSING" ||
      graph.document?.processingState !== "SCANNING" ||
      graph.document.leaseOwner !== input.workerId ||
      graph.document.binaryChecksum !== input.checksum ||
      graph.job?.state !== "RUNNING" ||
      graph.job.leaseOwner !== input.workerId
    ) {
      throw new ConflictError();
    }
    const changed = await tx.knowledgeDocument.updateMany({
      where: {
        id: input.job.documentId,
        organizationId: input.job.organizationId,
        sourceId: input.job.sourceId,
        versionId: input.job.versionId,
        processingState: "SCANNING",
        leaseOwner: input.workerId,
        binaryChecksum: input.checksum,
      },
      data: {
        scanState: "CLEAN",
        scannedChecksum: input.checksum,
        scannerName: input.scannerName,
        scannerVersion: input.scannerVersion,
        scannedAt: input.now,
        processingState: "EXTRACTING",
      },
    });
    if (changed.count !== 1) throw new ConflictError();
    await recordOrganizationAuditEvent(tx, {
      organizationId: input.job.organizationId,
      actorUserId: null,
      action: "KNOWLEDGE_DOCUMENT_SCAN_COMPLETED",
      metadata: {
        sourceId: input.job.sourceId,
        versionId: input.job.versionId,
        documentId: input.job.documentId,
        jobId: input.job.id,
        verdict: "clean",
        checksum: input.checksum,
        scannerVersion: input.scannerVersion,
      },
    });
  });
}

async function failOrRetryDocumentJob(
  input: {
    job: KnowledgeDocumentJob & { document: KnowledgeDocument };
    workerId: string;
    error: unknown;
    scannerName: string;
    scannerVersion: string;
    now: Date;
  },
  hooks: KnowledgeMutationTestHooks = {},
): Promise<"retry" | "failed" | "stale"> {
  const classification = classifyDocumentProcessingError(input.error);
  const infected = input.error instanceof MalwareDetectedError;
  const retryable =
    classification.retryable && input.job.attempts < input.job.maxAttempts;
  const scanFailed =
    !retryable && input.error instanceof MalwareScanUnavailableError;
  const safeErrorCode = safeProcessingErrorCode(input.error, classification);
  const retryAt = retryable
    ? new Date(
        input.now.getTime() +
          documentRetryDelayMs(input.job.attempts, { jitterRatio: 0 }),
      )
    : null;

  const mutated = await prisma.$transaction(async (tx) => {
    const graph = await lockKnowledgeWorkerGraphForUpdate(
      tx,
      {
        organizationId: input.job.organizationId,
        sourceId: input.job.sourceId,
        versionId: input.job.versionId,
        documentId: input.job.documentId,
        jobId: input.job.id,
      },
      hooks,
    );
    if (
      !isCurrentFailureRetryGraph(graph, {
        workerId: input.workerId,
        attempts: input.job.attempts,
        sourceId: input.job.sourceId,
        versionId: input.job.versionId,
        documentId: input.job.documentId,
        now: input.now,
      })
    ) {
      return false;
    }
    const terminalAt = retryable ? null : input.now;
    const jobUpdated = await tx.knowledgeDocumentJob.updateMany({
      where: {
        id: input.job.id,
        organizationId: input.job.organizationId,
        sourceId: input.job.sourceId,
        versionId: input.job.versionId,
        documentId: input.job.documentId,
        state: "RUNNING",
        leaseOwner: input.workerId,
        attempts: input.job.attempts,
        leaseExpiresAt: { gte: input.now },
      },
      data: {
        state: retryable ? "RETRY" : "FAILED",
        availableAt: retryAt ?? input.now,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastSafeErrorCode: safeErrorCode,
        completedAt: terminalAt,
      },
    });
    if (jobUpdated.count !== 1) throw new ConflictError();
    const documentUpdated = await tx.knowledgeDocument.updateMany({
      where: {
        id: input.job.documentId,
        organizationId: input.job.organizationId,
        sourceId: input.job.sourceId,
        versionId: input.job.versionId,
        leaseOwner: input.workerId,
        processingState: graph.document.processingState,
      },
      data: {
        processingState: retryable ? "QUEUED" : "FAILED",
        ...(infected
          ? {
              scanState: "INFECTED" as const,
              scannedChecksum: input.job.document.binaryChecksum,
              scannerName: input.scannerName,
              scannerVersion: input.scannerVersion,
              scannedAt: input.now,
            }
          : scanFailed
            ? {
                scanState: "FAILED" as const,
                scannedChecksum: null,
                scannerName: input.scannerName,
                scannerVersion: input.scannerVersion,
                scannedAt: input.now,
              }
            : {}),
        leaseOwner: null,
        leaseExpiresAt: null,
        retryAt,
        lastSafeErrorCode: safeErrorCode,
      },
    });
    if (documentUpdated.count !== 1) throw new ConflictError();
    if (!retryable) {
      const versionUpdated = await tx.knowledgeVersion.updateMany({
        where: {
          id: input.job.versionId,
          organizationId: input.job.organizationId,
          sourceId: input.job.sourceId,
          state: "PROCESSING",
        },
        data: { state: "FAILED" },
      });
      if (versionUpdated.count !== 1) throw new ConflictError();
      await recordOrganizationAuditEvent(tx, {
        organizationId: input.job.organizationId,
        actorUserId: null,
        action: "KNOWLEDGE_DOCUMENT_PROCESSING_FAILED",
        metadata: {
          sourceId: input.job.sourceId,
          versionId: input.job.versionId,
          documentId: input.job.documentId,
          jobId: input.job.id,
          safeErrorCode,
          attempts: graph.job.attempts,
        },
      });
    }
    return true;
  });
  if (!mutated) return "stale";
  return retryable ? "retry" : "failed";
}

function isCurrentFailureRetryGraph(
  graph: Awaited<ReturnType<typeof lockKnowledgeWorkerGraphForUpdate>>,
  expected: {
    workerId: string;
    attempts: number;
    sourceId: string;
    versionId: string;
    documentId: string;
    now: Date;
  },
): graph is {
  source: NonNullable<(typeof graph)["source"]>;
  version: NonNullable<(typeof graph)["version"]>;
  document: NonNullable<(typeof graph)["document"]>;
  job: NonNullable<(typeof graph)["job"]>;
} {
  return (
    Boolean(graph.source) &&
    graph.source?.archivedAt === null &&
    graph.source?.inputKind === "DOCUMENT" &&
    graph.version?.state === "PROCESSING" &&
    graph.job !== null &&
    graph.job.state === "RUNNING" &&
    graph.job.leaseOwner === expected.workerId &&
    graph.job.attempts === expected.attempts &&
    graph.job.sourceId === expected.sourceId &&
    graph.job.versionId === expected.versionId &&
    graph.job.documentId === expected.documentId &&
    graph.job.leaseExpiresAt !== null &&
    graph.job.leaseExpiresAt >= expected.now &&
    graph.document !== null &&
    graph.document.leaseOwner === expected.workerId &&
    (graph.document.processingState === "SCANNING" ||
      graph.document.processingState === "EXTRACTING")
  );
}

export async function requestKnowledgeDocumentRetry(
  input: {
    actor: SafeUser;
    organizationId: string;
    sourceId: string;
    versionId: string;
  },
  hooks: KnowledgeMutationTestHooks = {},
): Promise<{ ok: true } | AuthFailure> {
  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.knowledge.manage",
    });
    await prisma.$transaction(async (tx) => {
      await acquireOrganizationKnowledgeLock(tx, input.organizationId, hooks);
      await requireActiveActorInTx(
        tx,
        {
          organizationId: input.organizationId,
          userId: input.actor.id,
          permission: "org.knowledge.manage",
        },
        hooks,
      );
      const source = await lockKnowledgeSourceForUpdate(
        tx,
        {
          organizationId: input.organizationId,
          sourceId: input.sourceId,
        },
        hooks,
      );
      const version = await lockKnowledgeVersionForUpdate(tx, input);
      const document = await lockKnowledgeDocumentForUpdate(tx, input);
      if (!source || !version || !document) throw new KnowledgeNotFoundError();
      if (
        source.archivedAt ||
        source.inputKind !== "DOCUMENT" ||
        document.scanState === "INFECTED" ||
        !["FAILED", "NEEDS_ATTENTION"].includes(document.processingState)
      ) {
        throw new KnowledgeLifecycleError(
          "not_confirmable",
          "This document cannot be retried in its current state.",
        );
      }
      const job = await tx.knowledgeDocumentJob.findFirst({
        where: {
          organizationId: input.organizationId,
          sourceId: input.sourceId,
          versionId: input.versionId,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      if (!job) throw new KnowledgeNotFoundError();
      await lockKnowledgeDocumentJobForUpdate(tx, {
        organizationId: input.organizationId,
        jobId: job.id,
      });
      await tx.knowledgeDocumentIssue.updateMany({
        where: {
          organizationId: input.organizationId,
          versionId: input.versionId,
          resolvedAt: null,
        },
        data: { resolvedAt: new Date() },
      });
      await tx.knowledgeVersion.updateMany({
        where: {
          id: input.versionId,
          organizationId: input.organizationId,
          state: { in: ["FAILED", "NEEDS_ATTENTION"] },
        },
        data: { state: "PROCESSING" },
      });
      await tx.knowledgeDocument.update({
        where: { id: document.id },
        data: {
          processingState: "QUEUED",
          scanState: "PENDING",
          scannedChecksum: null,
          scannerName: null,
          scannerVersion: null,
          scannedAt: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          retryAt: null,
          lastSafeErrorCode: null,
        },
      });
      await tx.knowledgeDocumentJob.update({
        where: { id: job.id },
        data: {
          state: "QUEUED",
          attempts: 0,
          availableAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
          lastSafeErrorCode: null,
          completedAt: null,
        },
      });
      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "KNOWLEDGE_DOCUMENT_RETRY_REQUESTED",
        metadata: {
          sourceId: input.sourceId,
          versionId: input.versionId,
          documentId: document.id,
          jobId: job.id,
        },
      });
    });
    return { ok: true };
  } catch (error) {
    return (
      mapKnowledgeError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not retry document processing.",
      }
    );
  }
}

export async function acknowledgeDocumentDuplicateWarning(input: {
  actor: SafeUser;
  organizationId: string;
  sourceId: string;
  versionId: string;
}): Promise<{ ok: true } | AuthFailure> {
  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.knowledge.manage",
    });
    await prisma.$transaction(async (tx) => {
      await acquireOrganizationKnowledgeLock(tx, input.organizationId);
      await requireActiveActorInTx(tx, {
        organizationId: input.organizationId,
        userId: input.actor.id,
        permission: "org.knowledge.manage",
      });
      const source = await lockKnowledgeSourceForUpdate(tx, input);
      const version = await lockKnowledgeVersionForUpdate(tx, input);
      const document = await lockKnowledgeDocumentForUpdate(tx, input);
      if (!source || !version || !document) throw new KnowledgeNotFoundError();
      const duplicate = await tx.knowledgeDocument.findUniqueOrThrow({
        where: { id: document.id },
        select: {
          exactDuplicateVersionId: true,
          nearDuplicateVersionId: true,
        },
      });
      if (
        source.inputKind !== "DOCUMENT" ||
        (!duplicate.exactDuplicateVersionId &&
          !duplicate.nearDuplicateVersionId)
      ) {
        throw new KnowledgeLifecycleError(
          "not_confirmable",
          "No duplicate warning is available.",
        );
      }
      await tx.knowledgeDocument.update({
        where: { id: document.id },
        data: { duplicateAcknowledgedAt: new Date() },
      });
      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "KNOWLEDGE_DOCUMENT_DUPLICATE_ACKNOWLEDGED",
        metadata: {
          sourceId: input.sourceId,
          versionId: input.versionId,
          documentId: document.id,
          exactDuplicateVersionId: duplicate.exactDuplicateVersionId,
          nearDuplicateVersionId: duplicate.nearDuplicateVersionId,
        },
      });
    });
    return { ok: true };
  } catch (error) {
    return (
      mapKnowledgeError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not acknowledge the duplicate warning.",
      }
    );
  }
}

export async function restoreKnowledgeDocumentVersion(
  input: {
    actor: SafeUser;
    organizationId: string;
    sourceId: string;
    versionId: string;
    expectedSourceVersion: number;
    storage: PrivateDocumentStorage;
  },
  hooks: KnowledgeMutationTestHooks = {},
): Promise<{ ok: true; versionId: string } | AuthFailure> {
  let initiated:
    | {
        version: KnowledgeVersion;
        document: KnowledgeDocument;
      }
    | undefined;
  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.knowledge.archive",
    });
    const historical = await prisma.knowledgeVersion.findFirst({
      where: {
        id: input.versionId,
        organizationId: input.organizationId,
        sourceId: input.sourceId,
        confirmedAt: { not: null },
        state: { in: ["SUPERSEDED", "ARCHIVED"] },
        source: { inputKind: "DOCUMENT" },
      },
      include: {
        document: true,
        sections: {
          orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
          include: {
            passages: {
              orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
            },
          },
        },
      },
    });
    if (!historical?.document) throw new KnowledgeNotFoundError();
    const sourceBytes = await input.storage.download(
      documentStorageRef(historical.document),
    );
    const validated = await validateDocument({
      bytes: sourceBytes,
      filename: historical.document.displayFilename,
      declaredMimeType: historical.document.declaredMimeType,
    });
    if (validated.sha256 !== historical.document.binaryChecksum) {
      throw new Error("Historical object checksum mismatch.");
    }
    const copiedKey = input.storage.createObjectKey(
      input.organizationId,
      validated.kind,
    );
    initiated = await prisma.$transaction(async (tx) => {
      await acquireOrganizationKnowledgeLock(tx, input.organizationId, hooks);
      await requireActiveActorInTx(
        tx,
        {
          organizationId: input.organizationId,
          userId: input.actor.id,
          permission: "org.knowledge.archive",
        },
        hooks,
      );
      const source = await lockKnowledgeSourceForUpdate(
        tx,
        {
          organizationId: input.organizationId,
          sourceId: input.sourceId,
        },
        hooks,
      );
      if (
        !source ||
        source.inputKind !== "DOCUMENT" ||
        source.version !== input.expectedSourceVersion
      ) {
        throw new ConflictError();
      }
      const lockedVersion = await lockKnowledgeVersionForUpdate(tx, input);
      const lockedDocument = await lockKnowledgeDocumentForUpdate(tx, input);
      if (
        !lockedVersion ||
        !lockedDocument ||
        !historical.confirmedAt ||
        !["SUPERSEDED", "ARCHIVED"].includes(lockedVersion.state)
      ) {
        throw new KnowledgeLifecycleError(
          "not_restorable",
          "This document version can no longer be restored.",
        );
      }
      const currentDraft = await tx.knowledgeVersion.findFirst({
        where: {
          organizationId: input.organizationId,
          sourceId: input.sourceId,
          OR: [
            { state: { in: ["DRAFT", "PROCESSING", "NEEDS_ATTENTION"] } },
            {
              state: "FAILED",
              document: {
                is: { processingState: { not: "ABANDONED" } },
              },
            },
          ],
        },
        select: { id: true },
      });
      if (currentDraft) {
        throw new KnowledgeLifecycleError(
          "draft_exists",
          "Finish or archive the current draft before restoring history.",
        );
      }
      const version = await tx.knowledgeVersion.create({
        data: {
          organizationId: input.organizationId,
          sourceId: input.sourceId,
          state: "PROCESSING",
          title: historical.title,
          contentChecksum: historical.contentChecksum,
          effectiveFrom: historical.effectiveFrom,
          effectiveUntil: historical.effectiveUntil,
          createdByUserId: input.actor.id,
          restoredFromVersionId: historical.id,
        },
      });
      const document = await tx.knowledgeDocument.create({
        data: {
          organizationId: input.organizationId,
          sourceId: input.sourceId,
          versionId: version.id,
          originalFilename: historical.document!.originalFilename,
          displayFilename: historical.document!.displayFilename,
          storageBucket: historical.document!.storageBucket,
          storageObjectKey: copiedKey,
          declaredMimeType: historical.document!.declaredMimeType,
          uploadedByUserId: input.actor.id,
        },
      });
      const bumped = await tx.knowledgeSource.updateMany({
        where: {
          id: input.sourceId,
          organizationId: input.organizationId,
          version: input.expectedSourceVersion,
        },
        data: { version: { increment: 1 } },
      });
      if (bumped.count !== 1) throw new ConflictError();
      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "KNOWLEDGE_DOCUMENT_UPLOAD_INITIATED",
        metadata: {
          sourceId: input.sourceId,
          versionId: version.id,
          documentId: document.id,
          restore: true,
        },
      });
      return { version, document };
    });

    const copiedRef = {
      organizationId: input.organizationId,
      key: copiedKey,
      bucket: initiated.document.storageBucket,
    };
    await input.storage.upload(
      copiedRef,
      sourceBytes,
      historical.document.declaredMimeType,
    );
    const copiedBytes = await input.storage.download(copiedRef);
    if (sha256(copiedBytes) !== validated.sha256) {
      throw new Error("Restored object checksum mismatch.");
    }
    await hooks.testBeforeDocumentUploadFinalization?.();

    const created = await prisma.$transaction(async (tx) => {
      await acquireOrganizationKnowledgeLock(tx, input.organizationId, hooks);
      await requireActiveActorInTx(
        tx,
        {
          organizationId: input.organizationId,
          userId: input.actor.id,
          permission: "org.knowledge.archive",
        },
        hooks,
      );
      const source = await lockKnowledgeSourceForUpdate(
        tx,
        {
          organizationId: input.organizationId,
          sourceId: input.sourceId,
        },
        hooks,
      );
      if (
        !source ||
        source.inputKind !== "DOCUMENT" ||
        source.version !== input.expectedSourceVersion + 1
      ) {
        throw new ConflictError();
      }
      const lockedVersion = await lockKnowledgeVersionForUpdate(tx, {
        organizationId: input.organizationId,
        sourceId: input.sourceId,
        versionId: initiated!.version.id,
      });
      const lockedDocument = await lockKnowledgeDocumentForUpdate(tx, {
        organizationId: input.organizationId,
        sourceId: input.sourceId,
        versionId: initiated!.version.id,
        documentId: initiated!.document.id,
      });
      if (
        !lockedVersion ||
        !lockedDocument ||
        lockedVersion.state !== "PROCESSING" ||
        lockedDocument.processingState !== "UPLOADING"
      ) {
        throw new KnowledgeLifecycleError(
          "not_restorable",
          "This document version can no longer be restored.",
        );
      }
      for (const section of historical.sections) {
        const createdSection = await tx.knowledgeSection.create({
          data: {
            organizationId: input.organizationId,
            sourceId: input.sourceId,
            versionId: initiated!.version.id,
            citationKey: section.citationKey,
            title: section.title,
            displayOrder: section.displayOrder,
          },
        });
        await tx.knowledgePassage.createMany({
          data: section.passages.map((passage) => ({
            organizationId: input.organizationId,
            sourceId: input.sourceId,
            versionId: initiated!.version.id,
            sectionId: createdSection.id,
            citationKey: passage.citationKey,
            body: passage.body,
            displayOrder: passage.displayOrder,
          })),
        });
      }
      await tx.knowledgeVersion.update({
        where: { id: initiated!.version.id },
        data: { state: "DRAFT" },
      });
      const document = await tx.knowledgeDocument.update({
        where: { id: initiated!.document.id },
        data: {
          declaredMimeType: historical.document!.declaredMimeType,
          detectedMimeType: historical.document!.detectedMimeType,
          byteSize: historical.document!.byteSize,
          binaryChecksum: historical.document!.binaryChecksum,
          normalizedContentChecksum:
            historical.document!.normalizedContentChecksum,
          uploadedByUserId: input.actor.id,
          finalizedAt: new Date(),
          scanState: "CLEAN",
          scannedChecksum: historical.document!.binaryChecksum,
          scannerName: historical.document!.scannerName ?? "retained-evidence",
          scannerVersion:
            historical.document!.scannerVersion ?? "retained-evidence",
          scannedAt: new Date(),
          processingState: "COMPLETE",
          extractorName:
            historical.document!.extractorName ?? DOCUMENT_EXTRACTOR_NAME,
          extractorVersion:
            historical.document!.extractorVersion ?? DOCUMENT_EXTRACTOR_VERSION,
        },
      });
      const changed = await tx.knowledgeSource.updateMany({
        where: {
          id: input.sourceId,
          organizationId: input.organizationId,
          version: input.expectedSourceVersion + 1,
        },
        data: {
          archivedAt: null,
          archivedByUserId: null,
        },
      });
      if (changed.count !== 1) throw new ConflictError();
      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "KNOWLEDGE_VERSION_RESTORED",
        metadata: {
          sourceId: input.sourceId,
          versionId: initiated!.version.id,
          restoredFromVersionId: historical.id,
          documentId: document.id,
          checksum: historical.contentChecksum,
        },
      });
      return initiated!.version;
    });
    return { ok: true, versionId: created.id };
  } catch (error) {
    if (initiated) {
      await compensateFailedDocumentUpload({
        storage: input.storage,
        organizationId: input.organizationId,
        sourceId: input.sourceId,
        versionId: initiated.version.id,
        documentId: initiated.document.id,
        actorUserId: input.actor.id,
      }).catch(() => {
        // The durable stale-upload sweep retries compensation.
      });
    }
    return (
      mapKnowledgeError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not restore this private document.",
      }
    );
  }
}

export async function getKnowledgeDocument(input: {
  actor: SafeUser;
  organizationId: string;
  sourceId: string;
  versionId: string;
}): Promise<{ ok: true; document: DocumentGraph } | AuthFailure> {
  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.knowledge.manage",
    });
    const document = await prisma.knowledgeDocument.findFirst({
      where: {
        organizationId: input.organizationId,
        sourceId: input.sourceId,
        versionId: input.versionId,
      },
      include: {
        issues: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        },
        jobs: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        },
      },
    });
    if (!document) throw new KnowledgeNotFoundError();
    return { ok: true, document };
  } catch (error) {
    return (
      mapKnowledgeError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not load document status.",
      }
    );
  }
}

export async function createAuthorizedDocumentDownload(input: {
  actor: SafeUser;
  organizationId: string;
  sourceId: string;
  versionId: string;
  storage: PrivateDocumentStorage;
}): Promise<
  | {
      ok: true;
      url: string;
      expiresAt: Date;
      objectKey: string;
      objectBucket: string;
      filename: string;
      mimeType: string;
    }
  | AuthFailure
> {
  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.knowledge.manage",
    });
    const document = await prisma.knowledgeDocument.findFirst({
      where: {
        organizationId: input.organizationId,
        sourceId: input.sourceId,
        versionId: input.versionId,
      },
    });
    if (!document) throw new KnowledgeNotFoundError();
    if (
      document.scanState !== "CLEAN" ||
      !document.finalizedAt ||
      !document.binaryChecksum ||
      document.scannedChecksum !== document.binaryChecksum
    ) {
      throw new KnowledgeLifecycleError(
        "not_confirmable",
        "This document is not available for private download.",
      );
    }
    const signed = await input.storage.createSignedDownload(
      documentStorageRef(document),
      60,
    );
    return {
      ok: true,
      url: signed.url,
      expiresAt: signed.expiresAt,
      objectKey: document.storageObjectKey,
      objectBucket: document.storageBucket,
      filename: document.displayFilename,
      mimeType: document.detectedMimeType ?? document.declaredMimeType,
    };
  } catch (error) {
    return (
      mapKnowledgeError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not create a private download.",
      }
    );
  }
}

export type FailedUploadCompensationResult =
  "cleaned" | "cleanup_pending" | "already_clean" | "protected";

/**
 * Compensate an upload that initialized DB state but did not finalize.
 *
 * The first transaction atomically makes the graph non-runnable and restores
 * replacement OCC. Only then may storage be deleted. A second transaction
 * removes the abandoned graph after object deletion succeeds. Repeated calls
 * are harmless and every lookup is scoped to the owning organization.
 */
export async function compensateFailedDocumentUpload(input: {
  storage: PrivateDocumentStorage;
  organizationId: string;
  sourceId: string;
  versionId: string;
  documentId: string;
  actorUserId: string | null;
}): Promise<FailedUploadCompensationResult> {
  const prepared = await prisma.$transaction(async (tx) => {
    await acquireOrganizationKnowledgeLock(tx, input.organizationId);
    const source = await lockKnowledgeSourceForUpdate(tx, {
      organizationId: input.organizationId,
      sourceId: input.sourceId,
    });
    if (!source) return { state: "already_clean" as const };

    const version = await lockKnowledgeVersionForUpdate(tx, {
      organizationId: input.organizationId,
      sourceId: input.sourceId,
      versionId: input.versionId,
    });
    const document = await lockKnowledgeDocumentForUpdate(tx, {
      organizationId: input.organizationId,
      sourceId: input.sourceId,
      versionId: input.versionId,
      documentId: input.documentId,
    });
    if (!version || !document) {
      return { state: "already_clean" as const };
    }

    const alreadyAbandoned =
      version.state === "FAILED" && document.processingState === "ABANDONED";
    if (
      !alreadyAbandoned &&
      (version.state !== "PROCESSING" ||
        document.processingState !== "UPLOADING")
    ) {
      return { state: "protected" as const };
    }

    if (!alreadyAbandoned) {
      const isReplacement =
        (await tx.knowledgeVersion.count({
          where: {
            organizationId: input.organizationId,
            sourceId: input.sourceId,
            id: { not: input.versionId },
          },
        })) > 0;
      await tx.knowledgeDocument.update({
        where: { id: input.documentId },
        data: {
          processingState: "ABANDONED",
          lastSafeErrorCode: "upload_finalization_failed",
        },
      });
      await tx.knowledgeVersion.update({
        where: { id: input.versionId },
        data: { state: "FAILED" },
      });
      if (isReplacement) {
        await tx.knowledgeSource.update({
          where: { id: input.sourceId },
          data: { version: { decrement: 1 } },
        });
      }
      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: "KNOWLEDGE_DOCUMENT_UPLOAD_FAILED",
        metadata: {
          sourceId: input.sourceId,
          versionId: input.versionId,
          documentId: input.documentId,
          replacement: isReplacement,
          cleanupPending: true,
        },
      });
    }

    return {
      state: "cleanup_pending" as const,
      objectKey: document.storageObjectKey,
      objectBucket: document.storageBucket,
    };
  });

  if (prepared.state !== "cleanup_pending") {
    return prepared.state;
  }

  try {
    await input.storage.delete({
      organizationId: input.organizationId,
      key: prepared.objectKey,
      bucket: prepared.objectBucket,
    });
  } catch {
    return "cleanup_pending";
  }

  return prisma.$transaction(async (tx) => {
    await acquireOrganizationKnowledgeLock(tx, input.organizationId);
    const source = await lockKnowledgeSourceForUpdate(tx, {
      organizationId: input.organizationId,
      sourceId: input.sourceId,
    });
    if (!source) return "already_clean";

    const version = await lockKnowledgeVersionForUpdate(tx, {
      organizationId: input.organizationId,
      sourceId: input.sourceId,
      versionId: input.versionId,
    });
    const document = await lockKnowledgeDocumentForUpdate(tx, {
      organizationId: input.organizationId,
      sourceId: input.sourceId,
      versionId: input.versionId,
      documentId: input.documentId,
    });
    if (!version || !document) return "already_clean";
    if (
      version.state !== "FAILED" ||
      document.processingState !== "ABANDONED"
    ) {
      return "protected";
    }

    const isReplacement =
      (await tx.knowledgeVersion.count({
        where: {
          organizationId: input.organizationId,
          sourceId: input.sourceId,
          id: { not: input.versionId },
        },
      })) > 0;
    await recordOrganizationAuditEvent(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "KNOWLEDGE_DOCUMENT_UPLOAD_CLEANED",
      metadata: {
        sourceId: input.sourceId,
        versionId: input.versionId,
        documentId: input.documentId,
        replacement: isReplacement,
      },
    });
    await tx.knowledgeVersion.delete({ where: { id: input.versionId } });
    if (!isReplacement) {
      await tx.knowledgeSource.delete({ where: { id: input.sourceId } });
    }
    return "cleaned";
  });
}

/**
 * Durable retry for process interruption or a temporarily unavailable object
 * store during synchronous compensation.
 */
export async function reconcileAbandonedDocumentUploads(input: {
  storage: PrivateDocumentStorage;
  olderThan: Date;
}): Promise<{ examined: number; cleaned: number; pending: number }> {
  const rows = await prisma.knowledgeDocument.findMany({
    where: {
      processingState: { in: ["UPLOADING", "ABANDONED"] },
      createdAt: { lt: input.olderThan },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 100,
  });
  let cleaned = 0;
  let pending = 0;
  for (const row of rows) {
    try {
      const result = await compensateFailedDocumentUpload({
        storage: input.storage,
        organizationId: row.organizationId,
        sourceId: row.sourceId,
        versionId: row.versionId,
        documentId: row.id,
        actorUserId: row.uploadedByUserId,
      });
      if (result === "cleaned" || result === "already_clean") {
        cleaned += 1;
      } else if (result === "cleanup_pending") {
        pending += 1;
      }
    } catch {
      pending += 1;
    }
  }
  return { examined: rows.length, cleaned, pending };
}

async function findDocumentDuplicates(input: {
  organizationId: string;
  documentId: string;
  binaryChecksum: string;
  contentChecksum: string;
  sections: ExtractedDocument["sections"];
}): Promise<{
  exact: { sourceId: string; versionId: string } | null;
  near: { sourceId: string; versionId: string } | null;
}> {
  const exact = await prisma.knowledgeDocument.findFirst({
    where: {
      organizationId: input.organizationId,
      id: { not: input.documentId },
      OR: [
        { binaryChecksum: input.binaryChecksum },
        { normalizedContentChecksum: input.contentChecksum },
      ],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { sourceId: true, versionId: true },
  });
  const candidates = await prisma.knowledgeDocument.findMany({
    where: {
      organizationId: input.organizationId,
      id: { not: input.documentId },
      processingState: "COMPLETE",
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 100,
    select: {
      sourceId: true,
      versionId: true,
      version: {
        select: {
          sections: {
            orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
            select: {
              title: true,
              citationKey: true,
              passages: {
                orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
                select: { body: true, citationKey: true },
              },
            },
          },
        },
      },
    },
  });
  const matches = findNearDuplicates(
    input.sections,
    candidates.map((candidate) => ({
      id: `${candidate.sourceId}:${candidate.versionId}`,
      sections: candidate.version.sections,
    })),
    { threshold: 0.85, maxResults: 1 },
  );
  const [nearSourceId, nearVersionId] = matches[0]?.id.split(":") ?? [];
  return {
    exact: exact
      ? { sourceId: exact.sourceId, versionId: exact.versionId }
      : null,
    near:
      nearSourceId && nearVersionId
        ? { sourceId: nearSourceId, versionId: nearVersionId }
        : null,
  };
}

function documentStorageRef(document: {
  organizationId: string;
  storageObjectKey: string;
  storageBucket: string;
}): PrivateDocumentRef {
  return {
    organizationId: document.organizationId,
    key: document.storageObjectKey,
    bucket: document.storageBucket,
  };
}

function documentJobIdempotencyKey(
  versionId: string,
  binaryChecksum: string,
): string {
  return `knowledge-document:${versionId}:${binaryChecksum}:${DOCUMENT_EXTRACTOR_VERSION}`;
}

function safeProcessingErrorCode(
  error: unknown,
  classification: ReturnType<typeof classifyDocumentProcessingError>,
): string {
  if (error instanceof MalwareDetectedError) return "malware_detected";
  if (error instanceof Error) {
    if (error.message === "storage_checksum_mismatch") {
      return "storage_checksum_mismatch";
    }
    if (error.message === "extraction_checksum_mismatch") {
      return "extraction_checksum_mismatch";
    }
  }
  return `processing_${classification.reason}`;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
