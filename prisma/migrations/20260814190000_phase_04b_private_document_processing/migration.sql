-- Phase 4B: private document metadata, scanning, extraction, and durable jobs.
-- File bytes remain in private object storage.

ALTER TYPE "KnowledgeInputKind" ADD VALUE 'DOCUMENT';

ALTER TYPE "OrganizationAuditAction" ADD VALUE 'KNOWLEDGE_DOCUMENT_UPLOAD_INITIATED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'KNOWLEDGE_DOCUMENT_UPLOAD_FINALIZED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'KNOWLEDGE_DOCUMENT_SCAN_COMPLETED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'KNOWLEDGE_DOCUMENT_PROCESSING_COMPLETED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'KNOWLEDGE_DOCUMENT_PROCESSING_FAILED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'KNOWLEDGE_DOCUMENT_RETRY_REQUESTED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'KNOWLEDGE_DOCUMENT_CORRECTIONS_SAVED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'KNOWLEDGE_DOCUMENT_DUPLICATE_ACKNOWLEDGED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'KNOWLEDGE_DOCUMENT_CONFIRMED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'KNOWLEDGE_DOCUMENT_REPLACED';

CREATE TYPE "KnowledgeDocumentScanState" AS ENUM (
  'PENDING', 'CLEAN', 'INFECTED', 'FAILED'
);
CREATE TYPE "KnowledgeDocumentProcessingState" AS ENUM (
  'UPLOADING', 'QUEUED', 'SCANNING', 'EXTRACTING',
  'NEEDS_ATTENTION', 'COMPLETE', 'FAILED', 'ABANDONED'
);
CREATE TYPE "KnowledgeDocumentJobState" AS ENUM (
  'QUEUED', 'RUNNING', 'RETRY', 'SUCCEEDED', 'FAILED'
);
CREATE TYPE "KnowledgeDocumentIssueSeverity" AS ENUM (
  'WARNING', 'BLOCKING'
);

CREATE TABLE "KnowledgeDocument" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "originalFilename" TEXT NOT NULL,
  "displayFilename" TEXT NOT NULL,
  "storageBucket" TEXT NOT NULL,
  "storageObjectKey" TEXT NOT NULL,
  "declaredMimeType" TEXT NOT NULL,
  "detectedMimeType" TEXT,
  "byteSize" BIGINT,
  "binaryChecksum" TEXT,
  "normalizedContentChecksum" TEXT,
  "objectVersion" TEXT,
  "objectEtag" TEXT,
  "uploadedByUserId" TEXT NOT NULL,
  "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finalizedAt" TIMESTAMP(3),
  "scanState" "KnowledgeDocumentScanState" NOT NULL DEFAULT 'PENDING',
  "scannedChecksum" TEXT,
  "scannerName" TEXT,
  "scannerVersion" TEXT,
  "scannedAt" TIMESTAMP(3),
  "processingState" "KnowledgeDocumentProcessingState" NOT NULL DEFAULT 'UPLOADING',
  "processingAttempts" INTEGER NOT NULL DEFAULT 0,
  "leaseOwner" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "retryAt" TIMESTAMP(3),
  "lastSafeErrorCode" TEXT,
  "extractorName" TEXT,
  "extractorVersion" TEXT,
  "exactDuplicateSourceId" TEXT,
  "exactDuplicateVersionId" TEXT,
  "nearDuplicateSourceId" TEXT,
  "nearDuplicateVersionId" TEXT,
  "duplicateAcknowledgedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "KnowledgeDocument_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeDocument_size_attempts_check"
    CHECK (("byteSize" IS NULL OR "byteSize" >= 0) AND "processingAttempts" >= 0),
  CONSTRAINT "KnowledgeDocument_checksum_format_check"
    CHECK (
      ("binaryChecksum" IS NULL OR "binaryChecksum" ~ '^[0-9a-f]{64}$')
      AND ("normalizedContentChecksum" IS NULL OR "normalizedContentChecksum" ~ '^[0-9a-f]{64}$')
      AND ("scannedChecksum" IS NULL OR "scannedChecksum" ~ '^[0-9a-f]{64}$')
    ),
  CONSTRAINT "KnowledgeDocument_scan_state_check"
    CHECK (
      ("scanState" = 'PENDING' AND "scannedAt" IS NULL AND "scannedChecksum" IS NULL)
      OR
      ("scanState" IN ('CLEAN', 'INFECTED', 'FAILED')
        AND "scannedAt" IS NOT NULL
        AND "scannerName" IS NOT NULL
        AND "scannerVersion" IS NOT NULL)
    ),
  CONSTRAINT "KnowledgeDocument_clean_checksum_check"
    CHECK ("scanState" <> 'CLEAN' OR ("scannedChecksum" IS NOT NULL AND "scannedChecksum" = "binaryChecksum")),
  CONSTRAINT "KnowledgeDocument_processing_state_check"
    CHECK (
      ("processingState" = 'UPLOADING' AND "finalizedAt" IS NULL AND "leaseOwner" IS NULL AND "leaseExpiresAt" IS NULL)
      OR
      ("processingState" IN ('QUEUED', 'ABANDONED') AND "leaseOwner" IS NULL AND "leaseExpiresAt" IS NULL)
      OR
      ("processingState" IN ('SCANNING', 'EXTRACTING') AND "leaseOwner" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL)
      OR
      ("processingState" IN ('NEEDS_ATTENTION', 'COMPLETE', 'FAILED') AND "leaseOwner" IS NULL AND "leaseExpiresAt" IS NULL)
    ),
  CONSTRAINT "KnowledgeDocument_complete_state_check"
    CHECK (
      "processingState" <> 'COMPLETE'
      OR (
        "scanState" = 'CLEAN'
        AND "binaryChecksum" = "scannedChecksum"
        AND "normalizedContentChecksum" IS NOT NULL
        AND "extractorName" IS NOT NULL
        AND "extractorVersion" IS NOT NULL
      )
    )
);

CREATE UNIQUE INDEX "KnowledgeDocument_versionId_key" ON "KnowledgeDocument"("versionId");
CREATE UNIQUE INDEX "KnowledgeDocument_storageObjectKey_key" ON "KnowledgeDocument"("storageObjectKey");
CREATE UNIQUE INDEX "KnowledgeDocument_id_organizationId_sourceId_versionId_key"
  ON "KnowledgeDocument"("id", "organizationId", "sourceId", "versionId");
CREATE UNIQUE INDEX "KnowledgeDocument_versionId_organizationId_sourceId_key"
  ON "KnowledgeDocument"("versionId", "organizationId", "sourceId");
CREATE INDEX "KnowledgeDocument_organizationId_binaryChecksum_idx"
  ON "KnowledgeDocument"("organizationId", "binaryChecksum");
CREATE INDEX "KnowledgeDocument_organizationId_normalizedContentChecksum_idx"
  ON "KnowledgeDocument"("organizationId", "normalizedContentChecksum");
CREATE INDEX "KnowledgeDocument_organizationId_processingState_retryAt_idx"
  ON "KnowledgeDocument"("organizationId", "processingState", "retryAt");
CREATE INDEX "KnowledgeDocument_processingState_leaseExpiresAt_idx"
  ON "KnowledgeDocument"("processingState", "leaseExpiresAt");
CREATE INDEX "KnowledgeDocument_organizationId_sourceId_idx"
  ON "KnowledgeDocument"("organizationId", "sourceId");

CREATE TABLE "KnowledgeDocumentJob" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "state" "KnowledgeDocumentJobState" NOT NULL DEFAULT 'QUEUED',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseOwner" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "lastSafeErrorCode" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "KnowledgeDocumentJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeDocumentJob_attempts_check"
    CHECK ("attempts" >= 0 AND "maxAttempts" > 0 AND "attempts" <= "maxAttempts"),
  CONSTRAINT "KnowledgeDocumentJob_state_check"
    CHECK (
      ("state" = 'RUNNING' AND "leaseOwner" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL AND "completedAt" IS NULL)
      OR
      ("state" IN ('QUEUED', 'RETRY') AND "leaseOwner" IS NULL AND "leaseExpiresAt" IS NULL AND "completedAt" IS NULL)
      OR
      ("state" IN ('SUCCEEDED', 'FAILED') AND "leaseOwner" IS NULL AND "leaseExpiresAt" IS NULL AND "completedAt" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "KnowledgeDocumentJob_idempotencyKey_key" ON "KnowledgeDocumentJob"("idempotencyKey");
CREATE UNIQUE INDEX "KnowledgeDocumentJob_id_organizationId_key" ON "KnowledgeDocumentJob"("id", "organizationId");
CREATE INDEX "KnowledgeDocumentJob_state_availableAt_idx" ON "KnowledgeDocumentJob"("state", "availableAt");
CREATE INDEX "KnowledgeDocumentJob_state_leaseExpiresAt_idx" ON "KnowledgeDocumentJob"("state", "leaseExpiresAt");
CREATE INDEX "KnowledgeDocumentJob_organizationId_state_availableAt_idx"
  ON "KnowledgeDocumentJob"("organizationId", "state", "availableAt");

CREATE TABLE "KnowledgeDocumentIssue" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "severity" "KnowledgeDocumentIssueSeverity" NOT NULL,
  "sectionLocator" TEXT,
  "safeMessage" TEXT NOT NULL,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "KnowledgeDocumentIssue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "KnowledgeDocumentIssue_documentId_code_sectionLocator_key"
  ON "KnowledgeDocumentIssue"("documentId", "code", "sectionLocator") NULLS NOT DISTINCT;
CREATE INDEX "KnowledgeDocumentIssue_organizationId_versionId_severity_resolvedAt_idx"
  ON "KnowledgeDocumentIssue"("organizationId", "versionId", "severity", "resolvedAt");

ALTER TABLE "KnowledgeDocument"
  ADD CONSTRAINT "KnowledgeDocument_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "KnowledgeDocument_version_ancestry_fkey"
  FOREIGN KEY ("versionId", "organizationId", "sourceId")
  REFERENCES "KnowledgeVersion"("id", "organizationId", "sourceId")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "KnowledgeDocument_uploadedByUserId_fkey"
  FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "KnowledgeDocument_exact_duplicate_ancestry_fkey"
  FOREIGN KEY ("exactDuplicateVersionId", "organizationId", "exactDuplicateSourceId")
  REFERENCES "KnowledgeVersion"("id", "organizationId", "sourceId")
  ON DELETE NO ACTION ON UPDATE CASCADE,
  ADD CONSTRAINT "KnowledgeDocument_near_duplicate_ancestry_fkey"
  FOREIGN KEY ("nearDuplicateVersionId", "organizationId", "nearDuplicateSourceId")
  REFERENCES "KnowledgeVersion"("id", "organizationId", "sourceId")
  ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "KnowledgeDocumentJob"
  ADD CONSTRAINT "KnowledgeDocumentJob_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "KnowledgeDocumentJob_version_ancestry_fkey"
  FOREIGN KEY ("versionId", "organizationId", "sourceId")
  REFERENCES "KnowledgeVersion"("id", "organizationId", "sourceId")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "KnowledgeDocumentJob_document_ancestry_fkey"
  FOREIGN KEY ("documentId", "organizationId", "sourceId", "versionId")
  REFERENCES "KnowledgeDocument"("id", "organizationId", "sourceId", "versionId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KnowledgeDocumentIssue"
  ADD CONSTRAINT "KnowledgeDocumentIssue_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "KnowledgeDocumentIssue_version_ancestry_fkey"
  FOREIGN KEY ("versionId", "organizationId", "sourceId")
  REFERENCES "KnowledgeVersion"("id", "organizationId", "sourceId")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "KnowledgeDocumentIssue_document_ancestry_fkey"
  FOREIGN KEY ("documentId", "organizationId", "sourceId", "versionId")
  REFERENCES "KnowledgeDocument"("id", "organizationId", "sourceId", "versionId")
  ON DELETE CASCADE ON UPDATE CASCADE;
