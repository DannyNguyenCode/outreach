-- Phase 4C: structured offerings catalog with versioned confirmation,
-- decimal pricing, features, variants, eligibility, and custom values.
-- Forward-only. Phase 0–4B knowledge and catalogue tables remain intact.

ALTER TYPE "OrganizationAuditAction" ADD VALUE 'OFFERING_DRAFT_CREATED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'OFFERING_DRAFT_UPDATED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'OFFERING_REPLACEMENT_DRAFT_CREATED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'OFFERING_PRICE_CHANGED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'OFFERING_VERSION_CONFIRMED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'OFFERING_SUPERSEDED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'OFFERING_ARCHIVED';
ALTER TYPE "OrganizationAuditAction" ADD VALUE 'OFFERING_RESTORED';

CREATE TYPE "OfferingType" AS ENUM (
  'PRODUCT',
  'SERVICE',
  'PLAN',
  'PACKAGE',
  'SUBSCRIPTION',
  'CUSTOM_QUOTE'
);

CREATE TYPE "OfferingPricingModel" AS ENUM (
  'NONE',
  'QUOTE_REQUIRED',
  'FIXED_ONE_TIME',
  'RECURRING',
  'MULTI_OPTION',
  'TIERED'
);

CREATE TYPE "OfferingLifecycleState" AS ENUM (
  'DRAFT',
  'ACTIVE',
  'SUPERSEDED',
  'ARCHIVED'
);

CREATE TYPE "OfferingBillingFrequency" AS ENUM (
  'ONE_TIME',
  'WEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'YEARLY',
  'CUSTOM'
);

CREATE TABLE "Offering" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "offeringType" "OfferingType" NOT NULL,
  "archivedAt" TIMESTAMP(3),
  "archivedByUserId" TEXT,
  "createdByUserId" TEXT,
  "legacyServiceId" TEXT,
  "legacyProductId" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Offering_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OfferingVersion" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "offeringId" TEXT NOT NULL,
  "state" "OfferingLifecycleState" NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "offeringType" "OfferingType" NOT NULL,
  "pricingModel" "OfferingPricingModel" NOT NULL,
  "quoteRequired" BOOLEAN NOT NULL DEFAULT false,
  "contentChecksum" TEXT NOT NULL,
  "effectiveFrom" TIMESTAMPTZ(3),
  "effectiveUntil" TIMESTAMPTZ(3),
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "draftRevision" INTEGER NOT NULL DEFAULT 0,
  "createdByUserId" TEXT,
  "confirmerUserId" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "confirmationLanguageVersion" TEXT,
  "supersedesVersionId" TEXT,
  "restoredFromVersionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OfferingVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OfferingPrice" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "offeringId" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "label" TEXT,
  "amount" DECIMAL(19,4) NOT NULL,
  "currencyCode" CHAR(3) NOT NULL,
  "billingFrequency" "OfferingBillingFrequency" NOT NULL,
  "intervalCount" INTEGER,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "effectiveFrom" TIMESTAMPTZ(3),
  "effectiveUntil" TIMESTAMPTZ(3),
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OfferingPrice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OfferingFeature" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "offeringId" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "featureKey" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "value" TEXT,
  "unit" TEXT,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OfferingFeature_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OfferingVariant" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "offeringId" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sku" TEXT,
  "referenceCode" TEXT,
  "attributes" JSONB NOT NULL DEFAULT '{}',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OfferingVariant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OfferingVariantPrice" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "offeringId" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "variantId" TEXT NOT NULL,
  "priceId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OfferingVariantPrice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OfferingEligibility" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "offeringId" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "description" TEXT,
  "availabilityRestrictions" TEXT,
  "qualificationNotes" TEXT,
  "geographicNotes" TEXT,
  "minimumQuantity" INTEGER,
  "maximumQuantity" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OfferingEligibility_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OfferingCustomValue" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "offeringId" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "definitionId" TEXT NOT NULL,
  "definitionKey" TEXT NOT NULL,
  "stringValue" TEXT,
  "numberValue" DECIMAL(19,4),
  "booleanValue" BOOLEAN,
  "dateValue" TIMESTAMPTZ(3),
  "jsonValue" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OfferingCustomValue_pkey" PRIMARY KEY ("id")
);

-- CustomFieldDefinition composite identity for tenant-safe value FKs.
CREATE UNIQUE INDEX "CustomFieldDefinition_id_organizationId_key"
ON "CustomFieldDefinition"("id", "organizationId");

CREATE UNIQUE INDEX "Offering_id_organizationId_key" ON "Offering"("id", "organizationId");
CREATE UNIQUE INDEX "Offering_organizationId_legacyServiceId_key" ON "Offering"("organizationId", "legacyServiceId");
CREATE UNIQUE INDEX "Offering_organizationId_legacyProductId_key" ON "Offering"("organizationId", "legacyProductId");
CREATE INDEX "Offering_organizationId_archivedAt_displayOrder_idx" ON "Offering"("organizationId", "archivedAt", "displayOrder");
CREATE INDEX "Offering_organizationId_offeringType_idx" ON "Offering"("organizationId", "offeringType");
CREATE INDEX "Offering_organizationId_name_idx" ON "Offering"("organizationId", "name");

CREATE UNIQUE INDEX "OfferingVersion_id_organizationId_key" ON "OfferingVersion"("id", "organizationId");
CREATE UNIQUE INDEX "OfferingVersion_id_organizationId_offeringId_key" ON "OfferingVersion"("id", "organizationId", "offeringId");
CREATE INDEX "OfferingVersion_organizationId_state_idx" ON "OfferingVersion"("organizationId", "state");
CREATE INDEX "OfferingVersion_offeringId_state_idx" ON "OfferingVersion"("offeringId", "state");
CREATE INDEX "OfferingVersion_organizationId_state_effectiveFrom_idx" ON "OfferingVersion"("organizationId", "state", "effectiveFrom");
CREATE INDEX "OfferingVersion_contentChecksum_idx" ON "OfferingVersion"("contentChecksum");

CREATE UNIQUE INDEX "OfferingVersion_offeringId_active_key"
ON "OfferingVersion" ("offeringId")
WHERE "state" = 'ACTIVE';

CREATE UNIQUE INDEX "OfferingVersion_offeringId_draft_key"
ON "OfferingVersion" ("offeringId")
WHERE "state" = 'DRAFT';

CREATE UNIQUE INDEX "OfferingPrice_id_organizationId_offeringId_versionId_key"
ON "OfferingPrice"("id", "organizationId", "offeringId", "versionId");
CREATE INDEX "OfferingPrice_organizationId_versionId_isActive_displayOrder_idx"
ON "OfferingPrice"("organizationId", "versionId", "isActive", "displayOrder");
CREATE INDEX "OfferingPrice_organizationId_versionId_effectiveFrom_idx"
ON "OfferingPrice"("organizationId", "versionId", "effectiveFrom");

CREATE UNIQUE INDEX "OfferingFeature_versionId_featureKey_key" ON "OfferingFeature"("versionId", "featureKey");
CREATE UNIQUE INDEX "OfferingFeature_versionId_displayOrder_key" ON "OfferingFeature"("versionId", "displayOrder");
CREATE UNIQUE INDEX "OfferingFeature_id_organizationId_offeringId_versionId_key"
ON "OfferingFeature"("id", "organizationId", "offeringId", "versionId");
CREATE INDEX "OfferingFeature_organizationId_versionId_displayOrder_idx"
ON "OfferingFeature"("organizationId", "versionId", "displayOrder");

CREATE UNIQUE INDEX "OfferingVariant_versionId_displayOrder_key" ON "OfferingVariant"("versionId", "displayOrder");
CREATE UNIQUE INDEX "OfferingVariant_id_organizationId_offeringId_versionId_key"
ON "OfferingVariant"("id", "organizationId", "offeringId", "versionId");
CREATE INDEX "OfferingVariant_organizationId_versionId_isActive_displayOrder_idx"
ON "OfferingVariant"("organizationId", "versionId", "isActive", "displayOrder");

CREATE UNIQUE INDEX "OfferingVariant_versionId_sku_key"
ON "OfferingVariant" ("versionId", "sku")
WHERE "sku" IS NOT NULL;

CREATE UNIQUE INDEX "OfferingVariantPrice_variantId_priceId_key"
ON "OfferingVariantPrice"("variantId", "priceId");
CREATE INDEX "OfferingVariantPrice_organizationId_versionId_idx"
ON "OfferingVariantPrice"("organizationId", "versionId");

CREATE UNIQUE INDEX "OfferingEligibility_versionId_key" ON "OfferingEligibility"("versionId");
CREATE UNIQUE INDEX "OfferingEligibility_versionId_organizationId_offeringId_key"
ON "OfferingEligibility"("versionId", "organizationId", "offeringId");
CREATE UNIQUE INDEX "OfferingEligibility_id_organizationId_offeringId_versionId_key"
ON "OfferingEligibility"("id", "organizationId", "offeringId", "versionId");
CREATE INDEX "OfferingEligibility_organizationId_versionId_idx"
ON "OfferingEligibility"("organizationId", "versionId");

CREATE UNIQUE INDEX "OfferingCustomValue_versionId_definitionId_key"
ON "OfferingCustomValue"("versionId", "definitionId");
CREATE UNIQUE INDEX "OfferingCustomValue_versionId_definitionKey_key"
ON "OfferingCustomValue"("versionId", "definitionKey");
CREATE INDEX "OfferingCustomValue_organizationId_versionId_idx"
ON "OfferingCustomValue"("organizationId", "versionId");
CREATE INDEX "OfferingCustomValue_organizationId_definitionId_idx"
ON "OfferingCustomValue"("organizationId", "definitionId");

ALTER TABLE "Offering"
  ADD CONSTRAINT "Offering_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Offering"
  ADD CONSTRAINT "Offering_archivedByUserId_fkey"
  FOREIGN KEY ("archivedByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Offering"
  ADD CONSTRAINT "Offering_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Offering"
  ADD CONSTRAINT "Offering_legacyServiceId_fkey"
  FOREIGN KEY ("legacyServiceId") REFERENCES "BusinessService"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Offering"
  ADD CONSTRAINT "Offering_legacyProductId_fkey"
  FOREIGN KEY ("legacyProductId") REFERENCES "BusinessProduct"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OfferingVersion"
  ADD CONSTRAINT "OfferingVersion_offering_fkey"
  FOREIGN KEY ("offeringId", "organizationId") REFERENCES "Offering"("id", "organizationId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OfferingVersion"
  ADD CONSTRAINT "OfferingVersion_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OfferingVersion"
  ADD CONSTRAINT "OfferingVersion_confirmerUserId_fkey"
  FOREIGN KEY ("confirmerUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OfferingVersion"
  ADD CONSTRAINT "OfferingVersion_supersedes_fkey"
  FOREIGN KEY ("supersedesVersionId", "organizationId", "offeringId")
  REFERENCES "OfferingVersion"("id", "organizationId", "offeringId")
  ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "OfferingVersion"
  ADD CONSTRAINT "OfferingVersion_restoredFrom_fkey"
  FOREIGN KEY ("restoredFromVersionId", "organizationId", "offeringId")
  REFERENCES "OfferingVersion"("id", "organizationId", "offeringId")
  ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "OfferingPrice"
  ADD CONSTRAINT "OfferingPrice_version_fkey"
  FOREIGN KEY ("versionId", "organizationId", "offeringId")
  REFERENCES "OfferingVersion"("id", "organizationId", "offeringId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OfferingFeature"
  ADD CONSTRAINT "OfferingFeature_version_fkey"
  FOREIGN KEY ("versionId", "organizationId", "offeringId")
  REFERENCES "OfferingVersion"("id", "organizationId", "offeringId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OfferingVariant"
  ADD CONSTRAINT "OfferingVariant_version_fkey"
  FOREIGN KEY ("versionId", "organizationId", "offeringId")
  REFERENCES "OfferingVersion"("id", "organizationId", "offeringId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OfferingVariantPrice"
  ADD CONSTRAINT "OfferingVariantPrice_variant_fkey"
  FOREIGN KEY ("variantId", "organizationId", "offeringId", "versionId")
  REFERENCES "OfferingVariant"("id", "organizationId", "offeringId", "versionId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OfferingVariantPrice"
  ADD CONSTRAINT "OfferingVariantPrice_price_fkey"
  FOREIGN KEY ("priceId", "organizationId", "offeringId", "versionId")
  REFERENCES "OfferingPrice"("id", "organizationId", "offeringId", "versionId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OfferingEligibility"
  ADD CONSTRAINT "OfferingEligibility_version_fkey"
  FOREIGN KEY ("versionId", "organizationId", "offeringId")
  REFERENCES "OfferingVersion"("id", "organizationId", "offeringId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OfferingCustomValue"
  ADD CONSTRAINT "OfferingCustomValue_version_fkey"
  FOREIGN KEY ("versionId", "organizationId", "offeringId")
  REFERENCES "OfferingVersion"("id", "organizationId", "offeringId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OfferingCustomValue"
  ADD CONSTRAINT "OfferingCustomValue_definition_fkey"
  FOREIGN KEY ("definitionId", "organizationId")
  REFERENCES "CustomFieldDefinition"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OfferingVersion"
  ADD CONSTRAINT "OfferingVersion_effective_range_check"
  CHECK (
    "effectiveUntil" IS NULL
    OR "effectiveFrom" IS NULL
    OR "effectiveUntil" > "effectiveFrom"
  );

ALTER TABLE "OfferingVersion"
  ADD CONSTRAINT "OfferingVersion_confirmation_consistency_check"
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

ALTER TABLE "OfferingVersion"
  ADD CONSTRAINT "OfferingVersion_state_confirmation_check"
  CHECK (
    (
      "state" IN ('ACTIVE', 'SUPERSEDED')
      AND "confirmerUserId" IS NOT NULL
      AND "confirmedAt" IS NOT NULL
      AND "confirmationLanguageVersion" IS NOT NULL
    )
    OR (
      "state" IN ('DRAFT', 'ARCHIVED')
      AND (
        ("state" = 'DRAFT' AND "confirmerUserId" IS NULL AND "confirmedAt" IS NULL AND "confirmationLanguageVersion" IS NULL)
        OR ("state" = 'ARCHIVED')
      )
    )
  );

ALTER TABLE "OfferingPrice"
  ADD CONSTRAINT "OfferingPrice_effective_range_check"
  CHECK (
    "effectiveUntil" IS NULL
    OR "effectiveFrom" IS NULL
    OR "effectiveUntil" > "effectiveFrom"
  );

ALTER TABLE "OfferingPrice"
  ADD CONSTRAINT "OfferingPrice_amount_non_negative_check"
  CHECK ("amount" >= 0);

ALTER TABLE "OfferingPrice"
  ADD CONSTRAINT "OfferingPrice_currency_check"
  CHECK ("currencyCode" ~ '^[A-Z]{3}$');

ALTER TABLE "OfferingPrice"
  ADD CONSTRAINT "OfferingPrice_interval_check"
  CHECK (
    "intervalCount" IS NULL
    OR "intervalCount" >= 1
  );

ALTER TABLE "OfferingEligibility"
  ADD CONSTRAINT "OfferingEligibility_quantity_check"
  CHECK (
    ("minimumQuantity" IS NULL OR "minimumQuantity" >= 0)
    AND ("maximumQuantity" IS NULL OR "maximumQuantity" >= 0)
    AND (
      "minimumQuantity" IS NULL
      OR "maximumQuantity" IS NULL
      OR "maximumQuantity" >= "minimumQuantity"
    )
  );

-- Backfill DRAFT offerings from Phase 3 operational catalogues (never ACTIVE).
INSERT INTO "Offering" (
  "id",
  "organizationId",
  "name",
  "offeringType",
  "createdByUserId",
  "legacyServiceId",
  "legacyProductId",
  "version",
  "displayOrder",
  "createdAt",
  "updatedAt"
)
SELECT
  'svc_' || s."id",
  s."organizationId",
  s."name",
  'SERVICE'::"OfferingType",
  NULL,
  s."id",
  NULL,
  0,
  s."displayOrder",
  s."createdAt",
  s."updatedAt"
FROM "BusinessService" s;

INSERT INTO "OfferingVersion" (
  "id",
  "organizationId",
  "offeringId",
  "state",
  "name",
  "description",
  "offeringType",
  "pricingModel",
  "quoteRequired",
  "contentChecksum",
  "displayOrder",
  "draftRevision",
  "createdAt",
  "updatedAt"
)
SELECT
  'svcv_' || s."id",
  s."organizationId",
  'svc_' || s."id",
  'DRAFT'::"OfferingLifecycleState",
  s."name",
  s."description",
  'SERVICE'::"OfferingType",
  CASE
    WHEN s."priceDescription" IS NULL OR btrim(s."priceDescription") = '' THEN 'NONE'::"OfferingPricingModel"
    ELSE 'QUOTE_REQUIRED'::"OfferingPricingModel"
  END,
  CASE
    WHEN s."priceDescription" IS NULL OR btrim(s."priceDescription") = '' THEN false
    ELSE true
  END,
  encode(sha256(convert_to(s."name" || E'\n' || coalesce(s."description", '') || E'\n' || coalesce(s."priceDescription", ''), 'UTF8')), 'hex'),
  s."displayOrder",
  0,
  s."createdAt",
  s."updatedAt"
FROM "BusinessService" s;

INSERT INTO "Offering" (
  "id",
  "organizationId",
  "name",
  "offeringType",
  "createdByUserId",
  "legacyServiceId",
  "legacyProductId",
  "version",
  "displayOrder",
  "createdAt",
  "updatedAt"
)
SELECT
  'prd_' || p."id",
  p."organizationId",
  p."name",
  'PRODUCT'::"OfferingType",
  NULL,
  NULL,
  p."id",
  0,
  p."displayOrder",
  p."createdAt",
  p."updatedAt"
FROM "BusinessProduct" p;

INSERT INTO "OfferingVersion" (
  "id",
  "organizationId",
  "offeringId",
  "state",
  "name",
  "description",
  "offeringType",
  "pricingModel",
  "quoteRequired",
  "contentChecksum",
  "displayOrder",
  "draftRevision",
  "createdAt",
  "updatedAt"
)
SELECT
  'prdv_' || p."id",
  p."organizationId",
  'prd_' || p."id",
  'DRAFT'::"OfferingLifecycleState",
  p."name",
  p."description",
  'PRODUCT'::"OfferingType",
  CASE
    WHEN p."priceDescription" IS NULL OR btrim(p."priceDescription") = '' THEN 'NONE'::"OfferingPricingModel"
    ELSE 'QUOTE_REQUIRED'::"OfferingPricingModel"
  END,
  CASE
    WHEN p."priceDescription" IS NULL OR btrim(p."priceDescription") = '' THEN false
    ELSE true
  END,
  encode(sha256(convert_to(p."name" || E'\n' || coalesce(p."description", '') || E'\n' || coalesce(p."priceDescription", ''), 'UTF8')), 'hex'),
  p."displayOrder",
  0,
  p."createdAt",
  p."updatedAt"
FROM "BusinessProduct" p;
