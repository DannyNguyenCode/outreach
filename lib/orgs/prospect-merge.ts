import "server-only";

import type { Prisma } from "@prisma/client";

import type { SafeUser } from "@/lib/auth/users";
import { recordOrganizationAuditEvent } from "@/lib/orgs/audit";
import { requireOrganizationPermission } from "@/lib/orgs/authorization";
import { prisma } from "@/lib/prisma";
import {
  acquireOrganizationProspectsLock,
  ConflictError,
  lockProspectsForUpdate,
  mapProspectError,
  ProspectLifecycleError,
  ProspectNotFoundError,
  requireActiveActorInTx,
  type ProspectMutationTestHooks,
} from "@/lib/orgs/prospect-access";
import {
  canonicalCustomStoredValue,
  mergeResolutionsSchema,
  normalizeProspectSearchName,
  PROSPECT_MAX_CHANNELS,
  PROSPECT_MAX_CONTACTS,
  requireExpectedVersion,
  type MergeFieldResolutions,
} from "@/lib/orgs/prospect-validation";
import type { ProspectFailure } from "@/lib/orgs/prospects";

const MERGEABLE_FIELDS = [
  "displayName",
  "kind",
  "website",
  "locationLabel",
  "addressLine1",
  "addressLine2",
  "city",
  "region",
  "postalCode",
  "countryCode",
  "timeZone",
] as const;

type MergeableField = (typeof MERGEABLE_FIELDS)[number];

export type MergeFieldConflict = {
  field: MergeableField | `custom:${string}`;
  survivorValue: string;
  duplicateValue: string;
};

export type MergePreview = {
  survivor: {
    id: string;
    displayName: string;
    version: number;
    lifecycle: string;
  };
  duplicate: {
    id: string;
    displayName: string;
    version: number;
    lifecycle: string;
  };
  conflicts: MergeFieldConflict[];
  contacts: {
    survivorCount: number;
    duplicateCount: number;
  };
  channels: {
    survivorCount: number;
    duplicateCount: number;
    duplicateIdenticalCount: number;
  };
  resultingDisplayName: string;
};

type ProspectMergeRow = {
  id: string;
  displayName: string;
  kind: string;
  websiteDisplay: string | null;
  websiteNormalized: string | null;
  locationLabel: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  countryCode: string | null;
  timeZone: string | null;
  version: number;
  lifecycle: string;
  searchName: string;
};

function fieldValue(row: ProspectMergeRow, field: MergeableField): string {
  if (field === "website") {
    return row.websiteDisplay ?? "";
  }
  const value = row[field];
  return value == null ? "" : String(value);
}

function detectConflicts(
  survivor: ProspectMergeRow,
  duplicate: ProspectMergeRow,
): MergeFieldConflict[] {
  const conflicts: MergeFieldConflict[] = [];
  for (const field of MERGEABLE_FIELDS) {
    const left = fieldValue(survivor, field);
    const right = fieldValue(duplicate, field);
    if (left !== right && left.length > 0 && right.length > 0) {
      conflicts.push({
        field,
        survivorValue: left,
        duplicateValue: right,
      });
    }
  }
  return conflicts;
}

function pickField(
  field: MergeableField,
  survivor: ProspectMergeRow,
  duplicate: ProspectMergeRow,
  resolutions: MergeFieldResolutions,
): string {
  const left = fieldValue(survivor, field);
  const right = fieldValue(duplicate, field);
  if (left === right) return left;
  if (left.length === 0) return right;
  if (right.length === 0) return left;
  const choice = resolutions[field] ?? "survivor";
  return choice === "duplicate" ? right : left;
}

export async function previewProspectMerge(input: {
  actor: SafeUser;
  organizationId: string;
  survivorProspectId: string;
  duplicateProspectId: string;
}): Promise<{ ok: true; preview: MergePreview } | ProspectFailure> {
  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.prospects.manage",
    });
    if (input.survivorProspectId === input.duplicateProspectId) {
      return {
        ok: false,
        reason: "self_merge",
        message: "A prospect cannot be merged into itself.",
      };
    }
    const [survivor, duplicate] = await Promise.all([
      prisma.prospect.findFirst({
        where: {
          id: input.survivorProspectId,
          organizationId: input.organizationId,
        },
      }),
      prisma.prospect.findFirst({
        where: {
          id: input.duplicateProspectId,
          organizationId: input.organizationId,
        },
      }),
    ]);
    if (!survivor || !duplicate) {
      throw new ProspectNotFoundError();
    }
    const [
      survivorChannels,
      duplicateChannels,
      survivorContacts,
      duplicateContacts,
    ] = await Promise.all([
      prisma.prospectChannel.count({
        where: {
          organizationId: input.organizationId,
          prospectId: survivor.id,
        },
      }),
      prisma.prospectChannel.findMany({
        where: {
          organizationId: input.organizationId,
          prospectId: duplicate.id,
        },
        select: { kind: true, normalizedValue: true, contactId: true },
      }),
      prisma.prospectContact.count({
        where: {
          organizationId: input.organizationId,
          prospectId: survivor.id,
        },
      }),
      prisma.prospectContact.count({
        where: {
          organizationId: input.organizationId,
          prospectId: duplicate.id,
        },
      }),
    ]);
    const survivorChannelKeys = new Set(
      (
        await prisma.prospectChannel.findMany({
          where: {
            organizationId: input.organizationId,
            prospectId: survivor.id,
            contactId: null,
          },
          select: { kind: true, normalizedValue: true },
        })
      ).map((channel) => `${channel.kind}:${channel.normalizedValue}`),
    );
    const duplicateIdenticalCount = duplicateChannels.filter(
      (channel) =>
        channel.contactId == null &&
        survivorChannelKeys.has(`${channel.kind}:${channel.normalizedValue}`),
    ).length;
    const conflicts = detectConflicts(survivor, duplicate);
    const customConflicts = await customValueConflicts(
      prisma,
      input.organizationId,
      survivor.id,
      duplicate.id,
    );
    return {
      ok: true,
      preview: {
        survivor: {
          id: survivor.id,
          displayName: survivor.displayName,
          version: survivor.version,
          lifecycle: survivor.lifecycle,
        },
        duplicate: {
          id: duplicate.id,
          displayName: duplicate.displayName,
          version: duplicate.version,
          lifecycle: duplicate.lifecycle,
        },
        conflicts: [...conflicts, ...customConflicts],
        contacts: {
          survivorCount: survivorContacts,
          duplicateCount: duplicateContacts,
        },
        channels: {
          survivorCount: survivorChannels,
          duplicateCount: duplicateChannels.length,
          duplicateIdenticalCount,
        },
        resultingDisplayName: survivor.displayName,
      },
    };
  } catch (error) {
    return (
      mapProspectError(error) ?? {
        ok: false,
        reason: "error",
        message: "Request denied.",
      }
    );
  }
}

async function customValueConflicts(
  db: Prisma.TransactionClient | typeof prisma,
  organizationId: string,
  survivorId: string,
  duplicateId: string,
): Promise<MergeFieldConflict[]> {
  const [survivorValues, duplicateValues] = await Promise.all([
    db.prospectCustomValue.findMany({
      where: { organizationId, prospectId: survivorId },
    }),
    db.prospectCustomValue.findMany({
      where: { organizationId, prospectId: duplicateId },
    }),
  ]);
  const survivorByKey = new Map(
    survivorValues.map((value) => [value.definitionKey, value]),
  );
  const conflicts: MergeFieldConflict[] = [];
  for (const value of duplicateValues) {
    const existing = survivorByKey.get(value.definitionKey);
    if (!existing) continue;
    const left = canonicalCustomStoredValue(existing);
    const right = canonicalCustomStoredValue(value);
    if (left !== right) {
      conflicts.push({
        field: `custom:${value.definitionKey}`,
        survivorValue: left,
        duplicateValue: right,
      });
    }
  }
  return conflicts;
}

export async function mergeProspects(
  input: {
    actor: SafeUser;
    organizationId: string;
    survivorProspectId: string;
    duplicateProspectId: string;
    expectedSurvivorVersion: unknown;
    expectedDuplicateVersion: unknown;
    resolutions?: unknown;
  },
  hooks: ProspectMutationTestHooks = {},
): Promise<
  { ok: true; survivorProspectId: string; mergeId: string } | ProspectFailure
> {
  if (input.survivorProspectId === input.duplicateProspectId) {
    return {
      ok: false,
      reason: "self_merge",
      message: "A prospect cannot be merged into itself.",
    };
  }
  const survivorVersion = requireExpectedVersion(input.expectedSurvivorVersion);
  const duplicateVersion = requireExpectedVersion(
    input.expectedDuplicateVersion,
  );
  if (!survivorVersion.ok || !duplicateVersion.ok) {
    return {
      ok: false,
      reason: "conflict",
      message: "This prospect changed. Reload the page, then try again.",
      fieldErrors: { expectedVersion: ["Expected version is invalid."] },
    };
  }
  const parsedResolutions = mergeResolutionsSchema.safeParse(
    input.resolutions ?? {},
  );
  if (!parsedResolutions.success) {
    return {
      ok: false,
      reason: "validation",
      message: "Choose a surviving value for each conflicting field.",
    };
  }

  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.prospects.manage",
    });
    const merged = await prisma.$transaction(async (tx) => {
      await acquireOrganizationProspectsLock(tx, input.organizationId, hooks);
      await requireActiveActorInTx(
        tx,
        {
          organizationId: input.organizationId,
          userId: input.actor.id,
          permission: "org.prospects.manage",
        },
        hooks,
      );
      const rows = await lockProspectsForUpdate(
        tx,
        {
          organizationId: input.organizationId,
          prospectIds: [input.survivorProspectId, input.duplicateProspectId],
        },
        hooks,
      );
      const survivorLock = rows.find(
        (row) => row.id === input.survivorProspectId,
      );
      const duplicateLock = rows.find(
        (row) => row.id === input.duplicateProspectId,
      );
      if (!survivorLock || !duplicateLock) {
        throw new ProspectNotFoundError();
      }
      if (
        survivorLock.lifecycle === "MERGED" ||
        duplicateLock.lifecycle === "MERGED"
      ) {
        throw new ProspectLifecycleError(
          "merged",
          "Merged prospects cannot be merged again.",
        );
      }
      if (
        survivorLock.mergedIntoProspectId ||
        duplicateLock.mergedIntoProspectId
      ) {
        throw new ProspectLifecycleError(
          "circular_merge",
          "Merged prospects cannot participate in another merge.",
        );
      }
      if (
        survivorLock.version !== survivorVersion.version ||
        duplicateLock.version !== duplicateVersion.version
      ) {
        throw new ConflictError();
      }

      const [survivor, duplicate] = await Promise.all([
        tx.prospect.findFirstOrThrow({
          where: { id: survivorLock.id, organizationId: input.organizationId },
        }),
        tx.prospect.findFirstOrThrow({
          where: { id: duplicateLock.id, organizationId: input.organizationId },
        }),
      ]);

      const conflicts = detectConflicts(survivor, duplicate);
      const customConflicts = await customValueConflicts(
        tx,
        input.organizationId,
        survivor.id,
        duplicate.id,
      );
      for (const conflict of conflicts) {
        const field = conflict.field;
        const choice =
          field === "displayName" ||
          field === "kind" ||
          field === "website" ||
          field === "locationLabel" ||
          field === "addressLine1" ||
          field === "addressLine2" ||
          field === "city" ||
          field === "region" ||
          field === "postalCode" ||
          field === "countryCode" ||
          field === "timeZone"
            ? parsedResolutions.data[field]
            : undefined;
        if (!choice) {
          throw Object.assign(
            new Error("Choose a surviving value for each conflicting field."),
            {
              fieldMessage:
                "Choose a surviving value for each conflicting field.",
            },
          );
        }
      }
      for (const conflict of customConflicts) {
        const key = conflict.field.replace(/^custom:/, "");
        if (!parsedResolutions.data.customValues?.[key]) {
          throw Object.assign(
            new Error("Choose a surviving value for each conflicting field."),
            {
              fieldMessage:
                "Choose a surviving value for each conflicting field.",
            },
          );
        }
      }

      const displayName = pickField(
        "displayName",
        survivor,
        duplicate,
        parsedResolutions.data,
      );
      const websiteChoice = pickField(
        "website",
        survivor,
        duplicate,
        parsedResolutions.data,
      );
      const websiteFrom =
        websiteChoice === (duplicate.websiteDisplay ?? "")
          ? duplicate
          : survivor;

      const survivorUpdate = await tx.prospect.updateMany({
        where: {
          id: survivor.id,
          organizationId: input.organizationId,
          version: survivorVersion.version,
          lifecycle: { in: ["ACTIVE", "ARCHIVED"] },
        },
        data: {
          displayName,
          searchName: normalizeProspectSearchName(displayName),
          kind: pickField(
            "kind",
            survivor,
            duplicate,
            parsedResolutions.data,
          ) as "BUSINESS" | "INDIVIDUAL" | "HOUSEHOLD" | "ORGANIZATION",
          websiteDisplay: websiteFrom.websiteDisplay,
          websiteNormalized: websiteFrom.websiteNormalized,
          locationLabel:
            pickField(
              "locationLabel",
              survivor,
              duplicate,
              parsedResolutions.data,
            ) || null,
          addressLine1:
            pickField(
              "addressLine1",
              survivor,
              duplicate,
              parsedResolutions.data,
            ) || null,
          addressLine2:
            pickField(
              "addressLine2",
              survivor,
              duplicate,
              parsedResolutions.data,
            ) || null,
          city:
            pickField("city", survivor, duplicate, parsedResolutions.data) ||
            null,
          region:
            pickField("region", survivor, duplicate, parsedResolutions.data) ||
            null,
          postalCode:
            pickField(
              "postalCode",
              survivor,
              duplicate,
              parsedResolutions.data,
            ) || null,
          countryCode:
            pickField(
              "countryCode",
              survivor,
              duplicate,
              parsedResolutions.data,
            ) || null,
          timeZone:
            pickField(
              "timeZone",
              survivor,
              duplicate,
              parsedResolutions.data,
            ) || null,
          version: { increment: 1 },
          updatedByUserId: input.actor.id,
        },
      });
      if (survivorUpdate.count !== 1) throw new ConflictError();

      const [contactCount, channelCount] = await Promise.all([
        tx.prospectContact.count({
          where: {
            organizationId: input.organizationId,
            prospectId: { in: [survivor.id, duplicate.id] },
          },
        }),
        tx.prospectChannel.count({
          where: {
            organizationId: input.organizationId,
            prospectId: { in: [survivor.id, duplicate.id] },
          },
        }),
      ]);
      if (contactCount > PROSPECT_MAX_CONTACTS) {
        throw Object.assign(
          new Error("Merging would exceed the contact limit."),
          { fieldMessage: "Merging would exceed the contact limit." },
        );
      }
      if (channelCount > PROSPECT_MAX_CHANNELS) {
        throw Object.assign(
          new Error("Merging would exceed the communication-point limit."),
          {
            fieldMessage: "Merging would exceed the communication-point limit.",
          },
        );
      }

      await tx.prospectContact.updateMany({
        where: {
          organizationId: input.organizationId,
          prospectId: duplicate.id,
          isPrimary: true,
        },
        data: { isPrimary: false },
      });
      await tx.prospectContact.updateMany({
        where: {
          organizationId: input.organizationId,
          prospectId: duplicate.id,
        },
        data: { prospectId: survivor.id },
      });

      const survivorProspectChannels = await tx.prospectChannel.findMany({
        where: {
          organizationId: input.organizationId,
          prospectId: survivor.id,
          contactId: null,
          lifecycle: "ACTIVE",
        },
        select: { kind: true, normalizedValue: true },
      });
      const survivorKeys = new Set(
        survivorProspectChannels.map(
          (channel) => `${channel.kind}:${channel.normalizedValue}`,
        ),
      );
      const duplicateProspectChannels = await tx.prospectChannel.findMany({
        where: {
          organizationId: input.organizationId,
          prospectId: duplicate.id,
          contactId: null,
          lifecycle: "ACTIVE",
        },
      });
      const redundantIds = duplicateProspectChannels
        .filter((channel) =>
          survivorKeys.has(`${channel.kind}:${channel.normalizedValue}`),
        )
        .map((channel) => channel.id);
      if (redundantIds.length > 0) {
        await tx.prospectChannel.updateMany({
          where: {
            organizationId: input.organizationId,
            prospectId: duplicate.id,
            id: { in: redundantIds },
          },
          data: { lifecycle: "ARCHIVED", archivedAt: new Date() },
        });
      }
      await tx.prospectChannel.updateMany({
        where: {
          organizationId: input.organizationId,
          prospectId: duplicate.id,
        },
        data: { prospectId: survivor.id },
      });

      const duplicateCustom = await tx.prospectCustomValue.findMany({
        where: {
          organizationId: input.organizationId,
          prospectId: duplicate.id,
        },
      });
      const survivorCustom = await tx.prospectCustomValue.findMany({
        where: {
          organizationId: input.organizationId,
          prospectId: survivor.id,
        },
      });
      const survivorCustomByKey = new Map(
        survivorCustom.map((value) => [value.definitionKey, value]),
      );
      for (const value of duplicateCustom) {
        const existing = survivorCustomByKey.get(value.definitionKey);
        const choice =
          parsedResolutions.data.customValues?.[value.definitionKey];
        if (!existing) {
          await tx.prospectCustomValue.create({
            data: {
              organizationId: input.organizationId,
              prospectId: survivor.id,
              definitionId: value.definitionId,
              definitionKey: value.definitionKey,
              stringValue: value.stringValue,
              numberValue: value.numberValue,
              booleanValue: value.booleanValue,
              dateValue: value.dateValue,
              jsonValue: value.jsonValue as Prisma.InputJsonValue | undefined,
            },
          });
          continue;
        }
        if (choice === "duplicate") {
          await tx.prospectCustomValue.update({
            where: { id: existing.id },
            data: {
              stringValue: value.stringValue,
              numberValue: value.numberValue,
              booleanValue: value.booleanValue,
              dateValue: value.dateValue,
              jsonValue: value.jsonValue as Prisma.InputJsonValue | undefined,
            },
          });
        }
      }

      await tx.prospectContactCustomValue.updateMany({
        where: {
          organizationId: input.organizationId,
          prospectId: duplicate.id,
        },
        data: { prospectId: survivor.id },
      });

      await tx.prospect.updateMany({
        where: {
          organizationId: input.organizationId,
          mergedIntoProspectId: duplicate.id,
        },
        data: { mergedIntoProspectId: survivor.id },
      });

      const duplicateUpdate = await tx.prospect.updateMany({
        where: {
          id: duplicate.id,
          organizationId: input.organizationId,
          version: duplicateVersion.version,
          lifecycle: { in: ["ACTIVE", "ARCHIVED"] },
        },
        data: {
          lifecycle: "MERGED",
          mergedAt: new Date(),
          mergedIntoProspectId: survivor.id,
          version: { increment: 1 },
          updatedByUserId: input.actor.id,
        },
      });
      if (duplicateUpdate.count !== 1) throw new ConflictError();

      const receipt = await tx.prospectMerge.create({
        data: {
          organizationId: input.organizationId,
          survivorProspectId: survivor.id,
          mergedProspectId: duplicate.id,
          actorUserId: input.actor.id,
          fieldResolutionsJson: JSON.stringify(parsedResolutions.data),
        },
      });
      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "PROSPECT_MERGED",
        metadata: {
          prospectId: survivor.id,
          survivorProspectId: survivor.id,
          mergedProspectId: duplicate.id,
          mergeId: receipt.id,
        },
      });
      if (hooks.testBeforeCommit) {
        await hooks.testBeforeCommit();
      }
      return { survivorProspectId: survivor.id, mergeId: receipt.id };
    });
    if (hooks.testAfterTransactionCommit) {
      await hooks.testAfterTransactionCommit();
    }
    return { ok: true, ...merged };
  } catch (error) {
    if (error instanceof Error && "fieldMessage" in error) {
      return {
        ok: false,
        reason: "validation",
        message: String((error as { fieldMessage: string }).fieldMessage),
      };
    }
    return (
      mapProspectError(error) ?? {
        ok: false,
        reason: "error",
        message: "Request denied.",
      }
    );
  }
}
