-- Phase 5A: organization-scoped prospects, contacts, communication channels,
-- custom values, and immutable merge provenance.
-- Forward-only. Phase 0–4 tables remain intact.

ALTER TYPE "OrganizationAuditAction" ADD VALUE 'PROSPECT_CREATED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'PROSPECT_UPDATED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'PROSPECT_ARCHIVED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'PROSPECT_RESTORED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'PROSPECT_MERGED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'CONTACT_CREATED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'CONTACT_UPDATED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'CONTACT_ARCHIVED';

ALTER TYPE "CustomFieldScope" ADD VALUE 'CONTACT';

CREATE TYPE "ProspectKind" AS ENUM (
  'BUSINESS',
  'INDIVIDUAL',
  'HOUSEHOLD',
  'ORGANIZATION'
);

CREATE TYPE "ProspectLifecycle" AS ENUM (
  'ACTIVE',
  'ARCHIVED',
  'MERGED'
);

CREATE TYPE "ProspectSourceKind" AS ENUM (
  'MANUAL'
);

CREATE TYPE "ProspectChannelKind" AS ENUM (
  'PHONE',
  'EMAIL'
);

CREATE TYPE "ProspectContactLifecycle" AS ENUM (
  'ACTIVE',
  'ARCHIVED'
);

CREATE TABLE "Prospect" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "kind" "ProspectKind" NOT NULL DEFAULT 'BUSINESS',
  "displayName" TEXT NOT NULL,
  "searchName" TEXT NOT NULL,
  "websiteDisplay" TEXT,
  "websiteNormalized" TEXT,
  "locationLabel" TEXT,
  "addressLine1" TEXT,
  "addressLine2" TEXT,
  "city" TEXT,
  "region" TEXT,
  "postalCode" TEXT,
  "countryCode" TEXT,
  "timeZone" TEXT,
  "sourceKind" "ProspectSourceKind" NOT NULL DEFAULT 'MANUAL',
  "sourceDetail" TEXT,
  "lifecycle" "ProspectLifecycle" NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdByUserId" TEXT NOT NULL,
  "updatedByUserId" TEXT NOT NULL,
  "archivedAt" TIMESTAMP(3),
  "archivedByUserId" TEXT,
  "restoredAt" TIMESTAMP(3),
  "restoredByUserId" TEXT,
  "mergedAt" TIMESTAMP(3),
  "mergedIntoProspectId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Prospect_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Prospect_no_self_merge" CHECK (
    "mergedIntoProspectId" IS NULL OR "mergedIntoProspectId" <> "id"
  ),
  CONSTRAINT "Prospect_merged_state" CHECK (
    (
      "lifecycle" = 'MERGED'
      AND "mergedIntoProspectId" IS NOT NULL
      AND "mergedAt" IS NOT NULL
    )
    OR (
      "lifecycle" <> 'MERGED'
      AND "mergedIntoProspectId" IS NULL
      AND "mergedAt" IS NULL
    )
  )
);

CREATE TABLE "ProspectContact" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "prospectId" TEXT NOT NULL,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "title" TEXT,
  "preferredLanguage" TEXT,
  "lifecycle" "ProspectContactLifecycle" NOT NULL DEFAULT 'ACTIVE',
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdByUserId" TEXT NOT NULL,
  "updatedByUserId" TEXT NOT NULL,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProspectContact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProspectChannel" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "prospectId" TEXT NOT NULL,
  "contactId" TEXT,
  "kind" "ProspectChannelKind" NOT NULL,
  "label" TEXT,
  "displayValue" TEXT NOT NULL,
  "normalizedValue" TEXT NOT NULL,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProspectChannel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProspectCustomValue" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "prospectId" TEXT NOT NULL,
  "definitionId" TEXT NOT NULL,
  "definitionKey" TEXT NOT NULL,
  "stringValue" TEXT,
  "numberValue" DECIMAL(19,4),
  "booleanValue" BOOLEAN,
  "dateValue" TIMESTAMPTZ(3),
  "jsonValue" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProspectCustomValue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProspectContactCustomValue" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "prospectId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "definitionId" TEXT NOT NULL,
  "definitionKey" TEXT NOT NULL,
  "stringValue" TEXT,
  "numberValue" DECIMAL(19,4),
  "booleanValue" BOOLEAN,
  "dateValue" TIMESTAMPTZ(3),
  "jsonValue" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProspectContactCustomValue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProspectMerge" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "survivorProspectId" TEXT NOT NULL,
  "mergedProspectId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "fieldResolutionsJson" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProspectMerge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProspectMerge_no_self" CHECK (
    "survivorProspectId" <> "mergedProspectId"
  )
);

CREATE UNIQUE INDEX "Prospect_id_organizationId_key" ON "Prospect"("id", "organizationId");
CREATE INDEX "Prospect_organizationId_lifecycle_updatedAt_idx" ON "Prospect"("organizationId", "lifecycle", "updatedAt");
CREATE INDEX "Prospect_organizationId_searchName_idx" ON "Prospect"("organizationId", "searchName");
CREATE INDEX "Prospect_organizationId_websiteNormalized_idx" ON "Prospect"("organizationId", "websiteNormalized");
CREATE INDEX "Prospect_organizationId_sourceKind_idx" ON "Prospect"("organizationId", "sourceKind");
CREATE INDEX "Prospect_mergedIntoProspectId_organizationId_idx" ON "Prospect"("mergedIntoProspectId", "organizationId");

CREATE UNIQUE INDEX "ProspectContact_id_organizationId_key" ON "ProspectContact"("id", "organizationId");
CREATE UNIQUE INDEX "ProspectContact_id_organizationId_prospectId_key" ON "ProspectContact"("id", "organizationId", "prospectId");
CREATE INDEX "ProspectContact_organizationId_prospectId_isPrimary_idx" ON "ProspectContact"("organizationId", "prospectId", "isPrimary");
CREATE INDEX "ProspectContact_organizationId_prospectId_lifecycle_idx" ON "ProspectContact"("organizationId", "prospectId", "lifecycle");
CREATE UNIQUE INDEX "ProspectContact_one_primary_active" ON "ProspectContact"("organizationId", "prospectId")
  WHERE "isPrimary" = true AND "lifecycle" = 'ACTIVE';

CREATE UNIQUE INDEX "ProspectChannel_id_organizationId_key" ON "ProspectChannel"("id", "organizationId");
CREATE INDEX "ProspectChannel_organizationId_kind_normalizedValue_idx" ON "ProspectChannel"("organizationId", "kind", "normalizedValue");
CREATE INDEX "ProspectChannel_organizationId_prospectId_idx" ON "ProspectChannel"("organizationId", "prospectId");
CREATE INDEX "ProspectChannel_organizationId_contactId_idx" ON "ProspectChannel"("organizationId", "contactId");

CREATE UNIQUE INDEX "ProspectCustomValue_prospectId_definitionId_key" ON "ProspectCustomValue"("prospectId", "definitionId");
CREATE UNIQUE INDEX "ProspectCustomValue_id_organizationId_key" ON "ProspectCustomValue"("id", "organizationId");
CREATE INDEX "ProspectCustomValue_organizationId_prospectId_idx" ON "ProspectCustomValue"("organizationId", "prospectId");
CREATE INDEX "ProspectCustomValue_organizationId_definitionId_idx" ON "ProspectCustomValue"("organizationId", "definitionId");

CREATE UNIQUE INDEX "ProspectContactCustomValue_contactId_definitionId_key" ON "ProspectContactCustomValue"("contactId", "definitionId");
CREATE UNIQUE INDEX "ProspectContactCustomValue_id_organizationId_key" ON "ProspectContactCustomValue"("id", "organizationId");
CREATE INDEX "ProspectContactCustomValue_organizationId_contactId_idx" ON "ProspectContactCustomValue"("organizationId", "contactId");
CREATE INDEX "ProspectContactCustomValue_organizationId_prospectId_idx" ON "ProspectContactCustomValue"("organizationId", "prospectId");
CREATE INDEX "ProspectContactCustomValue_organizationId_definitionId_idx" ON "ProspectContactCustomValue"("organizationId", "definitionId");

CREATE UNIQUE INDEX "ProspectMerge_mergedProspectId_key" ON "ProspectMerge"("mergedProspectId");
CREATE UNIQUE INDEX "ProspectMerge_id_organizationId_key" ON "ProspectMerge"("id", "organizationId");
CREATE UNIQUE INDEX "ProspectMerge_organizationId_mergedProspectId_key" ON "ProspectMerge"("organizationId", "mergedProspectId");
CREATE INDEX "ProspectMerge_organizationId_survivorProspectId_idx" ON "ProspectMerge"("organizationId", "survivorProspectId");
CREATE INDEX "ProspectMerge_organizationId_createdAt_idx" ON "ProspectMerge"("organizationId", "createdAt");

ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_updatedByUserId_fkey"
  FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_archivedByUserId_fkey"
  FOREIGN KEY ("archivedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_restoredByUserId_fkey"
  FOREIGN KEY ("restoredByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_mergedInto_fkey"
  FOREIGN KEY ("mergedIntoProspectId", "organizationId") REFERENCES "Prospect"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "ProspectContact" ADD CONSTRAINT "ProspectContact_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProspectContact" ADD CONSTRAINT "ProspectContact_prospect_fkey"
  FOREIGN KEY ("prospectId", "organizationId") REFERENCES "Prospect"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "ProspectContact" ADD CONSTRAINT "ProspectContact_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProspectContact" ADD CONSTRAINT "ProspectContact_updatedByUserId_fkey"
  FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProspectChannel" ADD CONSTRAINT "ProspectChannel_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProspectChannel" ADD CONSTRAINT "ProspectChannel_prospect_fkey"
  FOREIGN KEY ("prospectId", "organizationId") REFERENCES "Prospect"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "ProspectChannel" ADD CONSTRAINT "ProspectChannel_contact_fkey"
  FOREIGN KEY ("contactId", "organizationId", "prospectId") REFERENCES "ProspectContact"("id", "organizationId", "prospectId")
  ON DELETE RESTRICT ON UPDATE CASCADE
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "ProspectCustomValue" ADD CONSTRAINT "ProspectCustomValue_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProspectCustomValue" ADD CONSTRAINT "ProspectCustomValue_prospect_fkey"
  FOREIGN KEY ("prospectId", "organizationId") REFERENCES "Prospect"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProspectCustomValue" ADD CONSTRAINT "ProspectCustomValue_definition_fkey"
  FOREIGN KEY ("definitionId", "organizationId") REFERENCES "CustomFieldDefinition"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProspectContactCustomValue" ADD CONSTRAINT "ProspectContactCustomValue_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProspectContactCustomValue" ADD CONSTRAINT "ProspectContactCustomValue_prospect_fkey"
  FOREIGN KEY ("prospectId", "organizationId") REFERENCES "Prospect"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "ProspectContactCustomValue" ADD CONSTRAINT "ProspectContactCustomValue_contact_fkey"
  FOREIGN KEY ("contactId", "organizationId", "prospectId") REFERENCES "ProspectContact"("id", "organizationId", "prospectId")
  ON DELETE RESTRICT ON UPDATE CASCADE
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "ProspectContactCustomValue" ADD CONSTRAINT "ProspectContactCustomValue_definition_fkey"
  FOREIGN KEY ("definitionId", "organizationId") REFERENCES "CustomFieldDefinition"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProspectMerge" ADD CONSTRAINT "ProspectMerge_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProspectMerge" ADD CONSTRAINT "ProspectMerge_survivor_fkey"
  FOREIGN KEY ("survivorProspectId", "organizationId") REFERENCES "Prospect"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProspectMerge" ADD CONSTRAINT "ProspectMerge_merged_fkey"
  FOREIGN KEY ("mergedProspectId", "organizationId") REFERENCES "Prospect"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProspectMerge" ADD CONSTRAINT "ProspectMerge_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
