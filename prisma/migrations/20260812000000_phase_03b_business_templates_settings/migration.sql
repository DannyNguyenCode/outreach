-- Phase 3B: business templates, locale/config defaults, custom fields,
-- service areas, holiday closures, operational defaults, and config progress.
-- Forward-only. Phase 3A tables (BusinessProfile, BusinessLocation,
-- OperatingHourInterval, BusinessService, BusinessProduct, OrganizationSettings,
-- OrganizationOnboarding) are intentionally untouched.

-- AlterEnum: add Phase 3B audit actions (PostgreSQL-compatible additive values).
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'BUSINESS_TEMPLATE_SELECTED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'BUSINESS_TEMPLATE_SWITCHED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'CUSTOM_FIELD_CREATED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'CUSTOM_FIELD_UPDATED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'CUSTOM_FIELD_DEACTIVATED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'CUSTOM_FIELDS_REORDERED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'SERVICE_AREA_CREATED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'SERVICE_AREA_UPDATED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'SERVICE_AREA_DEACTIVATED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'HOLIDAY_CLOSURE_CREATED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'HOLIDAY_CLOSURE_UPDATED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'HOLIDAY_CLOSURE_DEACTIVATED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'OPERATIONAL_DEFAULTS_UPDATED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'LEAD_STAGES_UPDATED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'CALL_DISPOSITIONS_UPDATED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'ORGANIZATION_LOCALE_UPDATED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'CONFIG_PROGRESS_UPDATED';

CREATE TYPE "BusinessTemplateKey" AS ENUM (
  'PROFESSIONAL_SERVICES',
  'HOME_TRADE_SERVICES',
  'PRODUCT_BUSINESS',
  'SUBSCRIPTIONS_PLANS',
  'APPOINTMENT_BASED',
  'CUSTOM_MIXED'
);

CREATE TYPE "CustomFieldDataType" AS ENUM (
  'TEXT',
  'LONG_TEXT',
  'NUMBER',
  'BOOLEAN',
  'DATE',
  'SINGLE_SELECT',
  'MULTI_SELECT',
  'URL',
  'EMAIL',
  'PHONE'
);

CREATE TYPE "CustomFieldScope" AS ENUM (
  'BUSINESS',
  'OFFERING',
  'PROSPECT',
  'KNOWLEDGE'
);

CREATE TYPE "LeadStageClassification" AS ENUM (
  'NONE',
  'INITIAL',
  'WON',
  'LOST',
  'TERMINAL'
);

CREATE TYPE "CallbackAssignmentBehavior" AS ENUM (
  'UNASSIGNED',
  'ROUND_ROBIN_PLACEHOLDER',
  'CREATOR'
);

CREATE TYPE "RecordingAccessDefault" AS ENUM (
  'ADMINS_ONLY',
  'ADMINS_AND_OWNERS',
  'ROLE_GATED_LATER'
);

CREATE TYPE "ConfigProgressStatus" AS ENUM (
  'NOT_STARTED',
  'IN_PROGRESS',
  'COMPLETED'
);

CREATE TYPE "ConfigSection" AS ENUM (
  'BUSINESS_TEMPLATE',
  'LOCALE',
  'SERVICE_AREAS',
  'AVAILABILITY',
  'LEAD_STAGES',
  'CALL_DISPOSITIONS',
  'CALLBACK_POLICY',
  'RECORDING_CONSENT',
  'NOTIFICATIONS',
  'CUSTOM_FIELDS',
  'REVIEW'
);

CREATE TABLE "OrganizationTemplateAssignment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "templateKey" "BusinessTemplateKey" NOT NULL,
    "templateDefinitionVersion" INTEGER NOT NULL,
    "customization" JSONB NOT NULL DEFAULT '{}',
    "selectedByUserId" TEXT,
    "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationTemplateAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrganizationTemplateAssignment_organizationId_key"
ON "OrganizationTemplateAssignment"("organizationId");

CREATE TABLE "OrganizationLocaleSettings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en-CA',
    "defaultLanguage" TEXT NOT NULL DEFAULT 'en',
    "dateDisplayPreference" TEXT NOT NULL DEFAULT 'locale',
    "timeDisplayPreference" TEXT NOT NULL DEFAULT 'locale',
    "numberDisplayPreference" TEXT NOT NULL DEFAULT 'locale',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationLocaleSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrganizationLocaleSettings_organizationId_key"
ON "OrganizationLocaleSettings"("organizationId");

CREATE TABLE "CustomFieldDefinition" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "dataType" "CustomFieldDataType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "options" JSONB,
    "validation" JSONB,
    "scope" "CustomFieldScope" NOT NULL DEFAULT 'BUSINESS',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomFieldDefinition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomFieldDefinition_organizationId_scope_key_key"
ON "CustomFieldDefinition"("organizationId", "scope", "key");

CREATE INDEX "CustomFieldDefinition_organizationId_scope_displayOrder_idx"
ON "CustomFieldDefinition"("organizationId", "scope", "displayOrder");

CREATE INDEX "CustomFieldDefinition_organizationId_isActive_displayOrder_idx"
ON "CustomFieldDefinition"("organizationId", "isActive", "displayOrder");

CREATE TABLE "ServiceArea" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "countryCode" TEXT,
    "region" TEXT,
    "city" TEXT,
    "postalPrefix" TEXT,
    "isRemote" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceArea_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ServiceArea_organizationId_displayOrder_idx"
ON "ServiceArea"("organizationId", "displayOrder");

CREATE INDEX "ServiceArea_organizationId_isActive_displayOrder_idx"
ON "ServiceArea"("organizationId", "isActive", "displayOrder");

CREATE TABLE "HolidayClosure" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "localDateStart" TEXT NOT NULL,
    "localDateEnd" TEXT,
    "isClosedAllDay" BOOLEAN NOT NULL DEFAULT true,
    "replacementIntervals" JSONB,
    "customerNote" TEXT,
    "internalLabel" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HolidayClosure_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HolidayClosure_organizationId_localDateStart_idx"
ON "HolidayClosure"("organizationId", "localDateStart");

CREATE INDEX "HolidayClosure_organizationId_isActive_localDateStart_idx"
ON "HolidayClosure"("organizationId", "isActive", "localDateStart");

CREATE TABLE "LeadStageDefault" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "classification" "LeadStageClassification" NOT NULL DEFAULT 'NONE',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadStageDefault_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeadStageDefault_organizationId_key_key"
ON "LeadStageDefault"("organizationId", "key");

CREATE INDEX "LeadStageDefault_organizationId_displayOrder_idx"
ON "LeadStageDefault"("organizationId", "displayOrder");

CREATE TABLE "CallDispositionDefault" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "expectsFollowUp" BOOLEAN NOT NULL DEFAULT false,
    "isTerminal" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallDispositionDefault_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CallDispositionDefault_organizationId_key_key"
ON "CallDispositionDefault"("organizationId", "key");

CREATE INDEX "CallDispositionDefault_organizationId_displayOrder_idx"
ON "CallDispositionDefault"("organizationId", "displayOrder");

CREATE TABLE "OrganizationCallbackPolicy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "defaultWindowMinutes" INTEGER NOT NULL DEFAULT 60,
    "maxSuggestedAttempts" INTEGER NOT NULL DEFAULT 3,
    "minSpacingMinutes" INTEGER NOT NULL DEFAULT 120,
    "businessHoursOnly" BOOLEAN NOT NULL DEFAULT true,
    "defaultAssignmentBehavior" "CallbackAssignmentBehavior" NOT NULL DEFAULT 'UNASSIGNED',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationCallbackPolicy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrganizationCallbackPolicy_organizationId_key"
ON "OrganizationCallbackPolicy"("organizationId");

CREATE TABLE "OrganizationRecordingConsentPolicy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "recordingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "transcriptionEnabled" BOOLEAN NOT NULL DEFAULT false,
    "consentCaptureRequired" BOOLEAN NOT NULL DEFAULT true,
    "disclosureTextPlaceholder" TEXT,
    "retentionDays" INTEGER NOT NULL DEFAULT 30,
    "accessDefault" "RecordingAccessDefault" NOT NULL DEFAULT 'ADMINS_ONLY',
    "reviewRequired" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationRecordingConsentPolicy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrganizationRecordingConsentPolicy_organizationId_key"
ON "OrganizationRecordingConsentPolicy"("organizationId");

CREATE TABLE "OrganizationNotificationDefaults" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "escalationContactLabel" TEXT,
    "escalationContactEmail" TEXT,
    "notificationCategories" JSONB NOT NULL DEFAULT '[]',
    "enabledChannels" JSONB NOT NULL DEFAULT '["in_app"]',
    "thresholdPlaceholders" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationNotificationDefaults_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrganizationNotificationDefaults_organizationId_key"
ON "OrganizationNotificationDefaults"("organizationId");

CREATE TABLE "OrganizationConfigProgress" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" "ConfigProgressStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "currentSection" "ConfigSection" NOT NULL DEFAULT 'BUSINESS_TEMPLATE',
    "completedSections" JSONB NOT NULL DEFAULT '[]',
    "updatedByUserId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationConfigProgress_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrganizationConfigProgress_organizationId_key"
ON "OrganizationConfigProgress"("organizationId");

CREATE INDEX "OrganizationConfigProgress_status_idx"
ON "OrganizationConfigProgress"("status");

ALTER TABLE "OrganizationTemplateAssignment"
ADD CONSTRAINT "OrganizationTemplateAssignment_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrganizationTemplateAssignment"
ADD CONSTRAINT "OrganizationTemplateAssignment_selectedByUserId_fkey"
FOREIGN KEY ("selectedByUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OrganizationLocaleSettings"
ADD CONSTRAINT "OrganizationLocaleSettings_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CustomFieldDefinition"
ADD CONSTRAINT "CustomFieldDefinition_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CustomFieldDefinition"
ADD CONSTRAINT "CustomFieldDefinition_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CustomFieldDefinition"
ADD CONSTRAINT "CustomFieldDefinition_updatedByUserId_fkey"
FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ServiceArea"
ADD CONSTRAINT "ServiceArea_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "HolidayClosure"
ADD CONSTRAINT "HolidayClosure_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LeadStageDefault"
ADD CONSTRAINT "LeadStageDefault_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CallDispositionDefault"
ADD CONSTRAINT "CallDispositionDefault_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrganizationCallbackPolicy"
ADD CONSTRAINT "OrganizationCallbackPolicy_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrganizationRecordingConsentPolicy"
ADD CONSTRAINT "OrganizationRecordingConsentPolicy_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrganizationNotificationDefaults"
ADD CONSTRAINT "OrganizationNotificationDefaults_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrganizationConfigProgress"
ADD CONSTRAINT "OrganizationConfigProgress_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrganizationConfigProgress"
ADD CONSTRAINT "OrganizationConfigProgress_updatedByUserId_fkey"
FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
