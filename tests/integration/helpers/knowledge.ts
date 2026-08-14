import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";

import type { SafeUser } from "@/lib/auth/users";
import { KNOWLEDGE_CONFIRMATION_LANGUAGE_VERSION } from "@/lib/orgs/knowledge-confirmation";
import {
  archiveKnowledgeSource,
  confirmKnowledgeVersion,
  createManualKnowledgeSource,
  createReplacementDraft,
  updateKnowledgeDraft,
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

export type KnowledgeIdPair = {
  sourceId: string;
  versionId: string;
  title: string;
};

/**
 * Not a product input kind. Used only to prove member SQL filters reject
 * non-MANUAL rows without implementing Phase 4B writers.
 */
export const TEST_NON_MANUAL_INPUT_KIND = "TEST_NON_MANUAL";

export async function ensureTestNonManualInputKind(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(
    `ALTER TYPE "KnowledgeInputKind" ADD VALUE IF NOT EXISTS '${TEST_NON_MANUAL_INPUT_KIND}'`,
  );
}

async function confirmCreatedDraft(
  actor: SafeUser,
  organizationId: string,
  created: {
    source: { id: string };
    version: { id: string; draftRevision: number; contentChecksum: string };
  },
) {
  const confirmed = await confirmSample(
    actor,
    organizationId,
    created.source.id,
    created.version.id,
    created.version.draftRevision,
    created.version.contentChecksum,
  );
  return {
    sourceId: created.source.id,
    versionId: confirmed.version.id,
    title: confirmed.version.title,
  };
}

async function insertConfirmedVersion(
  prisma: PrismaClient,
  input: {
    organizationId: string;
    sourceId: string;
    confirmerUserId: string;
    title: string;
    body: string;
  },
) {
  const version = await prisma.knowledgeVersion.create({
    data: {
      organizationId: input.organizationId,
      sourceId: input.sourceId,
      state: "ACTIVE",
      title: input.title,
      contentChecksum: "b".repeat(64),
      confirmedAt: new Date(),
      confirmationLanguageVersion: KNOWLEDGE_CONFIRMATION_LANGUAGE_VERSION,
      confirmerUserId: input.confirmerUserId,
    },
  });
  const section = await prisma.knowledgeSection.create({
    data: {
      organizationId: input.organizationId,
      sourceId: input.sourceId,
      versionId: version.id,
      citationKey: "sec_other",
      title: "Example",
      displayOrder: 0,
    },
  });
  await prisma.knowledgePassage.create({
    data: {
      organizationId: input.organizationId,
      sourceId: input.sourceId,
      versionId: version.id,
      sectionId: section.id,
      citationKey: "pas_other",
      body: input.body,
      displayOrder: 0,
    },
  });
  return {
    sourceId: input.sourceId,
    versionId: version.id,
    title: input.title,
  };
}

/**
 * Member-visibility matrix: hidden rows plus currently effective ACTIVE
 * customer-confirmed MANUAL versions used for list/get/retrieve proofs.
 */
export async function createMemberAccessFixtures(
  prisma: PrismaClient,
  actor: SafeUser,
  organizationId: string,
) {
  const draftCreated = await createSampleDraft(actor, organizationId, {
    title: "Unconfirmed draft policy",
    sections: [
      { title: "Draft", passages: [{ body: "unconfirmed-draft-body" }] },
    ],
  });
  const draft: KnowledgeIdPair = {
    sourceId: draftCreated.source.id,
    versionId: draftCreated.version.id,
    title: draftCreated.version.title,
  };

  const future = await confirmCreatedDraft(
    actor,
    organizationId,
    await createSampleDraft(actor, organizationId, {
      title: "Future member policy",
      effectiveFrom: new Date(Date.now() + 86_400_000).toISOString(),
      sections: [
        { title: "Future", passages: [{ body: "future-confirmed-body" }] },
      ],
    }),
  );

  const expired = await confirmCreatedDraft(
    actor,
    organizationId,
    await createSampleDraft(actor, organizationId, {
      title: "Expired member policy",
      effectiveFrom: new Date("2020-01-01T00:00:00.000Z").toISOString(),
      effectiveUntil: new Date("2020-12-31T00:00:00.000Z").toISOString(),
      sections: [
        { title: "Expired", passages: [{ body: "expired-confirmed-body" }] },
      ],
    }),
  );

  const archivedCreated = await createSampleDraft(actor, organizationId, {
    title: "Archived member policy",
    sections: [
      { title: "Archived", passages: [{ body: "archived-confirmed-body" }] },
    ],
  });
  const archived = await confirmCreatedDraft(
    actor,
    organizationId,
    archivedCreated,
  );
  const archivedSource = await prisma.knowledgeSource.findUniqueOrThrow({
    where: { id: archived.sourceId },
  });
  const archivedResult = await archiveKnowledgeSource({
    actor,
    organizationId,
    raw: {
      sourceId: archived.sourceId,
      expectedVersion: String(archivedSource.version),
    },
  });
  if (!archivedResult.ok) {
    throw new Error(archivedResult.message);
  }

  const supersededCreated = await createSampleDraft(actor, organizationId, {
    title: "Superseded historical member policy",
    sections: [
      {
        title: "Historical",
        passages: [{ body: "superseded-historical-body" }],
      },
    ],
  });
  const superseded = await confirmCreatedDraft(
    actor,
    organizationId,
    supersededCreated,
  );
  const sourceAfterFirst = await prisma.knowledgeSource.findUniqueOrThrow({
    where: { id: superseded.sourceId },
  });
  const replacementForCurrent = await createReplacementDraft({
    actor,
    organizationId,
    raw: {
      sourceId: superseded.sourceId,
      expectedVersion: String(sourceAfterFirst.version),
    },
  });
  if (!replacementForCurrent.ok) {
    throw new Error(replacementForCurrent.message);
  }
  const currentDraft = await updateKnowledgeDraft({
    actor,
    organizationId,
    raw: {
      sourceId: superseded.sourceId,
      versionId: replacementForCurrent.version.id,
      expectedDraftRevision: String(
        replacementForCurrent.version.draftRevision,
      ),
      title: "Currently effective member policy",
      sections: [
        {
          title: "Current",
          passages: [{ body: "currently-effective-body" }],
        },
      ],
    },
  });
  if (!currentDraft.ok) {
    throw new Error(currentDraft.message);
  }
  const current = await confirmCreatedDraft(actor, organizationId, {
    source: { id: superseded.sourceId },
    version: currentDraft.version,
  });

  const alphaCreated = await createSampleDraft(actor, organizationId, {
    title: "Alpha member policy",
    sections: [{ title: "Alpha", passages: [{ body: "alpha-visible-body" }] }],
  });
  const alpha = await confirmCreatedDraft(actor, organizationId, alphaCreated);
  const alphaSource = await prisma.knowledgeSource.findUniqueOrThrow({
    where: { id: alpha.sourceId },
  });
  const replacementDraftCreated = await createReplacementDraft({
    actor,
    organizationId,
    raw: {
      sourceId: alpha.sourceId,
      expectedVersion: String(alphaSource.version),
    },
  });
  if (!replacementDraftCreated.ok) {
    throw new Error(replacementDraftCreated.message);
  }
  const replacementEdited = await updateKnowledgeDraft({
    actor,
    organizationId,
    raw: {
      sourceId: alpha.sourceId,
      versionId: replacementDraftCreated.version.id,
      expectedDraftRevision: String(
        replacementDraftCreated.version.draftRevision,
      ),
      title: "Secret replacement draft title",
      sections: [
        {
          title: "Secret",
          passages: [{ body: "secret-replacement-draft-body" }],
        },
      ],
    },
  });
  if (!replacementEdited.ok) {
    throw new Error(replacementEdited.message);
  }
  const replacementDraft: KnowledgeIdPair = {
    sourceId: alpha.sourceId,
    versionId: replacementEdited.version.id,
    title: replacementEdited.version.title,
  };

  const zebra = await confirmCreatedDraft(
    actor,
    organizationId,
    await createSampleDraft(actor, organizationId, {
      title: "Zebra member policy",
      sections: [
        { title: "Zebra", passages: [{ body: "zebra-visible-body" }] },
      ],
    }),
  );

  const wrongCategorySource = await prisma.knowledgeSource.create({
    data: {
      organizationId,
      inputKind: "MANUAL",
      category: "PLATFORM_MAINTAINED_GUIDANCE",
      title: "Wrong category policy",
    },
  });
  const wrongCategory = await insertConfirmedVersion(prisma, {
    organizationId,
    sourceId: wrongCategorySource.id,
    confirmerUserId: actor.id,
    title: "Wrong category policy",
    body: "wrong-category-body",
  });

  await ensureTestNonManualInputKind(prisma);
  const wrongKindSourceId = `ksrc_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  await prisma.$executeRawUnsafe(
    `INSERT INTO "KnowledgeSource" (
      id, "organizationId", "inputKind", category, title, version, "createdAt", "updatedAt"
    ) VALUES (
      $1, $2, $3::"KnowledgeInputKind", $4::"KnowledgeSourceCategory",
      $5, 0, NOW(), NOW()
    )`,
    wrongKindSourceId,
    organizationId,
    TEST_NON_MANUAL_INPUT_KIND,
    "CUSTOMER_CONFIRMED_BUSINESS_FACTS",
    "Wrong kind policy",
  );
  const wrongKind = await insertConfirmedVersion(prisma, {
    organizationId,
    sourceId: wrongKindSourceId,
    confirmerUserId: actor.id,
    title: "Wrong kind policy",
    body: "wrong-kind-body",
  });

  return {
    draft,
    future,
    expired,
    archived,
    superseded,
    current,
    alpha,
    replacementDraft,
    zebra,
    wrongCategory,
    wrongKind,
    visibleTitles: [
      "Alpha member policy",
      "Currently effective member policy",
      "Zebra member policy",
    ],
  };
}
