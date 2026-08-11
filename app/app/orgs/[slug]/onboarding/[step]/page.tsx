import Link from "next/link";
import { notFound } from "next/navigation";

import { BusinessBasicsForm } from "@/components/orgs/onboarding/business-basics-form";
import { CatalogueManager } from "@/components/orgs/onboarding/catalogue-manager";
import { ContactLocationForm } from "@/components/orgs/onboarding/contact-location-form";
import {
  CompleteOnboardingForm,
  EmployeeDefaultsForm,
  ReopenOnboardingForm,
} from "@/components/orgs/onboarding/defaults-and-review";
import { OnboardingShell } from "@/components/orgs/onboarding/onboarding-shell";
import { OperatingHoursForm } from "@/components/orgs/onboarding/operating-hours-form";
import { StartOnboardingForm } from "@/components/orgs/onboarding/start-onboarding-form";
import { stepPathToEnum } from "@/components/orgs/onboarding/onboarding-progress";
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
import { minutesToTimeString } from "@/lib/orgs/business-validation";
import { getOrganizationOnboarding } from "@/lib/orgs/onboarding";
import { getOperatingHours } from "@/lib/orgs/operating-hours";
import { getOrganizationSettings } from "@/lib/orgs/organization-settings";
import type { OnboardingView } from "@/lib/orgs/onboarding";
import type { BusinessConfiguration } from "@/lib/orgs/business-profile";
import { roleHasPermission } from "@/lib/orgs/permissions";

type PageProps = {
  params: Promise<{ slug: string; step: string }>;
};

export default async function OnboardingStepPage({ params }: PageProps) {
  const { slug, step: stepParam } = await params;
  const step = stepPathToEnum(stepParam);
  if (!step) {
    notFound();
  }

  const user = await requireVerifiedUser({
    returnTo: `/app/orgs/${slug}/onboarding/${stepParam}`,
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
        <h1 className="text-2xl font-semibold">Onboarding unavailable</h1>
        <p className="text-sm text-[var(--muted)]">
          Your role cannot view onboarding progress.
        </p>
        <Link href={`/app/orgs/${slug}`} className="text-sm underline">
          Back
        </Link>
      </div>
    );
  }

  const onboardingResult = await getOrganizationOnboarding({
    actor: user,
    organizationId: membership.organizationId,
  });
  if (!onboardingResult.ok) {
    if (onboardingResult.reason === "not_started") {
      return (
        <div className="space-y-4">
          <h1 className="text-2xl font-semibold tracking-tight">
            Business onboarding
          </h1>
          {roleHasPermission(membership.role, "org.onboarding.manage") ? (
            <StartOnboardingForm organizationSlug={slug} />
          ) : (
            <p className="text-sm text-[var(--muted)]">
              Onboarding has not been started yet.
            </p>
          )}
        </div>
      );
    }
    notFound();
  }

  const canManage = roleHasPermission(membership.role, "org.onboarding.manage");
  const business = await getBusinessConfiguration({
    actor: user,
    organizationId: membership.organizationId,
  });

  return (
    <OnboardingShell
      slug={slug}
      orgName={membership.organization.name}
      onboarding={onboardingResult.onboarding}
    >
      {step === "BUSINESS_BASICS" && business.ok && canManage ? (
        <BusinessBasicsForm
          organizationSlug={slug}
          expectedVersion={business.data.profile.version}
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
      ) : null}

      {step === "CONTACT_LOCATION" && business.ok && canManage ? (
        <ContactLocationForm
          organizationSlug={slug}
          expectedVersion={business.data.profile.version}
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
      ) : null}

      {step === "OPERATING_HOURS" && canManage ? (
        <HoursStep
          slug={slug}
          organizationId={membership.organizationId}
          user={user}
        />
      ) : null}

      {step === "CATALOGUE" ? (
        <CatalogueStep
          slug={slug}
          organizationId={membership.organizationId}
          user={user}
          businessType={business.ok ? business.data.profile.businessType : null}
          canManage={canManage}
        />
      ) : null}

      {step === "EMPLOYEE_DEFAULTS" && canManage ? (
        <DefaultsStep
          slug={slug}
          organizationId={membership.organizationId}
          user={user}
        />
      ) : null}

      {step === "REVIEW" ? (
        <ReviewStep
          slug={slug}
          organizationId={membership.organizationId}
          user={user}
          canManage={canManage}
          canReopen={roleHasPermission(
            membership.role,
            "org.onboarding.reopen",
          )}
          onboarding={onboardingResult.onboarding}
          business={business.ok ? business.data : null}
        />
      ) : null}

      {!canManage && step !== "REVIEW" && step !== "CATALOGUE" ? (
        <p className="text-sm text-[var(--muted)]">
          You can view progress, but only owners and admins can edit
          configuration.
        </p>
      ) : null}
    </OnboardingShell>
  );
}

async function HoursStep({
  slug,
  organizationId,
  user,
}: {
  slug: string;
  organizationId: string;
  user: Awaited<ReturnType<typeof requireVerifiedUser>>;
}) {
  const hours = await getOperatingHours({ actor: user, organizationId });
  if (!hours.ok) {
    return <p className="text-sm text-[var(--danger)]">{hours.message}</p>;
  }

  return (
    <OperatingHoursForm
      organizationSlug={slug}
      customerNote={hours.customerNote ?? ""}
      initial={hours.intervals.map((interval) => ({
        dayOfWeek: interval.dayOfWeek as DayOfWeekValue,
        isClosed: interval.isClosed,
        startMinute: interval.startMinute,
        endMinute: interval.endMinute,
      }))}
    />
  );
}

async function CatalogueStep({
  slug,
  organizationId,
  user,
  businessType,
  canManage,
}: {
  slug: string;
  organizationId: string;
  user: Awaited<ReturnType<typeof requireVerifiedUser>>;
  businessType: string | null;
  canManage: boolean;
}) {
  const [services, products] = await Promise.all([
    listBusinessServices({ actor: user, organizationId }),
    listBusinessProducts({ actor: user, organizationId }),
  ]);

  return (
    <CatalogueManager
      organizationSlug={slug}
      businessType={businessType}
      canManage={canManage}
      services={services.ok ? services.services : []}
      products={products.ok ? products.products : []}
    />
  );
}

async function DefaultsStep({
  slug,
  organizationId,
  user,
}: {
  slug: string;
  organizationId: string;
  user: Awaited<ReturnType<typeof requireVerifiedUser>>;
}) {
  const settings = await getOrganizationSettings({
    actor: user,
    organizationId,
  });
  if (!settings.ok) {
    return <p className="text-sm text-[var(--danger)]">{settings.message}</p>;
  }

  return (
    <EmployeeDefaultsForm
      organizationSlug={slug}
      expectedVersion={settings.settings.version}
      defaults={{
        membersCanViewServices: settings.settings.membersCanViewServices,
        membersCanViewProducts: settings.settings.membersCanViewProducts,
        membersCanViewBusinessInfo:
          settings.settings.membersCanViewBusinessInfo,
        futureCallingAccessDefault:
          settings.settings.futureCallingAccessDefault,
      }}
    />
  );
}

async function ReviewStep({
  slug,
  organizationId,
  user,
  canManage,
  canReopen,
  onboarding,
  business,
}: {
  slug: string;
  organizationId: string;
  user: Awaited<ReturnType<typeof requireVerifiedUser>>;
  canManage: boolean;
  canReopen: boolean;
  onboarding: OnboardingView;
  business: BusinessConfiguration | null;
}) {
  const hours = await getOperatingHours({ actor: user, organizationId });
  const services = await listBusinessServices({ actor: user, organizationId });
  const products = await listBusinessProducts({ actor: user, organizationId });

  return (
    <div className="space-y-6">
      {onboarding.status === "COMPLETED" ? (
        <div
          role="status"
          className="rounded-sm border border-[var(--border)] bg-[var(--surface)] p-4 text-sm"
        >
          <p className="font-medium">Onboarding completed</p>
          <p className="mt-1 text-[var(--muted)]">
            Completed{" "}
            {onboarding.completedAt
              ? onboarding.completedAt.toISOString()
              : "previously"}
            . Configuration readiness:{" "}
            {onboarding.isConfigurationReady ? "ready" : "needs attention"}.
          </p>
        </div>
      ) : null}

      <section className="space-y-2 text-sm">
        <h2 className="text-lg font-semibold">Current configuration</h2>
        {business ? (
          <dl className="grid gap-2 sm:grid-cols-2">
            <div>
              <dt className="text-[var(--muted)]">Display name</dt>
              <dd>{business.profile.displayName ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Industry</dt>
              <dd>{business.profile.industry ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Business type</dt>
              <dd>{business.profile.businessType ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Time zone</dt>
              <dd>{business.profile.timeZone ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Email</dt>
              <dd>{business.profile.primaryEmail ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Phone</dt>
              <dd>{business.profile.primaryPhoneE164 ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Country</dt>
              <dd>{business.location.countryCode ?? "—"}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-[var(--muted)]">Business profile unavailable.</p>
        )}
      </section>

      <section className="space-y-2 text-sm">
        <h2 className="text-lg font-semibold">Operating hours</h2>
        {hours.ok ? (
          <ul className="space-y-1">
            {hours.intervals.map((interval) => (
              <li key={interval.id}>
                <span className="capitalize">
                  {interval.dayOfWeek.toLowerCase()}
                </span>
                :{" "}
                {interval.isClosed
                  ? "Closed"
                  : `${minutesToTimeString(interval.startMinute ?? 0)}–${
                      interval.endMinute === 1440
                        ? "24:00"
                        : minutesToTimeString(interval.endMinute ?? 0)
                    }`}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[var(--muted)]">No hours configured.</p>
        )}
      </section>

      <section className="space-y-2 text-sm">
        <h2 className="text-lg font-semibold">Catalogue</h2>
        <p>
          Active services:{" "}
          {services.ok ? services.services.filter((s) => s.isActive).length : 0}
        </p>
        <p>
          Active products:{" "}
          {products.ok ? products.products.filter((p) => p.isActive).length : 0}
        </p>
      </section>

      {canManage && onboarding.status !== "COMPLETED" ? (
        <CompleteOnboardingForm
          organizationSlug={slug}
          expectedVersion={onboarding.version}
          missing={onboarding.readiness.missing}
          ready={onboarding.readiness.ready}
        />
      ) : null}

      {canReopen && onboarding.status === "COMPLETED" ? (
        <ReopenOnboardingForm
          organizationSlug={slug}
          expectedVersion={onboarding.version}
        />
      ) : null}
    </div>
  );
}
