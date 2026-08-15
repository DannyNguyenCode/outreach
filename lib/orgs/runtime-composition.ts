import "server-only";

import type { SafeUser } from "@/lib/auth/users";
import { requireOrganizationPermission } from "@/lib/orgs/authorization";
import { mapAuthError, type AuthFailure } from "@/lib/orgs/business-access";
import { retrieveActiveKnowledge } from "@/lib/orgs/knowledge-retrieval";
import { retrieveActiveOfferings } from "@/lib/orgs/offering-retrieval";
import {
  compareRuntimeEvidence,
  detectDeterministicConflicts,
} from "@/lib/orgs/runtime-composition-logic";
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
import {
  adaptKnowledgePassagesToRuntimeEvidence,
  adaptOfferingsToRuntimeEvidence,
} from "@/lib/orgs/runtime-source-adapters";

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

export {
  compareRuntimeEvidence,
  detectDeterministicConflicts,
} from "@/lib/orgs/runtime-composition-logic";

export function assertRuntimeAdapterRegistryIsExhaustive(): void {
  for (const sourceClass of RUNTIME_SOURCE_CLASSES) {
    if (!(sourceClass in RUNTIME_SOURCE_ADAPTERS)) {
      throw new Error(`Missing runtime adapter declaration: ${sourceClass}`);
    }
  }
}
