-- Phase 5A follow-up: contact restore audit, channel archival, and
-- database-enforced ProspectMerge immutability. Forward-only.
-- Does not edit 20260816200000_phase_05a_prospect_contact_core.

ALTER TYPE "OrganizationAuditAction" ADD VALUE 'CONTACT_RESTORED';

CREATE TYPE "ProspectChannelLifecycle" AS ENUM ('ACTIVE', 'ARCHIVED');

ALTER TABLE "ProspectContact"
  ADD COLUMN "restoredAt" TIMESTAMP(3);

ALTER TABLE "ProspectChannel"
  ADD COLUMN "lifecycle" "ProspectChannelLifecycle" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "ProspectChannel_organizationId_prospectId_lifecycle_idx"
  ON "ProspectChannel"("organizationId", "prospectId", "lifecycle");

-- At most one active primary contact per prospect.
CREATE UNIQUE INDEX "ProspectContact_one_active_primary_key"
  ON "ProspectContact" ("organizationId", "prospectId")
  WHERE "lifecycle" = 'ACTIVE' AND "isPrimary" = true;

-- One active communication point per prospect+owner+kind+normalized value.
-- COALESCE lets prospect-level (null contactId) channels participate.
CREATE UNIQUE INDEX "ProspectChannel_active_normalized_key"
  ON "ProspectChannel" (
    "organizationId",
    "prospectId",
    "kind",
    "normalizedValue",
    COALESCE("contactId", '')
  )
  WHERE "lifecycle" = 'ACTIVE';

CREATE OR REPLACE FUNCTION outreach_reject_prospect_merge_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'prospect merge receipts are immutable after creation'
    USING ERRCODE = '23000';
END;
$$;

CREATE TRIGGER prospect_merge_immutable_update
  BEFORE UPDATE ON "ProspectMerge"
  FOR EACH ROW
  EXECUTE FUNCTION outreach_reject_prospect_merge_update();
