import type { PrismaClient } from "@prisma/client";

import type { SafeUser } from "@/lib/auth/users";
import {
  confirmOfferingVersion,
  createOfferingDraft,
} from "@/lib/orgs/offerings";
import {
  addMember,
  createGate,
  createOrgWithOwner,
} from "@/tests/integration/helpers/knowledge";

export { addMember, createGate, createOrgWithOwner };

export const SAMPLE_OFFERING = {
  name: "Premium plan",
  description: "A customer-confirmed recurring plan.",
  offeringType: "PLAN",
  pricingModel: "RECURRING",
  quoteRequired: false,
  effectiveFrom: null,
  effectiveUntil: null,
  prices: [
    {
      amount: "49.00",
      currencyCode: "CAD",
      billingFrequency: "MONTHLY",
      isActive: true,
      clientKey: "monthly",
    },
  ],
  features: [
    {
      featureKey: "storage",
      name: "Storage",
      value: "10",
      unit: "GB",
    },
  ],
  variants: [],
  customValues: [],
};

export async function createSampleOfferingDraft(
  actor: SafeUser,
  organizationId: string,
  raw: Record<string, unknown> = {},
) {
  const result = await createOfferingDraft({
    actor,
    organizationId,
    raw: { ...SAMPLE_OFFERING, ...raw },
  });
  if (!result.ok) throw new Error(result.message);
  return result;
}

export async function confirmSampleOffering(
  actor: SafeUser,
  organizationId: string,
  draft: Awaited<ReturnType<typeof createSampleOfferingDraft>>,
) {
  const result = await confirmOfferingVersion({
    actor,
    organizationId,
    raw: {
      offeringId: draft.offering.id,
      versionId: draft.version.id,
      expectedDraftRevision: draft.version.draftRevision,
      expectedChecksum: draft.version.contentChecksum,
      confirmAccuracy: "on",
    },
  });
  if (!result.ok) throw new Error(result.message);
  return result;
}

export async function countOfferingAudits(
  prisma: PrismaClient,
  organizationId: string,
) {
  return prisma.organizationAuditEvent.count({
    where: {
      organizationId,
      action: {
        in: [
          "OFFERING_DRAFT_CREATED",
          "OFFERING_DRAFT_UPDATED",
          "OFFERING_REPLACEMENT_DRAFT_CREATED",
          "OFFERING_PRICE_CHANGED",
          "OFFERING_VERSION_CONFIRMED",
          "OFFERING_SUPERSEDED",
          "OFFERING_ARCHIVED",
          "OFFERING_RESTORED",
        ],
      },
    },
  });
}
