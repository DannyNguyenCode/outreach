-- Phase 3A: business profile, location, operating hours, services, products,
-- organization settings, and onboarding state.
-- Forward-only. Does not modify Phase 1/2 migration history.

-- AlterEnum: add Phase 3A audit actions (PostgreSQL-compatible additive values).
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'BUSINESS_PROFILE_UPDATED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'OPERATING_HOURS_UPDATED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'SERVICE_CREATED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'SERVICE_UPDATED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'SERVICE_DEACTIVATED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'PRODUCT_CREATED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'PRODUCT_UPDATED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'PRODUCT_DEACTIVATED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'ORGANIZATION_SETTINGS_UPDATED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'ONBOARDING_STARTED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'ONBOARDING_COMPLETED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'ONBOARDING_REOPENED';

CREATE TYPE "BusinessType" AS ENUM ('SERVICES', 'PRODUCTS', 'BOTH');

CREATE TYPE "PreferredContactMethod" AS ENUM ('EMAIL', 'PHONE', 'WEBSITE');

CREATE TYPE "DayOfWeek" AS ENUM (
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY'
);

CREATE TYPE "OnboardingStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');

CREATE TYPE "OnboardingStep" AS ENUM (
  'BUSINESS_BASICS',
  'CONTACT_LOCATION',
  'OPERATING_HOURS',
  'CATALOGUE',
  'EMPLOYEE_DEFAULTS',
  'REVIEW'
);

CREATE TYPE "FutureCallingAccessDefault" AS ENUM ('DISABLED', 'STANDARD');

CREATE TABLE "BusinessProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalName" TEXT,
    "displayName" TEXT,
    "description" TEXT,
    "industry" TEXT,
    "websiteUrl" TEXT,
    "primaryEmail" TEXT,
    "primaryPhoneE164" TEXT,
    "preferredContactMethod" "PreferredContactMethod",
    "timeZone" TEXT,
    "businessType" "BusinessType",
    "logoUrl" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BusinessProfile_organizationId_key" ON "BusinessProfile"("organizationId");

CREATE TABLE "BusinessLocation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'Primary',
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postalCode" TEXT,
    "countryCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessLocation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BusinessLocation_organizationId_idx" ON "BusinessLocation"("organizationId");

-- At most one primary location per organization.
CREATE UNIQUE INDEX "BusinessLocation_organizationId_primary_key"
ON "BusinessLocation" ("organizationId")
WHERE "isPrimary" = true;

CREATE TABLE "OperatingHourInterval" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "dayOfWeek" "DayOfWeek" NOT NULL,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "startMinute" INTEGER,
    "endMinute" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "customerNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperatingHourInterval_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OperatingHourInterval_organizationId_dayOfWeek_sortOrder_key"
ON "OperatingHourInterval"("organizationId", "dayOfWeek", "sortOrder");

CREATE INDEX "OperatingHourInterval_organizationId_dayOfWeek_idx"
ON "OperatingHourInterval"("organizationId", "dayOfWeek");

CREATE TABLE "BusinessService" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "priceDescription" TEXT,
    "durationMinutes" INTEGER,
    "category" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessService_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BusinessService_organizationId_displayOrder_idx"
ON "BusinessService"("organizationId", "displayOrder");

CREATE INDEX "BusinessService_organizationId_isActive_displayOrder_idx"
ON "BusinessService"("organizationId", "isActive", "displayOrder");

CREATE TABLE "BusinessProduct" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "sku" TEXT,
    "priceDescription" TEXT,
    "category" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessProduct_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BusinessProduct_organizationId_displayOrder_idx"
ON "BusinessProduct"("organizationId", "displayOrder");

CREATE INDEX "BusinessProduct_organizationId_isActive_displayOrder_idx"
ON "BusinessProduct"("organizationId", "isActive", "displayOrder");

-- SKU uniqueness is organization-scoped and ignores NULL sku values.
CREATE UNIQUE INDEX "BusinessProduct_organizationId_sku_key"
ON "BusinessProduct" ("organizationId", "sku")
WHERE "sku" IS NOT NULL;

CREATE TABLE "OrganizationSettings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "membersCanViewServices" BOOLEAN NOT NULL DEFAULT true,
    "membersCanViewProducts" BOOLEAN NOT NULL DEFAULT true,
    "membersCanViewBusinessInfo" BOOLEAN NOT NULL DEFAULT true,
    "futureCallingAccessDefault" "FutureCallingAccessDefault" NOT NULL DEFAULT 'DISABLED',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrganizationSettings_organizationId_key" ON "OrganizationSettings"("organizationId");

CREATE TABLE "OrganizationOnboarding" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" "OnboardingStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "currentStep" "OnboardingStep" NOT NULL DEFAULT 'BUSINESS_BASICS',
    "completedSteps" JSONB NOT NULL DEFAULT '[]',
    "isConfigurationReady" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "completedByUserId" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "reopenedByUserId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationOnboarding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrganizationOnboarding_organizationId_key" ON "OrganizationOnboarding"("organizationId");
CREATE INDEX "OrganizationOnboarding_status_idx" ON "OrganizationOnboarding"("status");

ALTER TABLE "BusinessProfile"
ADD CONSTRAINT "BusinessProfile_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BusinessLocation"
ADD CONSTRAINT "BusinessLocation_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OperatingHourInterval"
ADD CONSTRAINT "OperatingHourInterval_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BusinessService"
ADD CONSTRAINT "BusinessService_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BusinessProduct"
ADD CONSTRAINT "BusinessProduct_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrganizationSettings"
ADD CONSTRAINT "OrganizationSettings_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrganizationOnboarding"
ADD CONSTRAINT "OrganizationOnboarding_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrganizationOnboarding"
ADD CONSTRAINT "OrganizationOnboarding_completedByUserId_fkey"
FOREIGN KEY ("completedByUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OrganizationOnboarding"
ADD CONSTRAINT "OrganizationOnboarding_reopenedByUserId_fkey"
FOREIGN KEY ("reopenedByUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
