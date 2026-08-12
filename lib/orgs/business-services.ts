import "server-only";

import type { BusinessService } from "@prisma/client";

import type { SafeUser } from "@/lib/auth/users";
import { recordOrganizationAuditEvent } from "@/lib/orgs/audit";
import {
  OrganizationAuthError,
  requireOrganizationPermission,
} from "@/lib/orgs/authorization";
import {
  acquireOrganizationReadinessLock,
  assertCanReadServices,
  mapAuthError,
  refreshConfigurationReadiness,
  requireActiveActorInTx,
  type AuthFailure,
  type ReadinessMutationTestHooks,
} from "@/lib/orgs/business-access";
import {
  reorderItemsSchema,
  serviceInputSchema,
} from "@/lib/orgs/business-validation";
import { prisma } from "@/lib/prisma";

export type ServicesResult =
  { ok: true; services: BusinessService[] } | AuthFailure;

export type ServiceResult =
  { ok: true; service: BusinessService } | AuthFailure;

export async function listBusinessServices(input: {
  actor: SafeUser;
  organizationId: string;
}): Promise<ServicesResult> {
  try {
    await assertCanReadServices({ ...input, db: prisma });
    const services = await prisma.businessService.findMany({
      where: { organizationId: input.organizationId },
      orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
    });
    return { ok: true, services };
  } catch (error) {
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not load services.",
      }
    );
  }
}

export async function createBusinessService(
  input: {
    actor: SafeUser;
    organizationId: string;
    raw: unknown;
  },
  hooks: ReadinessMutationTestHooks = {},
): Promise<ServiceResult> {
  const parsed = serviceInputSchema.safeParse(input.raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "name");
      fieldErrors[key] ??= [];
      fieldErrors[key].push(issue.message);
    }
    return {
      ok: false,
      reason: "validation",
      message: "Please correct the highlighted fields.",
      fieldErrors,
    };
  }

  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.services.manage",
    });

    const service = await prisma.$transaction(async (tx) => {
      await acquireOrganizationReadinessLock(tx, input.organizationId, hooks);
      await requireActiveActorInTx(
        tx,
        {
          organizationId: input.organizationId,
          userId: input.actor.id,
          permission: "org.services.manage",
        },
        hooks,
      );

      const maxOrder = await tx.businessService.aggregate({
        where: { organizationId: input.organizationId },
        _max: { displayOrder: true },
      });

      const created = await tx.businessService.create({
        data: {
          organizationId: input.organizationId,
          name: parsed.data.name,
          description: parsed.data.description ?? null,
          priceDescription: parsed.data.priceDescription ?? null,
          durationMinutes: parsed.data.durationMinutes ?? null,
          category: parsed.data.category ?? null,
          isActive: parsed.data.isActive ?? true,
          displayOrder: (maxOrder._max.displayOrder ?? -1) + 1,
        },
      });

      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "SERVICE_CREATED",
        metadata: { serviceId: created.id },
      });

      await refreshConfigurationReadiness(tx, input.organizationId);
      return created;
    });

    return { ok: true, service };
  } catch (error) {
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not create service.",
      }
    );
  }
}

export async function updateBusinessService(
  input: {
    actor: SafeUser;
    organizationId: string;
    serviceId: string;
    raw: unknown;
  },
  hooks: ReadinessMutationTestHooks = {},
): Promise<ServiceResult> {
  const parsed = serviceInputSchema.safeParse(input.raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "name");
      fieldErrors[key] ??= [];
      fieldErrors[key].push(issue.message);
    }
    return {
      ok: false,
      reason: "validation",
      message: "Please correct the highlighted fields.",
      fieldErrors,
    };
  }

  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.services.manage",
    });

    const service = await prisma.$transaction(async (tx) => {
      await acquireOrganizationReadinessLock(tx, input.organizationId, hooks);
      await requireActiveActorInTx(
        tx,
        {
          organizationId: input.organizationId,
          userId: input.actor.id,
          permission: "org.services.manage",
        },
        hooks,
      );

      const existing = await tx.businessService.findFirst({
        where: {
          id: input.serviceId,
          organizationId: input.organizationId,
        },
      });
      if (!existing) {
        throw new OrganizationAuthError("organization_not_found");
      }

      const updated = await tx.businessService.update({
        where: { id: existing.id },
        data: {
          name: parsed.data.name,
          description: parsed.data.description ?? null,
          priceDescription: parsed.data.priceDescription ?? null,
          durationMinutes: parsed.data.durationMinutes ?? null,
          category: parsed.data.category ?? null,
          isActive: parsed.data.isActive ?? existing.isActive,
        },
      });

      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "SERVICE_UPDATED",
        metadata: { serviceId: updated.id },
      });

      await refreshConfigurationReadiness(tx, input.organizationId);
      return updated;
    });

    return { ok: true, service };
  } catch (error) {
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not update service.",
      }
    );
  }
}

export async function deactivateBusinessService(
  input: {
    actor: SafeUser;
    organizationId: string;
    serviceId: string;
  },
  hooks: ReadinessMutationTestHooks = {},
): Promise<ServiceResult> {
  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.services.manage",
    });

    const service = await prisma.$transaction(async (tx) => {
      await acquireOrganizationReadinessLock(tx, input.organizationId, hooks);
      await requireActiveActorInTx(
        tx,
        {
          organizationId: input.organizationId,
          userId: input.actor.id,
          permission: "org.services.manage",
        },
        hooks,
      );

      const existing = await tx.businessService.findFirst({
        where: {
          id: input.serviceId,
          organizationId: input.organizationId,
        },
      });
      if (!existing) {
        throw new OrganizationAuthError("organization_not_found");
      }

      const updated = await tx.businessService.update({
        where: { id: existing.id },
        data: { isActive: false },
      });

      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "SERVICE_DEACTIVATED",
        metadata: { serviceId: updated.id },
      });

      await refreshConfigurationReadiness(tx, input.organizationId);
      return updated;
    });

    return { ok: true, service };
  } catch (error) {
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not deactivate service.",
      }
    );
  }
}

export async function reorderBusinessServices(
  input: {
    actor: SafeUser;
    organizationId: string;
    raw: unknown;
  },
  hooks: ReadinessMutationTestHooks = {},
): Promise<ServicesResult> {
  const parsed = reorderItemsSchema.safeParse(input.raw);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "validation",
      message: "Invalid reorder payload.",
    };
  }

  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.services.manage",
    });

    const services = await prisma.$transaction(async (tx) => {
      await requireActiveActorInTx(
        tx,
        {
          organizationId: input.organizationId,
          userId: input.actor.id,
          permission: "org.services.manage",
        },
        hooks,
      );

      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`services-order:${input.organizationId}`}))`;

      const existing = await tx.businessService.findMany({
        where: { organizationId: input.organizationId },
        select: { id: true },
      });
      const existingIds = new Set(existing.map((s) => s.id));
      const orderedIds = parsed.data.orderedIds;
      if (
        orderedIds.length !== existingIds.size ||
        new Set(orderedIds).size !== orderedIds.length ||
        orderedIds.some((id) => !existingIds.has(id))
      ) {
        throw new OrganizationAuthError("forbidden");
      }

      for (const [index, id] of orderedIds.entries()) {
        await tx.businessService.updateMany({
          where: { id, organizationId: input.organizationId },
          data: { displayOrder: index },
        });
      }

      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "SERVICE_UPDATED",
        metadata: { reorder: true, count: parsed.data.orderedIds.length },
      });

      return tx.businessService.findMany({
        where: { organizationId: input.organizationId },
        orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
      });
    });

    return { ok: true, services };
  } catch (error) {
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not reorder services.",
      }
    );
  }
}
