-- Phase 4A corrective confirmer retention: keep immutable confirmation
-- evidence when a referenced user would otherwise be hard-deleted.
-- Prisma maps this as onDelete: Restrict (PostgreSQL RESTRICT).
-- Does not edit the original 4A or ancestry migrations, and does not
-- weaken confirmation consistency checks.
-- Apply only to disposable local and CI PostgreSQL.
--
-- Users referenced by KnowledgeVersion.confirmerUserId cannot be
-- hard-deleted until a future explicit retention/anonymization workflow
-- safely replaces that identity. Membership deactivation and demotion
-- are unaffected.

ALTER TABLE "KnowledgeVersion"
  DROP CONSTRAINT "KnowledgeVersion_confirmerUserId_fkey";

ALTER TABLE "KnowledgeVersion"
  ADD CONSTRAINT "KnowledgeVersion_confirmerUserId_fkey"
  FOREIGN KEY ("confirmerUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE
  NOT VALID;

ALTER TABLE "KnowledgeVersion"
  VALIDATE CONSTRAINT "KnowledgeVersion_confirmerUserId_fkey";
