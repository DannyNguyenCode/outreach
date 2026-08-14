import "server-only";

import { Prisma, type Offering, type OfferingVersion } from "@prisma/client";

import type { SafeUser } from "@/lib/auth/users";
import { recordOrganizationAuditEvent } from "@/lib/orgs/audit";
import { requireOrganizationPermission } from "@/lib/orgs/authorization";
import {
  acquireOrganizationOfferingsLock,
  ConflictError,
  lockActiveAndDraftOfferingVersionsForUpdate,
  lockOfferingForUpdate,
  lockOfferingVersionForUpdate,
  mapOfferingError,
  OfferingLifecycleError,
  OfferingNotFoundError,
  requireActiveActorInTx,
  type AuthFailure,
  type OfferingMutationTestHooks,
} from "@/lib/orgs/offering-access";
import { OFFERING_CONFIRMATION_LANGUAGE_VERSION } from "@/lib/orgs/offering-confirmation";
import {
  archiveOfferingSchema,
  confirmOfferingSchema,
  createOfferingSchema,
  parsePage,
  parsePageSize,
  replacementOfferingDraftSchema,
  requireExpectedVersion,
  restoreOfferingSchema,
  sanitizeSearchQuery,
  selectCurrentPrices,
  toCanonicalOfferingContent,
  updateOfferingDraftSchema,
  validateCustomFieldValue,
  zodFieldErrors,
  type CanonicalCustomValue,
  type CanonicalOfferingContent,
  type OfferingBillingFrequencyValue,
  type OfferingPricingModelValue,
  type OfferingTypeValue,
} from "@/lib/orgs/offering-validation";
import { roleHasPermission } from "@/lib/orgs/permissions";
import { prisma } from "@/lib/prisma";
import { resolveEffectiveRange } from "@/lib/time/organization-datetime";

export type OfferingFailure = AuthFailure;

const versionGraphInclude = {
  prices: {
    orderBy: [{ displayOrder: "asc" as const }, { id: "asc" as const }],
  },
  features: {
    orderBy: [{ displayOrder: "asc" as const }, { id: "asc" as const }],
  },
  variants: {
    orderBy: [{ displayOrder: "asc" as const }, { id: "asc" as const }],
    include: { prices: { include: { price: true } } },
  },
  eligibility: true,
  customValues: {
    orderBy: [{ definitionKey: "asc" as const }, { id: "asc" as const }],
  },
} satisfies Prisma.OfferingVersionInclude;

export type OfferingVersionGraph = Prisma.OfferingVersionGetPayload<{
  include: typeof versionGraphInclude;
}>;

export type OfferingDetail = Offering & {
  versions: OfferingVersion[];
  draft: OfferingVersionGraph | null;
  active: OfferingVersionGraph | null;
};

type PreparedCustomValue = {
  definitionId: string;
  definitionKey: string;
  normalized: CanonicalCustomValue;
  canonicalValue: unknown;
};

type PreparedDraft = {
  canonical: CanonicalOfferingContent;
  checksum: string;
  customValues: PreparedCustomValue[];
};

export async function createOfferingDraft(
  input: { actor: SafeUser; organizationId: string; raw: unknown },
  hooks: OfferingMutationTestHooks = {},
): Promise<
  | { ok: true; offering: Offering; version: OfferingVersionGraph }
  | OfferingFailure
> {
  const parsed = createOfferingSchema.safeParse(input.raw);
  if (!parsed.success) return validationFailure(parsed.error);
  const prepared = await prepareDraft(input.organizationId, parsed.data);
  if (!prepared.ok) return prepared.failure;

  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.knowledge.manage",
    });
    const created = await prisma.$transaction(async (tx) => {
      await acquireOrganizationOfferingsLock(tx, input.organizationId, hooks);
      await requireActiveActorInTx(
        tx,
        {
          organizationId: input.organizationId,
          userId: input.actor.id,
          permission: "org.knowledge.manage",
        },
        hooks,
      );
      const offering = await tx.offering.create({
        data: {
          organizationId: input.organizationId,
          name: prepared.value.canonical.name,
          offeringType: prepared.value.canonical.offeringType,
          displayOrder: prepared.value.canonical.displayOrder,
          createdByUserId: input.actor.id,
        },
      });
      const version = await createDraftVersion(tx, {
        organizationId: input.organizationId,
        offeringId: offering.id,
        actorUserId: input.actor.id,
        prepared: prepared.value,
      });
      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "OFFERING_DRAFT_CREATED",
        metadata: {
          offeringId: offering.id,
          versionId: version.id,
          checksum: version.contentChecksum,
        },
      });
      return { offering, version };
    });
    await hooks.testAfterTransactionCommit?.();
    return { ok: true, ...created };
  } catch (error) {
    return mapFailure(error, "Could not create offering draft.");
  }
}

export async function updateOfferingDraft(
  input: { actor: SafeUser; organizationId: string; raw: unknown },
  hooks: OfferingMutationTestHooks = {},
): Promise<{ ok: true; version: OfferingVersionGraph } | OfferingFailure> {
  const parsed = updateOfferingDraftSchema.safeParse(input.raw);
  if (!parsed.success) return validationFailure(parsed.error);
  const expected = requireExpectedVersion(parsed.data.expectedDraftRevision);
  if (!expected.ok)
    return conflictField("expectedDraftRevision", expected.message);
  const prepared = await prepareDraft(input.organizationId, parsed.data);
  if (!prepared.ok) return prepared.failure;

  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.knowledge.manage",
    });
    const version = await prisma.$transaction(async (tx) => {
      await acquireOrganizationOfferingsLock(tx, input.organizationId, hooks);
      await requireActiveActorInTx(
        tx,
        {
          organizationId: input.organizationId,
          userId: input.actor.id,
          permission: "org.knowledge.manage",
        },
        hooks,
      );
      const offering = await lockOfferingForUpdate(
        tx,
        {
          organizationId: input.organizationId,
          offeringId: parsed.data.offeringId,
        },
        hooks,
      );
      if (!offering) throw new OfferingNotFoundError();
      if (offering.archivedAt) {
        throw new OfferingLifecycleError(
          "already_archived",
          "Archived offerings cannot be edited.",
        );
      }
      const locked = await lockOfferingVersionForUpdate(tx, {
        organizationId: input.organizationId,
        offeringId: parsed.data.offeringId,
        versionId: parsed.data.versionId,
      });
      if (!locked) throw new OfferingNotFoundError();
      if (locked.state !== "DRAFT") {
        throw new OfferingLifecycleError(
          "not_draft",
          "Only drafts can be edited.",
        );
      }

      const oldPriceFingerprint = await priceFingerprint(tx, {
        organizationId: input.organizationId,
        versionId: parsed.data.versionId,
      });
      const changed = await tx.offeringVersion.updateMany({
        where: {
          id: parsed.data.versionId,
          organizationId: input.organizationId,
          offeringId: parsed.data.offeringId,
          state: "DRAFT",
          draftRevision: expected.version,
        },
        data: {
          name: prepared.value.canonical.name,
          description: prepared.value.canonical.description,
          offeringType: prepared.value.canonical.offeringType,
          pricingModel: prepared.value.canonical.pricingModel,
          quoteRequired: prepared.value.canonical.quoteRequired,
          effectiveFrom: asDate(prepared.value.canonical.effectiveFrom),
          effectiveUntil: asDate(prepared.value.canonical.effectiveUntil),
          displayOrder: prepared.value.canonical.displayOrder,
          contentChecksum: prepared.value.checksum,
          draftRevision: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw new ConflictError();
      await replaceDraftContents(tx, {
        organizationId: input.organizationId,
        offeringId: parsed.data.offeringId,
        versionId: parsed.data.versionId,
        prepared: prepared.value,
      });
      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "OFFERING_DRAFT_UPDATED",
        metadata: {
          offeringId: parsed.data.offeringId,
          versionId: parsed.data.versionId,
          checksum: prepared.value.checksum,
        },
      });
      const nextPriceFingerprint = canonicalPriceFingerprint(
        prepared.value.canonical,
      );
      if (oldPriceFingerprint !== nextPriceFingerprint) {
        await recordOrganizationAuditEvent(tx, {
          organizationId: input.organizationId,
          actorUserId: input.actor.id,
          action: "OFFERING_PRICE_CHANGED",
          metadata: {
            offeringId: parsed.data.offeringId,
            versionId: parsed.data.versionId,
          },
        });
      }
      return loadVersionGraph(tx, input.organizationId, parsed.data.versionId);
    });
    await hooks.testAfterTransactionCommit?.();
    return { ok: true, version };
  } catch (error) {
    return mapFailure(error, "Could not update offering draft.");
  }
}

export async function confirmOfferingVersion(
  input: { actor: SafeUser; organizationId: string; raw: unknown },
  hooks: OfferingMutationTestHooks = {},
): Promise<{ ok: true; version: OfferingVersionGraph } | OfferingFailure> {
  const parsed = confirmOfferingSchema.safeParse(input.raw);
  if (!parsed.success) {
    return {
      ...validationFailure(parsed.error),
      message: "Please confirm this exact offering version.",
    };
  }
  const expected = requireExpectedVersion(parsed.data.expectedDraftRevision);
  if (!expected.ok)
    return conflictField("expectedDraftRevision", expected.message);

  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.knowledge.confirm",
    });
    const version = await prisma.$transaction(async (tx) => {
      await acquireOrganizationOfferingsLock(tx, input.organizationId, hooks);
      await requireActiveActorInTx(
        tx,
        {
          organizationId: input.organizationId,
          userId: input.actor.id,
          permission: "org.knowledge.confirm",
        },
        hooks,
      );
      const offering = await lockOfferingForUpdate(
        tx,
        {
          organizationId: input.organizationId,
          offeringId: parsed.data.offeringId,
        },
        hooks,
      );
      if (!offering) throw new OfferingNotFoundError();
      if (offering.archivedAt) {
        throw new OfferingLifecycleError(
          "already_archived",
          "Archived offerings cannot be confirmed.",
        );
      }
      const locked = await lockOfferingVersionForUpdate(tx, {
        organizationId: input.organizationId,
        offeringId: parsed.data.offeringId,
        versionId: parsed.data.versionId,
      });
      if (!locked) throw new OfferingNotFoundError();
      if (
        locked.state !== "DRAFT" ||
        locked.draftRevision !== expected.version
      ) {
        throw new ConflictError();
      }
      const graph = await loadVersionGraph(
        tx,
        input.organizationId,
        parsed.data.versionId,
      );
      const canonical = canonicalFromGraph(graph);
      const serverChecksum = toCanonicalOfferingContent(canonical).checksum;
      if (
        serverChecksum !== parsed.data.expectedChecksum.toLowerCase() ||
        serverChecksum !== locked.contentChecksum.toLowerCase()
      ) {
        throw new OfferingLifecycleError(
          "checksum_mismatch",
          "This preview no longer matches the saved draft. Reload and review it again.",
        );
      }
      assertNoCurrentPriceConflicts(graph, new Date());

      const previousActive = await tx.offeringVersion.findFirst({
        where: {
          organizationId: input.organizationId,
          offeringId: parsed.data.offeringId,
          state: "ACTIVE",
          id: { not: parsed.data.versionId },
        },
        select: { id: true },
      });
      if (previousActive) {
        const changed = await tx.offeringVersion.updateMany({
          where: {
            id: previousActive.id,
            organizationId: input.organizationId,
            offeringId: parsed.data.offeringId,
            state: "ACTIVE",
          },
          data: { state: "SUPERSEDED" },
        });
        if (changed.count !== 1) throw new ConflictError();
      }
      const confirmedAt = new Date();
      const activated = await tx.offeringVersion.updateMany({
        where: {
          id: parsed.data.versionId,
          organizationId: input.organizationId,
          offeringId: parsed.data.offeringId,
          state: "DRAFT",
          draftRevision: expected.version,
          contentChecksum: locked.contentChecksum,
          confirmedAt: null,
          confirmerUserId: null,
        },
        data: {
          state: "ACTIVE",
          confirmedAt,
          confirmerUserId: input.actor.id,
          confirmationLanguageVersion: OFFERING_CONFIRMATION_LANGUAGE_VERSION,
          supersedesVersionId: previousActive?.id ?? null,
          draftRevision: { increment: 1 },
        },
      });
      if (activated.count !== 1) throw new ConflictError();
      const bumped = await tx.offering.updateMany({
        where: {
          id: parsed.data.offeringId,
          organizationId: input.organizationId,
        },
        data: {
          name: graph.name,
          offeringType: graph.offeringType,
          displayOrder: graph.displayOrder,
          version: { increment: 1 },
        },
      });
      if (bumped.count !== 1) throw new ConflictError();
      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "OFFERING_VERSION_CONFIRMED",
        metadata: {
          offeringId: parsed.data.offeringId,
          versionId: parsed.data.versionId,
          checksum: serverChecksum,
          confirmationLanguageVersion: OFFERING_CONFIRMATION_LANGUAGE_VERSION,
          supersedesVersionId: previousActive?.id ?? null,
        },
      });
      if (previousActive) {
        await recordOrganizationAuditEvent(tx, {
          organizationId: input.organizationId,
          actorUserId: input.actor.id,
          action: "OFFERING_SUPERSEDED",
          metadata: {
            offeringId: parsed.data.offeringId,
            versionId: previousActive.id,
            supersededByVersionId: parsed.data.versionId,
          },
        });
      }
      return loadVersionGraph(tx, input.organizationId, parsed.data.versionId);
    });
    await hooks.testAfterTransactionCommit?.();
    return { ok: true, version };
  } catch (error) {
    return mapFailure(error, "Could not confirm offering.");
  }
}

export async function archiveOffering(
  input: { actor: SafeUser; organizationId: string; raw: unknown },
  hooks: OfferingMutationTestHooks = {},
): Promise<{ ok: true; offering: Offering } | OfferingFailure> {
  const parsed = archiveOfferingSchema.safeParse(input.raw);
  if (!parsed.success) return validationFailure(parsed.error);
  const expected = requireExpectedVersion(parsed.data.expectedVersion);
  if (!expected.ok) return conflictField("expectedVersion", expected.message);

  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.knowledge.archive",
    });
    const offering = await prisma.$transaction(async (tx) => {
      await acquireOrganizationOfferingsLock(tx, input.organizationId, hooks);
      await requireActiveActorInTx(
        tx,
        {
          organizationId: input.organizationId,
          userId: input.actor.id,
          permission: "org.knowledge.archive",
        },
        hooks,
      );
      const locked = await lockOfferingForUpdate(
        tx,
        {
          organizationId: input.organizationId,
          offeringId: parsed.data.offeringId,
        },
        hooks,
      );
      if (!locked) throw new OfferingNotFoundError();
      if (locked.archivedAt) {
        throw new OfferingLifecycleError(
          "already_archived",
          "This offering is already archived.",
        );
      }
      if (locked.version !== expected.version) throw new ConflictError();
      await lockActiveAndDraftOfferingVersionsForUpdate(tx, {
        organizationId: input.organizationId,
        offeringId: parsed.data.offeringId,
      });
      await tx.offeringVersion.updateMany({
        where: {
          organizationId: input.organizationId,
          offeringId: parsed.data.offeringId,
          state: { in: ["ACTIVE", "DRAFT"] },
        },
        data: { state: "ARCHIVED" },
      });
      const changed = await tx.offering.updateMany({
        where: {
          id: parsed.data.offeringId,
          organizationId: input.organizationId,
          archivedAt: null,
          version: expected.version,
        },
        data: {
          archivedAt: new Date(),
          archivedByUserId: input.actor.id,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw new ConflictError();
      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "OFFERING_ARCHIVED",
        metadata: { offeringId: parsed.data.offeringId },
      });
      return tx.offering.findFirstOrThrow({
        where: {
          id: parsed.data.offeringId,
          organizationId: input.organizationId,
        },
      });
    });
    await hooks.testAfterTransactionCommit?.();
    return { ok: true, offering };
  } catch (error) {
    return mapFailure(error, "Could not archive offering.");
  }
}

export async function restoreOfferingVersion(
  input: { actor: SafeUser; organizationId: string; raw: unknown },
  hooks: OfferingMutationTestHooks = {},
): Promise<{ ok: true; version: OfferingVersionGraph } | OfferingFailure> {
  const parsed = restoreOfferingSchema.safeParse(input.raw);
  if (!parsed.success) return validationFailure(parsed.error);
  const expected = requireExpectedVersion(parsed.data.expectedVersion);
  if (!expected.ok) return conflictField("expectedVersion", expected.message);
  return copyHistoricalVersionToDraft({
    ...input,
    offeringId: parsed.data.offeringId,
    versionId: parsed.data.versionId,
    expectedVersion: expected.version,
    permission: "org.knowledge.archive",
    auditAction: "OFFERING_RESTORED",
    restored: true,
    hooks,
  });
}

export async function createOfferingReplacementDraft(
  input: { actor: SafeUser; organizationId: string; raw: unknown },
  hooks: OfferingMutationTestHooks = {},
): Promise<{ ok: true; version: OfferingVersionGraph } | OfferingFailure> {
  const parsed = replacementOfferingDraftSchema.safeParse(input.raw);
  if (!parsed.success) return validationFailure(parsed.error);
  const expected = requireExpectedVersion(parsed.data.expectedVersion);
  if (!expected.ok) return conflictField("expectedVersion", expected.message);
  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.knowledge.manage",
    });
    const active = await prisma.offeringVersion.findFirst({
      where: {
        organizationId: input.organizationId,
        offeringId: parsed.data.offeringId,
        state: "ACTIVE",
      },
      select: { id: true },
    });
    if (!active) {
      return {
        ok: false,
        reason: "not_confirmable",
        message: "There is no active offering version to replace.",
      };
    }
    return copyHistoricalVersionToDraft({
      ...input,
      offeringId: parsed.data.offeringId,
      versionId: active.id,
      expectedVersion: expected.version,
      permission: "org.knowledge.manage",
      auditAction: "OFFERING_REPLACEMENT_DRAFT_CREATED",
      restored: false,
      hooks,
    });
  } catch (error) {
    return mapFailure(error, "Could not create replacement draft.");
  }
}

export async function listOfferings(input: {
  actor: SafeUser;
  organizationId: string;
  query?: unknown;
  status?: unknown;
  page?: unknown;
  pageSize?: unknown;
}): Promise<
  | {
      ok: true;
      items: Array<Offering & { versions: OfferingVersion[] }>;
      page: number;
      pageSize: number;
      total: number;
      canManage: boolean;
    }
  | OfferingFailure
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
    const activeVersionWhere = memberVisibleVersionWhere(now);
    const status = canManage ? parseStatus(input.status) : "active";
    const where: Prisma.OfferingWhereInput = {
      organizationId: input.organizationId,
      ...(status === "archived"
        ? { archivedAt: { not: null } }
        : status === "draft"
          ? { archivedAt: null, versions: { some: { state: "DRAFT" } } }
          : status === "active"
            ? { archivedAt: null, versions: { some: activeVersionWhere } }
            : {}),
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              {
                versions: {
                  some: canManage
                    ? {
                        name: {
                          contains: query,
                          mode: "insensitive",
                        },
                      }
                    : {
                        ...activeVersionWhere,
                        name: {
                          contains: query,
                          mode: "insensitive",
                        },
                      },
                },
              },
            ],
          }
        : {}),
    };
    const [total, items] = await Promise.all([
      prisma.offering.count({ where }),
      prisma.offering.findMany({
        where,
        include: {
          versions: {
            where: canManage ? undefined : activeVersionWhere,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          },
        },
        orderBy: [{ displayOrder: "asc" }, { name: "asc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { ok: true, items, page, pageSize, total, canManage };
  } catch (error) {
    return mapFailure(error, "Could not load offerings.");
  }
}

export async function getOffering(input: {
  actor: SafeUser;
  organizationId: string;
  offeringId: string;
}): Promise<
  | {
      ok: true;
      offering: OfferingDetail;
      canManage: boolean;
      canConfirm: boolean;
      canArchive: boolean;
      organizationTimeZone: string | null;
    }
  | OfferingFailure
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
    const now = new Date();
    const versions = await prisma.offeringVersion.findMany({
      where: canManage
        ? {
            organizationId: input.organizationId,
            offeringId: input.offeringId,
          }
        : {
            organizationId: input.organizationId,
            offeringId: input.offeringId,
            ...memberVisibleVersionWhere(now),
          },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    const offering = await prisma.offering.findFirst({
      where: canManage
        ? { id: input.offeringId, organizationId: input.organizationId }
        : {
            id: input.offeringId,
            organizationId: input.organizationId,
            archivedAt: null,
            versions: { some: memberVisibleVersionWhere(now) },
          },
    });
    if (!offering) return notFound();
    const draftSummary = versions.find((item) => item.state === "DRAFT");
    const activeSummary = versions.find((item) => item.state === "ACTIVE");
    const [draft, active, profile] = await Promise.all([
      draftSummary
        ? loadVersionGraph(prisma, input.organizationId, draftSummary.id)
        : null,
      activeSummary
        ? loadVersionGraph(prisma, input.organizationId, activeSummary.id)
        : null,
      prisma.businessProfile.findUnique({
        where: { organizationId: input.organizationId },
        select: { timeZone: true },
      }),
    ]);
    return {
      ok: true,
      offering: { ...offering, versions, draft, active },
      canManage,
      canConfirm: roleHasPermission(membership.role, "org.knowledge.confirm"),
      canArchive: roleHasPermission(membership.role, "org.knowledge.archive"),
      organizationTimeZone: profile?.timeZone?.trim() || null,
    };
  } catch (error) {
    return mapFailure(error, "Could not load offering.");
  }
}

export async function getOfferingVersion(input: {
  actor: SafeUser;
  organizationId: string;
  offeringId: string;
  versionId: string;
}): Promise<
  | {
      ok: true;
      offering: Offering;
      version: OfferingVersionGraph;
      canManage: boolean;
      canConfirm: boolean;
      canArchive: boolean;
      organizationTimeZone: string | null;
    }
  | OfferingFailure
> {
  const detail = await getOffering(input);
  if (!detail.ok) return detail;
  const visible = detail.offering.versions.some(
    (version) => version.id === input.versionId,
  );
  if (!visible) return notFound();
  const version = await prisma.offeringVersion.findFirst({
    where: {
      id: input.versionId,
      offeringId: input.offeringId,
      organizationId: input.organizationId,
    },
    include: versionGraphInclude,
  });
  if (!version) return notFound();
  return {
    ok: true,
    offering: detail.offering,
    version,
    canManage: detail.canManage,
    canConfirm: detail.canConfirm,
    canArchive: detail.canArchive,
    organizationTimeZone: detail.organizationTimeZone,
  };
}

async function copyHistoricalVersionToDraft(input: {
  actor: SafeUser;
  organizationId: string;
  offeringId: string;
  versionId: string;
  expectedVersion: number;
  permission: "org.knowledge.manage" | "org.knowledge.archive";
  auditAction: "OFFERING_RESTORED" | "OFFERING_REPLACEMENT_DRAFT_CREATED";
  restored: boolean;
  hooks: OfferingMutationTestHooks;
}): Promise<{ ok: true; version: OfferingVersionGraph } | OfferingFailure> {
  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: input.permission,
    });
    const version = await prisma.$transaction(async (tx) => {
      await acquireOrganizationOfferingsLock(
        tx,
        input.organizationId,
        input.hooks,
      );
      await requireActiveActorInTx(
        tx,
        {
          organizationId: input.organizationId,
          userId: input.actor.id,
          permission: input.permission,
        },
        input.hooks,
      );
      const offering = await lockOfferingForUpdate(
        tx,
        {
          organizationId: input.organizationId,
          offeringId: input.offeringId,
        },
        input.hooks,
      );
      if (!offering) throw new OfferingNotFoundError();
      if (offering.version !== input.expectedVersion) throw new ConflictError();
      if (!input.restored && offering.archivedAt) {
        throw new OfferingLifecycleError(
          "already_archived",
          "Restore an archived offering before replacing it.",
        );
      }
      const existingDraft = await tx.offeringVersion.findFirst({
        where: {
          organizationId: input.organizationId,
          offeringId: input.offeringId,
          state: "DRAFT",
        },
      });
      if (existingDraft) {
        throw new OfferingLifecycleError(
          "draft_exists",
          "A draft already exists for this offering.",
        );
      }
      const historical = await tx.offeringVersion.findFirst({
        where: {
          id: input.versionId,
          organizationId: input.organizationId,
          offeringId: input.offeringId,
        },
        include: versionGraphInclude,
      });
      if (!historical || !historical.confirmedAt) {
        throw new OfferingLifecycleError(
          "not_restorable",
          "Only a previously confirmed version can be copied to a draft.",
        );
      }
      if (
        input.restored &&
        historical.state !== "SUPERSEDED" &&
        historical.state !== "ARCHIVED"
      ) {
        throw new OfferingLifecycleError(
          "not_restorable",
          "This offering version cannot be restored.",
        );
      }
      const prepared = preparedFromGraph(historical);
      const created = await createDraftVersion(tx, {
        organizationId: input.organizationId,
        offeringId: input.offeringId,
        actorUserId: input.actor.id,
        prepared,
        restoredFromVersionId: input.restored ? historical.id : undefined,
      });
      const changed = await tx.offering.updateMany({
        where: {
          id: input.offeringId,
          organizationId: input.organizationId,
          version: input.expectedVersion,
        },
        data: {
          archivedAt: input.restored ? null : undefined,
          archivedByUserId: input.restored ? null : undefined,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw new ConflictError();
      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: input.auditAction,
        metadata: {
          offeringId: input.offeringId,
          versionId: created.id,
          ...(input.restored
            ? { restoredFromVersionId: historical.id }
            : { copiedFromVersionId: historical.id }),
          checksum: created.contentChecksum,
        },
      });
      return created;
    });
    await input.hooks.testAfterTransactionCommit?.();
    return { ok: true, version };
  } catch (error) {
    return mapFailure(
      error,
      input.restored
        ? "Could not restore offering."
        : "Could not create replacement draft.",
    );
  }
}

async function prepareDraft(
  organizationId: string,
  parsed: {
    name: string;
    description?: string | null;
    offeringType: OfferingTypeValue;
    pricingModel: OfferingPricingModelValue;
    quoteRequired?: boolean;
    effectiveFrom?: unknown;
    effectiveUntil?: unknown;
    effectiveFromDisambiguation?: unknown;
    effectiveUntilDisambiguation?: unknown;
    displayOrder?: number;
    prices: Array<{
      label?: string | null;
      amount: Prisma.Decimal;
      currencyCode: string;
      billingFrequency: OfferingBillingFrequencyValue;
      intervalCount?: number | null;
      isActive: boolean;
      effectiveFrom?: unknown;
      effectiveUntil?: unknown;
      effectiveFromDisambiguation?: unknown;
      effectiveUntilDisambiguation?: unknown;
      displayOrder?: number;
      clientKey?: string;
    }>;
    features: Array<{
      featureKey?: string;
      name: string;
      value?: string | null;
      unit?: string | null;
      displayOrder?: number;
    }>;
    variants: Array<{
      name: string;
      sku?: string | null;
      referenceCode?: string | null;
      attributes: Record<string, unknown>;
      isActive: boolean;
      displayOrder?: number;
      priceClientKeys?: string[];
    }>;
    eligibility?: {
      description?: string | null;
      availabilityRestrictions?: string | null;
      qualificationNotes?: string | null;
      geographicNotes?: string | null;
      minimumQuantity?: number | null;
      maximumQuantity?: number | null;
    } | null;
    customValues: Array<{ definitionKey: string; value: unknown }>;
  },
): Promise<
  { ok: true; value: PreparedDraft } | { ok: false; failure: OfferingFailure }
> {
  const [profile, organization, definitions] = await Promise.all([
    prisma.businessProfile.findUnique({
      where: { organizationId },
      select: { timeZone: true },
    }),
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { slug: true },
    }),
    prisma.customFieldDefinition.findMany({
      where: {
        organizationId,
        scope: "OFFERING",
        key: { in: parsed.customValues.map((value) => value.definitionKey) },
      },
    }),
  ]);
  const settingsHref = organization?.slug
    ? `/app/orgs/${organization.slug}/settings`
    : null;
  const effective = resolveEffectiveRange({
    effectiveFrom: parsed.effectiveFrom,
    effectiveUntil: parsed.effectiveUntil,
    effectiveFromDisambiguation: parsed.effectiveFromDisambiguation,
    effectiveUntilDisambiguation: parsed.effectiveUntilDisambiguation,
    timeZone: profile?.timeZone ?? null,
    settingsHref,
  });
  if (!effective.ok) {
    return {
      ok: false,
      failure: {
        ok: false,
        reason: "validation",
        message: effective.message,
        fieldErrors: effective.fieldErrors,
      },
    };
  }
  const prices = [];
  for (const [index, price] of parsed.prices.entries()) {
    const range = resolveEffectiveRange({
      effectiveFrom: price.effectiveFrom,
      effectiveUntil: price.effectiveUntil,
      effectiveFromDisambiguation: price.effectiveFromDisambiguation,
      effectiveUntilDisambiguation: price.effectiveUntilDisambiguation,
      timeZone: profile?.timeZone ?? null,
      settingsHref,
    });
    if (!range.ok) {
      const field = Object.keys(range.fieldErrors)[0] ?? "effectiveFrom";
      return {
        ok: false,
        failure: {
          ok: false,
          reason: "validation",
          message: range.message,
          fieldErrors: { [`prices.${index}.${field}`]: [range.message] },
        },
      };
    }
    prices.push({ ...price, ...range });
  }
  const definitionByKey = new Map(definitions.map((item) => [item.key, item]));
  const customValues: PreparedCustomValue[] = [];
  for (const [index, item] of parsed.customValues.entries()) {
    const definition = definitionByKey.get(item.definitionKey);
    if (!definition || !definition.isActive) {
      return customFailure(
        index,
        "Custom field is not an active OFFERING field in this organization.",
      );
    }
    const validated = validateCustomFieldValue({
      dataType: definition.dataType,
      options: definition.options,
      value: item.value,
    });
    if (!validated.ok) return customFailure(index, validated.message);
    customValues.push({
      definitionId: definition.id,
      definitionKey: definition.key,
      normalized: validated.normalized,
      canonicalValue: canonicalCustomValue(validated.normalized),
    });
  }
  const prepared = toCanonicalOfferingContent({
    ...parsed,
    effectiveFrom: effective.effectiveFrom,
    effectiveUntil: effective.effectiveUntil,
    prices,
    variants: parsed.variants.map((variant) => ({
      ...variant,
      attributes: variant.attributes as Record<
        string,
        string | number | boolean | null
      >,
    })),
    eligibility: parsed.eligibility
      ? {
          description: parsed.eligibility.description ?? null,
          availabilityRestrictions:
            parsed.eligibility.availabilityRestrictions ?? null,
          qualificationNotes: parsed.eligibility.qualificationNotes ?? null,
          geographicNotes: parsed.eligibility.geographicNotes ?? null,
          minimumQuantity: parsed.eligibility.minimumQuantity ?? null,
          maximumQuantity: parsed.eligibility.maximumQuantity ?? null,
        }
      : null,
    customValues: customValues.map((item) => ({
      definitionKey: item.definitionKey,
      value: item.canonicalValue,
    })),
  });
  return { ok: true, value: { ...prepared, customValues } };
}

async function createDraftVersion(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    offeringId: string;
    actorUserId: string;
    prepared: PreparedDraft;
    restoredFromVersionId?: string;
  },
): Promise<OfferingVersionGraph> {
  const content = input.prepared.canonical;
  const version = await tx.offeringVersion.create({
    data: {
      organizationId: input.organizationId,
      offeringId: input.offeringId,
      state: "DRAFT",
      name: content.name,
      description: content.description,
      offeringType: content.offeringType,
      pricingModel: content.pricingModel,
      quoteRequired: content.quoteRequired,
      contentChecksum: input.prepared.checksum,
      effectiveFrom: asDate(content.effectiveFrom),
      effectiveUntil: asDate(content.effectiveUntil),
      displayOrder: content.displayOrder,
      createdByUserId: input.actorUserId,
      restoredFromVersionId: input.restoredFromVersionId ?? null,
    },
  });
  await replaceDraftContents(tx, {
    organizationId: input.organizationId,
    offeringId: input.offeringId,
    versionId: version.id,
    prepared: input.prepared,
  });
  return loadVersionGraph(tx, input.organizationId, version.id);
}

async function replaceDraftContents(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    offeringId: string;
    versionId: string;
    prepared: PreparedDraft;
  },
) {
  await tx.offeringVariantPrice.deleteMany({
    where: { organizationId: input.organizationId, versionId: input.versionId },
  });
  await tx.offeringVariant.deleteMany({
    where: { organizationId: input.organizationId, versionId: input.versionId },
  });
  await tx.offeringPrice.deleteMany({
    where: { organizationId: input.organizationId, versionId: input.versionId },
  });
  await tx.offeringFeature.deleteMany({
    where: { organizationId: input.organizationId, versionId: input.versionId },
  });
  await tx.offeringEligibility.deleteMany({
    where: { organizationId: input.organizationId, versionId: input.versionId },
  });
  await tx.offeringCustomValue.deleteMany({
    where: { organizationId: input.organizationId, versionId: input.versionId },
  });

  const priceIds = new Map<string, string>();
  for (const price of input.prepared.canonical.prices) {
    const created = await tx.offeringPrice.create({
      data: {
        organizationId: input.organizationId,
        offeringId: input.offeringId,
        versionId: input.versionId,
        label: price.label,
        amount: new Prisma.Decimal(price.amount),
        currencyCode: price.currencyCode,
        billingFrequency: price.billingFrequency,
        intervalCount: price.intervalCount,
        isActive: price.isActive,
        effectiveFrom: asDate(price.effectiveFrom),
        effectiveUntil: asDate(price.effectiveUntil),
        displayOrder: price.displayOrder,
      },
    });
    priceIds.set(price.clientKey, created.id);
  }
  for (const feature of input.prepared.canonical.features) {
    await tx.offeringFeature.create({
      data: {
        organizationId: input.organizationId,
        offeringId: input.offeringId,
        versionId: input.versionId,
        featureKey: feature.featureKey,
        name: feature.name,
        value: feature.value,
        unit: feature.unit,
        displayOrder: feature.displayOrder,
      },
    });
  }
  for (const variant of input.prepared.canonical.variants) {
    const created = await tx.offeringVariant.create({
      data: {
        organizationId: input.organizationId,
        offeringId: input.offeringId,
        versionId: input.versionId,
        name: variant.name,
        sku: variant.sku,
        referenceCode: variant.referenceCode,
        attributes: variant.attributes as Prisma.InputJsonValue,
        isActive: variant.isActive,
        displayOrder: variant.displayOrder,
      },
    });
    for (const clientKey of variant.priceClientKeys) {
      const priceId = priceIds.get(clientKey);
      if (!priceId) throw new ConflictError();
      await tx.offeringVariantPrice.create({
        data: {
          organizationId: input.organizationId,
          offeringId: input.offeringId,
          versionId: input.versionId,
          variantId: created.id,
          priceId,
        },
      });
    }
  }
  const eligibility = input.prepared.canonical.eligibility;
  if (eligibility) {
    await tx.offeringEligibility.create({
      data: {
        organizationId: input.organizationId,
        offeringId: input.offeringId,
        versionId: input.versionId,
        ...eligibility,
      },
    });
  }
  for (const custom of input.prepared.customValues) {
    await tx.offeringCustomValue.create({
      data: {
        organizationId: input.organizationId,
        offeringId: input.offeringId,
        versionId: input.versionId,
        definitionId: custom.definitionId,
        definitionKey: custom.definitionKey,
        ...customStorage(custom.normalized),
      },
    });
  }
}

function canonicalFromGraph(version: OfferingVersionGraph) {
  const priceClientKey = new Map(
    version.prices.map((price, index) => [price.id, `price_${index + 1}`]),
  );
  return {
    name: version.name,
    description: version.description,
    offeringType: version.offeringType,
    pricingModel: version.pricingModel,
    quoteRequired: version.quoteRequired,
    effectiveFrom: version.effectiveFrom,
    effectiveUntil: version.effectiveUntil,
    displayOrder: version.displayOrder,
    prices: version.prices.map((price) => ({
      ...price,
      clientKey: priceClientKey.get(price.id),
    })),
    features: version.features,
    variants: version.variants.map((variant) => ({
      ...variant,
      attributes: variant.attributes as Record<
        string,
        string | number | boolean | null
      >,
      priceClientKeys: variant.prices
        .map((item) => priceClientKey.get(item.priceId))
        .filter((key): key is string => Boolean(key)),
    })),
    eligibility: version.eligibility,
    customValues: version.customValues.map((item) => ({
      definitionKey: item.definitionKey,
      value: customGraphValue(item),
    })),
  };
}

function preparedFromGraph(version: OfferingVersionGraph): PreparedDraft {
  const canonicalInput = canonicalFromGraph(version);
  const prepared = toCanonicalOfferingContent(canonicalInput);
  return {
    ...prepared,
    customValues: version.customValues.map((item) => {
      const normalized = customGraphNormalized(item);
      return {
        definitionId: item.definitionId,
        definitionKey: item.definitionKey,
        normalized,
        canonicalValue: canonicalCustomValue(normalized),
      };
    }),
  };
}

function assertNoCurrentPriceConflicts(graph: OfferingVersionGraph, now: Date) {
  const variantPriceIds = new Set(
    graph.variants.flatMap((variant) =>
      variant.prices.map((item) => item.priceId),
    ),
  );
  const basePrices = graph.prices.filter(
    (price) => !variantPriceIds.has(price.id),
  );
  const base = selectCurrentPrices(basePrices, now);
  // MULTI_OPTION / TIERED intentionally expose multiple currently effective
  // choices. FIXED_ONE_TIME / RECURRING must have at most one current base price.
  if (
    (graph.pricingModel === "FIXED_ONE_TIME" ||
      graph.pricingModel === "RECURRING") &&
    base.conflict
  ) {
    throw new OfferingLifecycleError(
      "conflicting_prices",
      "Multiple base prices are currently effective. Adjust their effective dates before confirmation.",
    );
  }
  if (
    graph.pricingModel === "MULTI_OPTION" ||
    graph.pricingModel === "TIERED"
  ) {
    const labels = new Map<string, number>();
    for (const price of base.current) {
      const key = (price.label ?? "").trim().toLowerCase() || price.id;
      labels.set(key, (labels.get(key) ?? 0) + 1);
    }
    if ([...labels.values()].some((count) => count > 1)) {
      throw new OfferingLifecycleError(
        "conflicting_prices",
        "Multiple currently effective prices share the same option/tier label.",
      );
    }
  }
  for (const variant of graph.variants) {
    const ids = new Set(variant.prices.map((item) => item.priceId));
    if (selectCurrentPrices(graph.prices, now, ids).conflict) {
      throw new OfferingLifecycleError(
        "conflicting_prices",
        `Variant "${variant.name}" has multiple currently effective prices.`,
      );
    }
  }
}

function memberVisibleVersionWhere(
  now: Date,
): Prisma.OfferingVersionWhereInput {
  return {
    state: "ACTIVE",
    confirmedAt: { not: null },
    confirmationLanguageVersion: { not: null },
    AND: [
      { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }] },
      { OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }] },
    ],
  };
}

async function loadVersionGraph(
  db: Prisma.TransactionClient | typeof prisma,
  organizationId: string,
  versionId: string,
) {
  return db.offeringVersion.findFirstOrThrow({
    where: { id: versionId, organizationId },
    include: versionGraphInclude,
  });
}

function customStorage(
  value: CanonicalCustomValue,
): Partial<
  Pick<
    Prisma.OfferingCustomValueUncheckedCreateInput,
    "stringValue" | "numberValue" | "booleanValue" | "dateValue" | "jsonValue"
  >
> {
  switch (value.kind) {
    case "string":
      return { stringValue: value.stringValue };
    case "number":
      return { numberValue: value.numberValue };
    case "boolean":
      return { booleanValue: value.booleanValue };
    case "date":
      return { dateValue: value.dateValue };
    case "json":
      return { jsonValue: value.jsonValue };
  }
}

function canonicalCustomValue(value: CanonicalCustomValue): unknown {
  switch (value.kind) {
    case "string":
      return value.stringValue;
    case "number":
      return value.numberValue.toFixed(4);
    case "boolean":
      return value.booleanValue;
    case "date":
      return value.dateValue.toISOString().slice(0, 10);
    case "json":
      return value.jsonValue;
  }
}

type StoredCustom = OfferingVersionGraph["customValues"][number];

function customGraphNormalized(value: StoredCustom): CanonicalCustomValue {
  if (value.stringValue !== null) {
    return { kind: "string", stringValue: value.stringValue };
  }
  if (value.numberValue !== null) {
    return { kind: "number", numberValue: value.numberValue };
  }
  if (value.booleanValue !== null) {
    return { kind: "boolean", booleanValue: value.booleanValue };
  }
  if (value.dateValue !== null) {
    return { kind: "date", dateValue: value.dateValue };
  }
  return {
    kind: "json",
    jsonValue: (value.jsonValue ?? []) as Prisma.InputJsonValue,
  };
}

function customGraphValue(value: StoredCustom): unknown {
  return canonicalCustomValue(customGraphNormalized(value));
}

async function priceFingerprint(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; versionId: string },
) {
  const prices = await tx.offeringPrice.findMany({
    where: input,
    orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
  });
  return JSON.stringify(
    prices.map((price) => ({
      label: price.label,
      amount: price.amount.toFixed(4),
      currencyCode: price.currencyCode,
      billingFrequency: price.billingFrequency,
      intervalCount: price.intervalCount,
      isActive: price.isActive,
      effectiveFrom: price.effectiveFrom?.toISOString() ?? null,
      effectiveUntil: price.effectiveUntil?.toISOString() ?? null,
      displayOrder: price.displayOrder,
    })),
  );
}

function canonicalPriceFingerprint(content: CanonicalOfferingContent) {
  return JSON.stringify(
    content.prices.map((price) => ({
      label: price.label,
      amount: price.amount,
      currencyCode: price.currencyCode,
      billingFrequency: price.billingFrequency,
      intervalCount: price.intervalCount,
      isActive: price.isActive,
      effectiveFrom: price.effectiveFrom,
      effectiveUntil: price.effectiveUntil,
      displayOrder: price.displayOrder,
    })),
  );
}

function customFailure(index: number, message: string) {
  return {
    ok: false as const,
    failure: {
      ok: false as const,
      reason: "validation" as const,
      message: "Please correct the highlighted fields.",
      fieldErrors: { [`customValues.${index}.value`]: [message] },
    },
  };
}

function validationFailure(error: {
  issues: Array<{ path: PropertyKey[]; message: string }>;
}): OfferingFailure {
  return {
    ok: false,
    reason: "validation",
    message: "Please correct the highlighted fields.",
    fieldErrors: zodFieldErrors(error as never),
  };
}

function conflictField(field: string, message: string): OfferingFailure {
  return {
    ok: false,
    reason: "conflict",
    message,
    fieldErrors: { [field]: [message] },
  };
}

function mapFailure(error: unknown, message: string): OfferingFailure {
  return (
    mapOfferingError(error) ?? {
      ok: false,
      reason: "failed",
      message,
    }
  );
}

function notFound(): OfferingFailure {
  return {
    ok: false,
    reason: "not_found",
    message: "Offering was not found.",
  };
}

function asDate(value: string | null): Date | null {
  return value ? new Date(value) : null;
}

function parseStatus(raw: unknown): "active" | "draft" | "archived" | "all" {
  return raw === "active" ||
    raw === "draft" ||
    raw === "archived" ||
    raw === "all"
    ? raw
    : "all";
}
