import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { enumToStepPath } from "@/components/orgs/onboarding/onboarding-progress";
import { requireVerifiedUser } from "@/lib/auth/session";
import { setActiveOrganization } from "@/lib/orgs/active-organization";
import {
  OrganizationAuthError,
  requireOrganizationMemberBySlug,
} from "@/lib/orgs/authorization";
import { getOrganizationOnboarding } from "@/lib/orgs/onboarding";
import { roleHasPermission } from "@/lib/orgs/permissions";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function OnboardingEntryPage({ params }: PageProps) {
  const { slug } = await params;
  const user = await requireVerifiedUser({
    returnTo: `/app/orgs/${slug}/onboarding`,
  });

  let membership;
  try {
    membership = await requireOrganizationMemberBySlug({ user, slug });
  } catch (error) {
    if (error instanceof OrganizationAuthError) {
      notFound();
    }
    throw error;
  }

  await setActiveOrganization({
    user,
    organizationId: membership.organizationId,
  });

  if (!roleHasPermission(membership.role, "org.onboarding.view")) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Onboarding</h1>
        <p className="text-sm text-[var(--muted)]">
          Onboarding progress is limited to owners and admins. You can view
          business information from organization settings when permitted.
        </p>
        <Link
          href={`/app/orgs/${slug}`}
          className="text-sm underline-offset-2 hover:underline"
        >
          ← Back to organization
        </Link>
      </div>
    );
  }

  const onboarding = await getOrganizationOnboarding({
    actor: user,
    organizationId: membership.organizationId,
  });

  if (!onboarding.ok) {
    notFound();
  }

  redirect(
    `/app/orgs/${slug}/onboarding/${enumToStepPath(onboarding.onboarding.currentStep)}`,
  );
}
