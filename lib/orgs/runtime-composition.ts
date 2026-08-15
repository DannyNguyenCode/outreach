import "server-only";

import type { SafeUser } from "@/lib/auth/users";
import { requireOrganizationPermission } from "@/lib/orgs/authorization";
import { mapAuthError, type AuthFailure } from "@/lib/orgs/business-access";
import { retrieveActiveKnowledge } from "@/lib/orgs/knowledge-retrieval";
import { retrieveActiveOfferings } from "@/lib/orgs/offering-retrieval";
import {
  adaptKnowledgePassagesToRuntimeEvidence,
  adaptOfferingsToRuntimeEvidence,
} from "@/lib/orgs/runtime-source-adapters";
import {
  parseRequestedSourceClasses,
  parseRuntimeLimit,
  parseRuntimeQuery,
  RUNTIME_SOURCE_CLASSES,
  RUNTIME_SOURCE_REGISTRY,
  RuntimeCompositionInputError,
  type OrganizationRuntimeEvidence,
  type RuntimeCompositionAuditRecord,
  type RuntimeEvidenceConflict,
  type RuntimeEvidenceItem,
  type RuntimeSourceClass,
  type RuntimeSupportState,
} from "@/lib/orgs/runtime-evidence";

type RuntimeSourceAdapter = (input: {
  actor: SafeUser;
  organizationId: string;
  query: string;
  limit: number;
}) => Promise<OrganizationRuntimeEvidence[]>;

/**
 * Exhaustive adapter declaration. Future source classes cannot become
 * composable merely by adding a string: their registry entry and adapter must
 * both be reviewed.
 */
export const RUNTIME_SOURCE_ADAPTERS = {
  CUSTOMER_CONFIRMED_KNOWLEDGE: composeKnowledgeEvidence,
  STRUCTURED_OFFERING: composeOfferingEvidence,
  PROSPECT_EVIDENCE: null,
  CRM_FACT: null,
  CALLER_STATEMENT: null,
  REPRESENTATIVE_NOTE: null,
  OPERATIONAL_DATA: null,
  AI_INFERENCE: null,
  UNKNOWN: null,
  CONFLICT: null,
} as const satisfies Record<RuntimeSourceClass, RuntimeSourceAdapter | null>;

export type RuntimeCompositionSuccess = {
  ok: true;
  supportState: RuntimeSupportState;
  items: RuntimeEvidenceItem[];
  conflicts: RuntimeEvidenceConflict[];
  requestedSourceClasses: RuntimeSourceClass[];
  unavailableSourceClasses: RuntimeSourceClass[];
  limit: number;
  query: string;
  audit: RuntimeCompositionAuditRecord;
};

export type RuntimeCompositionResult =
  | RuntimeCompositionSuccess
  | AuthFailure
  | {
      ok: false;
      reason: "invalid_input" | "failed";
      message: string;
    };

export async function composeRuntimeContext(input: {
  actor: SafeUser;
  organizationId: string;
  prospectId?: string;
  callId?: string;
  query?: unknown;
  requestedSourceClasses?: unknown;
  limit?: unknown;
}): Promise<RuntimeCompositionResult> {
  let query: string;
  let limit: number;
  let requestedSourceClasses: RuntimeSourceClass[];
  try {
    query = parseRuntimeQuery(input.query);
    limit = parseRuntimeLimit(input.limit);
    requestedSourceClasses = parseRequestedSourceClasses(
      input.requestedSourceClasses,
    );
    validateSourceContext(
      requestedSourceClasses,
      input.prospectId,
      input.callId,
    );
  } catch (error) {
    if (error instanceof RuntimeCompositionInputError) {
      return { ok: false, reason: "invalid_input", message: error.message };
    }
    throw error;
  }

  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.knowledge.read",
    });

    const adapterCalls = requestedSourceClasses.flatMap((sourceClass) => {
      const adapter = RUNTIME_SOURCE_ADAPTERS[sourceClass];
      return adapter
        ? [
            adapter({
              actor: input.actor,
              organizationId: input.organizationId,
              query,
              limit,
            }),
          ]
        : [];
    });
    const adapted = (await Promise.all(adapterCalls)).flat();
    const tenantSafe = adapted.filter(
      (item) => item.organizationId === input.organizationId,
    );
    const ordered = [...tenantSafe].sort(compareRuntimeEvidence);
    const items = ordered.slice(0, limit);
    const conflicts = detectDeterministicConflicts(items);
    const supportState: RuntimeSupportState =
      conflicts.length > 0
        ? "CONFLICT"
        : items.length === 0
          ? "UNKNOWN"
          : "SUPPORTED";
    const unavailableSourceClasses = requestedSourceClasses.filter(
      (sourceClass) =>
        !RUNTIME_SOURCE_REGISTRY[sourceClass].implementedInPhase4D ||
        RUNTIME_SOURCE_ADAPTERS[sourceClass] === null,
    );
    const composedAt = new Date().toISOString();
    const audit: RuntimeCompositionAuditRecord = {
      organizationId: input.organizationId,
      actorUserId: input.actor.id,
      prospectId: input.prospectId,
      callId: input.callId,
      requestedSourceClasses,
      returnedEvidenceRefs: items.map((item) => ({
        evidenceId: item.evidenceId,
        sourceClass: item.sourceClass,
        sourceEntityId: item.sourceEntityId,
        sourceVersionId: item.sourceVersionId,
        sourceChildId: item.sourceChildId,
      })),
      supportState,
      conflictIds: conflicts.map((conflict) => conflict.conflictId),
      composedAt,
    };
    return {
      ok: true,
      supportState,
      items,
      conflicts,
      requestedSourceClasses,
      unavailableSourceClasses,
      limit,
      query,
      audit,
    };
  } catch (error) {
    if (error instanceof RuntimeAdapterError) {
      return error.failure;
    }
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not compose runtime evidence.",
      }
    );
  }
}

async function composeKnowledgeEvidence(input: {
  actor: SafeUser;
  organizationId: string;
  query: string;
  limit: number;
}): Promise<OrganizationRuntimeEvidence[]> {
  const result = await retrieveActiveKnowledge({
    actor: input.actor,
    organizationId: input.organizationId,
    query: input.query,
    page: 1,
    pageSize: input.limit,
  });
  if (!result.ok) {
    throw new RuntimeAdapterError(result);
  }
  return adaptKnowledgePassagesToRuntimeEvidence(
    input.organizationId,
    result.items,
  );
}

async function composeOfferingEvidence(input: {
  actor: SafeUser;
  organizationId: string;
  query: string;
  limit: number;
}): Promise<OrganizationRuntimeEvidence[]> {
  const result = await retrieveActiveOfferings({
    actor: input.actor,
    organizationId: input.organizationId,
    query: input.query,
    page: 1,
    pageSize: input.limit,
  });
  if (!result.ok) {
    throw new RuntimeAdapterError(result);
  }
  return adaptOfferingsToRuntimeEvidence(input.organizationId, result.items);
}

class RuntimeAdapterError extends Error {
  constructor(readonly failure: AuthFailure) {
    super(failure.message);
    this.name = "RuntimeAdapterError";
  }
}

function validateSourceContext(
  sourceClasses: RuntimeSourceClass[],
  prospectId: string | undefined,
  callId: string | undefined,
): void {
  const requiresProspect = sourceClasses.some((sourceClass) =>
    (
      [
        "PROSPECT_EVIDENCE",
        "CRM_FACT",
        "REPRESENTATIVE_NOTE",
      ] as RuntimeSourceClass[]
    ).includes(sourceClass),
  );
  if (requiresProspect && !prospectId) {
    throw new RuntimeCompositionInputError(
      "missing_prospect_context",
      "Prospect-specific source classes require a prospect ID.",
    );
  }
  if (sourceClasses.includes("CALLER_STATEMENT") && (!prospectId || !callId)) {
    throw new RuntimeCompositionInputError(
      "missing_call_context",
      "Caller statements require both prospect and call IDs.",
    );
  }
}

export function compareRuntimeEvidence(
  left: RuntimeEvidenceItem,
  right: RuntimeEvidenceItem,
): number {
  return (
    left.authority.order - right.authority.order ||
    childKindOrder(left) - childKindOrder(right) ||
    left.title.localeCompare(right.title) ||
    left.evidenceId.localeCompare(right.evidenceId)
  );
}

function childKindOrder(item: RuntimeEvidenceItem): number {
  if (item.provenance.kind === "PRICE") return 0;
  if (item.provenance.kind === "OFFERING") return 1;
  if (item.provenance.kind === "VARIANT") return 2;
  if (item.provenance.kind === "FEATURE") return 3;
  if (item.provenance.kind === "ELIGIBILITY") return 4;
  if (item.provenance.kind === "CUSTOM_VALUE") return 5;
  return 10;
}

/**
 * Phase 4D exact detector: a current base structured price conflicts with a
 * customer-confirmed passage only when that passage names the offering and
 * contains an explicit different money amount. It does not attempt semantic
 * conflict resolution.
 */
export function detectDeterministicConflicts(
  items: RuntimeEvidenceItem[],
): RuntimeEvidenceConflict[] {
  const knowledge = items.filter(
    (item) => item.sourceClass === "CUSTOMER_CONFIRMED_KNOWLEDGE",
  );
  const prices = items.filter(isBasePriceEvidence);
  const conflicts: RuntimeEvidenceConflict[] = [];
  for (const price of prices) {
    const value = price.structuredValue as {
      amount: string;
      currencyCode: string;
    };
    const offeringName = price.title.split(" — ")[0] ?? price.title;
    const normalizedOffering = normalizeWords(offeringName);
    for (const passage of knowledge) {
      if (!normalizeWords(passage.safeText).includes(normalizedOffering)) {
        continue;
      }
      const statedAmounts = extractMoneyAmounts(
        passage.safeText,
        value.currencyCode,
      );
      if (
        statedAmounts.length === 0 ||
        statedAmounts.some((amount) => amountsEqual(amount, value.amount))
      ) {
        continue;
      }
      const evidenceIds = [price.evidenceId, passage.evidenceId].sort() as [
        string,
        string,
      ];
      conflicts.push({
        conflictId: `price-conflict:${evidenceIds.join(":")}`,
        kind: "STRUCTURED_PRICE_MISMATCH",
        message: `${offeringName} has conflicting current price evidence.`,
        evidenceIds,
        sourceClasses: [price.sourceClass, passage.sourceClass],
        provenance: [price.provenance, passage.provenance],
      });
    }
  }
  return conflicts.sort((left, right) =>
    left.conflictId.localeCompare(right.conflictId),
  );
}

function isBasePriceEvidence(
  item: RuntimeEvidenceItem,
): item is RuntimeEvidenceItem & {
  structuredValue: {
    kind: "price";
    amount: string;
    currencyCode: string;
    variantId: null;
  };
} {
  if (
    item.sourceClass !== "STRUCTURED_OFFERING" ||
    item.provenance.kind !== "PRICE" ||
    !item.structuredValue ||
    Array.isArray(item.structuredValue) ||
    typeof item.structuredValue !== "object"
  ) {
    return false;
  }
  return (
    item.structuredValue.kind === "price" &&
    item.structuredValue.variantId === null &&
    typeof item.structuredValue.amount === "string" &&
    typeof item.structuredValue.currencyCode === "string"
  );
}

function extractMoneyAmounts(text: string, currencyCode: string): string[] {
  const escapedCode = currencyCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `(?:${escapedCode}|[$€£])\\s*([0-9]+(?:\\.[0-9]{1,4})?)`,
    "gi",
  );
  return [...text.matchAll(pattern)].map((match) => match[1] ?? "");
}

function amountsEqual(left: string, right: string): boolean {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  return (
    Number.isFinite(leftNumber) &&
    Number.isFinite(rightNumber) &&
    leftNumber === rightNumber
  );
}

function normalizeWords(value: string): string {
  return value.toLocaleLowerCase("en").replace(/\s+/g, " ").trim();
}

export function assertRuntimeAdapterRegistryIsExhaustive(): void {
  for (const sourceClass of RUNTIME_SOURCE_CLASSES) {
    if (!(sourceClass in RUNTIME_SOURCE_ADAPTERS)) {
      throw new Error(`Missing runtime adapter declaration: ${sourceClass}`);
    }
  }
}
