"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import type { ActionState } from "@/app/actions/auth-state";
import {
  buildRateLimitBucketKey,
  enforceRateLimit,
  resolveClientIp,
  type RateLimitRoute,
} from "@/lib/auth/rate-limit";
import { requireVerifiedUser } from "@/lib/auth/session";
import { getServerEnv } from "@/lib/env/server";
import {
  OrganizationAuthError,
  requireOrganizationMemberBySlug,
} from "@/lib/orgs/authorization";
import {
  updateBusinessBasics,
  updateContactAndLocation,
} from "@/lib/orgs/business-profile";
import {
  createBusinessProduct,
  deactivateBusinessProduct,
  reorderBusinessProducts,
  updateBusinessProduct,
} from "@/lib/orgs/business-products";
import {
  createBusinessService,
  deactivateBusinessService,
  reorderBusinessServices,
  updateBusinessService,
} from "@/lib/orgs/business-services";
import { replaceOperatingHours } from "@/lib/orgs/operating-hours";
import {
  advanceOnboardingStep,
  completeOrganizationOnboarding,
  reopenOrganizationOnboarding,
  startOrganizationOnboarding,
} from "@/lib/orgs/onboarding";
import { updateOrganizationSettings } from "@/lib/orgs/organization-settings";
import { requireExpectedVersion } from "@/lib/orgs/business-validation";
import { prisma } from "@/lib/prisma";

function parseRequiredExpectedVersion(
  formData: FormData,
  fieldName = "expectedVersion",
): { ok: true; version: number } | ActionState {
  const parsed = requireExpectedVersion(formData.get(fieldName));
  if (!parsed.ok) {
    return {
      status: "error",
      message: parsed.message,
      fieldErrors: { [fieldName]: [parsed.message] },
    };
  }
  return { ok: true, version: parsed.version };
}

async function rateLimitOrReject(
  route: RateLimitRoute,
  missingIpSalt: string,
): Promise<ActionState | null> {
  const headerStore = await headers();
  const env = getServerEnv();
  const trustedProxy =
    env.NODE_ENV === "production" || Boolean(env.AUTH_TRUST_HOST);
  const ip = resolveClientIp(headerStore, trustedProxy);

  const bucketKey = buildRateLimitBucketKey({
    route,
    emailNormalized: null,
    ip,
    missingIpSalt,
  });

  const decision = await enforceRateLimit(prisma, { route, bucketKey });
  if (!decision.ok) {
    return {
      status: "rate_limited",
      message: "Too many requests. Please try again later.",
    };
  }
  return null;
}

async function resolveOrgFromForm(formData: FormData) {
  const slug = String(formData.get("organizationSlug") ?? "");
  const user = await requireVerifiedUser({
    returnTo: slug ? `/app/orgs/${slug}/onboarding` : "/app",
  });

  let membership;
  try {
    membership = await requireOrganizationMemberBySlug({ user, slug });
  } catch (error) {
    if (error instanceof OrganizationAuthError) {
      return {
        user,
        slug,
        error: {
          status: "error" as const,
          message: "You do not have access to this organization.",
        },
      };
    }
    throw error;
  }

  return { user, slug, membership, error: null };
}

function revalidateOrgPaths(slug: string) {
  revalidatePath(`/app/orgs/${slug}`);
  revalidatePath(`/app/orgs/${slug}/onboarding`);
  revalidatePath(`/app/orgs/${slug}/settings`);
  for (const step of [
    "basics",
    "contact",
    "hours",
    "catalogue",
    "defaults",
    "review",
  ]) {
    revalidatePath(`/app/orgs/${slug}/onboarding/${step}`);
  }
}

function failureFromService(result: {
  message: string;
  fieldErrors?: Record<string, string[]>;
  missingRequirements?: string[];
}): ActionState {
  return {
    status: "error",
    message:
      result.missingRequirements && result.missingRequirements.length > 0
        ? `${result.message} Missing: ${result.missingRequirements.join("; ")}.`
        : result.message,
    fieldErrors: result.fieldErrors,
  };
}

export async function updateBusinessBasicsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const resolved = await resolveOrgFromForm(formData);
  if (resolved.error || !resolved.membership) return resolved.error!;

  const limited = await rateLimitOrReject(
    "business-profile-update",
    `user:${resolved.user.id}:org:${resolved.membership.organizationId}`,
  );
  if (limited) return limited;

  const version = parseRequiredExpectedVersion(formData);
  if (!("ok" in version)) return version;

  const markStep = formData.get("markStep");
  let progress:
    | {
        step: "BUSINESS_BASICS";
        nextStep: "CONTACT_LOCATION";
        expectedVersion: number;
      }
    | undefined;
  if (markStep === "BUSINESS_BASICS") {
    const onboardingVersion = parseRequiredExpectedVersion(
      formData,
      "onboardingExpectedVersion",
    );
    if (!("ok" in onboardingVersion)) return onboardingVersion;
    progress = {
      step: "BUSINESS_BASICS",
      nextStep: "CONTACT_LOCATION",
      expectedVersion: onboardingVersion.version,
    };
  }

  const result = await updateBusinessBasics({
    actor: resolved.user,
    organizationId: resolved.membership.organizationId,
    expectedVersion: version.version,
    progress,
    raw: {
      legalName: formData.get("legalName") || undefined,
      displayName: formData.get("displayName"),
      description: formData.get("description") || undefined,
      industry: formData.get("industry"),
      businessType: formData.get("businessType"),
      websiteUrl: formData.get("websiteUrl") || undefined,
      logoUrl: formData.get("logoUrl") || undefined,
    },
  });

  if (!result.ok) return failureFromService(result);

  revalidateOrgPaths(resolved.slug);
  return { status: "success", message: "Business basics saved." };
}

export async function updateContactLocationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const resolved = await resolveOrgFromForm(formData);
  if (resolved.error || !resolved.membership) return resolved.error!;

  const limited = await rateLimitOrReject(
    "business-profile-update",
    `user:${resolved.user.id}:org:${resolved.membership.organizationId}`,
  );
  if (limited) return limited;

  const version = parseRequiredExpectedVersion(formData);
  if (!("ok" in version)) return version;

  let progress:
    | {
        step: "CONTACT_LOCATION";
        nextStep: "OPERATING_HOURS";
        expectedVersion: number;
      }
    | undefined;
  if (formData.get("markStep") === "CONTACT_LOCATION") {
    const onboardingVersion = parseRequiredExpectedVersion(
      formData,
      "onboardingExpectedVersion",
    );
    if (!("ok" in onboardingVersion)) return onboardingVersion;
    progress = {
      step: "CONTACT_LOCATION",
      nextStep: "OPERATING_HOURS",
      expectedVersion: onboardingVersion.version,
    };
  }

  const result = await updateContactAndLocation({
    actor: resolved.user,
    organizationId: resolved.membership.organizationId,
    expectedVersion: version.version,
    progress,
    raw: {
      primaryEmail: formData.get("primaryEmail"),
      primaryPhone: formData.get("primaryPhone"),
      preferredContactMethod:
        formData.get("preferredContactMethod") || undefined,
      timeZone: formData.get("timeZone"),
      addressLine1: formData.get("addressLine1") || undefined,
      addressLine2: formData.get("addressLine2") || undefined,
      city: formData.get("city") || undefined,
      region: formData.get("region") || undefined,
      postalCode: formData.get("postalCode") || undefined,
      countryCode: formData.get("countryCode"),
    },
  });

  if (!result.ok) return failureFromService(result);

  revalidateOrgPaths(resolved.slug);
  return { status: "success", message: "Contact and location saved." };
}

export async function replaceOperatingHoursAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const resolved = await resolveOrgFromForm(formData);
  if (resolved.error || !resolved.membership) return resolved.error!;

  const limited = await rateLimitOrReject(
    "business-profile-update",
    `user:${resolved.user.id}:org:${resolved.membership.organizationId}`,
  );
  if (limited) return limited;

  let progress:
    | {
        step: "OPERATING_HOURS";
        nextStep: "CATALOGUE";
        expectedVersion: number;
      }
    | undefined;
  if (formData.get("markStep") === "OPERATING_HOURS") {
    const onboardingVersion = parseRequiredExpectedVersion(
      formData,
      "onboardingExpectedVersion",
    );
    if (!("ok" in onboardingVersion)) return onboardingVersion;
    progress = {
      step: "OPERATING_HOURS",
      nextStep: "CATALOGUE",
      expectedVersion: onboardingVersion.version,
    };
  }

  const intervalsRaw = String(formData.get("intervalsJson") ?? "");
  let intervals: unknown;
  try {
    intervals = JSON.parse(intervalsRaw);
  } catch {
    return {
      status: "error",
      message: "Invalid operating hours payload.",
    };
  }

  const result = await replaceOperatingHours({
    actor: resolved.user,
    organizationId: resolved.membership.organizationId,
    progress,
    raw: {
      customerNote: formData.get("customerNote") || undefined,
      intervals,
    },
  });

  if (!result.ok) return failureFromService(result);

  revalidateOrgPaths(resolved.slug);
  return { status: "success", message: "Operating hours saved." };
}

export async function createServiceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const resolved = await resolveOrgFromForm(formData);
  if (resolved.error || !resolved.membership) return resolved.error!;

  const limited = await rateLimitOrReject(
    "catalogue-create",
    `user:${resolved.user.id}:org:${resolved.membership.organizationId}`,
  );
  if (limited) return limited;

  const result = await createBusinessService({
    actor: resolved.user,
    organizationId: resolved.membership.organizationId,
    raw: {
      name: formData.get("name"),
      description: formData.get("description") || undefined,
      priceDescription: formData.get("priceDescription") || undefined,
      durationMinutes: formData.get("durationMinutes") || undefined,
      category: formData.get("category") || undefined,
      isActive: formData.get("isActive") !== "false",
    },
  });

  if (!result.ok) return failureFromService(result);
  revalidateOrgPaths(resolved.slug);
  return { status: "success", message: "Service created." };
}

export async function updateServiceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const resolved = await resolveOrgFromForm(formData);
  if (resolved.error || !resolved.membership) return resolved.error!;

  const serviceId = String(formData.get("serviceId") ?? "");
  const result = await updateBusinessService({
    actor: resolved.user,
    organizationId: resolved.membership.organizationId,
    serviceId,
    raw: {
      name: formData.get("name"),
      description: formData.get("description") || undefined,
      priceDescription: formData.get("priceDescription") || undefined,
      durationMinutes: formData.get("durationMinutes") || undefined,
      category: formData.get("category") || undefined,
      isActive: formData.get("isActive") !== "false",
    },
  });

  if (!result.ok) return failureFromService(result);
  revalidateOrgPaths(resolved.slug);
  return { status: "success", message: "Service updated." };
}

export async function deactivateServiceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const resolved = await resolveOrgFromForm(formData);
  if (resolved.error || !resolved.membership) return resolved.error!;

  const result = await deactivateBusinessService({
    actor: resolved.user,
    organizationId: resolved.membership.organizationId,
    serviceId: String(formData.get("serviceId") ?? ""),
  });

  if (!result.ok) return failureFromService(result);
  revalidateOrgPaths(resolved.slug);
  return { status: "success", message: "Service deactivated." };
}

export async function reorderServicesAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const resolved = await resolveOrgFromForm(formData);
  if (resolved.error || !resolved.membership) return resolved.error!;

  let orderedIds: unknown;
  try {
    orderedIds = JSON.parse(String(formData.get("orderedIdsJson") ?? "[]"));
  } catch {
    return { status: "error", message: "Invalid reorder payload." };
  }

  const result = await reorderBusinessServices({
    actor: resolved.user,
    organizationId: resolved.membership.organizationId,
    raw: { orderedIds },
  });

  if (!result.ok) return failureFromService(result);
  revalidateOrgPaths(resolved.slug);
  return { status: "success", message: "Services reordered." };
}

export async function createProductAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const resolved = await resolveOrgFromForm(formData);
  if (resolved.error || !resolved.membership) return resolved.error!;

  const limited = await rateLimitOrReject(
    "catalogue-create",
    `user:${resolved.user.id}:org:${resolved.membership.organizationId}`,
  );
  if (limited) return limited;

  const result = await createBusinessProduct({
    actor: resolved.user,
    organizationId: resolved.membership.organizationId,
    raw: {
      name: formData.get("name"),
      description: formData.get("description") || undefined,
      priceDescription: formData.get("priceDescription") || undefined,
      sku: formData.get("sku") || undefined,
      category: formData.get("category") || undefined,
      isActive: formData.get("isActive") !== "false",
    },
  });

  if (!result.ok) return failureFromService(result);
  revalidateOrgPaths(resolved.slug);
  return { status: "success", message: "Product created." };
}

export async function updateProductAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const resolved = await resolveOrgFromForm(formData);
  if (resolved.error || !resolved.membership) return resolved.error!;

  const result = await updateBusinessProduct({
    actor: resolved.user,
    organizationId: resolved.membership.organizationId,
    productId: String(formData.get("productId") ?? ""),
    raw: {
      name: formData.get("name"),
      description: formData.get("description") || undefined,
      priceDescription: formData.get("priceDescription") || undefined,
      sku: formData.get("sku") || undefined,
      category: formData.get("category") || undefined,
      isActive: formData.get("isActive") !== "false",
    },
  });

  if (!result.ok) return failureFromService(result);
  revalidateOrgPaths(resolved.slug);
  return { status: "success", message: "Product updated." };
}

export async function deactivateProductAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const resolved = await resolveOrgFromForm(formData);
  if (resolved.error || !resolved.membership) return resolved.error!;

  const result = await deactivateBusinessProduct({
    actor: resolved.user,
    organizationId: resolved.membership.organizationId,
    productId: String(formData.get("productId") ?? ""),
  });

  if (!result.ok) return failureFromService(result);
  revalidateOrgPaths(resolved.slug);
  return { status: "success", message: "Product deactivated." };
}

export async function reorderProductsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const resolved = await resolveOrgFromForm(formData);
  if (resolved.error || !resolved.membership) return resolved.error!;

  let orderedIds: unknown;
  try {
    orderedIds = JSON.parse(String(formData.get("orderedIdsJson") ?? "[]"));
  } catch {
    return { status: "error", message: "Invalid reorder payload." };
  }

  const result = await reorderBusinessProducts({
    actor: resolved.user,
    organizationId: resolved.membership.organizationId,
    raw: { orderedIds },
  });

  if (!result.ok) return failureFromService(result);
  revalidateOrgPaths(resolved.slug);
  return { status: "success", message: "Products reordered." };
}

export async function updateEmployeeDefaultsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const resolved = await resolveOrgFromForm(formData);
  if (resolved.error || !resolved.membership) return resolved.error!;

  const limited = await rateLimitOrReject(
    "business-profile-update",
    `user:${resolved.user.id}:org:${resolved.membership.organizationId}`,
  );
  if (limited) return limited;

  const version = parseRequiredExpectedVersion(formData);
  if (!("ok" in version)) return version;

  let progress:
    | {
        step: "EMPLOYEE_DEFAULTS";
        nextStep: "REVIEW";
        expectedVersion: number;
      }
    | undefined;
  if (formData.get("markStep") === "EMPLOYEE_DEFAULTS") {
    const onboardingVersion = parseRequiredExpectedVersion(
      formData,
      "onboardingExpectedVersion",
    );
    if (!("ok" in onboardingVersion)) return onboardingVersion;
    progress = {
      step: "EMPLOYEE_DEFAULTS",
      nextStep: "REVIEW",
      expectedVersion: onboardingVersion.version,
    };
  }

  const result = await updateOrganizationSettings({
    actor: resolved.user,
    organizationId: resolved.membership.organizationId,
    expectedVersion: version.version,
    progress,
    raw: {
      membersCanViewServices: formData.get("membersCanViewServices") === "on",
      membersCanViewProducts: formData.get("membersCanViewProducts") === "on",
      membersCanViewBusinessInfo:
        formData.get("membersCanViewBusinessInfo") === "on",
      futureCallingAccessDefault:
        formData.get("futureCallingAccessDefault") || "DISABLED",
    },
  });

  if (!result.ok) return failureFromService(result);

  revalidateOrgPaths(resolved.slug);
  return { status: "success", message: "Employee defaults saved." };
}

export async function markCatalogueStepAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const resolved = await resolveOrgFromForm(formData);
  if (resolved.error || !resolved.membership) return resolved.error!;

  const onboardingVersion = parseRequiredExpectedVersion(
    formData,
    "onboardingExpectedVersion",
  );
  if (!("ok" in onboardingVersion)) return onboardingVersion;

  const result = await advanceOnboardingStep({
    actor: resolved.user,
    organizationId: resolved.membership.organizationId,
    step: "CATALOGUE",
    nextStep: "EMPLOYEE_DEFAULTS",
    expectedVersion: onboardingVersion.version,
  });

  if (!result.ok) return failureFromService(result);
  revalidateOrgPaths(resolved.slug);
  return { status: "success", message: "Catalogue step saved." };
}

export async function startOnboardingAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const resolved = await resolveOrgFromForm(formData);
  if (resolved.error || !resolved.membership) return resolved.error!;

  const limited = await rateLimitOrReject(
    "onboarding-complete",
    `user:${resolved.user.id}:org:${resolved.membership.organizationId}:start`,
  );
  if (limited) return limited;

  const result = await startOrganizationOnboarding({
    actor: resolved.user,
    organizationId: resolved.membership.organizationId,
  });

  if (!result.ok) return failureFromService(result);
  revalidateOrgPaths(resolved.slug);
  redirect(`/app/orgs/${resolved.slug}/onboarding/basics`);
}

export async function completeOnboardingAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const resolved = await resolveOrgFromForm(formData);
  if (resolved.error || !resolved.membership) return resolved.error!;

  const limited = await rateLimitOrReject(
    "onboarding-complete",
    `user:${resolved.user.id}:org:${resolved.membership.organizationId}`,
  );
  if (limited) return limited;

  // Completion intentionally omits optimistic expectedVersion: the shared
  // readiness lock + authoritative readiness recompute serialize the transition.
  const result = await completeOrganizationOnboarding({
    actor: resolved.user,
    organizationId: resolved.membership.organizationId,
  });

  if (!result.ok) return failureFromService(result);
  revalidateOrgPaths(resolved.slug);
  return { status: "success", message: "Onboarding completed." };
}

export async function reopenOnboardingAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const resolved = await resolveOrgFromForm(formData);
  if (resolved.error || !resolved.membership) return resolved.error!;

  const version = parseRequiredExpectedVersion(formData);
  if (!("ok" in version)) return version;

  const result = await reopenOrganizationOnboarding({
    actor: resolved.user,
    organizationId: resolved.membership.organizationId,
    expectedVersion: version.version,
  });

  if (!result.ok) return failureFromService(result);
  revalidateOrgPaths(resolved.slug);
  return { status: "success", message: "Onboarding reopened." };
}
