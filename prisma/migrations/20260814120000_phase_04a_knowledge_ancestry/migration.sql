-- Phase 4A corrective ancestry: immediate-parent composite FKs, unique
-- supporting indexes, confirmation/effective-range checks, and timestamptz
-- effective windows. Does not edit the original 4A migration.
-- Apply only to disposable local and CI PostgreSQL.

-- Unique indexes required by immediate-parent composite FKs.
CREATE UNIQUE INDEX "KnowledgeVersion_id_organizationId_sourceId_key"
ON "KnowledgeVersion" ("id", "organizationId", "sourceId");

CREATE UNIQUE INDEX "KnowledgeSection_id_organizationId_sourceId_versionId_key"
ON "KnowledgeSection" ("id", "organizationId", "sourceId", "versionId");

-- Persist effective windows as UTC instants.
ALTER TABLE "KnowledgeVersion"
  ALTER COLUMN "effectiveFrom" TYPE TIMESTAMPTZ(3)
  USING ("effectiveFrom" AT TIME ZONE 'UTC'),
  ALTER COLUMN "effectiveUntil" TYPE TIMESTAMPTZ(3)
  USING ("effectiveUntil" AT TIME ZONE 'UTC');

-- Immediate-parent composite FKs (NOT VALID then VALIDATE).
ALTER TABLE "KnowledgeSection"
  ADD CONSTRAINT "KnowledgeSection_versionId_organizationId_sourceId_fkey"
  FOREIGN KEY ("versionId", "organizationId", "sourceId")
  REFERENCES "KnowledgeVersion" ("id", "organizationId", "sourceId")
  ON DELETE CASCADE ON UPDATE CASCADE
  NOT VALID;

ALTER TABLE "KnowledgePassage"
  ADD CONSTRAINT "KnowledgePassage_sectionId_organizationId_sourceId_versionId_fkey"
  FOREIGN KEY ("sectionId", "organizationId", "sourceId", "versionId")
  REFERENCES "KnowledgeSection" ("id", "organizationId", "sourceId", "versionId")
  ON DELETE CASCADE ON UPDATE CASCADE
  NOT VALID;

ALTER TABLE "KnowledgeVersion"
  ADD CONSTRAINT "KnowledgeVersion_supersedesVersionId_organizationId_sourceId_fkey"
  FOREIGN KEY ("supersedesVersionId", "organizationId", "sourceId")
  REFERENCES "KnowledgeVersion" ("id", "organizationId", "sourceId")
  ON DELETE NO ACTION ON UPDATE NO ACTION
  NOT VALID;

ALTER TABLE "KnowledgeVersion"
  ADD CONSTRAINT "KnowledgeVersion_restoredFromVersionId_organizationId_sourceId_fkey"
  FOREIGN KEY ("restoredFromVersionId", "organizationId", "sourceId")
  REFERENCES "KnowledgeVersion" ("id", "organizationId", "sourceId")
  ON DELETE NO ACTION ON UPDATE NO ACTION
  NOT VALID;

ALTER TABLE "KnowledgeSection"
  VALIDATE CONSTRAINT "KnowledgeSection_versionId_organizationId_sourceId_fkey";
ALTER TABLE "KnowledgePassage"
  VALIDATE CONSTRAINT "KnowledgePassage_sectionId_organizationId_sourceId_versionId_fkey";
ALTER TABLE "KnowledgeVersion"
  VALIDATE CONSTRAINT "KnowledgeVersion_supersedesVersionId_organizationId_sourceId_fkey";
ALTER TABLE "KnowledgeVersion"
  VALIDATE CONSTRAINT "KnowledgeVersion_restoredFromVersionId_organizationId_sourceId_fkey";

-- Drop weaker duplicate FKs now covered by immediate-parent composites.
ALTER TABLE "KnowledgeVersion" DROP CONSTRAINT "KnowledgeVersion_organizationId_fkey";
ALTER TABLE "KnowledgeVersion" DROP CONSTRAINT "KnowledgeVersion_sourceId_fkey";

ALTER TABLE "KnowledgeSection" DROP CONSTRAINT "KnowledgeSection_organizationId_fkey";
ALTER TABLE "KnowledgeSection" DROP CONSTRAINT "KnowledgeSection_sourceId_fkey";
ALTER TABLE "KnowledgeSection" DROP CONSTRAINT "KnowledgeSection_versionId_fkey";
ALTER TABLE "KnowledgeSection" DROP CONSTRAINT "KnowledgeSection_versionId_organizationId_fkey";

ALTER TABLE "KnowledgePassage" DROP CONSTRAINT "KnowledgePassage_organizationId_fkey";
ALTER TABLE "KnowledgePassage" DROP CONSTRAINT "KnowledgePassage_sourceId_fkey";
ALTER TABLE "KnowledgePassage" DROP CONSTRAINT "KnowledgePassage_versionId_fkey";
ALTER TABLE "KnowledgePassage" DROP CONSTRAINT "KnowledgePassage_sectionId_fkey";
ALTER TABLE "KnowledgePassage" DROP CONSTRAINT "KnowledgePassage_versionId_organizationId_fkey";

-- Effective range and confirmation-field consistency.
ALTER TABLE "KnowledgeVersion"
  ADD CONSTRAINT "KnowledgeVersion_effective_range_check"
  CHECK (
    "effectiveFrom" IS NULL
    OR "effectiveUntil" IS NULL
    OR "effectiveUntil" > "effectiveFrom"
  );

ALTER TABLE "KnowledgeVersion"
  ADD CONSTRAINT "KnowledgeVersion_confirmation_fields_check"
  CHECK (
    (
      "confirmerUserId" IS NULL
      AND "confirmedAt" IS NULL
      AND "confirmationLanguageVersion" IS NULL
    )
    OR (
      "confirmerUserId" IS NOT NULL
      AND "confirmedAt" IS NOT NULL
      AND "confirmationLanguageVersion" IS NOT NULL
    )
  );

ALTER TABLE "KnowledgeVersion"
  ADD CONSTRAINT "KnowledgeVersion_active_superseded_confirmed_check"
  CHECK (
    "state" NOT IN ('ACTIVE', 'SUPERSEDED')
    OR (
      "confirmerUserId" IS NOT NULL
      AND "confirmedAt" IS NOT NULL
      AND "confirmationLanguageVersion" IS NOT NULL
    )
  );

ALTER TABLE "KnowledgeVersion"
  ADD CONSTRAINT "KnowledgeVersion_draft_unconfirmed_check"
  CHECK (
    "state" <> 'DRAFT'
    OR (
      "confirmerUserId" IS NULL
      AND "confirmedAt" IS NULL
      AND "confirmationLanguageVersion" IS NULL
    )
  );
