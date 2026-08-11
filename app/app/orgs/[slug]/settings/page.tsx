import Link from "next/link";
import { notFound } from "next/navigation";

import { BusinessBasicsForm } from "@/components/orgs/onboarding/business-basics-form";
import { CatalogueManager } from "@/components/orgs/onboarding/catalogue-manager";
import { ContactLocationForm } from "@/components/orgs/onboarding/contact-location-form";
import {
  EmployeeDefaultsForm,
  ReopenOnboardingForm,
} from "@/components/orgs/onboarding/defaults-and-review";
import { OperatingHoursForm } from "@/components/orgs/onboarding/operating-hours-form";
import { requireVerifiedUser } from "@/lib/auth/session";
import { setActiveOrganization } from "@/lib/orgs/active-organization";
import {
  OrganizationAuthError,
  requireOrganizationMemberBySlug,
} from "@/lib/orgs/authorization";
import { getBusinessConfiguration } from "@/lib/orgs/business-profile";
import { listBusinessProducts } from "@/lib/orgs/business-products";
import { listBusinessServices } from "@/lib/orgs/business-services";
import type { DayOfWeekValue } from "@/lib/orgs/business-validation";
import { getOrganizationOnboarding } from "@/lib/orgs/onboarding";
import { getOperatingHours } from "@/lib/orgs/operating-hours";
import { getOrganizationSettings } from "@/lib/orgs/organization-settings";
import { roleHasPermission } from "@/lib/orgs/permissions";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function OrganizationSettingsPage({ params }: PageProps) {
  const { slug } = await params;
  const user = await requireVerifiedUser({
    returnTo: `/app/orgs/${slug}/settings`,
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

  const canUpdate = roleHasPermission(membership.role, "org.business.update");
  const canManageSettings = roleHasPermission(
    membership.role,
    "org.settings.manage",
  );
  const canReopen = roleHasPermission(membership.role, "org.onboarding.reopen");

  const business = await getBusinessConfiguration({
    actor: user,
    organizationId: membership.organizationId,
  });
  const hours = await getOperatingHours({
    actor: user,
    organizationId: membership.organizationId,
  });
  const services = await listBusinessServices({
    actor: user,
    organizationId: membership.organizationId,
  });
  const products = await listBusinessProducts({
    actor: user,
    organizationId: membership.organizationId,
  });
  const settings = canManageSettings
    ? await getOrganizationSettings({
        actor: user,
        organizationId: membership.organizationId,
      })
    : null;
  const onboarding = roleHasPermission(membership.role, "org.onboarding.view")
    ? await getOrganizationOnboarding({
        actor: user,
        organizationId: membership.organizationId,
      })
    : null;

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <p className="text-sm text-[var(--muted)]">
          <Link
            href={`/app/orgs/${slug}`}
            className="underline-offset-2 hover:underline"
          >
            ← {membership.organization.name}
          </Link>
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Organization settings
        </h1>
        <p className="text-sm text-[var(--muted)]">
          Update business configuration after onboarding. Changes are saved
          server-side and remain tenant-scoped.
        </p>
      </div>

      {!business.ok ? (
        <p className="text-sm text-[var(--danger)]">{business.message}</p>
      ) : canUpdate ? (
        <>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Business basics</h2>
            <BusinessBasicsForm
              organizationSlug={slug}
              expectedVersion={business.data.profile.version}
              markStep={false}
              defaults={{
                legalName: business.data.profile.legalName ?? "",
                displayName: business.data.profile.displayName ?? "",
                description: business.data.profile.description ?? "",
                industry: business.data.profile.industry ?? "",
                businessType: business.data.profile.businessType ?? "SERVICES",
                websiteUrl: business.data.profile.websiteUrl ?? "",
                logoUrl: business.data.profile.logoUrl ?? "",
                organizationName: business.data.organizationName,
              }}
            />
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Contact and location</h2>
            <ContactLocationForm
              organizationSlug={slug}
              expectedVersion={business.data.profile.version}
              markStep={false}
              defaults={{
                primaryEmail: business.data.profile.primaryEmail ?? "",
                primaryPhone: business.data.profile.primaryPhoneE164 ?? "",
                preferredContactMethod:
                  business.data.profile.preferredContactMethod ?? "EMAIL",
                timeZone: business.data.profile.timeZone ?? "America/Toronto",
                addressLine1: business.data.location.addressLine1 ?? "",
                addressLine2: business.data.location.addressLine2 ?? "",
                city: business.data.location.city ?? "",
                region: business.data.location.region ?? "",
                postalCode: business.data.location.postalCode ?? "",
                countryCode: business.data.location.countryCode ?? "CA",
              }}
            />
          </section>
        </>
      ) : (
        <section className="space-y-2 text-sm">
          <h2 className="text-lg font-semibold">Business information</h2>
          <p>Display name: {business.data.profile.displayName ?? "—"}</p>
          <p>Industry: {business.data.profile.industry ?? "—"}</p>
          <p>Email: {business.data.profile.primaryEmail ?? "—"}</p>
          <p>Phone: {business.data.profile.primaryPhoneE164 ?? "—"}</p>
          <p>Time zone: {business.data.profile.timeZone ?? "—"}</p>
        </section>
      )}

      {hours.ok && canUpdate ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Operating hours</h2>
          <OperatingHoursForm
            organizationSlug={slug}
            markStep={false}
            customerNote={hours.customerNote ?? ""}
            initial={hours.intervals.map((interval) => ({
              dayOfWeek: interval.dayOfWeek as DayOfWeekValue,
              isClosed: interval.isClosed,
              startMinute: interval.startMinute,
              endMinute: interval.endMinute,
            }))}
          />
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Catalogue</h2>
        <CatalogueManager
          organizationSlug={slug}
          businessType={business.ok ? business.data.profile.businessType : null}
          canManage={roleHasPermission(membership.role, "org.services.manage")}
          markStep={false}
          services={services.ok ? services.services : []}
          products={products.ok ? products.products : []}
        />
      </section>

      {settings?.ok ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Employee defaults</h2>
          <EmployeeDefaultsForm
            organizationSlug={slug}
            expectedVersion={settings.settings.version}
            markStep={false}
            defaults={{
              membersCanViewServices: settings.settings.membersCanViewServices,
              membersCanViewProducts: settings.settings.membersCanViewProducts,
              membersCanViewBusinessInfo:
                settings.settings.membersCanViewBusinessInfo,
              futureCallingAccessDefault:
                settings.settings.futureCallingAccessDefault,
            }}
          />
        </section>
      ) : null}

      {onboarding?.ok &&
      onboarding.onboarding.status === "COMPLETED" &&
      canReopen ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Onboarding</h2>
          <ReopenOnboardingForm
            organizationSlug={slug}
            expectedVersion={onboarding.onboarding.version}
          />
        </section>
      ) : null}
    </div>
  );
}
