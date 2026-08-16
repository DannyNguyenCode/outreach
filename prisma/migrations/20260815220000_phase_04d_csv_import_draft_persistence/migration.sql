-- Phase 4D: organization-owned immutable CSV import staging.
-- Forward-only. Phase 0–4C knowledge, document, and offering tables remain intact.
-- This migration does not create KnowledgeSource, Offering, storage, or job rows.

ALTER TYPE "OrganizationAuditAction" ADD VALUE 'CSV_IMPORT_STAGED';

CREATE TYPE "CsvImportStatus" AS ENUM (
  'READY_TO_CONFIRM',
  'NEEDS_ATTENTION'
);

CREATE TYPE "CsvImportTargetFamily" AS ENUM (
  'KNOWLEDGE',
  'OFFERING'
);

CREATE TABLE "CsvImport" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "importIdentity" TEXT NOT NULL,
  "targetFamily" "CsvImportTargetFamily" NOT NULL,
  "status" "CsvImportStatus" NOT NULL,
  "filename" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "byteLength" INTEGER NOT NULL,
  "sourceChecksum" TEXT NOT NULL,
  "mappingJson" TEXT NOT NULL,
  "mappingIdentity" TEXT NOT NULL,
  "validationContractVersion" TEXT NOT NULL,
  "totalRowCount" INTEGER NOT NULL,
  "nonblankRowCount" INTEGER NOT NULL,
  "validRowCount" INTEGER NOT NULL,
  "invalidRowCount" INTEGER NOT NULL,
  "skippedBlankRowCount" INTEGER NOT NULL,
  "processedRowCount" INTEGER NOT NULL,
  "issueCount" INTEGER NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CsvImport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CsvImport_byteLength_nonnegative" CHECK ("byteLength" >= 0),
  CONSTRAINT "CsvImport_counts_nonnegative" CHECK (
    "totalRowCount" >= 0
    AND "nonblankRowCount" >= 0
    AND "validRowCount" >= 0
    AND "invalidRowCount" >= 0
    AND "skippedBlankRowCount" >= 0
    AND "processedRowCount" >= 0
    AND "issueCount" >= 0
  ),
  CONSTRAINT "CsvImport_count_identity" CHECK (
    "validRowCount" + "invalidRowCount" = "nonblankRowCount"
    AND "skippedBlankRowCount" + "nonblankRowCount" = "totalRowCount"
    AND "processedRowCount" = "totalRowCount"
  ),
  CONSTRAINT "CsvImport_status_counts" CHECK (
    (
      "status" = 'READY_TO_CONFIRM'
      AND "invalidRowCount" = 0
      AND "issueCount" = 0
    )
    OR (
      "status" = 'NEEDS_ATTENTION'
      AND ("invalidRowCount" > 0 OR "issueCount" > 0)
    )
  ),
  CONSTRAINT "CsvImport_mime_csv" CHECK ("mimeType" = 'text/csv'),
  CONSTRAINT "CsvImport_checksum_sha256" CHECK ("sourceChecksum" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "CsvImport_identity_sha256" CHECK ("importIdentity" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "CsvImport_contract_present" CHECK (char_length("validationContractVersion") > 0)
);

CREATE TABLE "CsvImportRow" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "importId" TEXT NOT NULL,
  "displayOrder" INTEGER NOT NULL,
  "sourceRowNumber" INTEGER NOT NULL,
  "valuesJson" TEXT NOT NULL,
  "issuesJson" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CsvImportRow_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CsvImportRow_displayOrder_nonnegative" CHECK ("displayOrder" >= 0),
  CONSTRAINT "CsvImportRow_sourceRowNumber_positive" CHECK ("sourceRowNumber" >= 1)
);

CREATE UNIQUE INDEX "CsvImport_id_organizationId_key" ON "CsvImport"("id", "organizationId");
CREATE UNIQUE INDEX "CsvImport_organizationId_importIdentity_key" ON "CsvImport"("organizationId", "importIdentity");
CREATE INDEX "CsvImport_organizationId_createdAt_idx" ON "CsvImport"("organizationId", "createdAt");
CREATE INDEX "CsvImport_organizationId_status_idx" ON "CsvImport"("organizationId", "status");

CREATE UNIQUE INDEX "CsvImportRow_importId_displayOrder_key" ON "CsvImportRow"("importId", "displayOrder");
CREATE UNIQUE INDEX "CsvImportRow_importId_sourceRowNumber_key" ON "CsvImportRow"("importId", "sourceRowNumber");
CREATE UNIQUE INDEX "CsvImportRow_id_organizationId_importId_key" ON "CsvImportRow"("id", "organizationId", "importId");
CREATE INDEX "CsvImportRow_organizationId_importId_displayOrder_idx" ON "CsvImportRow"("organizationId", "importId", "displayOrder");

ALTER TABLE "CsvImport"
  ADD CONSTRAINT "CsvImport_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CsvImport"
  ADD CONSTRAINT "CsvImport_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CsvImportRow"
  ADD CONSTRAINT "CsvImportRow_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CsvImportRow"
  ADD CONSTRAINT "CsvImportRow_import_org_fkey"
  FOREIGN KEY ("importId", "organizationId") REFERENCES "CsvImport"("id", "organizationId")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION outreach_reject_csv_import_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'csv import records are immutable after creation'
    USING ERRCODE = '23000';
END;
$$;

CREATE TRIGGER csv_import_immutable_update
  BEFORE UPDATE ON "CsvImport"
  FOR EACH ROW
  EXECUTE FUNCTION outreach_reject_csv_import_update();

CREATE TRIGGER csv_import_row_immutable_update
  BEFORE UPDATE ON "CsvImportRow"
  FOR EACH ROW
  EXECUTE FUNCTION outreach_reject_csv_import_update();
