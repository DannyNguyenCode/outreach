import "server-only";

import {
  Prisma,
  type OfferingBillingFrequency,
  type OfferingPricingModel,
  type OfferingType,
} from "@prisma/client";

import {
  CsvImportCorruptSnapshotError,
  CsvImportNotConfirmableError,
} from "@/lib/orgs/csv-import-access";
import { parseMoneyDecimal } from "@/lib/orgs/money";
import {
  toCanonicalOfferingContent,
  type OfferingBillingFrequencyValue,
  type OfferingPricingModelValue,
  type OfferingTypeValue,
} from "@/lib/orgs/offering-validation";
import type {
  CsvMappedValue,
  CsvMappingTargetFieldId,
} from "@/lib/orgs/tabular-mapping";
import { resolveEffectiveRange } from "@/lib/time/organization-datetime";

const PRICE_DEPENDENT = new Set<OfferingPricingModelValue>([
  "FIXED_ONE_TIME",
  "RECURRING",
]);
const PRICELESS = new Set<OfferingPricingModelValue>([
  "NONE",
  "QUOTE_REQUIRED",
]);

function requireText(
  values: Partial<Record<CsvMappingTargetFieldId, CsvMappedValue>>,
  field: CsvMappingTargetFieldId,
): string {
  const value = values[field];
  if (!value || value.kind !== "text" || !value.value) {
    throw new CsvImportCorruptSnapshotError();
  }
  return value.value;
}

function optionalText(
  values: Partial<Record<CsvMappingTargetFieldId, CsvMappedValue>>,
  field: CsvMappingTargetFieldId,
): string | null {
  const value = values[field];
  if (!value) return null;
  if (value.kind !== "text") {
    throw new CsvImportCorruptSnapshotError();
  }
  return value.value;
}

function requireEnum(
  values: Partial<Record<CsvMappingTargetFieldId, CsvMappedValue>>,
  field: CsvMappingTargetFieldId,
): string {
  const value = values[field];
  if (!value || value.kind !== "enum" || typeof value.value !== "string") {
    throw new CsvImportCorruptSnapshotError();
  }
  return value.value;
}

function optionalDate(
  values: Partial<Record<CsvMappingTargetFieldId, CsvMappedValue>>,
  field: CsvMappingTargetFieldId,
): string | null {
  const value = values[field];
  if (!value) return null;
  if (value.kind !== "date" || typeof value.value !== "string") {
    throw new CsvImportCorruptSnapshotError();
  }
  return value.value;
}

function optionalBoolean(
  values: Partial<Record<CsvMappingTargetFieldId, CsvMappedValue>>,
  field: CsvMappingTargetFieldId,
): boolean | undefined {
  const value = values[field];
  if (!value) return undefined;
  if (value.kind !== "boolean") {
    throw new CsvImportCorruptSnapshotError();
  }
  return value.value;
}

function wallTimeFromDate(value: string | null): string | undefined {
  return value ? `${value}T00:00` : undefined;
}

export async function createActiveOfferingFromCsvRow(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    actorUserId: string;
    confirmedAt: Date;
    confirmationLanguageVersion: string;
    displayOrder: number;
    values: Partial<Record<CsvMappingTargetFieldId, CsvMappedValue>>;
    timeZone: string | null;
    settingsHref: string | null;
  },
): Promise<{ offeringId: string; versionId: string }> {
  const name = requireText(input.values, "offering.name");
  const description = optionalText(input.values, "offering.description");
  const offeringType = requireEnum(input.values, "offering.offeringType");
  const pricingModel = requireEnum(
    input.values,
    "offering.pricingModel",
  ) as OfferingPricingModelValue;
  if (pricingModel === "MULTI_OPTION" || pricingModel === "TIERED") {
    throw new CsvImportCorruptSnapshotError();
  }
  const quoteRequiredMapped = optionalBoolean(
    input.values,
    "offering.quoteRequired",
  );
  const quoteRequired =
    quoteRequiredMapped ?? pricingModel === "QUOTE_REQUIRED";
  if (pricingModel === "QUOTE_REQUIRED" && !quoteRequired) {
    throw new CsvImportCorruptSnapshotError();
  }

  const times = resolveEffectiveRange({
    effectiveFrom: wallTimeFromDate(
      optionalDate(input.values, "offering.effectiveFrom"),
    ),
    effectiveUntil: wallTimeFromDate(
      optionalDate(input.values, "offering.effectiveUntil"),
    ),
    timeZone: input.timeZone,
    settingsHref: input.settingsHref,
  });
  if (!times.ok) {
    throw new CsvImportNotConfirmableError(times.code, times.message);
  }

  const amountValue = input.values["offering.priceAmount"];
  const currencyValue = input.values["offering.priceCurrency"];
  const frequencyValue = input.values["offering.billingFrequency"];
  const prices: Array<{
    amount: Prisma.Decimal;
    currencyCode: string;
    billingFrequency: OfferingBillingFrequencyValue;
    isActive: boolean;
    effectiveFrom: Date | null;
    effectiveUntil: Date | null;
    displayOrder: number;
    clientKey: string;
  }> = [];

  if (PRICE_DEPENDENT.has(pricingModel)) {
    if (
      !amountValue ||
      amountValue.kind !== "decimal" ||
      !currencyValue ||
      currencyValue.kind !== "currency" ||
      !frequencyValue ||
      frequencyValue.kind !== "billing_frequency"
    ) {
      throw new CsvImportCorruptSnapshotError();
    }
    const amount = parseMoneyDecimal(amountValue.value);
    if (!amount) {
      throw new CsvImportCorruptSnapshotError();
    }
    prices.push({
      amount,
      currencyCode: currencyValue.value,
      billingFrequency: frequencyValue.value,
      isActive: true,
      effectiveFrom: times.effectiveFrom,
      effectiveUntil: times.effectiveUntil,
      displayOrder: 0,
      clientKey: "price_1",
    });
  } else if (PRICELESS.has(pricingModel)) {
    if (amountValue || currencyValue || frequencyValue) {
      throw new CsvImportCorruptSnapshotError();
    }
  } else {
    throw new CsvImportCorruptSnapshotError();
  }

  const prepared = toCanonicalOfferingContent({
    name,
    description,
    offeringType: offeringType as OfferingTypeValue,
    pricingModel,
    quoteRequired,
    effectiveFrom: times.effectiveFrom,
    effectiveUntil: times.effectiveUntil,
    displayOrder: input.displayOrder,
    prices,
    features: [],
    variants: [],
    eligibility: null,
    customValues: [],
  });

  const offering = await tx.offering.create({
    data: {
      organizationId: input.organizationId,
      name: prepared.canonical.name,
      offeringType: prepared.canonical.offeringType as OfferingType,
      displayOrder: prepared.canonical.displayOrder,
      createdByUserId: input.actorUserId,
      version: 1,
    },
  });

  const version = await tx.offeringVersion.create({
    data: {
      organizationId: input.organizationId,
      offeringId: offering.id,
      state: "ACTIVE",
      name: prepared.canonical.name,
      description: prepared.canonical.description,
      offeringType: prepared.canonical.offeringType as OfferingType,
      pricingModel: prepared.canonical.pricingModel as OfferingPricingModel,
      quoteRequired: prepared.canonical.quoteRequired,
      contentChecksum: prepared.checksum,
      effectiveFrom: prepared.canonical.effectiveFrom
        ? new Date(prepared.canonical.effectiveFrom)
        : null,
      effectiveUntil: prepared.canonical.effectiveUntil
        ? new Date(prepared.canonical.effectiveUntil)
        : null,
      displayOrder: prepared.canonical.displayOrder,
      createdByUserId: input.actorUserId,
      confirmerUserId: input.actorUserId,
      confirmedAt: input.confirmedAt,
      confirmationLanguageVersion: input.confirmationLanguageVersion,
      draftRevision: 1,
    },
  });

  for (const price of prepared.canonical.prices) {
    await tx.offeringPrice.create({
      data: {
        organizationId: input.organizationId,
        offeringId: offering.id,
        versionId: version.id,
        label: price.label,
        amount: new Prisma.Decimal(price.amount),
        currencyCode: price.currencyCode,
        billingFrequency: price.billingFrequency as OfferingBillingFrequency,
        intervalCount: price.intervalCount,
        isActive: price.isActive,
        effectiveFrom: price.effectiveFrom
          ? new Date(price.effectiveFrom)
          : null,
        effectiveUntil: price.effectiveUntil
          ? new Date(price.effectiveUntil)
          : null,
        displayOrder: price.displayOrder,
      },
    });
  }

  return { offeringId: offering.id, versionId: version.id };
}
