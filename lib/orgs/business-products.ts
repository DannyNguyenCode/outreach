import "server-only";

import type { BusinessProduct } from "@prisma/client";
import { Prisma } from "@prisma/client";

import type { SafeUser } from "@/lib/auth/users";
import { recordOrganizationAuditEvent } from "@/lib/orgs/audit";
import {
  OrganizationAuthError,
  requireOrganizationPermission,
} from "@/lib/orgs/authorization";
import {
  acquireOrganizationReadinessLock,
  assertCanReadProducts,
  mapAuthError,
  refreshConfigurationReadiness,
  requireActiveActorInTx,
  type AuthFailure,
  type ReadinessMutationTestHooks,
} from "@/lib/orgs/business-access";
import {
  productInputSchema,
  reorderItemsSchema,
} from "@/lib/orgs/business-validation";
import { prisma } from "@/lib/prisma";

export type ProductsResult =
  { ok: true; products: BusinessProduct[] } | AuthFailure;

export type ProductResult =
  { ok: true; product: BusinessProduct } | AuthFailure;

export async function listBusinessProducts(input: {
  actor: SafeUser;
  organizationId: string;
}): Promise<ProductsResult> {
  try {
    await assertCanReadProducts({ ...input, db: prisma });
    const products = await prisma.businessProduct.findMany({
      where: { organizationId: input.organizationId },
      orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
    });
    return { ok: true, products };
  } catch (error) {
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not load products.",
      }
    );
  }
}

export async function createBusinessProduct(
  input: {
    actor: SafeUser;
    organizationId: string;
    raw: unknown;
  },
  hooks: ReadinessMutationTestHooks = {},
): Promise<ProductResult> {
  const parsed = productInputSchema.safeParse(input.raw);
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
      permission: "org.products.manage",
    });

    const product = await prisma.$transaction(async (tx) => {
      await acquireOrganizationReadinessLock(tx, input.organizationId, hooks);
      await requireActiveActorInTx(
        tx,
        {
          organizationId: input.organizationId,
          userId: input.actor.id,
          permission: "org.products.manage",
        },
        hooks,
      );

      const maxOrder = await tx.businessProduct.aggregate({
        where: { organizationId: input.organizationId },
        _max: { displayOrder: true },
      });

      try {
        const created = await tx.businessProduct.create({
          data: {
            organizationId: input.organizationId,
            name: parsed.data.name,
            description: parsed.data.description ?? null,
            priceDescription: parsed.data.priceDescription ?? null,
            sku: parsed.data.sku ?? null,
            category: parsed.data.category ?? null,
            isActive: parsed.data.isActive ?? true,
            displayOrder: (maxOrder._max.displayOrder ?? -1) + 1,
          },
        });

        await recordOrganizationAuditEvent(tx, {
          organizationId: input.organizationId,
          actorUserId: input.actor.id,
          action: "PRODUCT_CREATED",
          metadata: { productId: created.id },
        });

        await refreshConfigurationReadiness(tx, input.organizationId);
        return created;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          throw new SkuConflictError();
        }
        throw error;
      }
    });

    return { ok: true, product };
  } catch (error) {
    if (error instanceof SkuConflictError) {
      return {
        ok: false,
        reason: "validation",
        message: "SKU must be unique within the organization.",
        fieldErrors: { sku: ["SKU is already in use."] },
      };
    }
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not create product.",
      }
    );
  }
}

export async function updateBusinessProduct(
  input: {
    actor: SafeUser;
    organizationId: string;
    productId: string;
    raw: unknown;
  },
  hooks: ReadinessMutationTestHooks = {},
): Promise<ProductResult> {
  const parsed = productInputSchema.safeParse(input.raw);
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
      permission: "org.products.manage",
    });

    const product = await prisma.$transaction(async (tx) => {
      await acquireOrganizationReadinessLock(tx, input.organizationId, hooks);
      await requireActiveActorInTx(
        tx,
        {
          organizationId: input.organizationId,
          userId: input.actor.id,
          permission: "org.products.manage",
        },
        hooks,
      );

      const existing = await tx.businessProduct.findFirst({
        where: {
          id: input.productId,
          organizationId: input.organizationId,
        },
      });
      if (!existing) {
        throw new OrganizationAuthError("organization_not_found");
      }

      try {
        const updated = await tx.businessProduct.update({
          where: { id: existing.id },
          data: {
            name: parsed.data.name,
            description: parsed.data.description ?? null,
            priceDescription: parsed.data.priceDescription ?? null,
            sku: parsed.data.sku ?? null,
            category: parsed.data.category ?? null,
            isActive: parsed.data.isActive ?? existing.isActive,
          },
        });

        await recordOrganizationAuditEvent(tx, {
          organizationId: input.organizationId,
          actorUserId: input.actor.id,
          action: "PRODUCT_UPDATED",
          metadata: { productId: updated.id },
        });

        await refreshConfigurationReadiness(tx, input.organizationId);
        return updated;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          throw new SkuConflictError();
        }
        throw error;
      }
    });

    return { ok: true, product };
  } catch (error) {
    if (error instanceof SkuConflictError) {
      return {
        ok: false,
        reason: "validation",
        message: "SKU must be unique within the organization.",
        fieldErrors: { sku: ["SKU is already in use."] },
      };
    }
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not update product.",
      }
    );
  }
}

export async function deactivateBusinessProduct(
  input: {
    actor: SafeUser;
    organizationId: string;
    productId: string;
  },
  hooks: ReadinessMutationTestHooks = {},
): Promise<ProductResult> {
  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.products.manage",
    });

    const product = await prisma.$transaction(async (tx) => {
      await acquireOrganizationReadinessLock(tx, input.organizationId, hooks);
      await requireActiveActorInTx(
        tx,
        {
          organizationId: input.organizationId,
          userId: input.actor.id,
          permission: "org.products.manage",
        },
        hooks,
      );

      const existing = await tx.businessProduct.findFirst({
        where: {
          id: input.productId,
          organizationId: input.organizationId,
        },
      });
      if (!existing) {
        throw new OrganizationAuthError("organization_not_found");
      }

      const updated = await tx.businessProduct.update({
        where: { id: existing.id },
        data: { isActive: false },
      });

      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "PRODUCT_DEACTIVATED",
        metadata: { productId: updated.id },
      });

      await refreshConfigurationReadiness(tx, input.organizationId);
      return updated;
    });

    return { ok: true, product };
  } catch (error) {
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not deactivate product.",
      }
    );
  }
}

export async function reorderBusinessProducts(
  input: {
    actor: SafeUser;
    organizationId: string;
    raw: unknown;
  },
  hooks: ReadinessMutationTestHooks = {},
): Promise<ProductsResult> {
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
      permission: "org.products.manage",
    });

    const products = await prisma.$transaction(async (tx) => {
      await requireActiveActorInTx(
        tx,
        {
          organizationId: input.organizationId,
          userId: input.actor.id,
          permission: "org.products.manage",
        },
        hooks,
      );

      if (hooks.testBeforeCatalogueOrderLock) {
        await hooks.testBeforeCatalogueOrderLock();
      }
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`products-order:${input.organizationId}`}))`;
      if (hooks.testAfterCatalogueOrderLock) {
        await hooks.testAfterCatalogueOrderLock();
      }

      const existing = await tx.businessProduct.findMany({
        where: { organizationId: input.organizationId },
        select: { id: true },
      });
      const existingIds = new Set(existing.map((p) => p.id));
      const orderedIds = parsed.data.orderedIds;
      if (
        orderedIds.length !== existingIds.size ||
        new Set(orderedIds).size !== orderedIds.length ||
        orderedIds.some((id) => !existingIds.has(id))
      ) {
        throw new OrganizationAuthError("forbidden");
      }

      for (const [index, id] of orderedIds.entries()) {
        await tx.businessProduct.updateMany({
          where: { id, organizationId: input.organizationId },
          data: { displayOrder: index },
        });
      }

      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "PRODUCT_UPDATED",
        metadata: { reorder: true, count: parsed.data.orderedIds.length },
      });

      return tx.businessProduct.findMany({
        where: { organizationId: input.organizationId },
        orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
      });
    });

    return { ok: true, products };
  } catch (error) {
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not reorder products.",
      }
    );
  }
}

class SkuConflictError extends Error {
  constructor() {
    super("sku_conflict");
    this.name = "SkuConflictError";
  }
}
