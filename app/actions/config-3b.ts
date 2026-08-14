"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

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
import { requireExpectedVersion } from "@/lib/orgs/config-3b-validation";
import {
  confirmTemplateSwitch,
  previewTemplateSwitch,
  selectBusinessTemplate,
  updateTemplateCustomization,
  type TemplateSwitchPreview,
} from "@/lib/orgs/business-templates";
import {
  advanceConfigSection,
  startConfigProgress,
} from "@/lib/orgs/config-progress";
import {
  createCustomField,
  deactivateCustomField,
  reorderCustomFields,
  updateCustomField,
} from "@/lib/orgs/custom-fields";
import {
  createHolidayClosure,
  deactivateHolidayClosure,
  updateHolidayClosure,
} from "@/lib/orgs/holiday-closures";
import { updateLocaleSettings } from "@/lib/orgs/locale-settings";
import {
  replaceCallDispositions,
  replaceLeadStages,
  updateCallbackPolicy,
  updateNotificationDefaults,
  updateRecordingConsentPolicy,
} from "@/lib/orgs/operational-defaults";
import {
  createServiceArea,
  deactivateServiceArea,
  reorderServiceAreas,
  updateServiceArea,
} from "@/lib/orgs/service-areas";
import { prisma } from "@/lib/prisma";
import type { BusinessTemplateKey } from "@prisma/client";

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
    returnTo: slug ? `/app/orgs/${slug}/settings` : "/app",
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

function revalidateConfigPaths(slug: string) {
  revalidatePath(`/app/orgs/${slug}`);
  revalidatePath(`/app/orgs/${slug}/settings`);
  revalidatePath(`/app/orgs/${slug}/settings/business-template`);
  revalidatePath(`/app/orgs/${slug}/settings/service-areas`);
  revalidatePath(`/app/orgs/${slug}/settings/availability`);
  revalidatePath(`/app/orgs/${slug}/settings/operational-defaults`);
}

function failureFromService(result: {
  message: string;
  fieldErrors?: Record<string, string[]>;
}): ActionState {
  return {
    status: "error",
    message: result.message,
    fieldErrors: result.fieldErrors,
  };
}

/** Checkbox / explicit bool: missing means false (unchecked). */
function formBool(formData: FormData, name: string): boolean {
  const value = formData.get(name);
  return value === "on" || value === "true" || value === "1";
}

/** Optional bool when the field may be omitted entirely (defaults to `fallback`). */
function formBoolOrDefault(
  formData: FormData,
  name: string,
  fallback: boolean,
): boolean {
  if (formData.get(name) === null) return fallback;
  return formBool(formData, name);
}

function parseJsonField(
  formData: FormData,
  name: string,
  label: string,
): { ok: true; value: unknown } | ActionState {
  const raw = String(formData.get(name) ?? "");
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { status: "error", message: `Invalid ${label} payload.` };
  }
}

async function guardMutation(formData: FormData): Promise<
  | {
      ok: true;
      user: Awaited<ReturnType<typeof requireVerifiedUser>>;
      slug: string;
      membership: NonNullable<
        Awaited<ReturnType<typeof resolveOrgFromForm>>["membership"]
      >;
    }
  | { ok: false; state: ActionState }
> {
  const resolved = await resolveOrgFromForm(formData);
  if (resolved.error || !resolved.membership) {
    return { ok: false, state: resolved.error! };
  }

  const limited = await rateLimitOrReject(
    "config-3b-update",
    `user:${resolved.user.id}:org:${resolved.membership.organizationId}`,
  );
  if (limited) return { ok: false, state: limited };

  return {
    ok: true,
    user: resolved.user,
    slug: resolved.slug,
    membership: resolved.membership,
  };
}

function parseCustomization(formData: FormData) {
  const keys = formData
    .getAll("confirmedFieldKeys")
    .map((value) => String(value).trim())
    .filter(Boolean);
  const notesRaw = String(formData.get("notes") ?? "").trim();
  return {
    confirmedFieldKeys: keys,
    notes: notesRaw.length > 0 ? notesRaw : null,
  };
}

export async function startConfigProgressAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guard = await guardMutation(formData);
  if (!guard.ok) return guard.state;

  const result = await startConfigProgress({
    actor: guard.user,
    organizationId: guard.membership.organizationId,
  });

  if (!result.ok) return failureFromService(result);

  revalidateConfigPaths(guard.slug);
  return { status: "success", message: "Configuration started." };
}

export async function selectBusinessTemplateAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guard = await guardMutation(formData);
  if (!guard.ok) return guard.state;

  const result = await selectBusinessTemplate({
    actor: guard.user,
    organizationId: guard.membership.organizationId,
    raw: {
      templateKey: String(formData.get("templateKey") ?? ""),
      customization: parseCustomization(formData),
    },
  });

  if (!result.ok) return failureFromService(result);

  revalidateConfigPaths(guard.slug);
  return { status: "success", message: "Business template selected." };
}

export async function previewTemplateSwitchAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guard = await guardMutation(formData);
  if (!guard.ok) return guard.state;

  const templateKey = String(
    formData.get("templateKey") ?? "",
  ) as BusinessTemplateKey;
  const result = await previewTemplateSwitch({
    actor: guard.user,
    organizationId: guard.membership.organizationId,
    templateKey,
  });

  if (!result.ok) return failureFromService(result);

  const preview: TemplateSwitchPreview = result.preview;
  return {
    status: "success",
    message: `Preview ready: switch to ${preview.toKey}. Review details below, then confirm.`,
    data: preview,
  };
}

export async function confirmTemplateSwitchAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guard = await guardMutation(formData);
  if (!guard.ok) return guard.state;

  const version = parseRequiredExpectedVersion(formData);
  if (!("ok" in version)) return version;

  const result = await confirmTemplateSwitch({
    actor: guard.user,
    organizationId: guard.membership.organizationId,
    raw: {
      templateKey: String(formData.get("templateKey") ?? ""),
      expectedVersion: version.version,
      customization: parseCustomization(formData),
    },
  });

  if (!result.ok) return failureFromService(result);

  revalidateConfigPaths(guard.slug);
  return { status: "success", message: "Business template switched." };
}

export async function updateTemplateCustomizationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guard = await guardMutation(formData);
  if (!guard.ok) return guard.state;

  const version = parseRequiredExpectedVersion(formData);
  if (!("ok" in version)) return version;

  const result = await updateTemplateCustomization({
    actor: guard.user,
    organizationId: guard.membership.organizationId,
    expectedVersion: version.version,
    raw: parseCustomization(formData),
  });

  if (!result.ok) return failureFromService(result);

  revalidateConfigPaths(guard.slug);
  return { status: "success", message: "Template customization saved." };
}

export async function updateLocaleSettingsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guard = await guardMutation(formData);
  if (!guard.ok) return guard.state;

  const version = parseRequiredExpectedVersion(formData);
  if (!("ok" in version)) return version;

  const result = await updateLocaleSettings({
    actor: guard.user,
    organizationId: guard.membership.organizationId,
    expectedVersion: version.version,
    raw: {
      locale: formData.get("locale"),
      defaultLanguage: formData.get("defaultLanguage"),
      dateDisplayPreference: formData.get("dateDisplayPreference") || "locale",
      timeDisplayPreference: formData.get("timeDisplayPreference") || "locale",
      numberDisplayPreference:
        formData.get("numberDisplayPreference") || "locale",
    },
  });

  if (!result.ok) return failureFromService(result);

  revalidateConfigPaths(guard.slug);
  return { status: "success", message: "Locale settings saved." };
}

export async function createServiceAreaAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guard = await guardMutation(formData);
  if (!guard.ok) return guard.state;

  const result = await createServiceArea({
    actor: guard.user,
    organizationId: guard.membership.organizationId,
    raw: {
      label: formData.get("label"),
      countryCode: formData.get("countryCode") || null,
      region: formData.get("region") || null,
      city: formData.get("city") || null,
      postalPrefix: formData.get("postalPrefix") || null,
      isRemote: formBool(formData, "isRemote"),
      isActive: formBoolOrDefault(formData, "isActive", true),
    },
  });

  if (!result.ok) return failureFromService(result);

  revalidateConfigPaths(guard.slug);
  return { status: "success", message: "Service area created." };
}

export async function updateServiceAreaAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guard = await guardMutation(formData);
  if (!guard.ok) return guard.state;

  const version = parseRequiredExpectedVersion(formData);
  if (!("ok" in version)) return version;

  const result = await updateServiceArea({
    actor: guard.user,
    organizationId: guard.membership.organizationId,
    serviceAreaId: String(formData.get("serviceAreaId") ?? ""),
    expectedVersion: version.version,
    raw: {
      label: formData.get("label"),
      countryCode: formData.get("countryCode") || null,
      region: formData.get("region") || null,
      city: formData.get("city") || null,
      postalPrefix: formData.get("postalPrefix") || null,
      isRemote: formBool(formData, "isRemote"),
      isActive: formBool(formData, "isActive"),
    },
  });

  if (!result.ok) return failureFromService(result);

  revalidateConfigPaths(guard.slug);
  return { status: "success", message: "Service area updated." };
}

export async function deactivateServiceAreaAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guard = await guardMutation(formData);
  if (!guard.ok) return guard.state;

  const result = await deactivateServiceArea({
    actor: guard.user,
    organizationId: guard.membership.organizationId,
    serviceAreaId: String(formData.get("serviceAreaId") ?? ""),
  });

  if (!result.ok) return failureFromService(result);

  revalidateConfigPaths(guard.slug);
  return { status: "success", message: "Service area deactivated." };
}

export async function reorderServiceAreasAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guard = await guardMutation(formData);
  if (!guard.ok) return guard.state;

  const parsed = parseJsonField(formData, "orderedIdsJson", "reorder");
  if (!("ok" in parsed) || !("value" in parsed)) return parsed;

  const result = await reorderServiceAreas({
    actor: guard.user,
    organizationId: guard.membership.organizationId,
    raw: { orderedIds: parsed.value },
  });

  if (!result.ok) return failureFromService(result);

  revalidateConfigPaths(guard.slug);
  return { status: "success", message: "Service areas reordered." };
}

export async function createHolidayClosureAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guard = await guardMutation(formData);
  if (!guard.ok) return guard.state;

  const intervalsRaw = String(formData.get("replacementIntervalsJson") ?? "");
  let replacementIntervals: unknown = null;
  if (intervalsRaw.trim().length > 0) {
    try {
      replacementIntervals = JSON.parse(intervalsRaw);
    } catch {
      return {
        status: "error",
        message: "Invalid replacement intervals payload.",
      };
    }
  }

  const result = await createHolidayClosure({
    actor: guard.user,
    organizationId: guard.membership.organizationId,
    raw: {
      localDateStart: formData.get("localDateStart"),
      localDateEnd: formData.get("localDateEnd") || null,
      isClosedAllDay: formBoolOrDefault(formData, "isClosedAllDay", true),
      replacementIntervals,
      customerNote: formData.get("customerNote") || null,
      internalLabel: formData.get("internalLabel") || null,
      isActive: formBoolOrDefault(formData, "isActive", true),
    },
  });

  if (!result.ok) return failureFromService(result);

  revalidateConfigPaths(guard.slug);
  return { status: "success", message: "Holiday closure created." };
}

export async function updateHolidayClosureAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guard = await guardMutation(formData);
  if (!guard.ok) return guard.state;

  const version = parseRequiredExpectedVersion(formData);
  if (!("ok" in version)) return version;

  const intervalsRaw = String(formData.get("replacementIntervalsJson") ?? "");
  let replacementIntervals: unknown = null;
  if (intervalsRaw.trim().length > 0) {
    try {
      replacementIntervals = JSON.parse(intervalsRaw);
    } catch {
      return {
        status: "error",
        message: "Invalid replacement intervals payload.",
      };
    }
  }

  const result = await updateHolidayClosure({
    actor: guard.user,
    organizationId: guard.membership.organizationId,
    closureId: String(formData.get("closureId") ?? ""),
    expectedVersion: version.version,
    raw: {
      localDateStart: formData.get("localDateStart"),
      localDateEnd: formData.get("localDateEnd") || null,
      isClosedAllDay: formBoolOrDefault(formData, "isClosedAllDay", true),
      replacementIntervals,
      customerNote: formData.get("customerNote") || null,
      internalLabel: formData.get("internalLabel") || null,
      isActive: formBool(formData, "isActive"),
    },
  });

  if (!result.ok) return failureFromService(result);

  revalidateConfigPaths(guard.slug);
  return { status: "success", message: "Holiday closure updated." };
}

export async function deactivateHolidayClosureAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guard = await guardMutation(formData);
  if (!guard.ok) return guard.state;

  const result = await deactivateHolidayClosure({
    actor: guard.user,
    organizationId: guard.membership.organizationId,
    closureId: String(formData.get("closureId") ?? ""),
  });

  if (!result.ok) return failureFromService(result);

  revalidateConfigPaths(guard.slug);
  return { status: "success", message: "Holiday closure deactivated." };
}

export async function replaceLeadStagesAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guard = await guardMutation(formData);
  if (!guard.ok) return guard.state;

  const parsed = parseJsonField(formData, "stagesJson", "lead stages");
  if (!("ok" in parsed) || !("value" in parsed)) return parsed;

  const result = await replaceLeadStages({
    actor: guard.user,
    organizationId: guard.membership.organizationId,
    raw: { stages: parsed.value },
  });

  if (!result.ok) return failureFromService(result);

  revalidateConfigPaths(guard.slug);
  return { status: "success", message: "Lead stages saved." };
}

export async function replaceCallDispositionsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guard = await guardMutation(formData);
  if (!guard.ok) return guard.state;

  const parsed = parseJsonField(formData, "dispositionsJson", "dispositions");
  if (!("ok" in parsed) || !("value" in parsed)) return parsed;

  const result = await replaceCallDispositions({
    actor: guard.user,
    organizationId: guard.membership.organizationId,
    raw: { dispositions: parsed.value },
  });

  if (!result.ok) return failureFromService(result);

  revalidateConfigPaths(guard.slug);
  return { status: "success", message: "Call dispositions saved." };
}

export async function updateCallbackPolicyAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guard = await guardMutation(formData);
  if (!guard.ok) return guard.state;

  const version = parseRequiredExpectedVersion(formData);
  if (!("ok" in version)) return version;

  const result = await updateCallbackPolicy({
    actor: guard.user,
    organizationId: guard.membership.organizationId,
    expectedVersion: version.version,
    raw: {
      defaultWindowMinutes: Number(formData.get("defaultWindowMinutes")),
      maxSuggestedAttempts: Number(formData.get("maxSuggestedAttempts")),
      minSpacingMinutes: Number(formData.get("minSpacingMinutes")),
      businessHoursOnly: formBool(formData, "businessHoursOnly"),
      defaultAssignmentBehavior: formData.get("defaultAssignmentBehavior"),
    },
  });

  if (!result.ok) return failureFromService(result);

  revalidateConfigPaths(guard.slug);
  return { status: "success", message: "Callback policy saved." };
}

export async function updateRecordingConsentPolicyAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guard = await guardMutation(formData);
  if (!guard.ok) return guard.state;

  const version = parseRequiredExpectedVersion(formData);
  if (!("ok" in version)) return version;

  const result = await updateRecordingConsentPolicy({
    actor: guard.user,
    organizationId: guard.membership.organizationId,
    expectedVersion: version.version,
    raw: {
      recordingEnabled: formBool(formData, "recordingEnabled"),
      transcriptionEnabled: formBool(formData, "transcriptionEnabled"),
      // Missing fields must not silently disable fail-closed defaults.
      consentCaptureRequired: formBoolOrDefault(
        formData,
        "consentCaptureRequired",
        true,
      ),
      disclosureTextPlaceholder:
        formData.get("disclosureTextPlaceholder") || null,
      retentionDays: Number(formData.get("retentionDays") || 30),
      accessDefault: formData.get("accessDefault") || "ADMINS_ONLY",
      reviewRequired: formBoolOrDefault(formData, "reviewRequired", true),
    },
  });

  if (!result.ok) return failureFromService(result);

  revalidateConfigPaths(guard.slug);
  return { status: "success", message: "Recording consent policy saved." };
}

export async function updateNotificationDefaultsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guard = await guardMutation(formData);
  if (!guard.ok) return guard.state;

  const version = parseRequiredExpectedVersion(formData);
  if (!("ok" in version)) return version;

  const categoriesRaw = String(formData.get("notificationCategories") ?? "");
  const notificationCategories = categoriesRaw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const enabledChannels = formData
    .getAll("enabledChannels")
    .map((value) => String(value));

  let thresholdPlaceholders: unknown = {};
  const thresholdsRaw = String(formData.get("thresholdPlaceholdersJson") ?? "");
  if (thresholdsRaw.trim().length > 0) {
    try {
      thresholdPlaceholders = JSON.parse(thresholdsRaw);
    } catch {
      return {
        status: "error",
        message: "Invalid threshold placeholders payload.",
      };
    }
  }

  const result = await updateNotificationDefaults({
    actor: guard.user,
    organizationId: guard.membership.organizationId,
    expectedVersion: version.version,
    raw: {
      escalationContactLabel: formData.get("escalationContactLabel") || null,
      escalationContactEmail: formData.get("escalationContactEmail") || null,
      notificationCategories,
      enabledChannels:
        enabledChannels.length > 0 ? enabledChannels : ["in_app"],
      thresholdPlaceholders,
    },
  });

  if (!result.ok) return failureFromService(result);

  revalidateConfigPaths(guard.slug);
  return { status: "success", message: "Notification defaults saved." };
}

export async function createCustomFieldAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guard = await guardMutation(formData);
  if (!guard.ok) return guard.state;

  const optionsRaw = String(formData.get("options") ?? "").trim();
  const options =
    optionsRaw.length > 0
      ? optionsRaw
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
      : undefined;

  const result = await createCustomField({
    actor: guard.user,
    organizationId: guard.membership.organizationId,
    raw: {
      key: formData.get("key"),
      label: formData.get("label"),
      description: formData.get("description") || null,
      dataType: formData.get("dataType"),
      required: formBool(formData, "required"),
      isActive: formBoolOrDefault(formData, "isActive", true),
      options: options ?? null,
      scope: formData.get("scope") || "BUSINESS",
    },
  });

  if (!result.ok) return failureFromService(result);

  revalidateConfigPaths(guard.slug);
  return { status: "success", message: "Custom field created." };
}

export async function updateCustomFieldAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guard = await guardMutation(formData);
  if (!guard.ok) return guard.state;

  const version = parseRequiredExpectedVersion(formData);
  if (!("ok" in version)) return version;

  const optionsRaw = String(formData.get("options") ?? "").trim();
  const options =
    optionsRaw.length > 0
      ? optionsRaw
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
      : null;

  const result = await updateCustomField({
    actor: guard.user,
    organizationId: guard.membership.organizationId,
    fieldId: String(formData.get("fieldId") ?? ""),
    expectedVersion: version.version,
    raw: {
      label: formData.get("label"),
      description: formData.get("description") || null,
      dataType: formData.get("dataType"),
      required: formBool(formData, "required"),
      isActive: formBool(formData, "isActive"),
      options,
    },
  });

  if (!result.ok) return failureFromService(result);

  revalidateConfigPaths(guard.slug);
  return { status: "success", message: "Custom field updated." };
}

export async function deactivateCustomFieldAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guard = await guardMutation(formData);
  if (!guard.ok) return guard.state;

  const result = await deactivateCustomField({
    actor: guard.user,
    organizationId: guard.membership.organizationId,
    fieldId: String(formData.get("fieldId") ?? ""),
  });

  if (!result.ok) return failureFromService(result);

  revalidateConfigPaths(guard.slug);
  return { status: "success", message: "Custom field deactivated." };
}

export async function reorderCustomFieldsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guard = await guardMutation(formData);
  if (!guard.ok) return guard.state;

  const parsed = parseJsonField(formData, "orderedIdsJson", "reorder");
  if (!("ok" in parsed) || !("value" in parsed)) return parsed;

  const result = await reorderCustomFields({
    actor: guard.user,
    organizationId: guard.membership.organizationId,
    raw: { orderedIds: parsed.value },
  });

  if (!result.ok) return failureFromService(result);

  revalidateConfigPaths(guard.slug);
  return { status: "success", message: "Custom fields reordered." };
}

export async function advanceConfigSectionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guard = await guardMutation(formData);
  if (!guard.ok) return guard.state;

  const version = parseRequiredExpectedVersion(formData);
  if (!("ok" in version)) return version;

  const nextSectionRaw = String(formData.get("nextSection") ?? "").trim();
  const result = await advanceConfigSection({
    actor: guard.user,
    organizationId: guard.membership.organizationId,
    raw: {
      section: String(formData.get("section") ?? ""),
      nextSection: nextSectionRaw.length > 0 ? nextSectionRaw : undefined,
      expectedVersion: version.version,
      markCompleted: formData.get("markCompleted") !== "false",
    },
  });

  if (!result.ok) return failureFromService(result);

  revalidateConfigPaths(guard.slug);
  return { status: "success", message: "Configuration section updated." };
}
