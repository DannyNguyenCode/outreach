-- Phase 2: organizations, memberships, invitations, audit events.
-- Forward-only. Does not modify Phase 1 tables beyond additive User columns/FKs.

CREATE TYPE "OrganizationRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'INACTIVE');

CREATE TYPE "OrganizationAuditAction" AS ENUM (
  'ORGANIZATION_CREATED',
  'INVITATION_CREATED',
  'INVITATION_REPLACED',
  'INVITATION_REVOKED',
  'INVITATION_ACCEPTED',
  'MEMBER_ROLE_CHANGED',
  'MEMBER_DEACTIVATED'
);

CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");
CREATE INDEX "Organization_createdAt_idx" ON "Organization"("createdAt");

CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "OrganizationRole" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "deactivatedAt" TIMESTAMP(3),
    "deactivatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Membership_organizationId_userId_key" ON "Membership"("organizationId", "userId");
CREATE INDEX "Membership_userId_status_idx" ON "Membership"("userId", "status");
CREATE INDEX "Membership_organizationId_status_idx" ON "Membership"("organizationId", "status");
CREATE INDEX "Membership_organizationId_role_status_idx" ON "Membership"("organizationId", "role", "status");

CREATE TABLE "OrganizationInvitation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "emailNormalized" TEXT NOT NULL,
    "role" "OrganizationRole" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "invitedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrganizationInvitation_tokenHash_key" ON "OrganizationInvitation"("tokenHash");
CREATE INDEX "OrganizationInvitation_organizationId_emailNormalized_idx" ON "OrganizationInvitation"("organizationId", "emailNormalized");
CREATE INDEX "OrganizationInvitation_expiresAt_idx" ON "OrganizationInvitation"("expiresAt");
CREATE INDEX "OrganizationInvitation_organizationId_revokedAt_acceptedAt_idx" ON "OrganizationInvitation"("organizationId", "revokedAt", "acceptedAt");

-- At most one usable (pending) invitation per organization + email.
CREATE UNIQUE INDEX "OrganizationInvitation_org_email_active_key"
ON "OrganizationInvitation" ("organizationId", "emailNormalized")
WHERE "acceptedAt" IS NULL AND "revokedAt" IS NULL;

CREATE TABLE "OrganizationAuditEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" "OrganizationAuditAction" NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrganizationAuditEvent_organizationId_createdAt_idx" ON "OrganizationAuditEvent"("organizationId", "createdAt");
CREATE INDEX "OrganizationAuditEvent_actorUserId_createdAt_idx" ON "OrganizationAuditEvent"("actorUserId", "createdAt");

-- Soft active-organization preference on User (validated on every use).
ALTER TABLE "User" ADD COLUMN "activeOrganizationId" TEXT;

CREATE INDEX "User_activeOrganizationId_idx" ON "User"("activeOrganizationId");

ALTER TABLE "User" ADD CONSTRAINT "User_activeOrganizationId_fkey"
FOREIGN KEY ("activeOrganizationId") REFERENCES "Organization"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Membership" ADD CONSTRAINT "Membership_deactivatedByUserId_fkey"
FOREIGN KEY ("deactivatedByUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OrganizationInvitation" ADD CONSTRAINT "OrganizationInvitation_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Restrict inviter deletion so invitation audit attribution remains intact.
ALTER TABLE "OrganizationInvitation" ADD CONSTRAINT "OrganizationInvitation_invitedByUserId_fkey"
FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrganizationAuditEvent" ADD CONSTRAINT "OrganizationAuditEvent_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrganizationAuditEvent" ADD CONSTRAINT "OrganizationAuditEvent_actorUserId_fkey"
FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
