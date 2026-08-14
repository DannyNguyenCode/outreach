-- Phase 4A: manual business knowledge sources, immutable versions,
-- sections/passages, confirmation metadata, and retrieval indexes.
-- Forward-only. Phase 1–3B tables are intentionally untouched.

-- AlterEnum: add Phase 4A audit actions (PostgreSQL-compatible additive values).
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'KNOWLEDGE_SOURCE_CREATED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'KNOWLEDGE_DRAFT_UPDATED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'KNOWLEDGE_REPLACEMENT_DRAFT_CREATED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'KNOWLEDGE_VERSION_CONFIRMED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'KNOWLEDGE_SOURCE_ARCHIVED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'KNOWLEDGE_VERSION_RESTORED';

CREATE TYPE "KnowledgeInputKind" AS ENUM ('MANUAL');

CREATE TYPE "KnowledgeSourceCategory" AS ENUM (
  'CUSTOMER_CONFIRMED_BUSINESS_FACTS',
  'PLATFORM_MAINTAINED_GUIDANCE',
  'PROSPECT_EVIDENCE',
  'CRM_HISTORY',
  'CALLER_STATEMENTS',
  'REPRESENTATIVE_NOTES',
  'LIVE_OPERATIONAL_DATA',
  'AI_INFERENCES'
);

CREATE TYPE "KnowledgeLifecycleState" AS ENUM (
  'DRAFT',
  'PROCESSING',
  'NEEDS_ATTENTION',
  'ACTIVE',
  'SUPERSEDED',
  'ARCHIVED',
  'FAILED'
);

CREATE TABLE "KnowledgeSource" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "inputKind" "KnowledgeInputKind" NOT NULL DEFAULT 'MANUAL',
  "category" "KnowledgeSourceCategory" NOT NULL,
  "title" TEXT NOT NULL,
  "archivedAt" TIMESTAMP(3),
  "archivedByUserId" TEXT,
  "createdByUserId" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "KnowledgeSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KnowledgeVersion" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "state" "KnowledgeLifecycleState" NOT NULL,
  "title" TEXT NOT NULL,
  "contentChecksum" TEXT NOT NULL,
  "effectiveFrom" TIMESTAMP(3),
  "effectiveUntil" TIMESTAMP(3),
  "draftRevision" INTEGER NOT NULL DEFAULT 0,
  "createdByUserId" TEXT,
  "confirmerUserId" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "confirmationLanguageVersion" TEXT,
  "supersedesVersionId" TEXT,
  "restoredFromVersionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "KnowledgeVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KnowledgeSection" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "citationKey" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "displayOrder" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "KnowledgeSection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KnowledgePassage" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "sectionId" TEXT NOT NULL,
  "citationKey" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "displayOrder" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "KnowledgePassage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "KnowledgeSource_id_organizationId_key" ON "KnowledgeSource"("id", "organizationId");
CREATE INDEX "KnowledgeSource_organizationId_archivedAt_idx" ON "KnowledgeSource"("organizationId", "archivedAt");
CREATE INDEX "KnowledgeSource_organizationId_category_idx" ON "KnowledgeSource"("organizationId", "category");
CREATE INDEX "KnowledgeSource_organizationId_title_idx" ON "KnowledgeSource"("organizationId", "title");

CREATE UNIQUE INDEX "KnowledgeVersion_id_organizationId_key" ON "KnowledgeVersion"("id", "organizationId");
CREATE INDEX "KnowledgeVersion_organizationId_state_idx" ON "KnowledgeVersion"("organizationId", "state");
CREATE INDEX "KnowledgeVersion_sourceId_state_idx" ON "KnowledgeVersion"("sourceId", "state");
CREATE INDEX "KnowledgeVersion_organizationId_state_effectiveFrom_idx" ON "KnowledgeVersion"("organizationId", "state", "effectiveFrom");
CREATE INDEX "KnowledgeVersion_contentChecksum_idx" ON "KnowledgeVersion"("contentChecksum");

-- At most one active version and one draft version per logical source.
CREATE UNIQUE INDEX "KnowledgeVersion_sourceId_active_key"
ON "KnowledgeVersion" ("sourceId")
WHERE "state" = 'ACTIVE';

CREATE UNIQUE INDEX "KnowledgeVersion_sourceId_draft_key"
ON "KnowledgeVersion" ("sourceId")
WHERE "state" = 'DRAFT';

CREATE UNIQUE INDEX "KnowledgeSection_versionId_citationKey_key" ON "KnowledgeSection"("versionId", "citationKey");
CREATE UNIQUE INDEX "KnowledgeSection_versionId_displayOrder_key" ON "KnowledgeSection"("versionId", "displayOrder");
CREATE INDEX "KnowledgeSection_organizationId_versionId_displayOrder_idx" ON "KnowledgeSection"("organizationId", "versionId", "displayOrder");
CREATE INDEX "KnowledgeSection_sourceId_idx" ON "KnowledgeSection"("sourceId");

CREATE UNIQUE INDEX "KnowledgePassage_sectionId_citationKey_key" ON "KnowledgePassage"("sectionId", "citationKey");
CREATE UNIQUE INDEX "KnowledgePassage_sectionId_displayOrder_key" ON "KnowledgePassage"("sectionId", "displayOrder");
CREATE INDEX "KnowledgePassage_organizationId_versionId_idx" ON "KnowledgePassage"("organizationId", "versionId");
CREATE INDEX "KnowledgePassage_sourceId_idx" ON "KnowledgePassage"("sourceId");

ALTER TABLE "KnowledgeSource" ADD CONSTRAINT "KnowledgeSource_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeSource" ADD CONSTRAINT "KnowledgeSource_archivedByUserId_fkey" FOREIGN KEY ("archivedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KnowledgeSource" ADD CONSTRAINT "KnowledgeSource_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "KnowledgeVersion" ADD CONSTRAINT "KnowledgeVersion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeVersion" ADD CONSTRAINT "KnowledgeVersion_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "KnowledgeSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeVersion" ADD CONSTRAINT "KnowledgeVersion_sourceId_organizationId_fkey" FOREIGN KEY ("sourceId", "organizationId") REFERENCES "KnowledgeSource"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeVersion" ADD CONSTRAINT "KnowledgeVersion_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KnowledgeVersion" ADD CONSTRAINT "KnowledgeVersion_confirmerUserId_fkey" FOREIGN KEY ("confirmerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "KnowledgeSection" ADD CONSTRAINT "KnowledgeSection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeSection" ADD CONSTRAINT "KnowledgeSection_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "KnowledgeSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeSection" ADD CONSTRAINT "KnowledgeSection_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "KnowledgeVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeSection" ADD CONSTRAINT "KnowledgeSection_versionId_organizationId_fkey" FOREIGN KEY ("versionId", "organizationId") REFERENCES "KnowledgeVersion"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KnowledgePassage" ADD CONSTRAINT "KnowledgePassage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgePassage" ADD CONSTRAINT "KnowledgePassage_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "KnowledgeSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgePassage" ADD CONSTRAINT "KnowledgePassage_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "KnowledgeVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgePassage" ADD CONSTRAINT "KnowledgePassage_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "KnowledgeSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgePassage" ADD CONSTRAINT "KnowledgePassage_versionId_organizationId_fkey" FOREIGN KEY ("versionId", "organizationId") REFERENCES "KnowledgeVersion"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
