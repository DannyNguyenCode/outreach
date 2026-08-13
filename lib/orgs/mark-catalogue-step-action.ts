import { revalidatePath } from "next/cache";

import type { ActionState } from "@/app/actions/auth-state";
import { requireVerifiedUser } from "@/lib/auth/session";
import {
  OrganizationAuthError,
  requireOrganizationMemberBySlug,
} from "@/lib/orgs/authorization";
import { type ReadinessMutationTestHooks } from "@/lib/orgs/business-access";
import { requireExpectedVersion } from "@/lib/orgs/business-validation";
import { advanceOnboardingStep } from "@/lib/orgs/onboarding";

/**
 * Trusted server-side dependencies for catalogue-step progression.
 * Hooks are optional and inert unless supplied by tests; never read from FormData.
 */
export type MarkCatalogueStepActionDeps = {
  advanceHooks?: ReadinessMutationTestHooks;
};

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

/**
 * Authenticated catalogue-step progression used by the public server action.
 * Production callers must omit `deps` so hooks remain inert.
 */
export async function runMarkCatalogueStepAction(
  _prev: ActionState,
  formData: FormData,
  deps: MarkCatalogueStepActionDeps = {},
): Promise<ActionState> {
  const resolved = await resolveOrgFromForm(formData);
  if (resolved.error || !resolved.membership) return resolved.error!;

  const onboardingVersion = parseRequiredExpectedVersion(
    formData,
    "onboardingExpectedVersion",
  );
  if (!("ok" in onboardingVersion)) return onboardingVersion;

  const result = await advanceOnboardingStep(
    {
      actor: resolved.user,
      organizationId: resolved.membership.organizationId,
      step: "CATALOGUE",
      nextStep: "EMPLOYEE_DEFAULTS",
      expectedVersion: onboardingVersion.version,
    },
    deps.advanceHooks ?? {},
  );

  if (!result.ok) return failureFromService(result);

  revalidateOrgPaths(resolved.slug);
  return { status: "success", message: "Catalogue step saved." };
}
