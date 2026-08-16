-- Phase 4D: immutable CSV import confirmation receipt and row provenance.
-- Forward-only. Does not alter the approved CSV staging migration or tables.

ALTER TYPE "OrganizationAuditAction" ADD VALUE 'CSV_IMPORT_ACTIVATED';

CREATE TABLE "CsvImportConfirmation" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "importId" TEXT NOT NULL,
  "importIdentity" TEXT NOT NULL,
  "sourceChecksum" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "confirmedAt" TIMESTAMP(3) NOT NULL,
  "confirmationLanguageVersion" TEXT NOT NULL,
  "targetFamily" "CsvImportTargetFamily" NOT NULL,
  "createdRowCount" INTEGER NOT NULL,
  "resultSummaryJson" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CsvImportConfirmation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CsvImportConfirmation_createdRowCount_nonnegative"
    CHECK ("createdRowCount" >= 0),
  CONSTRAINT "CsvImportConfirmation_checksum_sha256"
    CHECK ("sourceChecksum" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "CsvImportConfirmation_identity_sha256"
    CHECK ("importIdentity" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "CsvImportConfirmation_language_present"
    CHECK (char_length("confirmationLanguageVersion") > 0),
  CONSTRAINT "CsvImportConfirmation_summary_present"
    CHECK (char_length("resultSummaryJson") > 0)
);

CREATE TABLE "CsvImportKnowledgeRowActivation" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "importId" TEXT NOT NULL,
  "importRowId" TEXT NOT NULL,
  "confirmationId" TEXT NOT NULL,
  "knowledgeSourceId" TEXT NOT NULL,
  "knowledgeVersionId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CsvImportKnowledgeRowActivation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CsvImportOfferingRowActivation" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "importId" TEXT NOT NULL,
  "importRowId" TEXT NOT NULL,
  "confirmationId" TEXT NOT NULL,
  "offeringId" TEXT NOT NULL,
  "offeringVersionId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CsvImportOfferingRowActivation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CsvImportConfirmation_importId_key"
  ON "CsvImportConfirmation"("importId");
CREATE UNIQUE INDEX "CsvImportConfirmation_id_organizationId_key"
  ON "CsvImportConfirmation"("id", "organizationId");
CREATE UNIQUE INDEX "CsvImportConfirmation_importId_organizationId_key"
  ON "CsvImportConfirmation"("importId", "organizationId");
CREATE INDEX "CsvImportConfirmation_organizationId_confirmedAt_idx"
  ON "CsvImportConfirmation"("organizationId", "confirmedAt");

CREATE UNIQUE INDEX "CsvImportKnowledgeRowActivation_importRowId_key"
  ON "CsvImportKnowledgeRowActivation"("importRowId");
CREATE UNIQUE INDEX "CsvImportKnowledgeRowActivation_importId_importRowId_key"
  ON "CsvImportKnowledgeRowActivation"("importId", "importRowId");
CREATE UNIQUE INDEX "CsvImportKnowledgeRowActivation_importRowId_organizationId_importId_key"
  ON "CsvImportKnowledgeRowActivation"("importRowId", "organizationId", "importId");
CREATE UNIQUE INDEX "CsvImportKnowledgeRowActivation_id_organizationId_key"
  ON "CsvImportKnowledgeRowActivation"("id", "organizationId");
CREATE INDEX "CsvImportKnowledgeRowActivation_organizationId_importId_idx"
  ON "CsvImportKnowledgeRowActivation"("organizationId", "importId");
CREATE INDEX "CsvImportKnowledgeRowActivation_organizationId_knowledgeSourceId_idx"
  ON "CsvImportKnowledgeRowActivation"("organizationId", "knowledgeSourceId");

CREATE UNIQUE INDEX "CsvImportOfferingRowActivation_importRowId_key"
  ON "CsvImportOfferingRowActivation"("importRowId");
CREATE UNIQUE INDEX "CsvImportOfferingRowActivation_importId_importRowId_key"
  ON "CsvImportOfferingRowActivation"("importId", "importRowId");
CREATE UNIQUE INDEX "CsvImportOfferingRowActivation_importRowId_organizationId_importId_key"
  ON "CsvImportOfferingRowActivation"("importRowId", "organizationId", "importId");
CREATE UNIQUE INDEX "CsvImportOfferingRowActivation_id_organizationId_key"
  ON "CsvImportOfferingRowActivation"("id", "organizationId");
CREATE INDEX "CsvImportOfferingRowActivation_organizationId_importId_idx"
  ON "CsvImportOfferingRowActivation"("organizationId", "importId");
CREATE INDEX "CsvImportOfferingRowActivation_organizationId_offeringId_idx"
  ON "CsvImportOfferingRowActivation"("organizationId", "offeringId");

ALTER TABLE "CsvImportConfirmation"
  ADD CONSTRAINT "CsvImportConfirmation_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CsvImportConfirmation"
  ADD CONSTRAINT "CsvImportConfirmation_import_org_fkey"
  FOREIGN KEY ("importId", "organizationId") REFERENCES "CsvImport"("id", "organizationId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CsvImportConfirmation"
  ADD CONSTRAINT "CsvImportConfirmation_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CsvImportKnowledgeRowActivation"
  ADD CONSTRAINT "CsvImportKnowledgeRowActivation_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CsvImportKnowledgeRowActivation"
  ADD CONSTRAINT "CsvImportKnowledgeRowActivation_import_org_fkey"
  FOREIGN KEY ("importId", "organizationId") REFERENCES "CsvImport"("id", "organizationId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CsvImportKnowledgeRowActivation"
  ADD CONSTRAINT "CsvImportKnowledgeRowActivation_row_org_fkey"
  FOREIGN KEY ("importRowId", "organizationId", "importId")
  REFERENCES "CsvImportRow"("id", "organizationId", "importId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CsvImportKnowledgeRowActivation"
  ADD CONSTRAINT "CsvImportKnowledgeRowActivation_confirmation_org_fkey"
  FOREIGN KEY ("confirmationId", "organizationId")
  REFERENCES "CsvImportConfirmation"("id", "organizationId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CsvImportKnowledgeRowActivation"
  ADD CONSTRAINT "CsvImportKnowledgeRowActivation_source_org_fkey"
  FOREIGN KEY ("knowledgeSourceId", "organizationId")
  REFERENCES "KnowledgeSource"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CsvImportKnowledgeRowActivation"
  ADD CONSTRAINT "CsvImportKnowledgeRowActivation_version_org_fkey"
  FOREIGN KEY ("knowledgeVersionId", "organizationId", "knowledgeSourceId")
  REFERENCES "KnowledgeVersion"("id", "organizationId", "sourceId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CsvImportOfferingRowActivation"
  ADD CONSTRAINT "CsvImportOfferingRowActivation_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CsvImportOfferingRowActivation"
  ADD CONSTRAINT "CsvImportOfferingRowActivation_import_org_fkey"
  FOREIGN KEY ("importId", "organizationId") REFERENCES "CsvImport"("id", "organizationId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CsvImportOfferingRowActivation"
  ADD CONSTRAINT "CsvImportOfferingRowActivation_row_org_fkey"
  FOREIGN KEY ("importRowId", "organizationId", "importId")
  REFERENCES "CsvImportRow"("id", "organizationId", "importId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CsvImportOfferingRowActivation"
  ADD CONSTRAINT "CsvImportOfferingRowActivation_confirmation_org_fkey"
  FOREIGN KEY ("confirmationId", "organizationId")
  REFERENCES "CsvImportConfirmation"("id", "organizationId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CsvImportOfferingRowActivation"
  ADD CONSTRAINT "CsvImportOfferingRowActivation_offering_org_fkey"
  FOREIGN KEY ("offeringId", "organizationId")
  REFERENCES "Offering"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CsvImportOfferingRowActivation"
  ADD CONSTRAINT "CsvImportOfferingRowActivation_version_org_fkey"
  FOREIGN KEY ("offeringVersionId", "organizationId", "offeringId")
  REFERENCES "OfferingVersion"("id", "organizationId", "offeringId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION outreach_reject_csv_import_confirmation_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'csv import confirmation records are immutable after creation'
    USING ERRCODE = '23000';
END;
$$;

CREATE TRIGGER csv_import_confirmation_immutable_update
  BEFORE UPDATE ON "CsvImportConfirmation"
  FOR EACH ROW
  EXECUTE FUNCTION outreach_reject_csv_import_confirmation_update();

CREATE TRIGGER csv_import_knowledge_row_activation_immutable_update
  BEFORE UPDATE ON "CsvImportKnowledgeRowActivation"
  FOR EACH ROW
  EXECUTE FUNCTION outreach_reject_csv_import_confirmation_update();

CREATE TRIGGER csv_import_offering_row_activation_immutable_update
  BEFORE UPDATE ON "CsvImportOfferingRowActivation"
  FOR EACH ROW
  EXECUTE FUNCTION outreach_reject_csv_import_confirmation_update();
