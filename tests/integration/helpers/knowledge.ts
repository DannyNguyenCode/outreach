import { PrismaClient } from "@prisma/client";

import type { SafeUser } from "@/lib/auth/users";
import {
  confirmKnowledgeVersion,
  createManualKnowledgeSource,
} from "@/lib/orgs/knowledge";
import {
  addMember,
  createGate,
  createOrgWithOwner as createOrgWithOwnerBase,
} from "@/tests/integration/helpers/config-3b";

export { addMember, createGate };

export async function createOrgWithOwner(
  prisma: PrismaClient,
  prefix: string,
  name?: string,
  options: { timeZone?: string | null } = {},
) {
  const ctx = await createOrgWithOwnerBase(prisma, prefix, name);
  if (options.timeZone !== null) {
    await prisma.businessProfile.upsert({
      where: { organizationId: ctx.organizationId },
      create: {
        organizationId: ctx.organizationId,
        timeZone: options.timeZone ?? "America/Toronto",
      },
      update: { timeZone: options.timeZone ?? "America/Toronto" },
    });
  }
  return ctx;
}

export const SAMPLE_DRAFT = {
  title: "Return policy",
  effectiveFrom: null as string | null,
  effectiveUntil: null as string | null,
  sections: [
    {
      title: "Overview",
      passages: [{ body: "Customers may return unused items within 30 days." }],
    },
  ],
};

export async function createSampleDraft(
  actor: SafeUser,
  organizationId: string,
  raw: Record<string, unknown> = {},
) {
  const result = await createManualKnowledgeSource({
    actor,
    organizationId,
    raw: { ...SAMPLE_DRAFT, ...raw },
  });
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result;
}

export async function confirmSample(
  actor: SafeUser,
  organizationId: string,
  sourceId: string,
  versionId: string,
  draftRevision: number,
  checksum: string,
) {
  const result = await confirmKnowledgeVersion({
    actor,
    organizationId,
    raw: {
      sourceId,
      versionId,
      expectedDraftRevision: String(draftRevision),
      expectedChecksum: checksum,
      confirmAccuracy: "on",
    },
  });
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result;
}

export async function createConfirmedKnowledge(
  prisma: PrismaClient,
  prefix: string,
) {
  const ctx = await createOrgWithOwner(prisma, prefix);
  const draft = await createSampleDraft(ctx.owner, ctx.organizationId);
  const confirmed = await confirmSample(
    ctx.owner,
    ctx.organizationId,
    draft.source.id,
    draft.version.id,
    draft.version.draftRevision,
    draft.version.contentChecksum,
  );
  return { ...ctx, source: draft.source, version: confirmed.version };
}

const KNOWLEDGE_AUDIT_ACTIONS = [
  "KNOWLEDGE_SOURCE_CREATED",
  "KNOWLEDGE_DRAFT_UPDATED",
  "KNOWLEDGE_REPLACEMENT_DRAFT_CREATED",
  "KNOWLEDGE_VERSION_CONFIRMED",
  "KNOWLEDGE_SOURCE_ARCHIVED",
  "KNOWLEDGE_VERSION_RESTORED",
] as const;

export async function countKnowledgeAudits(
  prisma: PrismaClient,
  organizationId: string,
  action?: (typeof KNOWLEDGE_AUDIT_ACTIONS)[number],
) {
  return prisma.organizationAuditEvent.count({
    where: {
      organizationId,
      action: action ?? { in: [...KNOWLEDGE_AUDIT_ACTIONS] },
    },
  });
}
