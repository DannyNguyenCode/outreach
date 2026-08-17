import { z } from "zod";

import { emailSchema } from "@/lib/auth/email";
import {
  normalizePhoneNumber,
  optionalCountryCodeSchema,
  optionalIanaTimeZoneSchema,
  requireExpectedVersion,
} from "@/lib/orgs/business-validation";
import { bcp47LanguageSchema } from "@/lib/orgs/config-3b-validation";
import { validateCustomFieldValue } from "@/lib/orgs/offering-validation";

export { requireExpectedVersion };

export const PROSPECT_NAME_MAX = 120;
export const PROSPECT_LOCATION_MAX = 120;
export const PROSPECT_ADDRESS_MAX = 200;
export const PROSPECT_WEBSITE_MAX = 2048;
export const PROSPECT_CHANNEL_LABEL_MAX = 40;
export const PROSPECT_CONTACT_NAME_MAX = 80;
export const PROSPECT_TITLE_MAX = 80;
export const PROSPECT_SEARCH_MAX = 200;
export const PROSPECT_PAGE_SIZE_DEFAULT = 20;
export const PROSPECT_PAGE_SIZE_MAX = 50;
export const PROSPECT_MAX_CONTACTS = 50;
export const PROSPECT_MAX_CHANNELS = 100;
export const PROSPECT_MAX_CUSTOM_VALUES = 40;
export const PROSPECT_DUPLICATE_CANDIDATE_MAX = 10;
export const PROSPECT_RECENT_AUDIT_MAX = 20;

export const PROSPECT_KINDS = [
  "BUSINESS",
  "INDIVIDUAL",
  "HOUSEHOLD",
  "ORGANIZATION",
] as const;

export const PROSPECT_LIFECYCLES = ["ACTIVE", "ARCHIVED", "MERGED"] as const;
export const PROSPECT_LIST_LIFECYCLES = ["ACTIVE", "ARCHIVED"] as const;
export const PROSPECT_CHANNEL_KINDS = ["PHONE", "EMAIL"] as const;
export const PROSPECT_SOURCES = ["MANUAL"] as const;

const LEGAL_SUFFIX_RE =
  /\b(inc|incorporated|ltd|limited|llc|llp|corp|corporation|co|company|plc)\b/g;

export function sanitizeSearchQuery(raw: unknown): string {
  if (typeof raw !== "string") {
    return "";
  }
  return raw
    .replace(/[%_\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, PROSPECT_SEARCH_MAX);
}

export function parsePage(raw: unknown): number {
  if (raw === undefined || raw === null || raw === "") {
    return 1;
  }
  const value = Number(String(raw));
  if (!Number.isInteger(value) || value < 1) {
    return 1;
  }
  return value;
}

export function parsePageSize(raw: unknown): number {
  if (raw === undefined || raw === null || raw === "") {
    return PROSPECT_PAGE_SIZE_DEFAULT;
  }
  const value = Number(String(raw));
  if (!Number.isInteger(value) || value < 1) {
    return PROSPECT_PAGE_SIZE_DEFAULT;
  }
  return Math.min(value, PROSPECT_PAGE_SIZE_MAX);
}

export function parseListLifecycle(raw: unknown): "ACTIVE" | "ARCHIVED" {
  return raw === "ARCHIVED" ? "ARCHIVED" : "ACTIVE";
}

export function normalizeProspectSearchName(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(LEGAL_SUFFIX_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function namesAreStrongMatch(left: string, right: string): boolean {
  const a = normalizeProspectSearchName(left);
  const b = normalizeProspectSearchName(right);
  return a.length > 0 && a === b;
}

export type NormalizedEmail = {
  displayValue: string;
  normalizedValue: string;
};

export function normalizeProspectEmail(
  raw: string,
): { ok: true; value: NormalizedEmail } | { ok: false; message: string } {
  const displayValue = raw.trim();
  if (displayValue.length === 0) {
    return { ok: false, message: "Enter an email address." };
  }
  if (displayValue.length > 254) {
    return { ok: false, message: "Email is too long." };
  }
  const parsed = emailSchema.safeParse(displayValue);
  if (!parsed.success) {
    return { ok: false, message: "Enter a valid email address." };
  }
  return {
    ok: true,
    value: {
      displayValue,
      normalizedValue: parsed.data,
    },
  };
}

export type NormalizedPhone = {
  displayValue: string;
  normalizedValue: string;
};

export function normalizeProspectPhone(
  raw: string,
  defaultCountry?: string,
): { ok: true; value: NormalizedPhone } | { ok: false; message: string } {
  const displayValue = raw.trim();
  if (displayValue.length === 0) {
    return { ok: false, message: "Enter a phone number." };
  }
  const result = normalizePhoneNumber(displayValue, defaultCountry);
  if (!result.ok) {
    return { ok: false, message: result.message };
  }
  if (!result.e164) {
    return { ok: false, message: "Enter a valid phone number." };
  }
  return {
    ok: true,
    value: {
      displayValue,
      normalizedValue: result.e164,
    },
  };
}

export type NormalizedWebsite = {
  displayValue: string | null;
  normalizedValue: string | null;
};

function hostnameFromUrl(url: URL): string {
  return url.hostname
    .replace(/\.$/, "")
    .replace(/^www\./i, "")
    .toLowerCase();
}

export function normalizeProspectWebsite(
  raw: string,
): { ok: true; value: NormalizedWebsite } | { ok: false; message: string } {
  const displayValue = raw.trim();
  if (displayValue.length === 0) {
    return { ok: true, value: { displayValue: null, normalizedValue: null } };
  }
  if (displayValue.length > PROSPECT_WEBSITE_MAX) {
    return { ok: false, message: "Website is too long." };
  }
  if (/^\s*(javascript|data|file|vbscript):/i.test(displayValue)) {
    return { ok: false, message: "Website must use http or https." };
  }

  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(displayValue)
    ? displayValue
    : `https://${displayValue}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, message: "Enter a valid website." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, message: "Website must use http or https." };
  }
  if (!parsed.hostname) {
    return { ok: false, message: "Enter a valid website." };
  }

  return {
    ok: true,
    value: {
      displayValue,
      normalizedValue: hostnameFromUrl(parsed),
    },
  };
}

/** Only http(s) hrefs are safe to render. Never fetch this URL in Phase 5A. */
export function safeWebsiteHref(displayValue: string | null): string | null {
  if (!displayValue) {
    return null;
  }
  const normalized = normalizeProspectWebsite(displayValue);
  if (!normalized.ok || !normalized.value.normalizedValue) {
    return null;
  }
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(displayValue.trim())
    ? displayValue.trim()
    : `https://${displayValue.trim()}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function looksLikePhoneQuery(query: string): boolean {
  const digits = query.replace(/\D/g, "");
  return digits.length >= 7 && /[+\d]/.test(query);
}

export function normalizeSearchPhone(
  query: string,
  defaultCountry?: string,
): string | null {
  const result = normalizePhoneNumber(query, defaultCountry);
  if (!result.ok || !result.e164) {
    const digits = query.replace(/\D/g, "");
    return digits.length >= 7 ? digits : null;
  }
  return result.e164;
}

const optionalTrimmed = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .transform((value) => (value.length === 0 ? undefined : value))
    .optional();

const customValueInputSchema = z.object({
  definitionKey: z.string().trim().min(1).max(80),
  value: z.unknown(),
});

/**
 * Update contract: omitted keys are preserved. `null` or a blank string is an
 * explicit clear. The server must not treat a missing JSON key as `null`.
 */
const patchOptionalText = (max: number, message: string) =>
  z
    .union([z.string().max(max, message), z.null()])
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      if (value === null) return null;
      const trimmed = value.trim();
      return trimmed.length === 0 ? null : trimmed;
    });

export type CustomFieldFormControl = {
  key: string;
  label: string;
  description: string | null;
  dataType: string;
  required: boolean;
  isActive: boolean;
  options: string[];
  value: unknown;
};

export function customFieldOptionsFromJson(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function isExplicitCustomClear(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string" && value.trim().length === 0) return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

export function storedCustomValueToFormValue(input: {
  dataType: string;
  stringValue: string | null;
  numberValue: { toString(): string } | string | null;
  booleanValue: boolean | null;
  dateValue: Date | null;
  jsonValue: unknown;
}): unknown {
  switch (input.dataType) {
    case "NUMBER":
      return input.numberValue == null ? null : String(input.numberValue);
    case "BOOLEAN":
      return input.booleanValue;
    case "DATE":
      return input.dateValue
        ? input.dateValue.toISOString().slice(0, 10)
        : null;
    case "MULTI_SELECT":
      return Array.isArray(input.jsonValue) ? input.jsonValue : [];
    default:
      return input.stringValue;
  }
}

export function customValuesToPayload(
  values: Record<string, unknown>,
): Array<{ definitionKey: string; value: unknown }> {
  return Object.entries(values).map(([definitionKey, value]) => ({
    definitionKey,
    value,
  }));
}

const channelInputSchema = z.object({
  kind: z.enum(PROSPECT_CHANNEL_KINDS),
  label: optionalTrimmed(
    PROSPECT_CHANNEL_LABEL_MAX,
    "Channel label is too long.",
  ),
  value: z.string().min(1, "Enter a phone number or email."),
  isPrimary: z.boolean().optional(),
});

const contactInputSchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(1, "First name is required.")
    .max(PROSPECT_CONTACT_NAME_MAX, "First name is too long."),
  lastName: z
    .string()
    .trim()
    .min(1, "Last name is required.")
    .max(PROSPECT_CONTACT_NAME_MAX, "Last name is too long."),
  displayName: optionalTrimmed(
    PROSPECT_NAME_MAX,
    "Contact display name is too long.",
  ),
  title: optionalTrimmed(PROSPECT_TITLE_MAX, "Title is too long."),
  preferredLanguage: z
    .string()
    .trim()
    .transform((value) => (value.length === 0 ? undefined : value))
    .optional()
    .superRefine((value, ctx) => {
      if (value === undefined) return;
      const parsed = bcp47LanguageSchema.safeParse(value);
      if (!parsed.success) {
        ctx.addIssue({
          code: "custom",
          message: "Enter a valid language tag (for example en).",
        });
      }
    }),
  isPrimary: z.boolean().optional(),
  channels: z.array(channelInputSchema).max(PROSPECT_MAX_CHANNELS).optional(),
  customValues: z
    .array(customValueInputSchema)
    .max(PROSPECT_MAX_CUSTOM_VALUES)
    .optional(),
});

export const prospectCoreInputSchema = z.object({
  kind: z.enum(PROSPECT_KINDS).default("BUSINESS"),
  displayName: z
    .string()
    .trim()
    .min(1, "Name is required.")
    .max(PROSPECT_NAME_MAX, "Name is too long."),
  website: optionalTrimmed(PROSPECT_WEBSITE_MAX, "Website is too long."),
  locationLabel: optionalTrimmed(
    PROSPECT_LOCATION_MAX,
    "Location is too long.",
  ),
  addressLine1: optionalTrimmed(PROSPECT_ADDRESS_MAX, "Address is too long."),
  addressLine2: optionalTrimmed(PROSPECT_ADDRESS_MAX, "Address is too long."),
  city: optionalTrimmed(PROSPECT_LOCATION_MAX, "City is too long."),
  region: optionalTrimmed(PROSPECT_LOCATION_MAX, "Region is too long."),
  postalCode: optionalTrimmed(20, "Postal code is too long."),
  countryCode: optionalCountryCodeSchema,
  timeZone: optionalIanaTimeZoneSchema,
  contacts: z.array(contactInputSchema).max(PROSPECT_MAX_CONTACTS).optional(),
  channels: z.array(channelInputSchema).max(PROSPECT_MAX_CHANNELS).optional(),
  customValues: z
    .array(customValueInputSchema)
    .max(PROSPECT_MAX_CUSTOM_VALUES)
    .optional(),
  acknowledgeDuplicates: z.boolean().optional(),
});

export const prospectUpdateInputSchema = z.object({
  kind: z.enum(PROSPECT_KINDS).optional(),
  displayName: z
    .string()
    .trim()
    .min(1, "Name is required.")
    .max(PROSPECT_NAME_MAX, "Name is too long.")
    .optional(),
  website: patchOptionalText(PROSPECT_WEBSITE_MAX, "Website is too long."),
  locationLabel: patchOptionalText(
    PROSPECT_LOCATION_MAX,
    "Location is too long.",
  ),
  addressLine1: patchOptionalText(PROSPECT_ADDRESS_MAX, "Address is too long."),
  addressLine2: patchOptionalText(PROSPECT_ADDRESS_MAX, "Address is too long."),
  city: patchOptionalText(PROSPECT_LOCATION_MAX, "City is too long."),
  region: patchOptionalText(PROSPECT_LOCATION_MAX, "Region is too long."),
  postalCode: patchOptionalText(20, "Postal code is too long."),
  countryCode: z
    .union([z.string(), z.null()])
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      if (value === null) return null;
      const trimmed = value.trim().toUpperCase();
      return trimmed.length === 0 ? null : trimmed;
    })
    .superRefine((value, ctx) => {
      if (value === undefined || value === null) return;
      if (!/^[A-Z]{2}$/.test(value)) {
        ctx.addIssue({
          code: "custom",
          message: "Enter a valid 2-letter country code.",
        });
      }
    }),
  timeZone: z
    .union([z.string(), z.null()])
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      if (value === null) return null;
      const trimmed = value.trim();
      return trimmed.length === 0 ? null : trimmed;
    })
    .superRefine((value, ctx) => {
      if (value === undefined || value === null) return;
      const parsed = optionalIanaTimeZoneSchema.safeParse(value);
      if (!parsed.success) {
        ctx.addIssue({
          code: "custom",
          message:
            "Enter a valid IANA time zone (for example America/Toronto).",
        });
      }
    }),
  customValues: z
    .array(customValueInputSchema)
    .max(PROSPECT_MAX_CUSTOM_VALUES)
    .optional(),
  expectedVersion: z.unknown(),
});

export const contactCreateInputSchema = contactInputSchema;
export const contactUpdateInputSchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(1, "First name is required.")
    .max(PROSPECT_CONTACT_NAME_MAX, "First name is too long.")
    .optional(),
  lastName: z
    .string()
    .trim()
    .min(1, "Last name is required.")
    .max(PROSPECT_CONTACT_NAME_MAX, "Last name is too long.")
    .optional(),
  displayName: patchOptionalText(
    PROSPECT_NAME_MAX,
    "Contact display name is too long.",
  ),
  title: patchOptionalText(PROSPECT_TITLE_MAX, "Title is too long."),
  preferredLanguage: z
    .union([z.string(), z.null()])
    .optional()
    .superRefine((value, ctx) => {
      if (value === undefined || value === null) return;
      const trimmed = value.trim();
      if (trimmed.length === 0) return;
      const parsed = bcp47LanguageSchema.safeParse(trimmed);
      if (!parsed.success) {
        ctx.addIssue({
          code: "custom",
          message: "Enter a valid language tag (for example en).",
        });
      }
    })
    .transform((value) => {
      if (value === undefined) return undefined;
      if (value === null) return null;
      const trimmed = value.trim();
      return trimmed.length === 0 ? null : trimmed;
    }),
  isPrimary: z.boolean().optional(),
  customValues: z
    .array(customValueInputSchema)
    .max(PROSPECT_MAX_CUSTOM_VALUES)
    .optional(),
  expectedVersion: z.unknown(),
});

export const channelCreateInputSchema = channelInputSchema;

export const mergeResolutionsSchema = z.object({
  displayName: z.enum(["survivor", "duplicate"]).optional(),
  kind: z.enum(["survivor", "duplicate"]).optional(),
  website: z.enum(["survivor", "duplicate"]).optional(),
  locationLabel: z.enum(["survivor", "duplicate"]).optional(),
  addressLine1: z.enum(["survivor", "duplicate"]).optional(),
  addressLine2: z.enum(["survivor", "duplicate"]).optional(),
  city: z.enum(["survivor", "duplicate"]).optional(),
  region: z.enum(["survivor", "duplicate"]).optional(),
  postalCode: z.enum(["survivor", "duplicate"]).optional(),
  countryCode: z.enum(["survivor", "duplicate"]).optional(),
  timeZone: z.enum(["survivor", "duplicate"]).optional(),
  customValues: z
    .record(z.string(), z.enum(["survivor", "duplicate"]))
    .optional(),
});

export type MergeFieldResolutions = z.infer<typeof mergeResolutionsSchema>;
export type ProspectCoreInput = z.infer<typeof prospectCoreInputSchema>;
export type ChannelInput = z.infer<typeof channelInputSchema>;
export type ContactInput = z.infer<typeof contactInputSchema>;

export type PreparedChannel = {
  kind: "PHONE" | "EMAIL";
  label: string | null;
  displayValue: string;
  normalizedValue: string;
  isPrimary: boolean;
};

export type PreparedCustomValue = {
  definitionId: string;
  definitionKey: string;
  stringValue: string | null;
  numberValue: string | null;
  booleanValue: boolean | null;
  dateValue: Date | null;
  jsonValue: unknown;
};

export function contactDisplayName(input: {
  firstName: string;
  lastName: string;
  displayName?: string;
}): string {
  if (input.displayName && input.displayName.trim().length > 0) {
    return input.displayName.trim();
  }
  return `${input.firstName.trim()} ${input.lastName.trim()}`.trim();
}

export function prepareChannel(
  input: ChannelInput,
  defaultCountry?: string,
): { ok: true; value: PreparedChannel } | { ok: false; message: string } {
  if (input.kind === "EMAIL") {
    const email = normalizeProspectEmail(input.value);
    if (!email.ok) {
      return email;
    }
    return {
      ok: true,
      value: {
        kind: "EMAIL",
        label: input.label ?? null,
        displayValue: email.value.displayValue,
        normalizedValue: email.value.normalizedValue,
        isPrimary: Boolean(input.isPrimary),
      },
    };
  }
  const phone = normalizeProspectPhone(input.value, defaultCountry);
  if (!phone.ok) {
    return phone;
  }
  return {
    ok: true,
    value: {
      kind: "PHONE",
      label: input.label ?? null,
      displayValue: phone.value.displayValue,
      normalizedValue: phone.value.normalizedValue,
      isPrimary: Boolean(input.isPrimary),
    },
  };
}

export function locationMatchKey(input: {
  locationLabel?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  countryCode?: string | null;
}): string {
  return [
    input.locationLabel,
    input.city,
    input.region,
    input.postalCode,
    input.countryCode,
  ]
    .map((part) => (part ?? "").trim().toLowerCase())
    .filter((part) => part.length > 0)
    .join("|");
}

export function customValuesConflict(
  left: { definitionKey: string; canonical: string },
  right: { definitionKey: string; canonical: string },
): boolean {
  return (
    left.definitionKey === right.definitionKey &&
    left.canonical !== right.canonical
  );
}

export function canonicalCustomStoredValue(input: {
  stringValue: string | null;
  numberValue: { toString(): string } | string | null;
  booleanValue: boolean | null;
  dateValue: Date | null;
  jsonValue: unknown;
}): string {
  if (input.stringValue != null) return `s:${input.stringValue}`;
  if (input.numberValue != null) return `n:${String(input.numberValue)}`;
  if (input.booleanValue != null) return `b:${input.booleanValue ? "1" : "0"}`;
  if (input.dateValue != null) return `d:${input.dateValue.toISOString()}`;
  if (input.jsonValue != null) return `j:${JSON.stringify(input.jsonValue)}`;
  return "empty";
}

export function mapValidatedCustomValue(input: {
  definitionId: string;
  definitionKey: string;
  dataType: string;
  options?: unknown;
  value: unknown;
}): { ok: true; value: PreparedCustomValue } | { ok: false; message: string } {
  const validated = validateCustomFieldValue({
    dataType: input.dataType,
    options: input.options,
    value: input.value,
  });
  if (!validated.ok) {
    return validated;
  }
  const normalized = validated.normalized;
  return {
    ok: true,
    value: {
      definitionId: input.definitionId,
      definitionKey: input.definitionKey,
      stringValue: normalized.kind === "string" ? normalized.stringValue : null,
      numberValue:
        normalized.kind === "number" ? normalized.numberValue.toString() : null,
      booleanValue:
        normalized.kind === "boolean" ? normalized.booleanValue : null,
      dateValue: normalized.kind === "date" ? normalized.dateValue : null,
      jsonValue: normalized.kind === "json" ? normalized.jsonValue : null,
    },
  };
}

export function zodFieldErrors(error: z.ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "form";
    fieldErrors[key] ??= [];
    fieldErrors[key].push(issue.message);
  }
  return fieldErrors;
}
