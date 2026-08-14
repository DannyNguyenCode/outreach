import "server-only";

import type {
  KnowledgePassage,
  KnowledgeSection,
  KnowledgeSource,
  KnowledgeVersion,
  Prisma,
} from "@prisma/client";

import type { SafeUser } from "@/lib/auth/users";
import { recordOrganizationAuditEvent } from "@/lib/orgs/audit";
import { requireOrganizationPermission } from "@/lib/orgs/authorization";
import {
  acquireOrganizationKnowledgeLock,
  ConflictError,
  KnowledgeLifecycleError,
  KnowledgeNotFoundError,
  lockActiveAndDraftKnowledgeVersionsForUpdate,
  lockKnowledgeSourceForUpdate,
  lockKnowledgeDocumentForUpdate,
  lockKnowledgeDocumentJobForUpdate,
  lockKnowledgeDocumentsAndJobsForSourceForUpdate,
  lockKnowledgeVersionForUpdate,
  mapKnowledgeError,
  requireActiveActorInTx,
  type AuthFailure,
  type KnowledgeMutationTestHooks,
} from "@/lib/orgs/knowledge-access";
import { KNOWLEDGE_CONFIRMATION_LANGUAGE_VERSION } from "@/lib/orgs/knowledge-confirmation";
import {
  archiveKnowledgeSchema,
  assignCitationKeys,
  checksumFromDraft,
  computeKnowledgeChecksum,
  confirmKnowledgeSchema,
  createManualKnowledgeSchema,
  KNOWLEDGE_ACTIVATABLE_CATEGORY,
  parsePage,
  parsePageSize,
  replacementDraftSchema,
  requireExpectedVersion,
  restoreKnowledgeSchema,
  sanitizeSearchQuery,
  toCanonicalContent,
  updateKnowledgeDraftSchema,
  zodFieldErrors,
  type CanonicalKnowledgeSection,
} from "@/lib/orgs/knowledge-validation";
import {
  memberVisibleSourceWhere,
  memberVisibleSourceWithVersionWhere,
  memberVisibleVersionWhere,
  memberVisibleVersionWithSourceWhere,
} from "@/lib/orgs/knowledge-visibility";
import { roleHasPermission } from "@/lib/orgs/permissions";
import { prisma } from "@/lib/prisma";
import { resolveEffectiveRange } from "@/lib/time/organization-datetime";

export type KnowledgeFailure = AuthFailure;

export type DocumentProcessingIssueInput = {
  code: string;
  severity: "WARNING" | "BLOCKING";
  sectionLocator?: string | null;
  safeMessage: string;
};

export type KnowledgeVersionDetail = KnowledgeVersion & {
  sections: Array<
    KnowledgeSection & {
      passages: KnowledgePassage[];
    }
  >;
};

export type KnowledgeSourceDetail = KnowledgeSource & {
  versions: KnowledgeVersion[];
  draft: KnowledgeVersionDetail | null;
  active: KnowledgeVersionDetail | null;
};

export type KnowledgeSourceListItem = {
  id: string;
  organizationId: string;
  title: string;
  archivedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  versions: Array<{
    id: string;
    state: KnowledgeVersion["state"];
    title: string;
    confirmedAt: Date | null;
    effectiveFrom: Date | null;
    effectiveUntil: Date | null;
    draftRevision?: number;
    contentChecksum?: string;
  }>;
};

type VersionGraph = KnowledgeVersionDetail;

export async function createManualKnowledgeSource(
  input: {
    actor: SafeUser;
    organizationId: string;
    raw: unknown;
  },
  hooks: KnowledgeMutationTestHooks = {},
): Promise<
  | { ok: true; source: KnowledgeSource; version: VersionGraph }
  | KnowledgeFailure
> {
  const parsed = createManualKnowledgeSchema.safeParse(input.raw);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "validation",
      message: "Please correct the highlighted fields.",
      fieldErrors: zodFieldErrors(parsed.error),
    };
  }

  const times = await resolveDraftEffectiveTimes(
    input.organizationId,
    parsed.data,
  );
  if (!times.ok) {
    return {
      ok: false,
      reason: "validation",
      message: times.message,
      fieldErrors: times.fieldErrors,
    };
  }

  const prepared = checksumFromDraft({
    title: parsed.data.title,
    effectiveFrom: times.effectiveFrom,
    effectiveUntil: times.effectiveUntil,
    sections: parsed.data.sections,
  });

  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.knowledge.manage",
    });

    const created = await prisma.$transaction(async (tx) => {
      await acquireOrganizationKnowledgeLock(tx, input.organizationId, hooks);
      await requireActiveActorInTx(
        tx,
        {
          organizationId: input.organizationId,
          userId: input.actor.id,
          permission: "org.knowledge.manage",
        },
        hooks,
      );

      const source = await tx.knowledgeSource.create({
        data: {
          organizationId: input.organizationId,
          inputKind: "MANUAL",
          category: KNOWLEDGE_ACTIVATABLE_CATEGORY,
          title: prepared.canonical.title,
          createdByUserId: input.actor.id,
        },
      });

      const version = await createDraftVersion(tx, {
        organizationId: input.organizationId,
        sourceId: source.id,
        actorUserId: input.actor.id,
        title: prepared.canonical.title,
        checksum: prepared.checksum,
        effectiveFrom: times.effectiveFrom,
        effectiveUntil: times.effectiveUntil,
        sections: prepared.sections,
      });

      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "KNOWLEDGE_SOURCE_CREATED",
        metadata: {
          sourceId: source.id,
          versionId: version.id,
          checksum: prepared.checksum,
        },
      });

      return { source, version };
    });

    if (hooks.testAfterTransactionCommit) {
      await hooks.testAfterTransactionCommit();
    }

    return { ok: true, source: created.source, version: created.version };
  } catch (error) {
    return (
      mapKnowledgeError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not create knowledge.",
      }
    );
  }
}

export async function updateKnowledgeDraft(
  input: {
    actor: SafeUser;
    organizationId: string;
    raw: unknown;
  },
  hooks: KnowledgeMutationTestHooks = {},
): Promise<{ ok: true; version: VersionGraph } | KnowledgeFailure> {
  const parsed = updateKnowledgeDraftSchema.safeParse(input.raw);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "validation",
      message: "Please correct the highlighted fields.",
      fieldErrors: zodFieldErrors(parsed.error),
    };
  }

  const expected = requireExpectedVersion(parsed.data.expectedDraftRevision);
  if (!expected.ok) {
    return {
      ok: false,
      reason: "conflict",
      message: expected.message,
      fieldErrors: { expectedDraftRevision: [expected.message] },
    };
  }

  const times = await resolveDraftEffectiveTimes(
    input.organizationId,
    parsed.data,
  );
  if (!times.ok) {
    return {
      ok: false,
      reason: "validation",
      message: times.message,
      fieldErrors: times.fieldErrors,
    };
  }

  const prepared = checksumFromDraft({
    title: parsed.data.title,
    effectiveFrom: times.effectiveFrom,
    effectiveUntil: times.effectiveUntil,
    sections: parsed.data.sections,
  });

  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.knowledge.manage",
    });

    const version = await prisma.$transaction(async (tx) => {
      await acquireOrganizationKnowledgeLock(tx, input.organizationId, hooks);
      await requireActiveActorInTx(
        tx,
        {
          organizationId: input.organizationId,
          userId: input.actor.id,
          permission: "org.knowledge.manage",
        },
        hooks,
      );

      const source = await lockKnowledgeSourceForUpdate(
        tx,
        {
          organizationId: input.organizationId,
          sourceId: parsed.data.sourceId,
        },
        hooks,
      );
      if (!source) {
        throw new KnowledgeNotFoundError();
      }
      if (source.archivedAt) {
        throw new KnowledgeLifecycleError(
          "already_archived",
          "Archived knowledge cannot be edited.",
        );
      }

      const locked = await lockKnowledgeVersionForUpdate(tx, {
        organizationId: input.organizationId,
        sourceId: parsed.data.sourceId,
        versionId: parsed.data.versionId,
      });
      if (!locked) {
        throw new KnowledgeNotFoundError();
      }
      const isDocumentCorrection =
        source.inputKind === "DOCUMENT" && locked.state === "NEEDS_ATTENTION";
      if (isDocumentCorrection) {
        const document = await lockKnowledgeDocumentForUpdate(tx, {
          organizationId: input.organizationId,
          sourceId: parsed.data.sourceId,
          versionId: parsed.data.versionId,
        });
        if (!document || document.processingState !== "NEEDS_ATTENTION") {
          throw new ConflictError();
        }
      }
      if (locked.state !== "DRAFT" && !isDocumentCorrection) {
        throw new KnowledgeLifecycleError(
          "not_draft",
          "Only a draft version can be edited.",
        );
      }

      const updated = await tx.knowledgeVersion.updateMany({
        where: {
          id: parsed.data.versionId,
          organizationId: input.organizationId,
          sourceId: parsed.data.sourceId,
          state: isDocumentCorrection ? { in: ["NEEDS_ATTENTION"] } : "DRAFT",
          draftRevision: expected.version,
        },
        data: {
          title: prepared.canonical.title,
          contentChecksum: prepared.checksum,
          effectiveFrom: times.effectiveFrom,
          effectiveUntil: times.effectiveUntil,
          state: "DRAFT",
          draftRevision: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw new ConflictError();
      }

      await replaceDraftContents(tx, {
        organizationId: input.organizationId,
        sourceId: parsed.data.sourceId,
        versionId: parsed.data.versionId,
        sections: prepared.sections,
      });

      if (isDocumentCorrection) {
        await tx.knowledgeDocumentIssue.updateMany({
          where: {
            organizationId: input.organizationId,
            sourceId: parsed.data.sourceId,
            versionId: parsed.data.versionId,
            resolvedAt: null,
          },
          data: { resolvedAt: new Date() },
        });
        await tx.knowledgeDocument.updateMany({
          where: {
            organizationId: input.organizationId,
            sourceId: parsed.data.sourceId,
            versionId: parsed.data.versionId,
            processingState: "NEEDS_ATTENTION",
            scanState: "CLEAN",
          },
          data: {
            processingState: "COMPLETE",
            normalizedContentChecksum: prepared.checksum,
            lastSafeErrorCode: null,
          },
        });
      }

      const hasActive = await sourceHasActiveVersion(tx, {
        organizationId: input.organizationId,
        sourceId: parsed.data.sourceId,
      });
      if (!hasActive) {
        await tx.knowledgeSource.updateMany({
          where: {
            id: parsed.data.sourceId,
            organizationId: input.organizationId,
          },
          data: { title: prepared.canonical.title },
        });
      }

      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "KNOWLEDGE_DRAFT_UPDATED",
        metadata: {
          sourceId: parsed.data.sourceId,
          versionId: parsed.data.versionId,
          checksum: prepared.checksum,
        },
      });
      if (isDocumentCorrection) {
        await recordOrganizationAuditEvent(tx, {
          organizationId: input.organizationId,
          actorUserId: input.actor.id,
          action: "KNOWLEDGE_DOCUMENT_CORRECTIONS_SAVED",
          metadata: {
            sourceId: parsed.data.sourceId,
            versionId: parsed.data.versionId,
            checksum: prepared.checksum,
          },
        });
      }

      return loadVersionGraph(tx, {
        organizationId: input.organizationId,
        versionId: parsed.data.versionId,
      });
    });

    if (hooks.testAfterTransactionCommit) {
      await hooks.testAfterTransactionCommit();
    }

    return { ok: true, version };
  } catch (error) {
    return (
      mapKnowledgeError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not update knowledge.",
      }
    );
  }
}

export async function createReplacementDraft(
  input: {
    actor: SafeUser;
    organizationId: string;
    raw: unknown;
  },
  hooks: KnowledgeMutationTestHooks = {},
): Promise<{ ok: true; version: VersionGraph } | KnowledgeFailure> {
  const parsed = replacementDraftSchema.safeParse(input.raw);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "validation",
      message: "Please correct the highlighted fields.",
      fieldErrors: zodFieldErrors(parsed.error),
    };
  }
  const expected = requireExpectedVersion(parsed.data.expectedVersion);
  if (!expected.ok) {
    return {
      ok: false,
      reason: "conflict",
      message: expected.message,
      fieldErrors: { expectedVersion: [expected.message] },
    };
  }

  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.knowledge.manage",
    });

    const version = await prisma.$transaction(async (tx) => {
      await acquireOrganizationKnowledgeLock(tx, input.organizationId, hooks);
      await requireActiveActorInTx(
        tx,
        {
          organizationId: input.organizationId,
          userId: input.actor.id,
          permission: "org.knowledge.manage",
        },
        hooks,
      );

      const source = await lockKnowledgeSourceForUpdate(
        tx,
        {
          organizationId: input.organizationId,
          sourceId: parsed.data.sourceId,
        },
        hooks,
      );
      if (!source) {
        throw new KnowledgeNotFoundError();
      }
      if (source.archivedAt) {
        throw new KnowledgeLifecycleError(
          "already_archived",
          "Archived knowledge cannot be replaced. Restore it first.",
        );
      }
      if (source.inputKind === "DOCUMENT") {
        throw new KnowledgeLifecycleError(
          "not_confirmable",
          "Document replacements require a new uploaded file.",
        );
      }
      if (source.version !== expected.version) {
        throw new ConflictError();
      }

      const existingDraft = await tx.knowledgeVersion.findFirst({
        where: {
          organizationId: input.organizationId,
          sourceId: parsed.data.sourceId,
          state: "DRAFT",
        },
      });
      if (existingDraft) {
        throw new KnowledgeLifecycleError(
          "draft_exists",
          "A draft already exists for this knowledge.",
        );
      }

      const active = await tx.knowledgeVersion.findFirst({
        where: {
          organizationId: input.organizationId,
          sourceId: parsed.data.sourceId,
          state: "ACTIVE",
        },
        include: versionGraphInclude,
      });
      if (!active) {
        throw new KnowledgeLifecycleError(
          "not_confirmable",
          "There is no active version to replace.",
        );
      }

      const sections = sectionsFromGraph(active);
      const created = await createDraftVersion(tx, {
        organizationId: input.organizationId,
        sourceId: parsed.data.sourceId,
        actorUserId: input.actor.id,
        title: active.title,
        checksum: active.contentChecksum,
        effectiveFrom: active.effectiveFrom,
        effectiveUntil: active.effectiveUntil,
        sections,
      });

      const bumped = await tx.knowledgeSource.updateMany({
        where: {
          id: parsed.data.sourceId,
          organizationId: input.organizationId,
          version: expected.version,
        },
        data: { version: { increment: 1 } },
      });
      if (bumped.count !== 1) {
        throw new ConflictError();
      }

      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "KNOWLEDGE_REPLACEMENT_DRAFT_CREATED",
        metadata: {
          sourceId: parsed.data.sourceId,
          versionId: created.id,
          checksum: active.contentChecksum,
        },
      });

      return created;
    });

    if (hooks.testAfterTransactionCommit) {
      await hooks.testAfterTransactionCommit();
    }

    return { ok: true, version };
  } catch (error) {
    return (
      mapKnowledgeError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not create a replacement draft.",
      }
    );
  }
}

export async function confirmKnowledgeVersion(
  input: {
    actor: SafeUser;
    organizationId: string;
    raw: unknown;
  },
  hooks: KnowledgeMutationTestHooks = {},
): Promise<{ ok: true; version: VersionGraph } | KnowledgeFailure> {
  const parsed = confirmKnowledgeSchema.safeParse(input.raw);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "validation",
      message: "Please confirm this exact version to activate it.",
      fieldErrors: zodFieldErrors(parsed.error),
    };
  }
  const expected = requireExpectedVersion(parsed.data.expectedDraftRevision);
  if (!expected.ok) {
    return {
      ok: false,
      reason: "conflict",
      message: expected.message,
      fieldErrors: { expectedDraftRevision: [expected.message] },
    };
  }

  const expectedChecksum = parsed.data.expectedChecksum.toLowerCase();

  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.knowledge.confirm",
    });

    const version = await prisma.$transaction(async (tx) => {
      await acquireOrganizationKnowledgeLock(tx, input.organizationId, hooks);
      await requireActiveActorInTx(
        tx,
        {
          organizationId: input.organizationId,
          userId: input.actor.id,
          permission: "org.knowledge.confirm",
        },
        hooks,
      );

      const source = await lockKnowledgeSourceForUpdate(
        tx,
        {
          organizationId: input.organizationId,
          sourceId: parsed.data.sourceId,
        },
        hooks,
      );
      if (!source) {
        throw new KnowledgeNotFoundError();
      }
      if (source.archivedAt) {
        throw new KnowledgeLifecycleError(
          "already_archived",
          "Archived knowledge cannot be activated.",
        );
      }

      const locked = await lockKnowledgeVersionForUpdate(tx, {
        organizationId: input.organizationId,
        sourceId: parsed.data.sourceId,
        versionId: parsed.data.versionId,
      });
      if (!locked) {
        throw new KnowledgeNotFoundError();
      }
      if (locked.state !== "DRAFT") {
        throw new ConflictError();
      }

      const graph = await loadVersionGraph(tx, {
        organizationId: input.organizationId,
        versionId: parsed.data.versionId,
      });
      const sourceRow = await tx.knowledgeSource.findFirst({
        where: {
          id: parsed.data.sourceId,
          organizationId: input.organizationId,
        },
      });
      if (
        !sourceRow ||
        sourceRow.category !== KNOWLEDGE_ACTIVATABLE_CATEGORY ||
        (sourceRow.inputKind !== "MANUAL" && sourceRow.inputKind !== "DOCUMENT")
      ) {
        throw new KnowledgeLifecycleError(
          "not_confirmable",
          "Only customer-confirmed business knowledge can be activated.",
        );
      }

      if (sourceRow.inputKind === "DOCUMENT") {
        const document = await lockKnowledgeDocumentForUpdate(tx, {
          organizationId: input.organizationId,
          sourceId: parsed.data.sourceId,
          versionId: parsed.data.versionId,
        });
        const blockingIssues = await tx.knowledgeDocumentIssue.count({
          where: {
            organizationId: input.organizationId,
            sourceId: parsed.data.sourceId,
            versionId: parsed.data.versionId,
            severity: "BLOCKING",
            resolvedAt: null,
          },
        });
        if (
          !document ||
          document.processingState !== "COMPLETE" ||
          document.scanState !== "CLEAN" ||
          !document.binaryChecksum ||
          document.binaryChecksum !== document.scannedChecksum ||
          !document.normalizedContentChecksum ||
          blockingIssues > 0
        ) {
          throw new KnowledgeLifecycleError(
            "not_confirmable",
            "This document must be clean, completely processed, and free of blocking issues before confirmation.",
          );
        }
      }

      const canonical = toCanonicalContent({
        title: graph.title,
        effectiveFrom: graph.effectiveFrom,
        effectiveUntil: graph.effectiveUntil,
        sections: sectionsFromGraph(graph),
      });
      const serverChecksum = computeKnowledgeChecksum(canonical);
      if (
        serverChecksum !== expectedChecksum ||
        serverChecksum !== locked.contentChecksum.toLowerCase()
      ) {
        throw new KnowledgeLifecycleError(
          "checksum_mismatch",
          "This preview no longer matches the saved draft. Reload and review it again.",
        );
      }

      const previousActive = await tx.knowledgeVersion.findFirst({
        where: {
          organizationId: input.organizationId,
          sourceId: parsed.data.sourceId,
          state: "ACTIVE",
          id: { not: parsed.data.versionId },
        },
        select: { id: true },
      });

      if (previousActive) {
        const superseded = await tx.knowledgeVersion.updateMany({
          where: {
            id: previousActive.id,
            organizationId: input.organizationId,
            sourceId: parsed.data.sourceId,
            state: "ACTIVE",
          },
          data: { state: "SUPERSEDED" },
        });
        if (superseded.count !== 1) {
          throw new ConflictError();
        }
      }

      const confirmedAt = new Date();
      const activated = await tx.knowledgeVersion.updateMany({
        where: {
          id: parsed.data.versionId,
          organizationId: input.organizationId,
          sourceId: parsed.data.sourceId,
          state: "DRAFT",
          draftRevision: expected.version,
          contentChecksum: locked.contentChecksum,
          confirmerUserId: null,
          confirmedAt: null,
        },
        data: {
          state: "ACTIVE",
          confirmerUserId: input.actor.id,
          confirmedAt,
          confirmationLanguageVersion: KNOWLEDGE_CONFIRMATION_LANGUAGE_VERSION,
          supersedesVersionId: previousActive?.id ?? null,
          draftRevision: { increment: 1 },
        },
      });
      if (activated.count !== 1) {
        throw new ConflictError();
      }

      await tx.knowledgeSource.updateMany({
        where: {
          id: parsed.data.sourceId,
          organizationId: input.organizationId,
        },
        data: {
          title: graph.title,
          version: { increment: 1 },
        },
      });

      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "KNOWLEDGE_VERSION_CONFIRMED",
        metadata: {
          sourceId: parsed.data.sourceId,
          versionId: parsed.data.versionId,
          checksum: serverChecksum,
          confirmationLanguageVersion: KNOWLEDGE_CONFIRMATION_LANGUAGE_VERSION,
          supersedesVersionId: previousActive?.id ?? null,
        },
      });
      if (sourceRow.inputKind === "DOCUMENT") {
        await recordOrganizationAuditEvent(tx, {
          organizationId: input.organizationId,
          actorUserId: input.actor.id,
          action: "KNOWLEDGE_DOCUMENT_CONFIRMED",
          metadata: {
            sourceId: parsed.data.sourceId,
            versionId: parsed.data.versionId,
            checksum: serverChecksum,
          },
        });
      }

      return loadVersionGraph(tx, {
        organizationId: input.organizationId,
        versionId: parsed.data.versionId,
      });
    });

    if (hooks.testAfterTransactionCommit) {
      await hooks.testAfterTransactionCommit();
    }

    return { ok: true, version };
  } catch (error) {
    return (
      mapKnowledgeError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not confirm knowledge.",
      }
    );
  }
}

export async function archiveKnowledgeSource(
  input: {
    actor: SafeUser;
    organizationId: string;
    raw: unknown;
  },
  hooks: KnowledgeMutationTestHooks = {},
): Promise<{ ok: true; source: KnowledgeSource } | KnowledgeFailure> {
  const parsed = archiveKnowledgeSchema.safeParse(input.raw);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "validation",
      message: "Please correct the highlighted fields.",
      fieldErrors: zodFieldErrors(parsed.error),
    };
  }
  const expected = requireExpectedVersion(parsed.data.expectedVersion);
  if (!expected.ok) {
    return {
      ok: false,
      reason: "conflict",
      message: expected.message,
      fieldErrors: { expectedVersion: [expected.message] },
    };
  }

  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.knowledge.archive",
    });

    const source = await prisma.$transaction(async (tx) => {
      await acquireOrganizationKnowledgeLock(tx, input.organizationId, hooks);
      await requireActiveActorInTx(
        tx,
        {
          organizationId: input.organizationId,
          userId: input.actor.id,
          permission: "org.knowledge.archive",
        },
        hooks,
      );

      const locked = await lockKnowledgeSourceForUpdate(
        tx,
        {
          organizationId: input.organizationId,
          sourceId: parsed.data.sourceId,
        },
        hooks,
      );
      if (!locked) {
        throw new KnowledgeNotFoundError();
      }
      if (locked.archivedAt) {
        throw new KnowledgeLifecycleError(
          "already_archived",
          "This knowledge is already archived.",
        );
      }
      if (locked.version !== expected.version) {
        throw new ConflictError();
      }

      await lockActiveAndDraftKnowledgeVersionsForUpdate(tx, {
        organizationId: input.organizationId,
        sourceId: parsed.data.sourceId,
      });
      if (locked.inputKind === "DOCUMENT") {
        await lockKnowledgeDocumentsAndJobsForSourceForUpdate(tx, {
          organizationId: input.organizationId,
          sourceId: parsed.data.sourceId,
        });
      }

      const archivedAt = new Date();
      await tx.knowledgeVersion.updateMany({
        where: {
          organizationId: input.organizationId,
          sourceId: parsed.data.sourceId,
          state: {
            in: ["ACTIVE", "DRAFT", "PROCESSING", "NEEDS_ATTENTION", "FAILED"],
          },
        },
        data: { state: "ARCHIVED" },
      });

      const archived = await tx.knowledgeSource.updateMany({
        where: {
          id: parsed.data.sourceId,
          organizationId: input.organizationId,
          archivedAt: null,
          version: expected.version,
        },
        data: {
          archivedAt,
          archivedByUserId: input.actor.id,
          version: { increment: 1 },
        },
      });
      if (archived.count !== 1) {
        throw new ConflictError();
      }

      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "KNOWLEDGE_SOURCE_ARCHIVED",
        metadata: {
          sourceId: parsed.data.sourceId,
        },
      });

      return tx.knowledgeSource.findFirstOrThrow({
        where: {
          id: parsed.data.sourceId,
          organizationId: input.organizationId,
        },
      });
    });

    if (hooks.testAfterTransactionCommit) {
      await hooks.testAfterTransactionCommit();
    }

    return { ok: true, source };
  } catch (error) {
    return (
      mapKnowledgeError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not archive knowledge.",
      }
    );
  }
}

export async function restoreKnowledgeVersion(
  input: {
    actor: SafeUser;
    organizationId: string;
    raw: unknown;
  },
  hooks: KnowledgeMutationTestHooks = {},
): Promise<{ ok: true; version: VersionGraph } | KnowledgeFailure> {
  const parsed = restoreKnowledgeSchema.safeParse(input.raw);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "validation",
      message: "Please correct the highlighted fields.",
      fieldErrors: zodFieldErrors(parsed.error),
    };
  }
  const expected = requireExpectedVersion(parsed.data.expectedVersion);
  if (!expected.ok) {
    return {
      ok: false,
      reason: "conflict",
      message: expected.message,
      fieldErrors: { expectedVersion: [expected.message] },
    };
  }

  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.knowledge.archive",
    });

    const version = await prisma.$transaction(async (tx) => {
      await acquireOrganizationKnowledgeLock(tx, input.organizationId, hooks);
      await requireActiveActorInTx(
        tx,
        {
          organizationId: input.organizationId,
          userId: input.actor.id,
          permission: "org.knowledge.archive",
        },
        hooks,
      );

      const source = await lockKnowledgeSourceForUpdate(
        tx,
        {
          organizationId: input.organizationId,
          sourceId: parsed.data.sourceId,
        },
        hooks,
      );
      if (!source) {
        throw new KnowledgeNotFoundError();
      }
      if (source.version !== expected.version) {
        throw new ConflictError();
      }
      if (source.inputKind === "DOCUMENT") {
        throw new KnowledgeLifecycleError(
          "not_restorable",
          "Document history must be restored through the private document workflow.",
        );
      }

      const historical = await tx.knowledgeVersion.findFirst({
        where: {
          id: parsed.data.versionId,
          sourceId: parsed.data.sourceId,
          organizationId: input.organizationId,
        },
        include: versionGraphInclude,
      });
      if (!historical || !historical.confirmedAt) {
        throw new KnowledgeLifecycleError(
          "not_restorable",
          "Only a previously confirmed version can be restored.",
        );
      }
      if (
        historical.state !== "SUPERSEDED" &&
        historical.state !== "ARCHIVED"
      ) {
        throw new KnowledgeLifecycleError(
          "not_restorable",
          "This version cannot be restored in its current state.",
        );
      }

      const existingDraft = await tx.knowledgeVersion.findFirst({
        where: {
          organizationId: input.organizationId,
          sourceId: parsed.data.sourceId,
          state: "DRAFT",
        },
      });
      if (existingDraft) {
        throw new KnowledgeLifecycleError(
          "draft_exists",
          "A draft already exists. Finish or archive it before restoring.",
        );
      }

      const sections = sectionsFromGraph(historical);
      const created = await createDraftVersion(tx, {
        organizationId: input.organizationId,
        sourceId: parsed.data.sourceId,
        actorUserId: input.actor.id,
        title: historical.title,
        checksum: historical.contentChecksum,
        effectiveFrom: historical.effectiveFrom,
        effectiveUntil: historical.effectiveUntil,
        sections,
        restoredFromVersionId: historical.id,
      });

      const hasActiveVersion = await sourceHasActiveVersion(tx, {
        organizationId: input.organizationId,
        sourceId: parsed.data.sourceId,
      });

      const unarchived = await tx.knowledgeSource.updateMany({
        where: {
          id: parsed.data.sourceId,
          organizationId: input.organizationId,
          version: expected.version,
        },
        data: {
          archivedAt: null,
          archivedByUserId: null,
          version: { increment: 1 },
          ...(hasActiveVersion ? {} : { title: historical.title }),
        },
      });
      if (unarchived.count !== 1) {
        throw new ConflictError();
      }

      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "KNOWLEDGE_VERSION_RESTORED",
        metadata: {
          sourceId: parsed.data.sourceId,
          versionId: created.id,
          restoredFromVersionId: historical.id,
          checksum: historical.contentChecksum,
        },
      });

      return created;
    });

    if (hooks.testAfterTransactionCommit) {
      await hooks.testAfterTransactionCommit();
    }

    return { ok: true, version };
  } catch (error) {
    return (
      mapKnowledgeError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not restore knowledge.",
      }
    );
  }
}

/**
 * Publish one claimed document extraction. Background workers do not have an
 * actor membership row, so they acquire the organization knowledge lock
 * first, then source, version, document, job, section, and passage rows.
 */
export async function publishDocumentExtraction(input: {
  organizationId: string;
  sourceId: string;
  versionId: string;
  documentId: string;
  jobId: string;
  workerId: string;
  extractorName: string;
  extractorVersion: string;
  normalizedContentChecksum: string;
  sections: CanonicalKnowledgeSection[];
  issues?: DocumentProcessingIssueInput[];
  exactDuplicate?: { sourceId: string; versionId: string } | null;
  nearDuplicate?: { sourceId: string; versionId: string } | null;
}): Promise<
  | { ok: true; state: "DRAFT" | "NEEDS_ATTENTION"; checksum: string }
  | KnowledgeFailure
> {
  try {
    return await prisma.$transaction(async (tx) => {
      await acquireOrganizationKnowledgeLock(tx, input.organizationId);

      const source = await lockKnowledgeSourceForUpdate(tx, {
        organizationId: input.organizationId,
        sourceId: input.sourceId,
      });
      if (!source || source.inputKind !== "DOCUMENT" || source.archivedAt) {
        throw new KnowledgeLifecycleError(
          "not_confirmable",
          "The document source is no longer processable.",
        );
      }

      const version = await lockKnowledgeVersionForUpdate(tx, {
        organizationId: input.organizationId,
        sourceId: input.sourceId,
        versionId: input.versionId,
      });
      if (!version) throw new KnowledgeNotFoundError();

      const document = await lockKnowledgeDocumentForUpdate(tx, {
        organizationId: input.organizationId,
        sourceId: input.sourceId,
        versionId: input.versionId,
        documentId: input.documentId,
      });
      const job = await lockKnowledgeDocumentJobForUpdate(tx, {
        organizationId: input.organizationId,
        jobId: input.jobId,
      });
      if (
        !document ||
        !job ||
        job.state !== "RUNNING" ||
        job.leaseOwner !== input.workerId
      ) {
        throw new ConflictError();
      }

      if (
        version.state !== "PROCESSING" ||
        document.processingState !== "EXTRACTING" ||
        document.scanState !== "CLEAN"
      ) {
        throw new ConflictError();
      }

      const storedVersion = await tx.knowledgeVersion.findFirstOrThrow({
        where: {
          id: input.versionId,
          sourceId: input.sourceId,
          organizationId: input.organizationId,
        },
        select: {
          title: true,
          effectiveFrom: true,
          effectiveUntil: true,
        },
      });
      const canonical = toCanonicalContent({
        title: storedVersion.title,
        effectiveFrom: storedVersion.effectiveFrom,
        effectiveUntil: storedVersion.effectiveUntil,
        sections: input.sections,
      });
      const checksum = computeKnowledgeChecksum(canonical);
      const issues = input.issues ?? [];
      const hasBlocking = issues.some((issue) => issue.severity === "BLOCKING");
      const nextState = hasBlocking ? "NEEDS_ATTENTION" : "DRAFT";

      await replaceDraftContents(tx, {
        organizationId: input.organizationId,
        sourceId: input.sourceId,
        versionId: input.versionId,
        sections: input.sections,
      });
      if (issues.length > 0) {
        await tx.knowledgeDocumentIssue.createMany({
          data: issues.map((issue) => ({
            organizationId: input.organizationId,
            sourceId: input.sourceId,
            versionId: input.versionId,
            documentId: input.documentId,
            code: issue.code,
            severity: issue.severity,
            sectionLocator: issue.sectionLocator ?? null,
            safeMessage: issue.safeMessage,
          })),
          skipDuplicates: true,
        });
      }

      const changedVersion = await tx.knowledgeVersion.updateMany({
        where: {
          id: input.versionId,
          organizationId: input.organizationId,
          sourceId: input.sourceId,
          state: "PROCESSING",
        },
        data: {
          state: nextState,
          contentChecksum: checksum,
          draftRevision: { increment: 1 },
        },
      });
      if (changedVersion.count !== 1) throw new ConflictError();

      const changedDocument = await tx.knowledgeDocument.updateMany({
        where: {
          id: input.documentId,
          organizationId: input.organizationId,
          sourceId: input.sourceId,
          versionId: input.versionId,
          processingState: "EXTRACTING",
          scanState: "CLEAN",
          leaseOwner: input.workerId,
        },
        data: {
          processingState: hasBlocking ? "NEEDS_ATTENTION" : "COMPLETE",
          normalizedContentChecksum: input.normalizedContentChecksum,
          extractorName: input.extractorName,
          extractorVersion: input.extractorVersion,
          exactDuplicateSourceId: input.exactDuplicate?.sourceId ?? null,
          exactDuplicateVersionId: input.exactDuplicate?.versionId ?? null,
          nearDuplicateSourceId: input.nearDuplicate?.sourceId ?? null,
          nearDuplicateVersionId: input.nearDuplicate?.versionId ?? null,
          leaseOwner: null,
          leaseExpiresAt: null,
          retryAt: null,
          lastSafeErrorCode: null,
        },
      });
      if (changedDocument.count !== 1) throw new ConflictError();

      const changedJob = await tx.knowledgeDocumentJob.updateMany({
        where: {
          id: input.jobId,
          organizationId: input.organizationId,
          state: "RUNNING",
          leaseOwner: input.workerId,
        },
        data: {
          state: "SUCCEEDED",
          leaseOwner: null,
          leaseExpiresAt: null,
          completedAt: new Date(),
          lastSafeErrorCode: null,
        },
      });
      if (changedJob.count !== 1) throw new ConflictError();

      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: null,
        action: "KNOWLEDGE_DOCUMENT_PROCESSING_COMPLETED",
        metadata: {
          sourceId: input.sourceId,
          versionId: input.versionId,
          documentId: input.documentId,
          jobId: input.jobId,
          state: nextState,
          checksum,
          normalizedContentChecksum: input.normalizedContentChecksum,
          issueCount: issues.length,
        },
      });

      return { ok: true as const, state: nextState, checksum };
    });
  } catch (error) {
    return (
      mapKnowledgeError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not publish document processing.",
      }
    );
  }
}

export async function listKnowledgeSources(input: {
  actor: SafeUser;
  organizationId: string;
  query?: unknown;
  page?: unknown;
  pageSize?: unknown;
  status?: unknown;
}): Promise<
  | {
      ok: true;
      items: KnowledgeSourceListItem[];
      page: number;
      pageSize: number;
      total: number;
      canManage: boolean;
    }
  | KnowledgeFailure
> {
  const query = sanitizeSearchQuery(input.query);
  const page = parsePage(input.page);
  const pageSize = parsePageSize(input.pageSize);
  const now = new Date();

  try {
    const membership = await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.knowledge.read",
    });
    const canManage = roleHasPermission(
      membership.role,
      "org.knowledge.manage",
    );
    const status = parseListStatus(input.status, canManage);

    if (!canManage) {
      return listMemberVisibleSources({
        organizationId: input.organizationId,
        query,
        page,
        pageSize,
        now,
      });
    }

    const where: Prisma.KnowledgeSourceWhereInput = {
      organizationId: input.organizationId,
      ...listStatusWhere(status, now),
      ...(query
        ? {
            OR: [
              { title: { contains: query, mode: "insensitive" } },
              {
                versions: {
                  some: { title: { contains: query, mode: "insensitive" } },
                },
              },
            ],
          }
        : {}),
    };

    const total = await prisma.knowledgeSource.count({ where });
    const rows = await prisma.knowledgeSource.findMany({
      where,
      select: {
        id: true,
        organizationId: true,
        title: true,
        archivedAt: true,
        version: true,
        createdAt: true,
        updatedAt: true,
        versions: {
          select: {
            id: true,
            state: true,
            title: true,
            draftRevision: true,
            confirmedAt: true,
            contentChecksum: true,
            effectiveFrom: true,
            effectiveUntil: true,
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        },
      },
      orderBy: [{ title: "asc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return { ok: true, items: rows, page, pageSize, total, canManage };
  } catch (error) {
    return (
      mapKnowledgeError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not load knowledge.",
      }
    );
  }
}

async function listMemberVisibleSources(input: {
  organizationId: string;
  query: string;
  page: number;
  pageSize: number;
  now: Date;
}): Promise<{
  ok: true;
  items: KnowledgeSourceListItem[];
  page: number;
  pageSize: number;
  total: number;
  canManage: boolean;
}> {
  const versionWhere: Prisma.KnowledgeVersionWhereInput = {
    ...memberVisibleVersionWithSourceWhere(input.organizationId, input.now),
    ...(input.query
      ? { title: { contains: input.query, mode: "insensitive" } }
      : {}),
  };

  const total = await prisma.knowledgeVersion.count({ where: versionWhere });
  const versions = await prisma.knowledgeVersion.findMany({
    where: versionWhere,
    select: {
      id: true,
      state: true,
      title: true,
      confirmedAt: true,
      effectiveFrom: true,
      effectiveUntil: true,
      source: {
        select: {
          id: true,
          organizationId: true,
          archivedAt: true,
          version: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
    orderBy: [{ title: "asc" }, { id: "asc" }],
    skip: (input.page - 1) * input.pageSize,
    take: input.pageSize,
  });

  const items: KnowledgeSourceListItem[] = versions.map((row) => ({
    id: row.source.id,
    organizationId: row.source.organizationId,
    title: row.title,
    archivedAt: row.source.archivedAt,
    version: row.source.version,
    createdAt: row.source.createdAt,
    updatedAt: row.source.updatedAt,
    versions: [
      {
        id: row.id,
        state: row.state,
        title: row.title,
        confirmedAt: row.confirmedAt,
        effectiveFrom: row.effectiveFrom,
        effectiveUntil: row.effectiveUntil,
      },
    ],
  }));

  return {
    ok: true,
    items,
    page: input.page,
    pageSize: input.pageSize,
    total,
    canManage: false,
  };
}

export async function getKnowledgeSource(input: {
  actor: SafeUser;
  organizationId: string;
  sourceId: string;
}): Promise<
  | {
      ok: true;
      source: KnowledgeSourceDetail;
      canManage: boolean;
      canConfirm: boolean;
      canArchive: boolean;
      organizationTimeZone: string | null;
    }
  | KnowledgeFailure
> {
  try {
    const membership = await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.knowledge.read",
    });
    const canManage = roleHasPermission(
      membership.role,
      "org.knowledge.manage",
    );
    const canConfirm = roleHasPermission(
      membership.role,
      "org.knowledge.confirm",
    );
    const canArchive = roleHasPermission(
      membership.role,
      "org.knowledge.archive",
    );
    const now = new Date();
    const organizationTimeZone = await loadOrganizationTimeZone(
      input.organizationId,
    );

    const source = await prisma.knowledgeSource.findFirst({
      where: canManage
        ? {
            id: input.sourceId,
            organizationId: input.organizationId,
          }
        : {
            id: input.sourceId,
            ...memberVisibleSourceWithVersionWhere(input.organizationId, now),
          },
      include: {
        versions: {
          where: canManage ? undefined : memberVisibleVersionWhere(now),
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        },
      },
    });
    if (!source) {
      return notFound();
    }

    const draftSummary = canManage
      ? source.versions.find(
          (version) =>
            version.state === "DRAFT" || version.state === "NEEDS_ATTENTION",
        )
      : undefined;
    const activeSummary = source.versions.find(
      (version) => version.state === "ACTIVE",
    );
    const draft = draftSummary
      ? await loadVersionGraph(prisma, {
          organizationId: input.organizationId,
          versionId: draftSummary.id,
        })
      : null;
    const active = activeSummary
      ? await loadVersionGraph(prisma, {
          organizationId: input.organizationId,
          versionId: activeSummary.id,
        })
      : null;

    return {
      ok: true,
      source: {
        ...source,
        draft,
        active,
      },
      canManage,
      canConfirm,
      canArchive,
      organizationTimeZone,
    };
  } catch (error) {
    return (
      mapKnowledgeError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not load knowledge.",
      }
    );
  }
}

export async function getKnowledgeVersion(input: {
  actor: SafeUser;
  organizationId: string;
  sourceId: string;
  versionId: string;
}): Promise<
  | {
      ok: true;
      source: KnowledgeSource;
      version: VersionGraph;
      canManage: boolean;
      canConfirm: boolean;
      canArchive: boolean;
      organizationTimeZone: string | null;
    }
  | KnowledgeFailure
> {
  try {
    const membership = await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.knowledge.read",
    });
    const canManage = roleHasPermission(
      membership.role,
      "org.knowledge.manage",
    );
    const canConfirm = roleHasPermission(
      membership.role,
      "org.knowledge.confirm",
    );
    const canArchive = roleHasPermission(
      membership.role,
      "org.knowledge.archive",
    );
    const now = new Date();
    const organizationTimeZone = await loadOrganizationTimeZone(
      input.organizationId,
    );

    const source = await prisma.knowledgeSource.findFirst({
      where: canManage
        ? {
            id: input.sourceId,
            organizationId: input.organizationId,
          }
        : {
            id: input.sourceId,
            ...memberVisibleSourceWithVersionWhere(input.organizationId, now),
          },
    });
    if (!source) {
      return notFound();
    }

    const version = await prisma.knowledgeVersion.findFirst({
      where: canManage
        ? {
            id: input.versionId,
            sourceId: input.sourceId,
            organizationId: input.organizationId,
          }
        : {
            id: input.versionId,
            sourceId: input.sourceId,
            ...memberVisibleVersionWithSourceWhere(input.organizationId, now),
          },
      include: versionGraphInclude,
    });
    if (!version) {
      return notFound();
    }

    return {
      ok: true,
      source,
      version,
      canManage,
      canConfirm,
      canArchive,
      organizationTimeZone,
    };
  } catch (error) {
    return (
      mapKnowledgeError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not load this knowledge version.",
      }
    );
  }
}

const versionGraphInclude = {
  sections: {
    orderBy: [{ displayOrder: "asc" as const }, { id: "asc" as const }],
    include: {
      passages: {
        orderBy: [{ displayOrder: "asc" as const }, { id: "asc" as const }],
      },
    },
  },
} satisfies Prisma.KnowledgeVersionInclude;

async function createDraftVersion(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    sourceId: string;
    actorUserId: string;
    title: string;
    checksum: string;
    effectiveFrom: Date | null;
    effectiveUntil: Date | null;
    sections: CanonicalKnowledgeSection[];
    restoredFromVersionId?: string;
  },
): Promise<VersionGraph> {
  const version = await tx.knowledgeVersion.create({
    data: {
      organizationId: input.organizationId,
      sourceId: input.sourceId,
      state: "DRAFT",
      title: input.title,
      contentChecksum: input.checksum,
      effectiveFrom: input.effectiveFrom,
      effectiveUntil: input.effectiveUntil,
      createdByUserId: input.actorUserId,
      restoredFromVersionId: input.restoredFromVersionId ?? null,
    },
  });

  await replaceDraftContents(tx, {
    organizationId: input.organizationId,
    sourceId: input.sourceId,
    versionId: version.id,
    sections: input.sections,
  });

  return loadVersionGraph(tx, {
    organizationId: input.organizationId,
    versionId: version.id,
  });
}

async function replaceDraftContents(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    sourceId: string;
    versionId: string;
    sections: CanonicalKnowledgeSection[];
  },
): Promise<void> {
  await tx.knowledgePassage.deleteMany({
    where: {
      organizationId: input.organizationId,
      versionId: input.versionId,
    },
  });
  await tx.knowledgeSection.deleteMany({
    where: {
      organizationId: input.organizationId,
      versionId: input.versionId,
    },
  });

  for (const [sectionIndex, section] of input.sections.entries()) {
    const createdSection = await tx.knowledgeSection.create({
      data: {
        organizationId: input.organizationId,
        sourceId: input.sourceId,
        versionId: input.versionId,
        citationKey: section.citationKey,
        title: section.title,
        displayOrder: sectionIndex,
      },
    });
    for (const [passageIndex, passage] of section.passages.entries()) {
      await tx.knowledgePassage.create({
        data: {
          organizationId: input.organizationId,
          sourceId: input.sourceId,
          versionId: input.versionId,
          sectionId: createdSection.id,
          citationKey: passage.citationKey,
          body: passage.body,
          displayOrder: passageIndex,
        },
      });
    }
  }
}

async function loadVersionGraph(
  db: Prisma.TransactionClient | typeof prisma,
  input: { organizationId: string; versionId: string },
): Promise<VersionGraph> {
  return db.knowledgeVersion.findFirstOrThrow({
    where: {
      id: input.versionId,
      organizationId: input.organizationId,
    },
    include: versionGraphInclude,
  });
}

function sectionsFromGraph(version: VersionGraph): CanonicalKnowledgeSection[] {
  return assignCitationKeys(
    version.sections.map((section) => ({
      citationKey: section.citationKey,
      title: section.title,
      passages: section.passages.map((passage) => ({
        citationKey: passage.citationKey,
        body: passage.body,
      })),
    })),
  );
}

function notFound(): KnowledgeFailure {
  return {
    ok: false,
    reason: "not_found",
    message: "Knowledge was not found.",
  };
}

type ListStatus = "active" | "draft" | "archived" | "all";

function parseListStatus(raw: unknown, canManage: boolean): ListStatus {
  if (!canManage) {
    return "active";
  }
  if (
    raw === "draft" ||
    raw === "archived" ||
    raw === "all" ||
    raw === "active"
  ) {
    return raw;
  }
  return "all";
}

function listStatusWhere(
  status: ListStatus,
  now: Date,
): Prisma.KnowledgeSourceWhereInput {
  if (status === "archived") {
    return { archivedAt: { not: null } };
  }
  if (status === "draft") {
    return {
      archivedAt: null,
      versions: { some: { state: "DRAFT" } },
    };
  }
  if (status === "active") {
    return {
      ...memberVisibleSourceWhere(),
      versions: { some: memberVisibleVersionWhere(now) },
    };
  }
  return {};
}

async function sourceHasActiveVersion(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; sourceId: string },
): Promise<boolean> {
  const row = await tx.knowledgeVersion.findFirst({
    where: {
      organizationId: input.organizationId,
      sourceId: input.sourceId,
      state: "ACTIVE",
    },
    select: { id: true },
  });
  return Boolean(row);
}

async function loadOrganizationTimeZone(
  organizationId: string,
): Promise<string | null> {
  const profile = await prisma.businessProfile.findUnique({
    where: { organizationId },
    select: { timeZone: true },
  });
  return profile?.timeZone?.trim() || null;
}

async function resolveDraftEffectiveTimes(
  organizationId: string,
  parsed: {
    effectiveFrom?: unknown;
    effectiveUntil?: unknown;
    effectiveFromDisambiguation?: unknown;
    effectiveUntilDisambiguation?: unknown;
  },
): Promise<
  | { ok: true; effectiveFrom: Date | null; effectiveUntil: Date | null }
  | { ok: false; message: string; fieldErrors: Record<string, string[]> }
> {
  const [profile, organization] = await Promise.all([
    prisma.businessProfile.findUnique({
      where: { organizationId },
      select: { timeZone: true },
    }),
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { slug: true },
    }),
  ]);
  const resolved = resolveEffectiveRange({
    effectiveFrom: parsed.effectiveFrom,
    effectiveUntil: parsed.effectiveUntil,
    effectiveFromDisambiguation: parsed.effectiveFromDisambiguation,
    effectiveUntilDisambiguation: parsed.effectiveUntilDisambiguation,
    timeZone: profile?.timeZone ?? null,
    settingsHref: organization?.slug
      ? `/app/orgs/${organization.slug}/settings`
      : null,
  });
  if (!resolved.ok) {
    return {
      ok: false,
      message: resolved.message,
      fieldErrors: resolved.fieldErrors,
    };
  }
  return resolved;
}
