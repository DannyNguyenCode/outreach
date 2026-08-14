import "server-only";

import type { ServiceArea } from "@prisma/client";

import type { SafeUser } from "@/lib/auth/users";
import { recordOrganizationAuditEvent } from "@/lib/orgs/audit";
import {
  OrganizationAuthError,
  requireOrganizationPermission,
} from "@/lib/orgs/authorization";
import {
  acquireConfig3bSectionLock,
  acquireOrganizationConfig3bLock,
  ConflictError,
  mapAuthError,
  requireActiveActorInTx,
  serviceAreasOrderLockKey,
  type AuthFailure,
  type Config3bMutationTestHooks,
} from "@/lib/orgs/config-3b-access";
import {
  reorderItemsSchema,
  requireExpectedVersion,
  serviceAreaInputSchema,
  zodFieldErrors,
} from "@/lib/orgs/config-3b-validation";
import { prisma } from "@/lib/prisma";

export type ServiceAreasResult =
  { ok: true; areas: ServiceArea[] } | AuthFailure;

export type ServiceAreaResult = { ok: true; area: ServiceArea } | AuthFailure;

function normalizeCountryCode(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.trim().toUpperCase();
}

export async function listServiceAreas(input: {
  actor: SafeUser;
  organizationId: string;
}): Promise<ServiceAreasResult> {
  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.config.read",
    });
    const areas = await prisma.serviceArea.findMany({
      where: { organizationId: input.organizationId },
      orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
    });
    return { ok: true, areas };
  } catch (error) {
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not load service areas.",
      }
    );
  }
}

export async function createServiceArea(
  input: {
    actor: SafeUser;
    organizationId: string;
    raw: unknown;
  },
  hooks: Config3bMutationTestHooks = {},
): Promise<ServiceAreaResult> {
  const parsed = serviceAreaInputSchema.safeParse(input.raw);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "validation",
      message: "Please correct the highlighted fields.",
      fieldErrors: zodFieldErrors(parsed.error),
    };
  }

  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.config.manage",
    });

    const area = await prisma.$transaction(async (tx) => {
      await acquireOrganizationConfig3bLock(tx, input.organizationId, hooks);
      await requireActiveActorInTx(
        tx,
        {
          organizationId: input.organizationId,
          userId: input.actor.id,
          permission: "org.config.manage",
        },
        hooks,
      );

      const maxOrder = await tx.serviceArea.aggregate({
        where: { organizationId: input.organizationId },
        _max: { displayOrder: true },
      });

      const created = await tx.serviceArea.create({
        data: {
          organizationId: input.organizationId,
          label: parsed.data.label,
          countryCode: normalizeCountryCode(parsed.data.countryCode ?? null),
          region: parsed.data.region ?? null,
          city: parsed.data.city ?? null,
          postalPrefix: parsed.data.postalPrefix ?? null,
          isRemote: parsed.data.isRemote,
          isActive: parsed.data.isActive,
          displayOrder: (maxOrder._max.displayOrder ?? -1) + 1,
        },
      });

      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "SERVICE_AREA_CREATED",
        metadata: { serviceAreaId: created.id },
      });

      return created;
    });

    if (hooks.testAfterTransactionCommit) {
      await hooks.testAfterTransactionCommit();
    }

    return { ok: true, area };
  } catch (error) {
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not create service area.",
      }
    );
  }
}

export async function updateServiceArea(
  input: {
    actor: SafeUser;
    organizationId: string;
    serviceAreaId: string;
    raw: unknown;
    expectedVersion: number;
  },
  hooks: Config3bMutationTestHooks = {},
): Promise<ServiceAreaResult> {
  const versionParsed = requireExpectedVersion(input.expectedVersion);
  if (!versionParsed.ok) {
    return {
      ok: false,
      reason: "validation",
      message: versionParsed.message,
      fieldErrors: { expectedVersion: [versionParsed.message] },
    };
  }

  const parsed = serviceAreaInputSchema.safeParse(input.raw);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "validation",
      message: "Please correct the highlighted fields.",
      fieldErrors: zodFieldErrors(parsed.error),
    };
  }

  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.config.manage",
    });

    const area = await prisma.$transaction(async (tx) => {
      await acquireOrganizationConfig3bLock(tx, input.organizationId, hooks);
      await requireActiveActorInTx(
        tx,
        {
          organizationId: input.organizationId,
          userId: input.actor.id,
          permission: "org.config.manage",
        },
        hooks,
      );

      const existing = await tx.serviceArea.findFirst({
        where: {
          id: input.serviceAreaId,
          organizationId: input.organizationId,
        },
      });
      if (!existing) {
        throw new OrganizationAuthError("organization_not_found");
      }

      const updatedCount = await tx.serviceArea.updateMany({
        where: {
          id: existing.id,
          organizationId: input.organizationId,
          version: versionParsed.version,
        },
        data: {
          label: parsed.data.label,
          countryCode: normalizeCountryCode(parsed.data.countryCode ?? null),
          region: parsed.data.region ?? null,
          city: parsed.data.city ?? null,
          postalPrefix: parsed.data.postalPrefix ?? null,
          isRemote: parsed.data.isRemote,
          isActive: parsed.data.isActive ?? existing.isActive,
          version: { increment: 1 },
        },
      });

      if (updatedCount.count !== 1) {
        throw new ConflictError();
      }

      const updated = await tx.serviceArea.findUniqueOrThrow({
        where: { id: existing.id },
      });

      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "SERVICE_AREA_UPDATED",
        metadata: { serviceAreaId: updated.id },
      });

      return updated;
    });

    if (hooks.testAfterTransactionCommit) {
      await hooks.testAfterTransactionCommit();
    }

    return { ok: true, area };
  } catch (error) {
    if (error instanceof ConflictError) {
      return {
        ok: false,
        reason: "conflict",
        message: "Service area was updated elsewhere. Reload and try again.",
      };
    }
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not update service area.",
      }
    );
  }
}

export async function deactivateServiceArea(
  input: {
    actor: SafeUser;
    organizationId: string;
    serviceAreaId: string;
    expectedVersion: number;
  },
  hooks: Config3bMutationTestHooks = {},
): Promise<ServiceAreaResult> {
  const versionParsed = requireExpectedVersion(input.expectedVersion);
  if (!versionParsed.ok) {
    return {
      ok: false,
      reason: "validation",
      message: versionParsed.message,
      fieldErrors: { expectedVersion: [versionParsed.message] },
    };
  }

  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.config.manage",
    });

    const area = await prisma.$transaction(async (tx) => {
      await acquireOrganizationConfig3bLock(tx, input.organizationId, hooks);
      await requireActiveActorInTx(
        tx,
        {
          organizationId: input.organizationId,
          userId: input.actor.id,
          permission: "org.config.manage",
        },
        hooks,
      );

      const existing = await tx.serviceArea.findFirst({
        where: {
          id: input.serviceAreaId,
          organizationId: input.organizationId,
        },
      });
      if (!existing) {
        throw new OrganizationAuthError("organization_not_found");
      }

      const updatedCount = await tx.serviceArea.updateMany({
        where: {
          id: existing.id,
          organizationId: input.organizationId,
          isActive: true,
          version: versionParsed.version,
        },
        data: { isActive: false, version: { increment: 1 } },
      });

      if (updatedCount.count !== 1) {
        throw new ConflictError();
      }

      const updated = await tx.serviceArea.findFirstOrThrow({
        where: {
          id: existing.id,
          organizationId: input.organizationId,
        },
      });

      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "SERVICE_AREA_DEACTIVATED",
        metadata: { serviceAreaId: updated.id },
      });

      return updated;
    });

    if (hooks.testAfterTransactionCommit) {
      await hooks.testAfterTransactionCommit();
    }

    return { ok: true, area };
  } catch (error) {
    if (error instanceof ConflictError) {
      return {
        ok: false,
        reason: "conflict",
        message:
          "Service area was updated or deactivated elsewhere. Reload and try again.",
      };
    }
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not deactivate service area.",
      }
    );
  }
}

export async function reorderServiceAreas(
  input: {
    actor: SafeUser;
    organizationId: string;
    raw: unknown;
  },
  hooks: Config3bMutationTestHooks = {},
): Promise<ServiceAreasResult> {
  const parsed = reorderItemsSchema.safeParse(input.raw);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "validation",
      message: "Invalid reorder payload.",
      fieldErrors: zodFieldErrors(parsed.error),
    };
  }

  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.config.manage",
    });

    const areas = await prisma.$transaction(async (tx) => {
      await acquireOrganizationConfig3bLock(tx, input.organizationId, hooks);
      await requireActiveActorInTx(
        tx,
        {
          organizationId: input.organizationId,
          userId: input.actor.id,
          permission: "org.config.manage",
        },
        hooks,
      );
      await acquireConfig3bSectionLock(
        tx,
        serviceAreasOrderLockKey(input.organizationId),
        hooks,
      );

      const existing = await tx.serviceArea.findMany({
        where: { organizationId: input.organizationId },
        select: { id: true },
      });
      const existingIds = new Set(existing.map((area) => area.id));
      const orderedIds = parsed.data.orderedIds;

      if (
        orderedIds.length !== existingIds.size ||
        new Set(orderedIds).size !== orderedIds.length ||
        orderedIds.some((id) => !existingIds.has(id))
      ) {
        throw new OrganizationAuthError("forbidden");
      }

      for (const [index, id] of orderedIds.entries()) {
        await tx.serviceArea.updateMany({
          where: { id, organizationId: input.organizationId },
          data: { displayOrder: index },
        });
      }

      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "SERVICE_AREA_UPDATED",
        metadata: { reorder: true, count: orderedIds.length },
      });

      return tx.serviceArea.findMany({
        where: { organizationId: input.organizationId },
        orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
      });
    });

    if (hooks.testAfterTransactionCommit) {
      await hooks.testAfterTransactionCommit();
    }

    return { ok: true, areas };
  } catch (error) {
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not reorder service areas.",
      }
    );
  }
}
