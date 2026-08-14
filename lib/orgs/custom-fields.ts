import "server-only";

import type { CustomFieldDefinition, Prisma } from "@prisma/client";

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
  customFieldsOrderLockKey,
  mapAuthError,
  requireActiveActorInTx,
  type AuthFailure,
  type Config3bMutationTestHooks,
} from "@/lib/orgs/config-3b-access";
import {
  customFieldInputSchema,
  customFieldUpdateSchema,
  reorderItemsSchema,
  requireExpectedVersion,
  zodFieldErrors,
} from "@/lib/orgs/config-3b-validation";
import { prisma } from "@/lib/prisma";

export type CustomFieldsResult =
  { ok: true; fields: CustomFieldDefinition[] } | AuthFailure;

export type CustomFieldResult =
  { ok: true; field: CustomFieldDefinition } | AuthFailure;

export async function listCustomFields(input: {
  actor: SafeUser;
  organizationId: string;
}): Promise<CustomFieldsResult> {
  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.config.read",
    });
    const fields = await prisma.customFieldDefinition.findMany({
      where: { organizationId: input.organizationId },
      orderBy: [
        { scope: "asc" },
        { displayOrder: "asc" },
        { createdAt: "asc" },
      ],
    });
    return { ok: true, fields };
  } catch (error) {
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not load custom fields.",
      }
    );
  }
}

export async function createCustomField(
  input: {
    actor: SafeUser;
    organizationId: string;
    raw: unknown;
  },
  hooks: Config3bMutationTestHooks = {},
): Promise<CustomFieldResult> {
  const parsed = customFieldInputSchema.safeParse(input.raw);
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

    const field = await prisma.$transaction(async (tx) => {
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

      const maxOrder = await tx.customFieldDefinition.aggregate({
        where: {
          organizationId: input.organizationId,
          scope: parsed.data.scope,
        },
        _max: { displayOrder: true },
      });

      let created: CustomFieldDefinition;
      try {
        created = await tx.customFieldDefinition.create({
          data: {
            organizationId: input.organizationId,
            key: parsed.data.key,
            label: parsed.data.label,
            description: parsed.data.description ?? null,
            dataType: parsed.data.dataType,
            required: parsed.data.required,
            isActive: parsed.data.isActive,
            displayOrder: (maxOrder._max.displayOrder ?? -1) + 1,
            options: (parsed.data.options ?? null) as Prisma.InputJsonValue,
            validation: (parsed.data.validation ??
              null) as Prisma.InputJsonValue,
            scope: parsed.data.scope,
            createdByUserId: input.actor.id,
            updatedByUserId: input.actor.id,
          },
        });
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          (error as { code?: string }).code === "P2002"
        ) {
          throw new ConflictError("custom_field_key_exists");
        }
        throw error;
      }

      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "CUSTOM_FIELD_CREATED",
        metadata: {
          fieldId: created.id,
          key: created.key,
          scope: created.scope,
        },
      });

      return created;
    });

    if (hooks.testAfterTransactionCommit) {
      await hooks.testAfterTransactionCommit();
    }

    return { ok: true, field };
  } catch (error) {
    if (error instanceof ConflictError) {
      return {
        ok: false,
        reason: "conflict",
        message: "A custom field with this key already exists in this scope.",
      };
    }
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not create custom field.",
      }
    );
  }
}

export async function updateCustomField(
  input: {
    actor: SafeUser;
    organizationId: string;
    fieldId: string;
    raw: unknown;
    expectedVersion: number;
  },
  hooks: Config3bMutationTestHooks = {},
): Promise<CustomFieldResult> {
  const versionParsed = requireExpectedVersion(input.expectedVersion);
  if (!versionParsed.ok) {
    return {
      ok: false,
      reason: "validation",
      message: versionParsed.message,
      fieldErrors: { expectedVersion: [versionParsed.message] },
    };
  }

  const parsed = customFieldUpdateSchema.safeParse(input.raw);
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

    const field = await prisma.$transaction(async (tx) => {
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

      const existing = await tx.customFieldDefinition.findFirst({
        where: {
          id: input.fieldId,
          organizationId: input.organizationId,
        },
      });
      if (!existing) {
        throw new OrganizationAuthError("organization_not_found");
      }

      const updatedCount = await tx.customFieldDefinition.updateMany({
        where: {
          id: existing.id,
          organizationId: input.organizationId,
          version: versionParsed.version,
        },
        data: {
          ...(parsed.data.label !== undefined
            ? { label: parsed.data.label }
            : {}),
          ...(parsed.data.description !== undefined
            ? { description: parsed.data.description }
            : {}),
          ...(parsed.data.dataType !== undefined
            ? { dataType: parsed.data.dataType }
            : {}),
          ...(parsed.data.required !== undefined
            ? { required: parsed.data.required }
            : {}),
          ...(parsed.data.isActive !== undefined
            ? { isActive: parsed.data.isActive }
            : {}),
          ...(parsed.data.options !== undefined
            ? {
                options: (parsed.data.options ?? null) as Prisma.InputJsonValue,
              }
            : {}),
          ...(parsed.data.validation !== undefined
            ? {
                validation: (parsed.data.validation ??
                  null) as Prisma.InputJsonValue,
              }
            : {}),
          updatedByUserId: input.actor.id,
          version: { increment: 1 },
        },
      });

      if (updatedCount.count !== 1) {
        throw new ConflictError();
      }

      const updated = await tx.customFieldDefinition.findUniqueOrThrow({
        where: { id: existing.id },
      });

      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "CUSTOM_FIELD_UPDATED",
        metadata: { fieldId: updated.id, key: updated.key },
      });

      return updated;
    });

    if (hooks.testAfterTransactionCommit) {
      await hooks.testAfterTransactionCommit();
    }

    return { ok: true, field };
  } catch (error) {
    if (error instanceof ConflictError) {
      return {
        ok: false,
        reason: "conflict",
        message: "Custom field was updated elsewhere. Reload and try again.",
      };
    }
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not update custom field.",
      }
    );
  }
}

/** Deactivate — never hard-delete definitions. */
export async function deactivateCustomField(
  input: {
    actor: SafeUser;
    organizationId: string;
    fieldId: string;
  },
  hooks: Config3bMutationTestHooks = {},
): Promise<CustomFieldResult> {
  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.config.manage",
    });

    const field = await prisma.$transaction(async (tx) => {
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

      const existing = await tx.customFieldDefinition.findFirst({
        where: {
          id: input.fieldId,
          organizationId: input.organizationId,
        },
      });
      if (!existing) {
        throw new OrganizationAuthError("organization_not_found");
      }

      const updated = await tx.customFieldDefinition.update({
        where: { id: existing.id },
        data: {
          isActive: false,
          updatedByUserId: input.actor.id,
          version: { increment: 1 },
        },
      });

      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "CUSTOM_FIELD_DEACTIVATED",
        metadata: { fieldId: updated.id, key: updated.key },
      });

      return updated;
    });

    if (hooks.testAfterTransactionCommit) {
      await hooks.testAfterTransactionCommit();
    }

    return { ok: true, field };
  } catch (error) {
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not deactivate custom field.",
      }
    );
  }
}

/**
 * Reorder rejects duplicates, omissions, unknown IDs, and foreign (other-org) IDs.
 * Uses specialized `custom-fields-order:` lock after the Phase 3B config lock.
 */
export async function reorderCustomFields(
  input: {
    actor: SafeUser;
    organizationId: string;
    raw: unknown;
  },
  hooks: Config3bMutationTestHooks = {},
): Promise<CustomFieldsResult> {
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

    const fields = await prisma.$transaction(async (tx) => {
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
        customFieldsOrderLockKey(input.organizationId),
        hooks,
      );

      const existing = await tx.customFieldDefinition.findMany({
        where: { organizationId: input.organizationId },
        select: { id: true },
      });
      const existingIds = new Set(existing.map((field) => field.id));
      const orderedIds = parsed.data.orderedIds;

      if (
        orderedIds.length !== existingIds.size ||
        new Set(orderedIds).size !== orderedIds.length ||
        orderedIds.some((id) => !existingIds.has(id))
      ) {
        throw new OrganizationAuthError("forbidden");
      }

      for (const [index, id] of orderedIds.entries()) {
        await tx.customFieldDefinition.updateMany({
          where: { id, organizationId: input.organizationId },
          data: { displayOrder: index },
        });
      }

      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "CUSTOM_FIELDS_REORDERED",
        metadata: { count: orderedIds.length },
      });

      return tx.customFieldDefinition.findMany({
        where: { organizationId: input.organizationId },
        orderBy: [
          { scope: "asc" },
          { displayOrder: "asc" },
          { createdAt: "asc" },
        ],
      });
    });

    if (hooks.testAfterTransactionCommit) {
      await hooks.testAfterTransactionCommit();
    }

    return { ok: true, fields };
  } catch (error) {
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not reorder custom fields.",
      }
    );
  }
}
