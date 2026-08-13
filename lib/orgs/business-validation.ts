import {
  isValidPhoneNumber,
  parsePhoneNumberFromString,
} from "libphonenumber-js";
import { z } from "zod";

import { emailSchema } from "@/lib/auth/email";

/** ISO 3166-1 alpha-2 — common set plus validation by format. */
const COUNTRY_CODE_RE = /^[A-Z]{2}$/;

const IANA_TIME_ZONES = new Set([
  "UTC",
  "Etc/UTC",
  ...(typeof Intl.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("timeZone")
    : []),
]);

export const businessNameSchema = z
  .string()
  .trim()
  .min(1, "Business name is required.")
  .max(120, "Business name is too long.");

export const optionalBusinessNameSchema = z
  .string()
  .trim()
  .max(120, "Business name is too long.")
  .transform((value) => (value.length === 0 ? undefined : value))
  .optional();

export const businessDescriptionSchema = z
  .string()
  .trim()
  .max(1000, "Description is too long.")
  .transform((value) => (value.length === 0 ? undefined : value))
  .optional();

export const industrySchema = z
  .string()
  .trim()
  .min(1, "Industry or category is required.")
  .max(80, "Industry is too long.");

export const optionalIndustrySchema = z
  .string()
  .trim()
  .max(80, "Industry is too long.")
  .transform((value) => (value.length === 0 ? undefined : value))
  .optional();

export const safeHttpUrlSchema = z
  .string()
  .trim()
  .max(2048, "URL is too long.")
  .transform((value) => (value.length === 0 ? undefined : value))
  .optional()
  .superRefine((value, ctx) => {
    if (value === undefined) return;
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      ctx.addIssue({ code: "custom", message: "Enter a valid URL." });
      return;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      ctx.addIssue({
        code: "custom",
        message: "URL must use http or https.",
      });
    }
  });

export const ianaTimeZoneSchema = z
  .string()
  .trim()
  .min(1, "Time zone is required.")
  .max(64, "Time zone is invalid.")
  .refine(
    (value) => IANA_TIME_ZONES.size === 0 || IANA_TIME_ZONES.has(value),
    "Enter a valid IANA time zone (for example America/Toronto).",
  );

export const optionalIanaTimeZoneSchema = z
  .string()
  .trim()
  .max(64, "Time zone is invalid.")
  .transform((value) => (value.length === 0 ? undefined : value))
  .optional()
  .superRefine((value, ctx) => {
    if (value === undefined) return;
    if (IANA_TIME_ZONES.size > 0 && !IANA_TIME_ZONES.has(value)) {
      ctx.addIssue({
        code: "custom",
        message: "Enter a valid IANA time zone (for example America/Toronto).",
      });
    }
  });

export const countryCodeSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .refine(
    (value) => COUNTRY_CODE_RE.test(value),
    "Enter a valid 2-letter country code.",
  );

export const optionalCountryCodeSchema = z
  .string()
  .trim()
  .transform((value) => (value.length === 0 ? undefined : value.toUpperCase()))
  .optional()
  .superRefine((value, ctx) => {
    if (value === undefined) return;
    if (!COUNTRY_CODE_RE.test(value)) {
      ctx.addIssue({
        code: "custom",
        message: "Enter a valid 2-letter country code.",
      });
    }
  });

export const regionSchema = z
  .string()
  .trim()
  .max(80, "Region is too long.")
  .transform((value) => (value.length === 0 ? undefined : value))
  .optional();

export const citySchema = z
  .string()
  .trim()
  .max(80, "City is too long.")
  .transform((value) => (value.length === 0 ? undefined : value))
  .optional();

export const postalCodeSchema = z
  .string()
  .trim()
  .max(20, "Postal code is too long.")
  .transform((value) => (value.length === 0 ? undefined : value.toUpperCase()))
  .optional();

export const addressLineSchema = z
  .string()
  .trim()
  .max(120, "Address is too long.")
  .transform((value) => (value.length === 0 ? undefined : value))
  .optional();

export const priceDescriptionSchema = z
  .string()
  .trim()
  .max(120, "Price description is too long.")
  .transform((value) => (value.length === 0 ? undefined : value))
  .optional();

export const categorySchema = z
  .string()
  .trim()
  .max(80, "Category is too long.")
  .transform((value) => (value.length === 0 ? undefined : value))
  .optional();

export const skuSchema = z
  .string()
  .trim()
  .max(64, "SKU is too long.")
  .regex(/^[A-Za-z0-9._\-]*$/, "SKU contains invalid characters.")
  .transform((value) => (value.length === 0 ? undefined : value))
  .optional();

export const durationMinutesSchema = z.coerce
  .number()
  .int("Duration must be a whole number of minutes.")
  .positive("Duration must be positive.")
  .max(24 * 60, "Duration must be at most 24 hours.")
  .optional()
  .or(z.literal("").transform(() => undefined))
  .or(z.nan().transform(() => undefined));

export const displayOrderSchema = z.coerce
  .number()
  .int("Display order must be an integer.")
  .min(0, "Display order cannot be negative.")
  .max(100_000, "Display order is too large.");

export const catalogueNameSchema = z
  .string()
  .trim()
  .min(1, "Name is required.")
  .max(120, "Name is too long.");

export const catalogueDescriptionSchema = z
  .string()
  .trim()
  .max(1000, "Description is too long.")
  .transform((value) => (value.length === 0 ? undefined : value))
  .optional();

export const customerHoursNoteSchema = z
  .string()
  .trim()
  .max(200, "Note is too long.")
  .transform((value) => (value.length === 0 ? undefined : value))
  .optional();

/**
 * Normalize a phone number toward E.164 when a country context exists.
 * Returns null when the input is empty; throws nothing — callers use Zod.
 */
export function normalizePhoneNumber(
  raw: string,
  defaultCountry?: string,
): { ok: true; e164: string | undefined } | { ok: false; message: string } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: true, e164: undefined };
  }
  if (trimmed.length > 32) {
    return { ok: false, message: "Phone number is too long." };
  }

  const country =
    defaultCountry && COUNTRY_CODE_RE.test(defaultCountry.toUpperCase())
      ? (defaultCountry.toUpperCase() as import("libphonenumber-js").CountryCode)
      : undefined;

  const parsed = parsePhoneNumberFromString(trimmed, country);
  if (parsed && isValidPhoneNumber(parsed.number)) {
    return { ok: true, e164: parsed.format("E.164") };
  }

  // If the user already provided a leading +, require a valid international parse.
  if (trimmed.startsWith("+")) {
    return { ok: false, message: "Enter a valid phone number." };
  }

  // Without a reliable country, reject rather than invent incomplete parsing.
  if (!country) {
    return {
      ok: false,
      message:
        "Enter a phone number with country code (E.164) or provide a country.",
    };
  }

  return { ok: false, message: "Enter a valid phone number." };
}

export const phoneNumberInputSchema = z
  .object({
    phone: z.string().trim().max(32, "Phone number is too long."),
    countryCode: optionalCountryCodeSchema,
  })
  .superRefine((value, ctx) => {
    const result = normalizePhoneNumber(value.phone, value.countryCode);
    if (!result.ok) {
      ctx.addIssue({
        code: "custom",
        path: ["phone"],
        message: result.message,
      });
    }
  })
  .transform((value) => {
    const result = normalizePhoneNumber(value.phone, value.countryCode);
    return {
      phone: result.ok ? result.e164 : undefined,
      countryCode: value.countryCode,
    };
  });

export const localTimeSchema = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Use HH:MM 24-hour time.");

export function timeStringToMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function minutesToTimeString(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Operating-hours semantics:
 * - startMinute inclusive, endMinute exclusive
 * - Valid open interval: 0 <= start < end <= 1440
 * - Overnight intervals are rejected (end must be greater than start)
 * - Zero-length intervals are rejected
 * - Overlaps on the same day are rejected by the schedule validator
 */
export const operatingIntervalSchema = z
  .object({
    dayOfWeek: z.enum([
      "MONDAY",
      "TUESDAY",
      "WEDNESDAY",
      "THURSDAY",
      "FRIDAY",
      "SATURDAY",
      "SUNDAY",
    ]),
    isClosed: z.boolean(),
    startTime: z.string().optional(),
    endTime: z.string().optional(),
    sortOrder: displayOrderSchema.default(0),
    customerNote: customerHoursNoteSchema,
  })
  .superRefine((value, ctx) => {
    if (value.isClosed) {
      if (value.startTime || value.endTime) {
        ctx.addIssue({
          code: "custom",
          message: "Closed days cannot include opening intervals.",
        });
      }
      return;
    }
    if (!value.startTime || !value.endTime) {
      ctx.addIssue({
        code: "custom",
        message: "Open days require a start and end time.",
      });
      return;
    }
    const startParsed = localTimeSchema.safeParse(value.startTime);
    const endParsed = localTimeSchema.safeParse(value.endTime);
    if (!startParsed.success) {
      ctx.addIssue({
        code: "custom",
        path: ["startTime"],
        message: startParsed.error.issues[0]?.message ?? "Invalid start time.",
      });
      return;
    }
    if (!endParsed.success) {
      ctx.addIssue({
        code: "custom",
        path: ["endTime"],
        message: endParsed.error.issues[0]?.message ?? "Invalid end time.",
      });
      return;
    }
    const start = timeStringToMinutes(startParsed.data);
    let end = timeStringToMinutes(endParsed.data);
    // Allow 24:00 as exclusive end of day via 00:00 only when start is not 00:00
    // Callers should send endTime "24:00" or we treat midnight end as 1440 when
    // end is 00:00 and start > 0 — but that is ambiguous. Require end > start
    // in the same day; use endTime "24:00" for end-of-day.
    if (value.endTime === "24:00") {
      end = 1440;
    }
    if (end <= start) {
      ctx.addIssue({
        code: "custom",
        message:
          "Ending time must be after starting time. Overnight hours are not supported.",
      });
    }
  });

export const DAYS_OF_WEEK = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
] as const;

export type DayOfWeekValue = (typeof DAYS_OF_WEEK)[number];

export function intervalsOverlap(
  a: { startMinute: number; endMinute: number },
  b: { startMinute: number; endMinute: number },
): boolean {
  // Half-open intervals [start, end)
  return a.startMinute < b.endMinute && b.startMinute < a.endMinute;
}

export function validateWeeklySchedule(
  intervals: Array<{
    dayOfWeek: DayOfWeekValue;
    isClosed: boolean;
    startMinute: number | null;
    endMinute: number | null;
    sortOrder: number;
  }>,
): { ok: true } | { ok: false; message: string } {
  const byDay = new Map<DayOfWeekValue, typeof intervals>();
  for (const interval of intervals) {
    const list = byDay.get(interval.dayOfWeek) ?? [];
    list.push(interval);
    byDay.set(interval.dayOfWeek, list);
  }

  for (const day of DAYS_OF_WEEK) {
    const dayIntervals = byDay.get(day) ?? [];
    if (dayIntervals.length === 0) {
      return {
        ok: false,
        message: `Missing schedule entry for ${day.toLowerCase()}.`,
      };
    }

    const closed = dayIntervals.filter((i) => i.isClosed);
    const open = dayIntervals.filter((i) => !i.isClosed);

    if (closed.length > 0 && open.length > 0) {
      return {
        ok: false,
        message: `${day} cannot be both open and closed.`,
      };
    }
    if (closed.length > 1) {
      return {
        ok: false,
        message: `${day} has duplicate closed entries.`,
      };
    }

    for (const interval of open) {
      if (
        interval.startMinute === null ||
        interval.endMinute === null ||
        interval.startMinute < 0 ||
        interval.endMinute > 1440 ||
        interval.endMinute <= interval.startMinute
      ) {
        return {
          ok: false,
          message: `${day} has an invalid interval.`,
        };
      }
    }

    for (let i = 0; i < open.length; i += 1) {
      for (let j = i + 1; j < open.length; j += 1) {
        const a = open[i];
        const b = open[j];
        if (
          a.startMinute !== null &&
          a.endMinute !== null &&
          b.startMinute !== null &&
          b.endMinute !== null &&
          intervalsOverlap(
            { startMinute: a.startMinute, endMinute: a.endMinute },
            { startMinute: b.startMinute, endMinute: b.endMinute },
          )
        ) {
          return {
            ok: false,
            message: `${day} has overlapping intervals.`,
          };
        }
      }
    }
  }

  return { ok: true };
}

export const businessTypeSchema = z.enum(["SERVICES", "PRODUCTS", "BOTH"]);

export const preferredContactMethodSchema = z.enum([
  "EMAIL",
  "PHONE",
  "WEBSITE",
]);

export const futureCallingAccessDefaultSchema = z.enum([
  "DISABLED",
  "STANDARD",
]);

export const businessBasicsSchema = z.object({
  legalName: optionalBusinessNameSchema,
  displayName: businessNameSchema,
  description: businessDescriptionSchema,
  industry: industrySchema,
  businessType: businessTypeSchema,
  websiteUrl: safeHttpUrlSchema,
  logoUrl: safeHttpUrlSchema,
});

export const contactLocationSchema = z
  .object({
    primaryEmail: emailSchema,
    primaryPhone: z.string().trim().max(32),
    preferredContactMethod: preferredContactMethodSchema.optional(),
    timeZone: ianaTimeZoneSchema,
    addressLine1: addressLineSchema,
    addressLine2: addressLineSchema,
    city: citySchema,
    region: regionSchema,
    postalCode: postalCodeSchema,
    countryCode: countryCodeSchema,
  })
  .superRefine((value, ctx) => {
    const phone = normalizePhoneNumber(value.primaryPhone, value.countryCode);
    if (!phone.ok) {
      ctx.addIssue({
        code: "custom",
        path: ["primaryPhone"],
        message: phone.message,
      });
    } else if (!phone.e164) {
      ctx.addIssue({
        code: "custom",
        path: ["primaryPhone"],
        message: "Business phone is required.",
      });
    }
  })
  .transform((value) => {
    const phone = normalizePhoneNumber(value.primaryPhone, value.countryCode);
    return {
      ...value,
      primaryPhoneE164: phone.ok ? phone.e164 : undefined,
    };
  });

export const replaceOperatingHoursSchema = z.object({
  customerNote: customerHoursNoteSchema,
  intervals: z
    .array(
      z.object({
        dayOfWeek: z.enum(DAYS_OF_WEEK),
        isClosed: z.coerce.boolean(),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
        sortOrder: z.coerce.number().int().min(0).max(20).default(0),
      }),
    )
    .min(7)
    .max(70),
});

export const serviceInputSchema = z.object({
  name: catalogueNameSchema,
  description: catalogueDescriptionSchema,
  priceDescription: priceDescriptionSchema,
  durationMinutes: z.preprocess(
    (value) => {
      if (value === "" || value === null || value === undefined)
        return undefined;
      return value;
    },
    z.coerce
      .number()
      .int()
      .positive()
      .max(24 * 60)
      .optional(),
  ),
  category: categorySchema,
  isActive: z.coerce.boolean().optional().default(true),
});

export const productInputSchema = z.object({
  name: catalogueNameSchema,
  description: catalogueDescriptionSchema,
  priceDescription: priceDescriptionSchema,
  sku: skuSchema,
  category: categorySchema,
  isActive: z.coerce.boolean().optional().default(true),
});

export const reorderItemsSchema = z.object({
  orderedIds: z
    .array(z.string().cuid())
    .min(1, "At least one item is required.")
    .max(200, "Too many items."),
});

export const employeeDefaultsSchema = z.object({
  membersCanViewServices: z.coerce.boolean(),
  membersCanViewProducts: z.coerce.boolean(),
  membersCanViewBusinessInfo: z.coerce.boolean(),
  futureCallingAccessDefault: futureCallingAccessDefaultSchema,
});

export const onboardingStepSchema = z.enum([
  "BUSINESS_BASICS",
  "CONTACT_LOCATION",
  "OPERATING_HOURS",
  "CATALOGUE",
  "EMPLOYEE_DEFAULTS",
  "REVIEW",
]);

export const ONBOARDING_STEPS = [
  "BUSINESS_BASICS",
  "CONTACT_LOCATION",
  "OPERATING_HOURS",
  "CATALOGUE",
  "EMPLOYEE_DEFAULTS",
  "REVIEW",
] as const;

export type OnboardingStepValue = (typeof ONBOARDING_STEPS)[number];

export function parseCompletedSteps(value: unknown): OnboardingStepValue[] {
  if (!Array.isArray(value)) return [];
  const steps: OnboardingStepValue[] = [];
  for (const item of value) {
    const parsed = onboardingStepSchema.safeParse(item);
    if (parsed.success && !steps.includes(parsed.data)) {
      steps.push(parsed.data);
    }
  }
  return steps;
}

/**
 * Strict optimistic-concurrency version parser for Phase 3A mutations.
 *
 * Accepts only a base-10 non-negative safe integer. Malformed values must never
 * become `undefined` (which would weaken a conditional update into an
 * unconditional update).
 */
export type ExpectedVersionParseResult =
  { ok: true; version: number } | { ok: false; message: string };

export function parseExpectedVersion(
  raw: unknown,
  options: { required?: boolean } = { required: true },
): ExpectedVersionParseResult {
  const required = options.required !== false;

  if (raw === null || raw === undefined) {
    return required
      ? { ok: false, message: "Expected version is required." }
      : { ok: false, message: "Expected version is required." };
  }

  if (typeof raw === "number") {
    if (
      !Number.isInteger(raw) ||
      raw < 0 ||
      raw > Number.MAX_SAFE_INTEGER ||
      !Number.isSafeInteger(raw)
    ) {
      return { ok: false, message: "Expected version is invalid." };
    }
    return { ok: true, version: raw };
  }

  if (typeof raw !== "string") {
    return { ok: false, message: "Expected version is invalid." };
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, message: "Expected version is required." };
  }

  // Reject decimals, signs, whitespace mid-string, hex, etc.
  if (!/^[0-9]+$/.test(trimmed)) {
    return { ok: false, message: "Expected version is invalid." };
  }

  // Reject leading zeros that aren't exactly "0" to keep canonical base-10 ints.
  if (trimmed.length > 1 && trimmed.startsWith("0")) {
    return { ok: false, message: "Expected version is invalid." };
  }

  let version: number;
  try {
    version = Number(trimmed);
  } catch {
    return { ok: false, message: "Expected version is invalid." };
  }

  if (
    !Number.isInteger(version) ||
    version < 0 ||
    !Number.isSafeInteger(version)
  ) {
    return { ok: false, message: "Expected version is invalid." };
  }

  return { ok: true, version };
}

/**
 * Require a valid expected version for version-protected service mutations.
 * Throws ConflictError-compatible AuthFailure shape via return — callers check ok.
 */
export function requireExpectedVersion(
  raw: unknown,
): ExpectedVersionParseResult {
  return parseExpectedVersion(raw, { required: true });
}
