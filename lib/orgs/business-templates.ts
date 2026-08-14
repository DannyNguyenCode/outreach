import "server-only";

import type {
  BusinessTemplateKey,
  CustomFieldDefinition,
  OrganizationTemplateAssignment,
} from "@prisma/client";

import type { SafeUser } from "@/lib/auth/users";
import { recordOrganizationAuditEvent } from "@/lib/orgs/audit";
import {
  OrganizationAuthError,
  requireOrganizationPermission,
} from "@/lib/orgs/authorization";
import {
  getTemplateDefinition,
  listTemplateDefinitions,
  TEMPLATE_DEFINITION_VERSION,
  type BusinessTemplateDefinition,
  type SuggestedCustomField,
} from "@/lib/orgs/business-templates-registry";
import {
  acquireOrganizationConfig3bLock,
  ConflictError,
  mapAuthError,
  requireActiveActorInTx,
  type AuthFailure,
  type Config3bMutationTestHooks,
} from "@/lib/orgs/config-3b-access";
import {
  confirmTemplateSwitchSchema,
  selectBusinessTemplateSchema,
  templateCustomizationSchema,
  zodFieldErrors,
  requireExpectedVersion,
  type ConfigSectionValue,
} from "@/lib/orgs/config-3b-validation";
import { prisma } from "@/lib/prisma";

export type TemplateAssignmentResult =
  | { ok: true; assignment: OrganizationTemplateAssignment }
  | { ok: false; reason: "not_selected"; message: string }
  | AuthFailure;

export type TemplateListResult =
  { ok: true; templates: BusinessTemplateDefinition[] } | AuthFailure;

export type TemplateSwitchPreview = {
  fromKey: BusinessTemplateKey | null;
  toKey: BusinessTemplateKey;
  toDefinitionVersion: number;
  retainedCustomFields: Array<
    Pick<
      CustomFieldDefinition,
      "id" | "key" | "label" | "scope" | "dataType" | "isActive"
    >
  >;
  newlySuggestedFields: SuggestedCustomField[];
  compatibleCustomDefs: Array<{
    definitionId: string;
    key: string;
    suggested: SuggestedCustomField;
  }>;
  conflicts: Array<{
    key: string;
    reason: string;
    definitionId?: string;
  }>;
  sectionsVisible: ConfigSectionValue[];
  sectionsHidden: ConfigSectionValue[];
  orphanRiskFields: Array<
    Pick<CustomFieldDefinition, "id" | "key" | "label" | "scope">
  >;
  notes: string[];
};

export type TemplatePreviewResult =
  { ok: true; preview: TemplateSwitchPreview } | AuthFailure;

/**
 * Read-only template assignment. Never initializes rows.
 */
export async function getTemplateAssignment(input: {
  actor: SafeUser;
  organizationId: string;
}): Promise<TemplateAssignmentResult> {
  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.templates.read",
    });
    const assignment = await prisma.organizationTemplateAssignment.findUnique({
      where: { organizationId: input.organizationId },
    });
    if (!assignment) {
      return {
        ok: false,
        reason: "not_selected",
        message: "No business template has been selected yet.",
      };
    }
    return { ok: true, assignment };
  } catch (error) {
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not load template assignment.",
      }
    );
  }
}

/** Registry listing — read-only, no DB writes. */
export async function listAvailableTemplates(input: {
  actor: SafeUser;
  organizationId: string;
}): Promise<TemplateListResult> {
  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.templates.read",
    });
    return { ok: true, templates: listTemplateDefinitions() };
  } catch (error) {
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not list templates.",
      }
    );
  }
}

/**
 * First-time template selection. Creates assignment only; never activates
 * example services/products or suggested custom fields as customer facts.
 */
export async function selectBusinessTemplate(
  input: {
    actor: SafeUser;
    organizationId: string;
    raw: unknown;
  },
  hooks: Config3bMutationTestHooks = {},
): Promise<TemplateAssignmentResult> {
  const parsed = selectBusinessTemplateSchema.safeParse(input.raw);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "validation",
      message: "Please correct the highlighted fields.",
      fieldErrors: zodFieldErrors(parsed.error),
    };
  }

  const definition = getTemplateDefinition(parsed.data.templateKey);
  const customization = parsed.data.customization ?? {
    confirmedFieldKeys: [],
    notes: null,
  };

  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.templates.manage",
    });

    const assignment = await prisma.$transaction(async (tx) => {
      await acquireOrganizationConfig3bLock(tx, input.organizationId, hooks);
      await requireActiveActorInTx(
        tx,
        {
          organizationId: input.organizationId,
          userId: input.actor.id,
          permission: "org.templates.manage",
        },
        hooks,
      );

      const existing = await tx.organizationTemplateAssignment.findUnique({
        where: { organizationId: input.organizationId },
      });
      if (existing) {
        throw new ConflictError("template_already_selected");
      }

      const created = await tx.organizationTemplateAssignment.create({
        data: {
          organizationId: input.organizationId,
          templateKey: parsed.data.templateKey,
          templateDefinitionVersion: definition.version,
          customization,
          selectedByUserId: input.actor.id,
        },
      });

      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "BUSINESS_TEMPLATE_SELECTED",
        metadata: {
          templateKey: created.templateKey,
          templateDefinitionVersion: created.templateDefinitionVersion,
        },
      });

      return created;
    });

    if (hooks.testAfterTransactionCommit) {
      await hooks.testAfterTransactionCommit();
    }

    return { ok: true, assignment };
  } catch (error) {
    if (error instanceof ConflictError) {
      return {
        ok: false,
        reason: "conflict",
        message: "A business template is already selected. Use switch instead.",
      };
    }
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not select business template.",
      }
    );
  }
}

/**
 * Pure preview computation with read-only DB access. No writes.
 * Preserves customer data semantics: never proposes deleting custom fields,
 * services, or products; examples remain inactive suggestions.
 */
export async function previewTemplateSwitch(input: {
  actor: SafeUser;
  organizationId: string;
  templateKey: BusinessTemplateKey;
}): Promise<TemplatePreviewResult> {
  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.templates.read",
    });

    const [assignment, customFields] = await Promise.all([
      prisma.organizationTemplateAssignment.findUnique({
        where: { organizationId: input.organizationId },
      }),
      prisma.customFieldDefinition.findMany({
        where: { organizationId: input.organizationId },
        orderBy: [{ scope: "asc" }, { displayOrder: "asc" }],
      }),
    ]);

    const toDefinition = getTemplateDefinition(input.templateKey);
    const fromDefinition = assignment
      ? getTemplateDefinition(assignment.templateKey)
      : null;

    const suggestedByKey = new Map(
      toDefinition.suggestedCustomFields.map((field) => [
        `${field.scope}:${field.key}`,
        field,
      ]),
    );

    const retainedCustomFields = customFields.map((field) => ({
      id: field.id,
      key: field.key,
      label: field.label,
      scope: field.scope,
      dataType: field.dataType,
      isActive: field.isActive,
    }));

    const compatibleCustomDefs: TemplateSwitchPreview["compatibleCustomDefs"] =
      [];
    const conflicts: TemplateSwitchPreview["conflicts"] = [];

    for (const field of customFields) {
      const suggested = suggestedByKey.get(`${field.scope}:${field.key}`);
      if (!suggested) continue;
      if (suggested.dataType !== field.dataType) {
        conflicts.push({
          key: field.key,
          definitionId: field.id,
          reason: `Existing field data type ${field.dataType} differs from suggested ${suggested.dataType}.`,
        });
        continue;
      }
      compatibleCustomDefs.push({
        definitionId: field.id,
        key: field.key,
        suggested,
      });
    }

    const existingKeys = new Set(
      customFields.map((field) => `${field.scope}:${field.key}`),
    );
    const newlySuggestedFields = toDefinition.suggestedCustomFields.filter(
      (field) => !existingKeys.has(`${field.scope}:${field.key}`),
    );

    const suggestedKeys = new Set(suggestedByKey.keys());
    const orphanRiskFields = customFields
      .filter((field) => !suggestedKeys.has(`${field.scope}:${field.key}`))
      .map((field) => ({
        id: field.id,
        key: field.key,
        label: field.label,
        scope: field.scope,
      }));

    const fromSections = new Set(
      fromDefinition?.applicableSections ?? ([] as ConfigSectionValue[]),
    );
    const toSections = new Set(toDefinition.applicableSections);
    const sectionsVisible = toDefinition.applicableSections;
    const sectionsHidden = [...fromSections].filter(
      (section) => !toSections.has(section),
    );

    return {
      ok: true,
      preview: {
        fromKey: assignment?.templateKey ?? null,
        toKey: input.templateKey,
        toDefinitionVersion:
          TEMPLATE_DEFINITION_VERSION[input.templateKey] ??
          toDefinition.version,
        retainedCustomFields,
        newlySuggestedFields,
        compatibleCustomDefs,
        conflicts,
        sectionsVisible,
        sectionsHidden,
        orphanRiskFields,
        notes: [
          "Customer custom fields, services, and products are retained.",
          "Template examples are never activated automatically.",
          "Suggested fields remain suggestions until explicitly confirmed.",
        ],
      },
    };
  } catch (error) {
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not preview template switch.",
      }
    );
  }
}

/**
 * Atomic template switch with optimistic concurrency.
 * Preserves customer data; never deletes custom fields/services/products;
 * never activates examples. Rolls back on version conflict.
 */
export async function confirmTemplateSwitch(
  input: {
    actor: SafeUser;
    organizationId: string;
    raw: unknown;
  },
  hooks: Config3bMutationTestHooks = {},
): Promise<TemplateAssignmentResult> {
  const parsed = confirmTemplateSwitchSchema.safeParse(input.raw);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "validation",
      message: "Please correct the highlighted fields.",
      fieldErrors: zodFieldErrors(parsed.error),
    };
  }

  const versionParsed = requireExpectedVersion(parsed.data.expectedVersion);
  if (!versionParsed.ok) {
    return {
      ok: false,
      reason: "validation",
      message: versionParsed.message,
      fieldErrors: { expectedVersion: [versionParsed.message] },
    };
  }

  const definition = getTemplateDefinition(parsed.data.templateKey);
  const customization = parsed.data.customization;

  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.templates.manage",
    });

    const assignment = await prisma.$transaction(async (tx) => {
      await acquireOrganizationConfig3bLock(tx, input.organizationId, hooks);
      await requireActiveActorInTx(
        tx,
        {
          organizationId: input.organizationId,
          userId: input.actor.id,
          permission: "org.templates.manage",
        },
        hooks,
      );

      const existing = await tx.organizationTemplateAssignment.findUnique({
        where: { organizationId: input.organizationId },
      });
      if (!existing) {
        throw new OrganizationAuthError("organization_not_found");
      }

      const updatedCount = await tx.organizationTemplateAssignment.updateMany({
        where: {
          organizationId: input.organizationId,
          version: versionParsed.version,
        },
        data: {
          templateKey: parsed.data.templateKey,
          templateDefinitionVersion: definition.version,
          ...(customization ? { customization } : {}),
          selectedByUserId: input.actor.id,
          selectedAt: new Date(),
          version: { increment: 1 },
        },
      });

      if (updatedCount.count !== 1) {
        throw new ConflictError();
      }

      const updated = await tx.organizationTemplateAssignment.findUniqueOrThrow(
        {
          where: { organizationId: input.organizationId },
        },
      );

      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "BUSINESS_TEMPLATE_SWITCHED",
        metadata: {
          fromTemplateKey: existing.templateKey,
          toTemplateKey: updated.templateKey,
          templateDefinitionVersion: updated.templateDefinitionVersion,
        },
      });

      return updated;
    });

    if (hooks.testAfterTransactionCommit) {
      await hooks.testAfterTransactionCommit();
    }

    return { ok: true, assignment };
  } catch (error) {
    if (error instanceof ConflictError) {
      return {
        ok: false,
        reason: "conflict",
        message:
          "Template assignment was updated elsewhere. Reload and try again.",
      };
    }
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not switch business template.",
      }
    );
  }
}

/** Update confirmed customization metadata only (never auto-facts). */
export async function updateTemplateCustomization(
  input: {
    actor: SafeUser;
    organizationId: string;
    raw: unknown;
    expectedVersion: number;
  },
  hooks: Config3bMutationTestHooks = {},
): Promise<TemplateAssignmentResult> {
  const versionParsed = requireExpectedVersion(input.expectedVersion);
  if (!versionParsed.ok) {
    return {
      ok: false,
      reason: "validation",
      message: versionParsed.message,
      fieldErrors: { expectedVersion: [versionParsed.message] },
    };
  }

  const parsed = templateCustomizationSchema.safeParse(input.raw);
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
      permission: "org.templates.manage",
    });

    const assignment = await prisma.$transaction(async (tx) => {
      await acquireOrganizationConfig3bLock(tx, input.organizationId, hooks);
      await requireActiveActorInTx(
        tx,
        {
          organizationId: input.organizationId,
          userId: input.actor.id,
          permission: "org.templates.manage",
        },
        hooks,
      );

      const updatedCount = await tx.organizationTemplateAssignment.updateMany({
        where: {
          organizationId: input.organizationId,
          version: versionParsed.version,
        },
        data: {
          customization: parsed.data,
          version: { increment: 1 },
        },
      });

      if (updatedCount.count !== 1) {
        throw new ConflictError();
      }

      const updated = await tx.organizationTemplateAssignment.findUniqueOrThrow(
        {
          where: { organizationId: input.organizationId },
        },
      );

      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "BUSINESS_TEMPLATE_SWITCHED",
        metadata: {
          customizationOnly: true,
          templateKey: updated.templateKey,
          confirmedFieldCount: parsed.data.confirmedFieldKeys.length,
        },
      });

      return updated;
    });

    if (hooks.testAfterTransactionCommit) {
      await hooks.testAfterTransactionCommit();
    }

    return { ok: true, assignment };
  } catch (error) {
    if (error instanceof ConflictError) {
      return {
        ok: false,
        reason: "conflict",
        message:
          "Template assignment was updated elsewhere. Reload and try again.",
      };
    }
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not update template customization.",
      }
    );
  }
}
