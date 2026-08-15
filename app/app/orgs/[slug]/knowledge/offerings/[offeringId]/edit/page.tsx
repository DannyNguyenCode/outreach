import Link from "next/link";
import { notFound } from "next/navigation";

import { updateOfferingDraftAction } from "@/app/actions/offerings";
import { OfferingEditorForm } from "@/components/orgs/offerings/offering-editor-form";
import { requireVerifiedUser } from "@/lib/auth/session";
import {
  OrganizationAuthError,
  requireOrganizationMemberBySlug,
} from "@/lib/orgs/authorization";
import { getOffering } from "@/lib/orgs/offerings";
import { formatOrganizationWallTime } from "@/lib/time/organization-datetime";

export default async function EditOfferingPage({
  params,
}: {
  params: Promise<{ slug: string; offeringId: string }>;
}) {
  const { slug, offeringId } = await params;
  const user = await requireVerifiedUser({
    returnTo: `/app/orgs/${slug}/knowledge/offerings/${offeringId}/edit`,
  });
  let membership;
  try {
    membership = await requireOrganizationMemberBySlug({ user, slug });
  } catch (error) {
    if (error instanceof OrganizationAuthError) notFound();
    throw error;
  }
  const result = await getOffering({
    actor: user,
    organizationId: membership.organizationId,
    offeringId,
  });
  if (!result.ok || !result.canManage || !result.offering.draft) notFound();
  const draft = result.offering.draft;
  const priceKeys = new Map(
    draft.prices.map((price, index) => [price.id, `price_${index + 1}`]),
  );
  return (
    <div className="space-y-6">
      <Link
        href={`/app/orgs/${slug}/knowledge/offerings/${offeringId}`}
        className="text-sm underline-offset-2 hover:underline"
      >
        ← {result.offering.name}
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">
        Edit offering draft
      </h1>
      <OfferingEditorForm
        organizationSlug={slug}
        action={updateOfferingDraftAction}
        offeringId={offeringId}
        versionId={draft.id}
        expectedDraftRevision={draft.draftRevision}
        defaults={{
          name: draft.name,
          description: draft.description ?? "",
          offeringType: draft.offeringType,
          pricingModel: draft.pricingModel,
          quoteRequired: draft.quoteRequired,
          effectiveFrom: formatOrganizationWallTime(
            draft.effectiveFrom,
            result.organizationTimeZone,
          ).wall,
          effectiveUntil: formatOrganizationWallTime(
            draft.effectiveUntil,
            result.organizationTimeZone,
          ).wall,
          prices: draft.prices.map((price) => ({
            label: price.label,
            amount: price.amount.toFixed(4),
            currencyCode: price.currencyCode,
            billingFrequency: price.billingFrequency,
            intervalCount: price.intervalCount,
            isActive: price.isActive,
            effectiveFrom: price.effectiveFrom?.toISOString() ?? null,
            effectiveUntil: price.effectiveUntil?.toISOString() ?? null,
            clientKey: priceKeys.get(price.id),
          })),
          features: draft.features,
          variants: draft.variants.map((variant) => ({
            name: variant.name,
            sku: variant.sku,
            referenceCode: variant.referenceCode,
            attributes: variant.attributes,
            isActive: variant.isActive,
            displayOrder: variant.displayOrder,
            priceClientKeys: variant.prices
              .map((link) => priceKeys.get(link.priceId))
              .filter(Boolean),
          })),
          eligibility: draft.eligibility,
          customValues: draft.customValues.map((value) => ({
            definitionKey: value.definitionKey,
            value:
              value.stringValue ??
              value.numberValue?.toString() ??
              value.booleanValue ??
              value.dateValue?.toISOString().slice(0, 10) ??
              value.jsonValue,
          })),
        }}
      />
    </div>
  );
}
