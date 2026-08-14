import Link from "next/link";
import { notFound } from "next/navigation";

import { createOfferingDraftAction } from "@/app/actions/offerings";
import { OfferingEditorForm } from "@/components/orgs/offerings/offering-editor-form";
import { requireVerifiedUser } from "@/lib/auth/session";
import { setActiveOrganization } from "@/lib/orgs/active-organization";
import {
  OrganizationAuthError,
  requireOrganizationMemberBySlug,
} from "@/lib/orgs/authorization";
import { roleHasPermission } from "@/lib/orgs/permissions";

export default async function NewOfferingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await requireVerifiedUser({
    returnTo: `/app/orgs/${slug}/knowledge/offerings/new`,
  });
  let membership;
  try {
    membership = await requireOrganizationMemberBySlug({ user, slug });
  } catch (error) {
    if (error instanceof OrganizationAuthError) notFound();
    throw error;
  }
  if (!roleHasPermission(membership.role, "org.knowledge.manage")) notFound();
  await setActiveOrganization({
    user,
    organizationId: membership.organizationId,
  });
  return (
    <div className="space-y-6">
      <Link
        href={`/app/orgs/${slug}/knowledge/offerings`}
        className="text-sm underline-offset-2 hover:underline"
      >
        ← Offerings
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          New offering draft
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Drafts remain private until an authorized customer confirms the exact
          version.
        </p>
      </div>
      <OfferingEditorForm
        organizationSlug={slug}
        action={createOfferingDraftAction}
        defaults={{
          name: "",
          description: "",
          offeringType: "PLAN",
          pricingModel: "RECURRING",
          quoteRequired: false,
          effectiveFrom: "",
          effectiveUntil: "",
          prices: [
            {
              amount: "0",
              currencyCode: "USD",
              billingFrequency: "MONTHLY",
              isActive: true,
              clientKey: "price_1",
            },
          ],
          features: [],
          variants: [],
          eligibility: null,
          customValues: [],
        }}
      />
    </div>
  );
}
