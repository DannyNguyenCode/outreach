import { z } from "zod";

import { emailSchema } from "@/lib/auth/email";
import {
  optionalCountryCodeSchema,
  requireExpectedVersion,
} from "@/lib/orgs/business-validation";

export { requireExpectedVersion };

/** Config section identifiers aligned with Prisma `ConfigSection`. */
export const CONFIG_SECTIONS = [
  "BUSINESS_TEMPLATE",
  "LOCALE",
  "SERVICE_AREAS",
  "AVAILABILITY",
  "LEAD_STAGES",
  "CALL_DISPOSITIONS",
  "CALLBACK_POLICY",
  "RECORDING_CONSENT",
  "NOTIFICATIONS",
  "CUSTOM_FIELDS",
  "REVIEW",
] as const;

export type ConfigSectionValue = (typeof CONFIG_SECTIONS)[number];

export const configSectionSchema = z.enum(CONFIG_SECTIONS);

export const BUSINESS_TEMPLATE_KEYS = [
  "PROFESSIONAL_SERVICES",
  "HOME_TRADE_SERVICES",
  "PRODUCT_BUSINESS",
  "SUBSCRIPTIONS_PLANS",
  "APPOINTMENT_BASED",
  "CUSTOM_MIXED",
] as const;

export const businessTemplateKeySchema = z.enum(BUSINESS_TEMPLATE_KEYS);

export const CUSTOM_FIELD_DATA_TYPES = [
  "TEXT",
  "LONG_TEXT",
  "NUMBER",
  "BOOLEAN",
  "DATE",
  "SINGLE_SELECT",
  "MULTI_SELECT",
  "URL",
  "EMAIL",
  "PHONE",
] as const;

export const customFieldDataTypeSchema = z.enum(CUSTOM_FIELD_DATA_TYPES);

export const CUSTOM_FIELD_SCOPES = [
  "BUSINESS",
  "OFFERING",
  "PROSPECT",
  "KNOWLEDGE",
] as const;

export const customFieldScopeSchema = z.enum(CUSTOM_FIELD_SCOPES);

export const LEAD_STAGE_CLASSIFICATIONS = [
  "NONE",
  "INITIAL",
  "WON",
  "LOST",
  "TERMINAL",
] as const;

export const leadStageClassificationSchema = z.enum(LEAD_STAGE_CLASSIFICATIONS);

export const CALLBACK_ASSIGNMENT_BEHAVIORS = [
  "UNASSIGNED",
  "ROUND_ROBIN_PLACEHOLDER",
  "CREATOR",
] as const;

export const callbackAssignmentBehaviorSchema = z.enum(
  CALLBACK_ASSIGNMENT_BEHAVIORS,
);

export const RECORDING_ACCESS_DEFAULTS = [
  "ADMINS_ONLY",
  "ADMINS_AND_OWNERS",
  "ROLE_GATED_LATER",
] as const;

export const recordingAccessDefaultSchema = z.enum(RECORDING_ACCESS_DEFAULTS);

const RESERVED_CUSTOM_FIELD_KEYS = new Set([
  "id",
  "organizationid",
  "organization_id",
  "email",
  "phone",
  "name",
  "createdat",
  "created_at",
  "updatedat",
  "updated_at",
  "version",
  "slug",
  "role",
  "status",
  "password",
  "token",
  "secret",
  "hash",
  "userid",
  "user_id",
  "membershipid",
  "authorization",
  "session",
  "apikey",
  "api_key",
]);

export function isReservedCustomFieldKey(key: string): boolean {
  return RESERVED_CUSTOM_FIELD_KEYS.has(key.toLowerCase());
}

/**
 * BCP 47 locale/language tag. Uses Intl.Locale when available; rejects malformed.
 */
export function isValidBcp47Tag(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 35) {
    return false;
  }
  if (!/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(trimmed)) {
    return false;
  }
  try {
    if (typeof Intl !== "undefined" && typeof Intl.Locale === "function") {
      const locale = new Intl.Locale(trimmed);
      return Boolean(locale.language && locale.language.length >= 2);
    }
  } catch {
    return false;
  }
  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(trimmed);
}

export const bcp47LocaleSchema = z
  .string()
  .trim()
  .min(2, "Locale is required.")
  .max(35, "Locale is too long.")
  .refine(isValidBcp47Tag, "Enter a valid BCP 47 locale (for example en-CA).");

export const bcp47LanguageSchema = z
  .string()
  .trim()
  .min(2, "Language is required.")
  .max(35, "Language is too long.")
  .refine(
    isValidBcp47Tag,
    "Enter a valid BCP 47 language tag (for example en).",
  );

/**
 * Bounded postal/ZIP prefix: alphanumeric 1–10 chars, optional single hyphen.
 * Rejects `*` and unbounded wildcard patterns.
 */
export function isValidPostalPrefix(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 10) {
    return false;
  }
  if (trimmed.includes("*") || trimmed.includes("%") || trimmed.includes("?")) {
    return false;
  }
  const hyphenCount = (trimmed.match(/-/g) ?? []).length;
  if (hyphenCount > 1) {
    return false;
  }
  if (trimmed.startsWith("-") || trimmed.endsWith("-")) {
    return false;
  }
  return /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)?$/.test(trimmed);
}

export const postalPrefixSchema = z
  .string()
  .trim()
  .transform((value) => (value.length === 0 ? undefined : value.toUpperCase()))
  .optional()
  .superRefine((value, ctx) => {
    if (value === undefined) return;
    if (!isValidPostalPrefix(value)) {
      ctx.addIssue({
        code: "custom",
        message:
          "Postal prefix must be 1–10 alphanumeric characters with at most one hyphen.",
      });
    }
  });

export const labelSchema = z
  .string()
  .trim()
  .min(1, "Label is required.")
  .max(120, "Label is too long.");

export const optionalLabelSchema = z
  .string()
  .trim()
  .max(120, "Label is too long.")
  .transform((value) => (value.length === 0 ? undefined : value))
  .optional();

export const selectOptionsSchema = z
  .array(z.string().trim().min(1).max(80, "Option is too long."))
  .max(50, "At most 50 options are allowed.")
  .superRefine((options, ctx) => {
    const seen = new Set<string>();
    for (const [index, option] of options.entries()) {
      const key = option.toLowerCase();
      if (seen.has(key)) {
        ctx.addIssue({
          code: "custom",
          message: "Options must be unique.",
          path: [index],
        });
      }
      seen.add(key);
    }
  });

export const customFieldKeySchema = z
  .string()
  .trim()
  .regex(
    /^[a-z][a-z0-9_]{1,63}$/,
    "Key must start with a letter and use lowercase letters, digits, or underscores (2–64 chars).",
  )
  .refine(
    (key) => !isReservedCustomFieldKey(key),
    "This field key is reserved.",
  );

const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidLocalDateString(value: string): boolean {
  if (!LOCAL_DATE_RE.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return false;
  }
  const utc = new Date(Date.UTC(year, month - 1, day));
  return (
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === day
  );
}

export const localDateSchema = z
  .string()
  .trim()
  .refine(isValidLocalDateString, "Enter a valid local date (YYYY-MM-DD).");

export const replacementIntervalSchema = z
  .object({
    startMinute: z.number().int().min(0).max(1440),
    endMinute: z.number().int().min(0).max(1440),
  })
  .superRefine((interval, ctx) => {
    if (interval.endMinute <= interval.startMinute) {
      ctx.addIssue({
        code: "custom",
        message: "Interval end must be greater than start (half-open).",
        path: ["endMinute"],
      });
    }
  });

export const holidayClosureInputSchema = z
  .object({
    localDateStart: localDateSchema,
    localDateEnd: localDateSchema.optional().nullable(),
    isClosedAllDay: z.boolean().optional().default(true),
    replacementIntervals: z
      .array(replacementIntervalSchema)
      .max(12)
      .optional()
      .nullable(),
    customerNote: z
      .string()
      .trim()
      .max(500)
      .transform((value) => (value.length === 0 ? undefined : value))
      .optional()
      .nullable(),
    internalLabel: optionalLabelSchema.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.localDateEnd && data.localDateEnd < data.localDateStart) {
      ctx.addIssue({
        code: "custom",
        message: "End date must be on or after the start date.",
        path: ["localDateEnd"],
      });
    }
    if (data.isClosedAllDay === false) {
      if (
        !data.replacementIntervals ||
        data.replacementIntervals.length === 0
      ) {
        ctx.addIssue({
          code: "custom",
          message:
            "Replacement intervals are required when not closed all day.",
          path: ["replacementIntervals"],
        });
      }
    }
  });

export function holidayDateRangesOverlap(
  aStart: string,
  aEnd: string | null | undefined,
  bStart: string,
  bEnd: string | null | undefined,
): boolean {
  const aLast = aEnd ?? aStart;
  const bLast = bEnd ?? bStart;
  return aStart <= bLast && bStart <= aLast;
}

function refineCustomFieldOptions(
  data: {
    dataType?: (typeof CUSTOM_FIELD_DATA_TYPES)[number];
    options?: string[] | null;
  },
  ctx: z.RefinementCtx,
) {
  if (!data.dataType) return;
  const needsOptions =
    data.dataType === "SINGLE_SELECT" || data.dataType === "MULTI_SELECT";
  if (needsOptions) {
    if (!data.options || data.options.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "Select fields require at least one option.",
        path: ["options"],
      });
    }
  } else if (data.options && data.options.length > 0) {
    ctx.addIssue({
      code: "custom",
      message: "Options are only allowed for select field types.",
      path: ["options"],
    });
  }
}

const customFieldBaseObjectSchema = z.object({
  key: customFieldKeySchema,
  label: labelSchema,
  description: z
    .string()
    .trim()
    .max(500)
    .transform((value) => (value.length === 0 ? undefined : value))
    .optional()
    .nullable(),
  dataType: customFieldDataTypeSchema,
  required: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
  options: selectOptionsSchema.optional().nullable(),
  validation: z.record(z.string(), z.unknown()).optional().nullable(),
  scope: customFieldScopeSchema.optional().default("BUSINESS"),
});

export const customFieldInputSchema = customFieldBaseObjectSchema.superRefine(
  refineCustomFieldOptions,
);

/** Zod 4: omit/extend must target the object schema, not a refined schema. */
export const customFieldUpdateSchema = customFieldBaseObjectSchema
  .omit({ key: true, scope: true })
  .extend({
    label: labelSchema.optional(),
    dataType: customFieldDataTypeSchema.optional(),
  })
  .superRefine(refineCustomFieldOptions);

export const reorderItemsSchema = z.object({
  orderedIds: z
    .array(z.string().cuid())
    .min(1, "At least one item is required.")
    .max(200, "Too many items."),
});

export const serviceAreaInputSchema = z.object({
  label: labelSchema,
  countryCode: optionalCountryCodeSchema.nullable().optional(),
  region: z
    .string()
    .trim()
    .max(80)
    .transform((value) => (value.length === 0 ? undefined : value))
    .optional()
    .nullable(),
  city: z
    .string()
    .trim()
    .max(80)
    .transform((value) => (value.length === 0 ? undefined : value))
    .optional()
    .nullable(),
  postalPrefix: z
    .union([
      z
        .string()
        .trim()
        .transform((value) => (value.length === 0 ? null : value.toUpperCase()))
        .refine(
          (value) => value === null || isValidPostalPrefix(value),
          "Postal prefix must be 1–10 alphanumeric characters with at most one hyphen.",
        ),
      z.null(),
    ])
    .optional(),
  isRemote: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
});

export const replaceHolidayClosuresSchema = z.object({
  closures: z.array(holidayClosureInputSchema).max(200),
});

export const localeSettingsInputSchema = z.object({
  locale: bcp47LocaleSchema,
  defaultLanguage: bcp47LanguageSchema,
  dateDisplayPreference: z.string().trim().min(1).max(40).default("locale"),
  timeDisplayPreference: z.string().trim().min(1).max(40).default("locale"),
  numberDisplayPreference: z.string().trim().min(1).max(40).default("locale"),
});

export const leadStageItemSchema = z.object({
  key: customFieldKeySchema,
  label: labelSchema,
  isActive: z.boolean().optional().default(true),
  displayOrder: z.number().int().min(0).max(10_000).optional(),
  classification: leadStageClassificationSchema.optional().default("NONE"),
  isDefault: z.boolean().optional().default(false),
});

export const replaceLeadStagesSchema = z
  .object({
    stages: z.array(leadStageItemSchema).min(1).max(50),
  })
  .superRefine((data, ctx) => {
    const keys = new Set<string>();
    for (const [index, stage] of data.stages.entries()) {
      if (keys.has(stage.key)) {
        ctx.addIssue({
          code: "custom",
          message: "Lead stage keys must be unique.",
          path: ["stages", index, "key"],
        });
      }
      keys.add(stage.key);
    }
    const activeDefaults = data.stages.filter(
      (stage) => (stage.isActive ?? true) && (stage.isDefault ?? false),
    );
    if (activeDefaults.length !== 1) {
      ctx.addIssue({
        code: "custom",
        message: "Exactly one active lead stage must be marked as default.",
        path: ["stages"],
      });
    }
  });

export const callDispositionItemSchema = z.object({
  key: customFieldKeySchema,
  label: labelSchema,
  isActive: z.boolean().optional().default(true),
  displayOrder: z.number().int().min(0).max(10_000).optional(),
  expectsFollowUp: z.boolean().optional().default(false),
  isTerminal: z.boolean().optional().default(false),
});

export const replaceCallDispositionsSchema = z
  .object({
    dispositions: z.array(callDispositionItemSchema).min(1).max(50),
  })
  .superRefine((data, ctx) => {
    const keys = new Set<string>();
    for (const [index, disposition] of data.dispositions.entries()) {
      if (keys.has(disposition.key)) {
        ctx.addIssue({
          code: "custom",
          message: "Disposition keys must be unique.",
          path: ["dispositions", index, "key"],
        });
      }
      keys.add(disposition.key);
    }
  });

export const callbackPolicyInputSchema = z.object({
  defaultWindowMinutes: z.number().int().min(15).max(480),
  maxSuggestedAttempts: z.number().int().min(1).max(20),
  minSpacingMinutes: z.number().int().min(15).max(10_080),
  businessHoursOnly: z.boolean(),
  defaultAssignmentBehavior: callbackAssignmentBehaviorSchema,
});

/**
 * Recording / consent policy. Safe defaults: recording and transcription OFF.
 * `consentCaptureRequired` defaults to true when omitted from trusted parse
 * (cannot be silently forged off by missing hidden fields).
 * Transcription cannot be enabled without recording.
 */
export const recordingConsentPolicyInputSchema = z
  .object({
    recordingEnabled: z.boolean().optional().default(false),
    transcriptionEnabled: z.boolean().optional().default(false),
    consentCaptureRequired: z.boolean().optional().default(true),
    disclosureTextPlaceholder: z
      .string()
      .trim()
      .max(2000)
      .transform((value) => (value.length === 0 ? undefined : value))
      .optional()
      .nullable(),
    retentionDays: z.number().int().min(1).max(3650).optional().default(30),
    accessDefault: recordingAccessDefaultSchema
      .optional()
      .default("ADMINS_ONLY"),
    reviewRequired: z.boolean().optional().default(true),
  })
  .superRefine((data, ctx) => {
    if (data.transcriptionEnabled && !data.recordingEnabled) {
      ctx.addIssue({
        code: "custom",
        message: "Transcription requires recording to be enabled.",
        path: ["transcriptionEnabled"],
      });
    }
  });

const NOTIFICATION_CHANNELS = ["in_app", "email"] as const;

export const notificationDefaultsInputSchema = z.object({
  escalationContactLabel: optionalLabelSchema.nullable().optional(),
  escalationContactEmail: z
    .union([emailSchema, z.literal(""), z.null()])
    .optional()
    .transform((value) => {
      if (value === undefined || value === null || value === "") {
        return null;
      }
      return value;
    }),
  notificationCategories: z
    .array(z.string().trim().min(1).max(64))
    .max(40)
    .optional()
    .default([]),
  enabledChannels: z
    .array(z.enum(NOTIFICATION_CHANNELS))
    .min(1)
    .max(10)
    .optional()
    .default(["in_app"]),
  thresholdPlaceholders: z
    .record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.null()]),
    )
    .optional()
    .default({}),
});

export const templateCustomizationSchema = z.object({
  confirmedFieldKeys: z
    .array(customFieldKeySchema)
    .max(100)
    .optional()
    .default([]),
  notes: z
    .string()
    .trim()
    .max(2000, "Notes are too long.")
    .transform((value) => (value.length === 0 ? undefined : value))
    .optional()
    .nullable(),
});

export const selectBusinessTemplateSchema = z.object({
  templateKey: businessTemplateKeySchema,
  customization: templateCustomizationSchema.optional(),
});

export const confirmTemplateSwitchSchema = z.object({
  templateKey: businessTemplateKeySchema,
  expectedVersion: z.unknown(),
  customization: templateCustomizationSchema.optional(),
});

export const advanceConfigSectionSchema = z.object({
  section: configSectionSchema,
  nextSection: configSectionSchema.optional(),
  expectedVersion: z.unknown(),
  markCompleted: z.boolean().optional().default(true),
});

export function zodFieldErrors(error: z.ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "_form");
    fieldErrors[key] ??= [];
    fieldErrors[key].push(issue.message);
  }
  return fieldErrors;
}
