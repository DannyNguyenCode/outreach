/**
 * Canonical KNOW-004 runtime source classes. Every new class must be added to
 * this registry with explicit authority and claim-scope semantics.
 */
export const RUNTIME_SOURCE_CLASSES = [
  "CUSTOMER_CONFIRMED_KNOWLEDGE",
  "STRUCTURED_OFFERING",
  "PROSPECT_EVIDENCE",
  "CRM_FACT",
  "CALLER_STATEMENT",
  "REPRESENTATIVE_NOTE",
  "OPERATIONAL_DATA",
  "AI_INFERENCE",
  "UNKNOWN",
  "CONFLICT",
] as const;

export type RuntimeSourceClass = (typeof RUNTIME_SOURCE_CLASSES)[number];

export const STRUCTURED_OFFERING_SOURCE_CLASS = RUNTIME_SOURCE_CLASSES[1];

export type RuntimeAuthorityClassification =
  | "ORGANIZATION_AUTHORITATIVE"
  | "PROSPECT_SPECIFIC_CONTEXT"
  | "OPERATIONAL_CURRENT"
  | "INFERENCE_ONLY"
  | "NO_AUTHORITY";

export type RuntimeClaimScope =
  "ORGANIZATION" | "PROSPECT" | "CALL" | "OPERATIONAL" | "NONE";

export type RuntimeSourceDefinition = {
  label: string;
  description: string;
  authority: RuntimeAuthorityClassification;
  claimScope: RuntimeClaimScope;
  authorityOrder: number;
  implementedInPhase4D: boolean;
  maySupportOrganizationClaim: boolean;
};

export const RUNTIME_SOURCE_REGISTRY = {
  CUSTOMER_CONFIRMED_KNOWLEDGE: {
    label: "Customer-confirmed business knowledge",
    description:
      "Current, customer-confirmed manual or private-document knowledge about the organization using Outreach.",
    authority: "ORGANIZATION_AUTHORITATIVE",
    claimScope: "ORGANIZATION",
    authorityOrder: 30,
    implementedInPhase4D: true,
    maySupportOrganizationClaim: true,
  },
  STRUCTURED_OFFERING: {
    label: "Structured offering",
    description:
      "Current, confirmed structured offerings, prices, variants, features, eligibility, and custom values.",
    authority: "ORGANIZATION_AUTHORITATIVE",
    claimScope: "ORGANIZATION",
    authorityOrder: 20,
    implementedInPhase4D: true,
    maySupportOrganizationClaim: true,
  },
  PROSPECT_EVIDENCE: {
    label: "Prospect evidence",
    description:
      "Evidence about one prospect, such as an authorized website audit; never a reusable fact about the Outreach organization.",
    authority: "PROSPECT_SPECIFIC_CONTEXT",
    claimScope: "PROSPECT",
    authorityOrder: 40,
    implementedInPhase4D: false,
    maySupportOrganizationClaim: false,
  },
  CRM_FACT: {
    label: "CRM or prior-interaction fact",
    description:
      "Organization-scoped CRM history describing a particular prospect or interaction.",
    authority: "PROSPECT_SPECIFIC_CONTEXT",
    claimScope: "PROSPECT",
    authorityOrder: 40,
    implementedInPhase4D: false,
    maySupportOrganizationClaim: false,
  },
  CALLER_STATEMENT: {
    label: "Caller statement",
    description:
      "A statement attributed to a caller in a particular call; it is not confirmed organization knowledge.",
    authority: "PROSPECT_SPECIFIC_CONTEXT",
    claimScope: "CALL",
    authorityOrder: 40,
    implementedInPhase4D: false,
    maySupportOrganizationClaim: false,
  },
  REPRESENTATIVE_NOTE: {
    label: "Representative note",
    description:
      "A labelled human note or confirmation tied to a prospect or call, not automatically reusable business knowledge.",
    authority: "PROSPECT_SPECIFIC_CONTEXT",
    claimScope: "PROSPECT",
    authorityOrder: 50,
    implementedInPhase4D: false,
    maySupportOrganizationClaim: false,
  },
  OPERATIONAL_DATA: {
    label: "Live operational data",
    description:
      "Current operational state that may supersede static data only for the exact operational fact represented.",
    authority: "OPERATIONAL_CURRENT",
    claimScope: "OPERATIONAL",
    authorityOrder: 10,
    implementedInPhase4D: false,
    maySupportOrganizationClaim: false,
  },
  AI_INFERENCE: {
    label: "AI inference",
    description:
      "A model-derived inference that must remain labelled and can never masquerade as an authoritative source.",
    authority: "INFERENCE_ONLY",
    claimScope: "NONE",
    authorityOrder: 60,
    implementedInPhase4D: false,
    maySupportOrganizationClaim: false,
  },
  UNKNOWN: {
    label: "Unknown",
    description:
      "No current authorized evidence supports the requested business-specific claim.",
    authority: "NO_AUTHORITY",
    claimScope: "NONE",
    authorityOrder: 80,
    implementedInPhase4D: true,
    maySupportOrganizationClaim: false,
  },
  CONFLICT: {
    label: "Conflict",
    description:
      "Current evidence disagrees and must be shown without automatic truth arbitration.",
    authority: "NO_AUTHORITY",
    claimScope: "NONE",
    authorityOrder: 70,
    implementedInPhase4D: true,
    maySupportOrganizationClaim: false,
  },
} as const satisfies Record<RuntimeSourceClass, RuntimeSourceDefinition>;

export const PHASE_4D_COMPOSABLE_SOURCE_CLASSES = [
  "CUSTOMER_CONFIRMED_KNOWLEDGE",
  "STRUCTURED_OFFERING",
] as const satisfies readonly RuntimeSourceClass[];

export type Phase4DComposableSourceClass =
  (typeof PHASE_4D_COMPOSABLE_SOURCE_CLASSES)[number];

export type ClientSafeStructuredValue =
  | string
  | number
  | boolean
  | null
  | ClientSafeStructuredValue[]
  | { [key: string]: ClientSafeStructuredValue };

const STRUCTURED_VALUE_MAX_DEPTH = 4;
const STRUCTURED_VALUE_MAX_KEYS = 40;
const STRUCTURED_VALUE_STRING_MAX = 500;

/**
 * Converts validated domain values into a bounded client-safe shape. Database
 * JSON is never passed through directly.
 */
export function toClientSafeStructuredValue(
  value: unknown,
  depth = 0,
): ClientSafeStructuredValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    return value.slice(0, STRUCTURED_VALUE_STRING_MAX);
  }
  if (depth >= STRUCTURED_VALUE_MAX_DEPTH) return "[bounded]";
  if (Array.isArray(value)) {
    return value
      .slice(0, STRUCTURED_VALUE_MAX_KEYS)
      .map((entry) => toClientSafeStructuredValue(entry, depth + 1));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, STRUCTURED_VALUE_MAX_KEYS)
        .map(([key, entry]) => [
          key.slice(0, 100),
          toClientSafeStructuredValue(entry, depth + 1),
        ]),
    );
  }
  return String(value).slice(0, STRUCTURED_VALUE_STRING_MAX);
}

export type RuntimeKnowledgeProvenance = {
  kind: "KNOWLEDGE_PASSAGE";
  inputKind: "MANUAL" | "DOCUMENT";
  sourceId: string;
  versionId: string;
  sectionId: string;
  passageId: string;
  sectionCitationKey: string;
  passageCitationKey: string;
  sourceTitle: string;
};

export type RuntimeOfferingProvenance = {
  kind:
    | "OFFERING"
    | "PRICE"
    | "VARIANT"
    | "FEATURE"
    | "ELIGIBILITY"
    | "CUSTOM_VALUE";
  offeringId: string;
  versionId: string;
  priceId?: string;
  variantId?: string;
  featureId?: string;
  eligibilityId?: string;
  customValueId?: string;
  customDefinitionId?: string;
  customDefinitionKey?: string;
};

export type RuntimeFutureSourceProvenance = {
  kind: "FUTURE_SOURCE";
  sourceEntityId: string;
  sourceVersionId?: string;
  locator?: string;
};

export type RuntimeEvidenceProvenance =
  | RuntimeKnowledgeProvenance
  | RuntimeOfferingProvenance
  | RuntimeFutureSourceProvenance;

export type RuntimeFreshness = {
  state: "CURRENT" | "UNKNOWN";
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  confirmedAt: string | null;
  observedAt: string | null;
};

export type RuntimeEvidenceItem = {
  evidenceId: string;
  organizationId: string;
  sourceClass: RuntimeSourceClass;
  claimScope: RuntimeClaimScope;
  prospectId?: string;
  callId?: string;
  title: string;
  safeText: string;
  promptSafeText: string;
  structuredValue?: ClientSafeStructuredValue;
  sourceEntityId: string;
  sourceVersionId?: string;
  sourceChildId?: string;
  provenance: RuntimeEvidenceProvenance;
  freshness: RuntimeFreshness;
  authority: {
    classification: RuntimeAuthorityClassification;
    order: number;
    maySupportOrganizationClaim: boolean;
  };
  visibility: {
    scope: "ORGANIZATION_AUTHORIZED";
    requiredPermission: "org.knowledge.read";
  };
  relevance?: {
    strategy: "DETERMINISTIC_SUBSTRING";
    rank: number | null;
  };
};

export type OrganizationRuntimeEvidence = RuntimeEvidenceItem & {
  sourceClass: "CUSTOMER_CONFIRMED_KNOWLEDGE" | "STRUCTURED_OFFERING";
  claimScope: "ORGANIZATION";
  prospectId?: never;
  callId?: never;
};

export type ProspectRuntimeEvidence = RuntimeEvidenceItem & {
  sourceClass:
    | "PROSPECT_EVIDENCE"
    | "CRM_FACT"
    | "CALLER_STATEMENT"
    | "REPRESENTATIVE_NOTE";
  claimScope: "PROSPECT" | "CALL";
  prospectId: string;
};

export type RuntimeEvidenceConflict = {
  conflictId: string;
  kind: "STRUCTURED_PRICE_MISMATCH";
  message: string;
  evidenceIds: readonly [string, string];
  sourceClasses: readonly RuntimeSourceClass[];
  provenance: readonly RuntimeEvidenceProvenance[];
};

export type RuntimeSupportState = "SUPPORTED" | "UNKNOWN" | "CONFLICT";

export type RuntimeCompositionAuditRecord = {
  organizationId: string;
  actorUserId: string;
  prospectId?: string;
  callId?: string;
  requestedSourceClasses: RuntimeSourceClass[];
  returnedEvidenceRefs: Array<{
    evidenceId: string;
    sourceClass: RuntimeSourceClass;
    sourceEntityId: string;
    sourceVersionId?: string;
    sourceChildId?: string;
  }>;
  supportState: RuntimeSupportState;
  conflictIds: string[];
  composedAt: string;
};

export class RuntimeCompositionInputError extends Error {
  constructor(
    readonly code:
      | "invalid_source_class"
      | "invalid_query"
      | "invalid_limit"
      | "missing_prospect_context"
      | "missing_call_context",
    message: string,
  ) {
    super(message);
    this.name = "RuntimeCompositionInputError";
  }
}

export function isRuntimeSourceClass(
  value: unknown,
): value is RuntimeSourceClass {
  return (
    typeof value === "string" &&
    (RUNTIME_SOURCE_CLASSES as readonly string[]).includes(value)
  );
}

export function parseRequestedSourceClasses(
  value: unknown,
): RuntimeSourceClass[] {
  if (value === undefined) {
    return [...PHASE_4D_COMPOSABLE_SOURCE_CLASSES];
  }
  if (!Array.isArray(value)) {
    throw new RuntimeCompositionInputError(
      "invalid_source_class",
      "Requested source classes must be an array.",
    );
  }
  const result: RuntimeSourceClass[] = [];
  for (const sourceClass of value) {
    if (!isRuntimeSourceClass(sourceClass)) {
      throw new RuntimeCompositionInputError(
        "invalid_source_class",
        "A requested source class is not supported.",
      );
    }
    if (!result.includes(sourceClass)) result.push(sourceClass);
  }
  return result;
}

export const RUNTIME_QUERY_MAX_LENGTH = 200;
export const RUNTIME_RESULT_LIMIT_DEFAULT = 20;
export const RUNTIME_RESULT_LIMIT_MAX = 50;
export const RUNTIME_ITEM_TEXT_MAX_LENGTH = 1_600;

export function parseRuntimeQuery(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || value.length > RUNTIME_QUERY_MAX_LENGTH) {
    throw new RuntimeCompositionInputError(
      "invalid_query",
      `Query must be at most ${RUNTIME_QUERY_MAX_LENGTH} characters.`,
    );
  }
  return value
    .replace(/[%_\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseRuntimeLimit(value: unknown): number {
  if (value === undefined || value === null || value === "") {
    return RUNTIME_RESULT_LIMIT_DEFAULT;
  }
  const limit = Number(value);
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > RUNTIME_RESULT_LIMIT_MAX
  ) {
    throw new RuntimeCompositionInputError(
      "invalid_limit",
      `Result limit must be between 1 and ${RUNTIME_RESULT_LIMIT_MAX}.`,
    );
  }
  return limit;
}

/**
 * Bounded source rendering for prompts and UI. `safeText` keeps the original
 * bounded customer content for the inspector. `promptSafeText` JSON-encodes
 * that body onto a single line between reserved header/footer markers so a
 * source containing those markers cannot forge or duplicate the boundary.
 * Future prompt builders must place this value in a source-data channel.
 */
export function renderRuntimeSourceText(
  sourceClass: RuntimeSourceClass,
  value: unknown,
  maxLength = RUNTIME_ITEM_TEXT_MAX_LENGTH,
): { safeText: string; promptSafeText: string; truncated: boolean } {
  const raw =
    typeof value === "string"
      ? value
      : value === null || value === undefined
        ? ""
        : String(value);
  const normalized = raw
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  const boundedMax = Math.max(
    1,
    Math.min(maxLength, RUNTIME_ITEM_TEXT_MAX_LENGTH),
  );
  const truncated = normalized.length > boundedMax;
  const safeText = truncated
    ? `${normalized.slice(0, Math.max(1, boundedMax - 1))}…`
    : normalized;
  return {
    safeText,
    promptSafeText: [
      `[SOURCE CONTENT — ${sourceClass}]`,
      JSON.stringify(safeText),
      "[END SOURCE CONTENT]",
    ].join("\n"),
    truncated,
  };
}

export function runtimeAuthorityFor(sourceClass: RuntimeSourceClass) {
  const definition = RUNTIME_SOURCE_REGISTRY[sourceClass];
  return {
    classification: definition.authority,
    order: definition.authorityOrder,
    maySupportOrganizationClaim: definition.maySupportOrganizationClaim,
  } as const;
}
