import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import { requireExpectedVersion } from "@/lib/orgs/business-validation";

export { requireExpectedVersion };

export const KNOWLEDGE_CONFIRMATION_LANGUAGE_VERSION = "knowledge.confirm.v1";

export const KNOWLEDGE_CONFIRMATION_STATEMENT =
  "I am authorized to provide this information for this organization. I have reviewed this exact version and take responsibility for its accuracy. Outreach does not independently verify that this information is true or legally valid.";

export const KNOWLEDGE_TITLE_MAX = 200;
export const KNOWLEDGE_SECTION_TITLE_MAX = 200;
export const KNOWLEDGE_PASSAGE_BODY_MAX = 8_000;
export const KNOWLEDGE_MAX_SECTIONS = 40;
export const KNOWLEDGE_MAX_PASSAGES_PER_SECTION = 40;
export const KNOWLEDGE_MAX_PASSAGES_TOTAL = 200;
export const KNOWLEDGE_SEARCH_MAX = 200;
export const KNOWLEDGE_PAGE_SIZE_DEFAULT = 20;
export const KNOWLEDGE_PAGE_SIZE_MAX = 50;

export const KNOWLEDGE_ACTIVATABLE_CATEGORY =
  "CUSTOMER_CONFIRMED_BUSINESS_FACTS" as const;

const TITLE_MESSAGE = `Enter a title (1–${KNOWLEDGE_TITLE_MAX} characters).`;

export type CanonicalKnowledgePassage = {
  citationKey: string;
  body: string;
};

export type CanonicalKnowledgeSection = {
  citationKey: string;
  title: string;
  passages: CanonicalKnowledgePassage[];
};

export type CanonicalKnowledgeContent = {
  title: string;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  sections: CanonicalKnowledgeSection[];
};

export type KnowledgeDraftPassageInput = {
  citationKey?: string;
  body: string;
};

export type KnowledgeDraftSectionInput = {
  citationKey?: string;
  title: string;
  passages: KnowledgeDraftPassageInput[];
};

const citationKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(
    /^[A-Za-z0-9_-]+$/,
    "Citation keys may only use letters, numbers, _ and -.",
  );

const passageInputSchema = z.object({
  citationKey: citationKeySchema.optional(),
  body: z
    .string()
    .trim()
    .min(1, "Each passage needs body text.")
    .max(
      KNOWLEDGE_PASSAGE_BODY_MAX,
      `Passage text must be at most ${KNOWLEDGE_PASSAGE_BODY_MAX} characters.`,
    ),
});

const sectionInputSchema = z.object({
  citationKey: citationKeySchema.optional(),
  title: z
    .string()
    .trim()
    .min(1, "Each section needs a title.")
    .max(
      KNOWLEDGE_SECTION_TITLE_MAX,
      `Section titles must be at most ${KNOWLEDGE_SECTION_TITLE_MAX} characters.`,
    ),
  passages: z
    .array(passageInputSchema)
    .min(1, "Each section needs at least one passage.")
    .max(
      KNOWLEDGE_MAX_PASSAGES_PER_SECTION,
      `Each section may have at most ${KNOWLEDGE_MAX_PASSAGES_PER_SECTION} passages.`,
    ),
});

const optionalInstantSchema = z
  .union([z.string(), z.date(), z.null(), z.undefined()])
  .optional()
  .transform((value, ctx) => {
    if (value === undefined || value === null || value === "") {
      return null;
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      ctx.addIssue({
        code: "custom",
        message: "Enter a valid date and time.",
      });
      return z.NEVER;
    }
    return date;
  });

const knowledgeContentFields = {
  title: z
    .string()
    .trim()
    .min(1, TITLE_MESSAGE)
    .max(KNOWLEDGE_TITLE_MAX, TITLE_MESSAGE),
  effectiveFrom: optionalInstantSchema,
  effectiveUntil: optionalInstantSchema,
  sections: z
    .array(sectionInputSchema)
    .min(1, "Add at least one section.")
    .max(
      KNOWLEDGE_MAX_SECTIONS,
      `A version may have at most ${KNOWLEDGE_MAX_SECTIONS} sections.`,
    ),
};

function refineEffectiveRange(
  data: { effectiveFrom: Date | null; effectiveUntil: Date | null },
  ctx: z.RefinementCtx,
) {
  if (
    data.effectiveFrom &&
    data.effectiveUntil &&
    data.effectiveUntil.getTime() <= data.effectiveFrom.getTime()
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["effectiveUntil"],
      message: "Effective until must be after effective from.",
    });
  }
}

function refinePassageCount(
  data: { sections: KnowledgeDraftSectionInput[] },
  ctx: z.RefinementCtx,
) {
  const total = data.sections.reduce(
    (sum, section) => sum + section.passages.length,
    0,
  );
  if (total > KNOWLEDGE_MAX_PASSAGES_TOTAL) {
    ctx.addIssue({
      code: "custom",
      path: ["sections"],
      message: `A version may have at most ${KNOWLEDGE_MAX_PASSAGES_TOTAL} passages.`,
    });
  }
}

export const knowledgeDraftContentSchema = z
  .object(knowledgeContentFields)
  .superRefine(refineEffectiveRange)
  .superRefine(refinePassageCount);

export const createManualKnowledgeSchema = knowledgeDraftContentSchema;

export const updateKnowledgeDraftSchema = knowledgeDraftContentSchema.extend({
  sourceId: z.string().trim().min(1, "Source is required."),
  versionId: z.string().trim().min(1, "Version is required."),
  expectedDraftRevision: z.unknown(),
});

const confirmAccuracySchema = z
  .union([z.literal(true), z.literal("on"), z.literal("true"), z.literal("1")])
  .transform(() => true as const);

export const confirmKnowledgeSchema = z.object({
  sourceId: z.string().trim().min(1, "Source is required."),
  versionId: z.string().trim().min(1, "Version is required."),
  expectedDraftRevision: z.unknown(),
  expectedChecksum: z
    .string()
    .trim()
    .regex(/^[a-f0-9]{64}$/i, "Preview checksum is invalid."),
  confirmAccuracy: confirmAccuracySchema,
});

export const archiveKnowledgeSchema = z.object({
  sourceId: z.string().trim().min(1, "Source is required."),
  expectedVersion: z.unknown(),
});

export const restoreKnowledgeSchema = z.object({
  sourceId: z.string().trim().min(1, "Source is required."),
  versionId: z.string().trim().min(1, "Version is required."),
  expectedVersion: z.unknown(),
});

export const replacementDraftSchema = z.object({
  sourceId: z.string().trim().min(1, "Source is required."),
  expectedVersion: z.unknown(),
});

export function parseContentJson(raw: unknown): unknown {
  if (typeof raw !== "string") {
    return raw;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return { _invalidJson: true };
  }
}

export function sanitizeSearchQuery(raw: unknown): string {
  if (typeof raw !== "string") {
    return "";
  }
  return raw
    .replace(/[%_\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, KNOWLEDGE_SEARCH_MAX);
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
    return KNOWLEDGE_PAGE_SIZE_DEFAULT;
  }
  const value = Number(String(raw));
  if (!Number.isInteger(value) || value < 1) {
    return KNOWLEDGE_PAGE_SIZE_DEFAULT;
  }
  return Math.min(value, KNOWLEDGE_PAGE_SIZE_MAX);
}

export function assignCitationKeys(
  sections: KnowledgeDraftSectionInput[],
): CanonicalKnowledgeSection[] {
  const used = new Set<string>();
  return sections.map((section) => {
    const sectionKey = uniqueCitationKey(section.citationKey, "sec", used);
    const passages = section.passages.map((passage) => ({
      citationKey: uniqueCitationKey(passage.citationKey, "pas", used),
      body: passage.body.trim(),
    }));
    return {
      citationKey: sectionKey,
      title: section.title.trim(),
      passages,
    };
  });
}

function uniqueCitationKey(
  candidate: string | undefined,
  prefix: string,
  used: Set<string>,
): string {
  const trimmed = candidate?.trim();
  if (trimmed && /^[A-Za-z0-9_-]+$/.test(trimmed) && !used.has(trimmed)) {
    used.add(trimmed);
    return trimmed;
  }
  let next = `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  while (used.has(next)) {
    next = `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  }
  used.add(next);
  return next;
}

export function toCanonicalContent(input: {
  title: string;
  effectiveFrom: Date | null;
  effectiveUntil: Date | null;
  sections: CanonicalKnowledgeSection[];
}): CanonicalKnowledgeContent {
  return {
    title: input.title.trim(),
    effectiveFrom: input.effectiveFrom
      ? input.effectiveFrom.toISOString()
      : null,
    effectiveUntil: input.effectiveUntil
      ? input.effectiveUntil.toISOString()
      : null,
    sections: input.sections.map((section) => ({
      citationKey: section.citationKey,
      title: section.title,
      passages: section.passages.map((passage) => ({
        citationKey: passage.citationKey,
        body: passage.body,
      })),
    })),
  };
}

export function computeKnowledgeChecksum(
  content: CanonicalKnowledgeContent,
): string {
  const payload = JSON.stringify(content);
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

export function checksumFromDraft(input: {
  title: string;
  effectiveFrom: Date | null;
  effectiveUntil: Date | null;
  sections: KnowledgeDraftSectionInput[];
}): {
  sections: CanonicalKnowledgeSection[];
  canonical: CanonicalKnowledgeContent;
  checksum: string;
} {
  const sections = assignCitationKeys(input.sections);
  const canonical = toCanonicalContent({
    title: input.title,
    effectiveFrom: input.effectiveFrom,
    effectiveUntil: input.effectiveUntil,
    sections,
  });
  return {
    sections,
    canonical,
    checksum: computeKnowledgeChecksum(canonical),
  };
}

export function zodFieldErrors(error: z.ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "_form");
    fieldErrors[key] ??= [];
    fieldErrors[key].push(issue.message);
  }
  return fieldErrors;
}

export const INACTIVE_KNOWLEDGE_STATES = [
  "DRAFT",
  "PROCESSING",
  "NEEDS_ATTENTION",
  "SUPERSEDED",
  "ARCHIVED",
  "FAILED",
] as const;
