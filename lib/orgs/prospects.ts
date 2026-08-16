import "server-only";

import type {
  CustomFieldDefinition,
  OrganizationAuditAction,
  Prisma,
} from "@prisma/client";

import type { SafeUser } from "@/lib/auth/users";
import { recordOrganizationAuditEvent } from "@/lib/orgs/audit";
import { requireOrganizationPermission } from "@/lib/orgs/authorization";
import { roleHasPermission } from "@/lib/orgs/permissions";
import { prisma } from "@/lib/prisma";
import {
  acquireOrganizationProspectsLock,
  assertActiveProspect,
  assertMutableProspect,
  ConflictError,
  lockProspectsForUpdate,
  mapProspectError,
  ProspectLifecycleError,
  ProspectNotFoundError,
  requireActiveActorInTx,
  type AuthFailure,
  type ProspectMutationTestHooks,
} from "@/lib/orgs/prospect-access";
import {
  findDuplicateCandidates,
  type DuplicateCandidate,
} from "@/lib/orgs/prospect-duplicates";
import {
  contactDisplayName,
  contactCreateInputSchema,
  contactUpdateInputSchema,
  channelCreateInputSchema,
  mapValidatedCustomValue,
  normalizeProspectSearchName,
  normalizeProspectWebsite,
  normalizeSearchPhone,
  parseListLifecycle,
  parsePage,
  parsePageSize,
  prepareChannel,
  prospectCoreInputSchema,
  prospectUpdateInputSchema,
  requireExpectedVersion,
  safeWebsiteHref,
  sanitizeSearchQuery,
  zodFieldErrors,
  type PreparedChannel,
  type PreparedCustomValue,
  type ProspectCoreInput,
} from "@/lib/orgs/prospect-validation";

export type { DuplicateCandidate };
export type ProspectFailure = AuthFailure & {
  candidates?: DuplicateCandidate[];
};

type ProspectTx = Prisma.TransactionClient;

const PROSPECT_AUDIT_ACTIONS: OrganizationAuditAction[] = [
  "PROSPECT_CREATED",
  "PROSPECT_UPDATED",
  "PROSPECT_ARCHIVED",
  "PROSPECT_RESTORED",
  "PROSPECT_MERGED",
  "CONTACT_CREATED",
  "CONTACT_UPDATED",
  "CONTACT_ARCHIVED",
];

async function recordProspectAudit(
  tx: ProspectTx,
  input: {
    organizationId: string;
    actorUserId: string;
    action: OrganizationAuditAction;
    metadata: Record<string, string | number | boolean | null | undefined>;
  },
) {
  await recordOrganizationAuditEvent(tx, input);
}

export async function defaultPhoneCountry(
  db: Prisma.TransactionClient | typeof prisma,
  organizationId: string,
): Promise<string | undefined> {
  const location = await db.businessLocation.findFirst({
    where: { organizationId, isPrimary: true },
    select: { countryCode: true },
  });
  if (location?.countryCode) {
    return location.countryCode;
  }
  const locale = await db.organizationLocaleSettings.findUnique({
    where: { organizationId },
    select: { locale: true },
  });
  const region = locale?.locale.split("-")[1];
  return region && /^[A-Za-z]{2}$/.test(region)
    ? region.toUpperCase()
    : undefined;
}

function validationFailure(
  message: string,
  fieldErrors?: Record<string, string[]>,
): ProspectFailure {
  return {
    ok: false,
    reason: "validation",
    message,
    fieldErrors,
  };
}

async function loadDefinitions(
  tx: ProspectTx,
  organizationId: string,
  scope: "PROSPECT" | "CONTACT",
): Promise<CustomFieldDefinition[]> {
  return tx.customFieldDefinition.findMany({
    where: { organizationId, scope, isActive: true },
    orderBy: [{ displayOrder: "asc" }, { key: "asc" }],
  });
}

function prepareCustomValues(
  definitions: CustomFieldDefinition[],
  raw: Array<{ definitionKey: string; value: unknown }> | undefined,
  scope: "PROSPECT" | "CONTACT",
):
  { ok: true; values: PreparedCustomValue[] } | { ok: false; message: string } {
  const byKey = new Map(definitions.map((item) => [item.key, item]));
  const values: PreparedCustomValue[] = [];
  const seen = new Set<string>();
  for (const item of raw ?? []) {
    const definition = byKey.get(item.definitionKey);
    if (!definition) {
      return {
        ok: false,
        message: `Custom field is not an active ${scope} field in this organization.`,
      };
    }
    if (seen.has(definition.id)) {
      return { ok: false, message: "Duplicate custom field value." };
    }
    seen.add(definition.id);
    const mapped = mapValidatedCustomValue({
      definitionId: definition.id,
      definitionKey: definition.key,
      dataType: definition.dataType,
      options: definition.options,
      value: item.value,
    });
    if (!mapped.ok) {
      return mapped;
    }
    values.push(mapped.value);
  }
  for (const definition of definitions) {
    if (definition.required && !seen.has(definition.id)) {
      return {
        ok: false,
        message: `Required custom field "${definition.label}" is missing.`,
      };
    }
  }
  return { ok: true, values };
}

function collectChannels(
  input: ProspectCoreInput,
  defaultCountry?: string,
): { ok: true; channels: PreparedChannel[] } | { ok: false; message: string } {
  const prepared: PreparedChannel[] = [];
  for (const channel of input.channels ?? []) {
    const result = prepareChannel(channel, defaultCountry);
    if (!result.ok) return result;
    prepared.push(result.value);
  }
  for (const contact of input.contacts ?? []) {
    for (const channel of contact.channels ?? []) {
      const result = prepareChannel(channel, defaultCountry);
      if (!result.ok) return result;
      prepared.push(result.value);
    }
  }
  if (prepared.length > 100) {
    return { ok: false, message: "Too many communication channels." };
  }
  return { ok: true, channels: prepared };
}

function dedupeKey(channel: PreparedChannel): string {
  return `${channel.kind}:${channel.normalizedValue}`;
}

async function bumpProspectVersion(
  tx: ProspectTx,
  input: {
    organizationId: string;
    prospectId: string;
    expectedVersion: number;
  },
): Promise<void> {
  const updated = await tx.prospect.updateMany({
    where: {
      id: input.prospectId,
      organizationId: input.organizationId,
      version: input.expectedVersion,
    },
    data: { version: { increment: 1 } },
  });
  if (updated.count !== 1) {
    throw new ConflictError();
  }
}

export async function createProspect(
  input: {
    actor: SafeUser;
    organizationId: string;
    raw: unknown;
  },
  hooks: ProspectMutationTestHooks = {},
): Promise<{ ok: true; prospectId: string } | ProspectFailure> {
  const parsed = prospectCoreInputSchema.safeParse(input.raw);
  if (!parsed.success) {
    return validationFailure(
      "Please correct the highlighted fields.",
      zodFieldErrors(parsed.error),
    );
  }
  const website = normalizeProspectWebsite(parsed.data.website ?? "");
  if (!website.ok) {
    return validationFailure(website.message, { website: [website.message] });
  }

  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.prospects.manage",
    });

    const result = await prisma.$transaction(async (tx) => {
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
      const defaultCountry = await defaultPhoneCountry(
        tx,
        input.organizationId,
      );
      const channels = collectChannels(parsed.data, defaultCountry);
      if (!channels.ok) {
        throw Object.assign(new Error(channels.message), {
          fieldMessage: channels.message,
        });
      }
      const prospectDefs = await loadDefinitions(
        tx,
        input.organizationId,
        "PROSPECT",
      );
      const contactDefs = await loadDefinitions(
        tx,
        input.organizationId,
        "CONTACT",
      );
      const prospectCustom = prepareCustomValues(
        prospectDefs,
        parsed.data.customValues,
        "PROSPECT",
      );
      if (!prospectCustom.ok) {
        throw Object.assign(new Error(prospectCustom.message), {
          fieldMessage: prospectCustom.message,
        });
      }

      const searchName = normalizeProspectSearchName(parsed.data.displayName);
      const candidates = await findDuplicateCandidates(tx, {
        organizationId: input.organizationId,
        prospect: {
          displayName: parsed.data.displayName,
          searchName,
          websiteNormalized: website.value.normalizedValue,
          locationLabel: parsed.data.locationLabel,
          city: parsed.data.city,
          region: parsed.data.region,
          postalCode: parsed.data.postalCode,
          countryCode: parsed.data.countryCode,
        },
        channels: channels.channels,
      });
      if (candidates.length > 0 && !parsed.data.acknowledgeDuplicates) {
        return { kind: "duplicates" as const, candidates };
      }

      const prospect = await tx.prospect.create({
        data: {
          organizationId: input.organizationId,
          kind: parsed.data.kind,
          displayName: parsed.data.displayName,
          searchName,
          websiteDisplay: website.value.displayValue,
          websiteNormalized: website.value.normalizedValue,
          locationLabel: parsed.data.locationLabel ?? null,
          addressLine1: parsed.data.addressLine1 ?? null,
          addressLine2: parsed.data.addressLine2 ?? null,
          city: parsed.data.city ?? null,
          region: parsed.data.region ?? null,
          postalCode: parsed.data.postalCode ?? null,
          countryCode: parsed.data.countryCode ?? null,
          timeZone: parsed.data.timeZone ?? null,
          sourceKind: "MANUAL",
          createdByUserId: input.actor.id,
          updatedByUserId: input.actor.id,
        },
      });

      for (const value of prospectCustom.values) {
        await tx.prospectCustomValue.create({
          data: {
            organizationId: input.organizationId,
            prospectId: prospect.id,
            definitionId: value.definitionId,
            definitionKey: value.definitionKey,
            stringValue: value.stringValue,
            numberValue: value.numberValue,
            booleanValue: value.booleanValue,
            dateValue: value.dateValue,
            jsonValue: value.jsonValue as Prisma.InputJsonValue | undefined,
          },
        });
      }

      const prospectChannels = (parsed.data.channels ?? []).map((channel) =>
        prepareChannel(channel, defaultCountry),
      );
      const seenProspectChannels = new Set<string>();
      for (const channel of prospectChannels) {
        if (!channel.ok) continue;
        const key = dedupeKey(channel.value);
        if (seenProspectChannels.has(key)) continue;
        seenProspectChannels.add(key);
        await tx.prospectChannel.create({
          data: {
            organizationId: input.organizationId,
            prospectId: prospect.id,
            kind: channel.value.kind,
            label: channel.value.label,
            displayValue: channel.value.displayValue,
            normalizedValue: channel.value.normalizedValue,
            isPrimary: channel.value.isPrimary,
          },
        });
      }

      let primaryAssigned = false;
      for (const [index, contactInput] of (
        parsed.data.contacts ?? []
      ).entries()) {
        const contactCustom = prepareCustomValues(
          contactDefs,
          contactInput.customValues,
          "CONTACT",
        );
        if (!contactCustom.ok) {
          throw Object.assign(new Error(contactCustom.message), {
            fieldMessage: contactCustom.message,
          });
        }
        const isPrimary =
          !primaryAssigned && (contactInput.isPrimary || index === 0);
        if (isPrimary) primaryAssigned = true;
        const contact = await tx.prospectContact.create({
          data: {
            organizationId: input.organizationId,
            prospectId: prospect.id,
            firstName: contactInput.firstName,
            lastName: contactInput.lastName,
            displayName: contactDisplayName(contactInput),
            title: contactInput.title ?? null,
            preferredLanguage: contactInput.preferredLanguage ?? null,
            isPrimary,
            createdByUserId: input.actor.id,
            updatedByUserId: input.actor.id,
          },
        });
        const seen = new Set<string>();
        for (const channelInput of contactInput.channels ?? []) {
          const channel = prepareChannel(channelInput, defaultCountry);
          if (!channel.ok) {
            throw Object.assign(new Error(channel.message), {
              fieldMessage: channel.message,
            });
          }
          const key = dedupeKey(channel.value);
          if (seen.has(key)) continue;
          seen.add(key);
          await tx.prospectChannel.create({
            data: {
              organizationId: input.organizationId,
              prospectId: prospect.id,
              contactId: contact.id,
              kind: channel.value.kind,
              label: channel.value.label,
              displayValue: channel.value.displayValue,
              normalizedValue: channel.value.normalizedValue,
              isPrimary: channel.value.isPrimary,
            },
          });
        }
        for (const value of contactCustom.values) {
          await tx.prospectContactCustomValue.create({
            data: {
              organizationId: input.organizationId,
              prospectId: prospect.id,
              contactId: contact.id,
              definitionId: value.definitionId,
              definitionKey: value.definitionKey,
              stringValue: value.stringValue,
              numberValue: value.numberValue,
              booleanValue: value.booleanValue,
              dateValue: value.dateValue,
              jsonValue: value.jsonValue as Prisma.InputJsonValue | undefined,
            },
          });
        }
        await recordProspectAudit(tx, {
          organizationId: input.organizationId,
          actorUserId: input.actor.id,
          action: "CONTACT_CREATED",
          metadata: { prospectId: prospect.id, contactId: contact.id },
        });
      }

      await recordProspectAudit(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "PROSPECT_CREATED",
        metadata: {
          prospectId: prospect.id,
          kind: parsed.data.kind,
          sourceKind: "MANUAL",
          contactCount: parsed.data.contacts?.length ?? 0,
          channelCount: channels.channels.length,
          acknowledgedDuplicates: Boolean(parsed.data.acknowledgeDuplicates),
        },
      });
      if (hooks.testBeforeCommit) {
        await hooks.testBeforeCommit();
      }
      return { kind: "created" as const, prospectId: prospect.id };
    });

    if (result.kind === "duplicates") {
      return {
        ok: false,
        reason: "duplicate_candidates",
        message:
          "Possible duplicate prospects were found. Review them before creating a distinct record.",
        candidates: result.candidates,
      };
    }
    if (hooks.testAfterTransactionCommit) {
      await hooks.testAfterTransactionCommit();
    }
    return { ok: true, prospectId: result.prospectId };
  } catch (error) {
    if (error instanceof Error && "fieldMessage" in error) {
      return validationFailure(
        String((error as { fieldMessage: string }).fieldMessage),
      );
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

export async function updateProspect(
  input: {
    actor: SafeUser;
    organizationId: string;
    prospectId: string;
    raw: unknown;
  },
  hooks: ProspectMutationTestHooks = {},
): Promise<{ ok: true } | ProspectFailure> {
  const parsed = prospectUpdateInputSchema.safeParse(input.raw);
  if (!parsed.success) {
    return validationFailure(
      "Please correct the highlighted fields.",
      zodFieldErrors(parsed.error),
    );
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
  const website = normalizeProspectWebsite(parsed.data.website ?? "");
  if (!website.ok) {
    return validationFailure(website.message, { website: [website.message] });
  }

  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.prospects.manage",
    });
    await prisma.$transaction(async (tx) => {
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
      const [row] = await lockProspectsForUpdate(
        tx,
        {
          organizationId: input.organizationId,
          prospectIds: [input.prospectId],
        },
        hooks,
      );
      if (!row) {
        throw new ProspectNotFoundError();
      }
      assertActiveProspect(row);
      if (row.version !== expected.version) {
        throw new ConflictError();
      }
      const defs = await loadDefinitions(tx, input.organizationId, "PROSPECT");
      const custom = prepareCustomValues(
        defs,
        parsed.data.customValues,
        "PROSPECT",
      );
      if (!custom.ok) {
        throw Object.assign(new Error(custom.message), {
          fieldMessage: custom.message,
        });
      }
      await bumpProspectVersion(tx, {
        organizationId: input.organizationId,
        prospectId: input.prospectId,
        expectedVersion: expected.version,
      });
      await tx.prospect.update({
        where: { id: input.prospectId },
        data: {
          kind: parsed.data.kind,
          displayName: parsed.data.displayName,
          searchName: normalizeProspectSearchName(parsed.data.displayName),
          websiteDisplay: website.value.displayValue,
          websiteNormalized: website.value.normalizedValue,
          locationLabel: parsed.data.locationLabel ?? null,
          addressLine1: parsed.data.addressLine1 ?? null,
          addressLine2: parsed.data.addressLine2 ?? null,
          city: parsed.data.city ?? null,
          region: parsed.data.region ?? null,
          postalCode: parsed.data.postalCode ?? null,
          countryCode: parsed.data.countryCode ?? null,
          timeZone: parsed.data.timeZone ?? null,
          updatedByUserId: input.actor.id,
        },
      });
      await tx.prospectCustomValue.deleteMany({
        where: {
          organizationId: input.organizationId,
          prospectId: input.prospectId,
        },
      });
      for (const value of custom.values) {
        await tx.prospectCustomValue.create({
          data: {
            organizationId: input.organizationId,
            prospectId: input.prospectId,
            definitionId: value.definitionId,
            definitionKey: value.definitionKey,
            stringValue: value.stringValue,
            numberValue: value.numberValue,
            booleanValue: value.booleanValue,
            dateValue: value.dateValue,
            jsonValue: value.jsonValue as Prisma.InputJsonValue | undefined,
          },
        });
      }
      await recordProspectAudit(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "PROSPECT_UPDATED",
        metadata: {
          prospectId: input.prospectId,
          changedFields:
            "displayName,kind,website,location,address,timeZone,customValues",
        },
      });
      if (hooks.testBeforeCommit) await hooks.testBeforeCommit();
    });
    if (hooks.testAfterTransactionCommit) {
      await hooks.testAfterTransactionCommit();
    }
    return { ok: true };
  } catch (error) {
    if (error instanceof Error && "fieldMessage" in error) {
      return validationFailure(
        String((error as { fieldMessage: string }).fieldMessage),
      );
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

export async function archiveProspect(
  input: {
    actor: SafeUser;
    organizationId: string;
    prospectId: string;
    expectedVersion: unknown;
  },
  hooks: ProspectMutationTestHooks = {},
): Promise<{ ok: true } | ProspectFailure> {
  return mutateLifecycle(input, "archive", hooks);
}

export async function restoreProspect(
  input: {
    actor: SafeUser;
    organizationId: string;
    prospectId: string;
    expectedVersion: unknown;
  },
  hooks: ProspectMutationTestHooks = {},
): Promise<{ ok: true; candidates: DuplicateCandidate[] } | ProspectFailure> {
  const expected = requireExpectedVersion(input.expectedVersion);
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
      permission: "org.prospects.manage",
    });
    const candidates = await prisma.$transaction(async (tx) => {
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
      const [row] = await lockProspectsForUpdate(
        tx,
        {
          organizationId: input.organizationId,
          prospectIds: [input.prospectId],
        },
        hooks,
      );
      if (!row) throw new ProspectNotFoundError();
      if (row.lifecycle === "MERGED") {
        throw new ProspectLifecycleError(
          "merged",
          "Merged prospects cannot be restored.",
        );
      }
      if (row.lifecycle !== "ARCHIVED") {
        throw new ProspectLifecycleError(
          "not_archived",
          "Only archived prospects can be restored.",
        );
      }
      if (row.version !== expected.version) throw new ConflictError();
      await bumpProspectVersion(tx, {
        organizationId: input.organizationId,
        prospectId: input.prospectId,
        expectedVersion: expected.version,
      });
      const restored = await tx.prospect.update({
        where: { id: input.prospectId },
        data: {
          lifecycle: "ACTIVE",
          restoredAt: new Date(),
          restoredByUserId: input.actor.id,
          updatedByUserId: input.actor.id,
        },
      });
      const channels = await tx.prospectChannel.findMany({
        where: {
          organizationId: input.organizationId,
          prospectId: input.prospectId,
        },
        select: { kind: true, normalizedValue: true },
      });
      const found = await findDuplicateCandidates(tx, {
        organizationId: input.organizationId,
        excludeProspectId: input.prospectId,
        prospect: {
          displayName: restored.displayName,
          searchName: restored.searchName,
          websiteNormalized: restored.websiteNormalized,
          locationLabel: restored.locationLabel,
          city: restored.city,
          region: restored.region,
          postalCode: restored.postalCode,
          countryCode: restored.countryCode,
        },
        channels,
      });
      await recordProspectAudit(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "PROSPECT_RESTORED",
        metadata: { prospectId: input.prospectId },
      });
      if (hooks.testBeforeCommit) await hooks.testBeforeCommit();
      return found;
    });
    if (hooks.testAfterTransactionCommit) {
      await hooks.testAfterTransactionCommit();
    }
    return { ok: true, candidates };
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

async function mutateLifecycle(
  input: {
    actor: SafeUser;
    organizationId: string;
    prospectId: string;
    expectedVersion: unknown;
  },
  _mode: "archive",
  hooks: ProspectMutationTestHooks,
): Promise<{ ok: true } | ProspectFailure> {
  const expected = requireExpectedVersion(input.expectedVersion);
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
      permission: "org.prospects.manage",
    });
    await prisma.$transaction(async (tx) => {
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
      const [row] = await lockProspectsForUpdate(
        tx,
        {
          organizationId: input.organizationId,
          prospectIds: [input.prospectId],
        },
        hooks,
      );
      if (!row) throw new ProspectNotFoundError();
      assertMutableProspect(row);
      if (row.lifecycle !== "ACTIVE") {
        throw new ProspectLifecycleError(
          "archived",
          "Prospect is already archived.",
        );
      }
      if (row.version !== expected.version) throw new ConflictError();
      await bumpProspectVersion(tx, {
        organizationId: input.organizationId,
        prospectId: input.prospectId,
        expectedVersion: expected.version,
      });
      await tx.prospect.update({
        where: { id: input.prospectId },
        data: {
          lifecycle: "ARCHIVED",
          archivedAt: new Date(),
          archivedByUserId: input.actor.id,
          updatedByUserId: input.actor.id,
        },
      });
      await recordProspectAudit(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "PROSPECT_ARCHIVED",
        metadata: { prospectId: input.prospectId },
      });
      if (hooks.testBeforeCommit) await hooks.testBeforeCommit();
    });
    if (hooks.testAfterTransactionCommit) {
      await hooks.testAfterTransactionCommit();
    }
    return { ok: true };
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

export async function addProspectContact(
  input: {
    actor: SafeUser;
    organizationId: string;
    prospectId: string;
    expectedVersion: unknown;
    raw: unknown;
  },
  hooks: ProspectMutationTestHooks = {},
): Promise<{ ok: true; contactId: string } | ProspectFailure> {
  const parsed = contactCreateInputSchema.safeParse(input.raw);
  if (!parsed.success) {
    return validationFailure(
      "Please correct the highlighted fields.",
      zodFieldErrors(parsed.error),
    );
  }
  const expected = requireExpectedVersion(input.expectedVersion);
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
      permission: "org.prospects.manage",
    });
    const contactId = await prisma.$transaction(async (tx) => {
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
      const [row] = await lockProspectsForUpdate(
        tx,
        {
          organizationId: input.organizationId,
          prospectIds: [input.prospectId],
        },
        hooks,
      );
      if (!row) throw new ProspectNotFoundError();
      assertActiveProspect(row);
      if (row.version !== expected.version) throw new ConflictError();
      const count = await tx.prospectContact.count({
        where: {
          organizationId: input.organizationId,
          prospectId: input.prospectId,
        },
      });
      if (count >= 50) {
        throw Object.assign(new Error("Too many contacts."), {
          fieldMessage: "Too many contacts.",
        });
      }
      const defaultCountry = await defaultPhoneCountry(
        tx,
        input.organizationId,
      );
      const defs = await loadDefinitions(tx, input.organizationId, "CONTACT");
      const custom = prepareCustomValues(
        defs,
        parsed.data.customValues,
        "CONTACT",
      );
      if (!custom.ok) {
        throw Object.assign(new Error(custom.message), {
          fieldMessage: custom.message,
        });
      }
      if (parsed.data.isPrimary) {
        await tx.prospectContact.updateMany({
          where: {
            organizationId: input.organizationId,
            prospectId: input.prospectId,
            isPrimary: true,
          },
          data: { isPrimary: false },
        });
      }
      await bumpProspectVersion(tx, {
        organizationId: input.organizationId,
        prospectId: input.prospectId,
        expectedVersion: expected.version,
      });
      const contact = await tx.prospectContact.create({
        data: {
          organizationId: input.organizationId,
          prospectId: input.prospectId,
          firstName: parsed.data.firstName,
          lastName: parsed.data.lastName,
          displayName: contactDisplayName(parsed.data),
          title: parsed.data.title ?? null,
          preferredLanguage: parsed.data.preferredLanguage ?? null,
          isPrimary: Boolean(parsed.data.isPrimary) || count === 0,
          createdByUserId: input.actor.id,
          updatedByUserId: input.actor.id,
        },
      });
      const seen = new Set<string>();
      for (const channelInput of parsed.data.channels ?? []) {
        const channel = prepareChannel(channelInput, defaultCountry);
        if (!channel.ok) {
          throw Object.assign(new Error(channel.message), {
            fieldMessage: channel.message,
          });
        }
        const key = dedupeKey(channel.value);
        if (seen.has(key)) continue;
        seen.add(key);
        await tx.prospectChannel.create({
          data: {
            organizationId: input.organizationId,
            prospectId: input.prospectId,
            contactId: contact.id,
            kind: channel.value.kind,
            label: channel.value.label,
            displayValue: channel.value.displayValue,
            normalizedValue: channel.value.normalizedValue,
            isPrimary: channel.value.isPrimary,
          },
        });
      }
      for (const value of custom.values) {
        await tx.prospectContactCustomValue.create({
          data: {
            organizationId: input.organizationId,
            prospectId: input.prospectId,
            contactId: contact.id,
            definitionId: value.definitionId,
            definitionKey: value.definitionKey,
            stringValue: value.stringValue,
            numberValue: value.numberValue,
            booleanValue: value.booleanValue,
            dateValue: value.dateValue,
            jsonValue: value.jsonValue as Prisma.InputJsonValue | undefined,
          },
        });
      }
      await recordProspectAudit(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "CONTACT_CREATED",
        metadata: { prospectId: input.prospectId, contactId: contact.id },
      });
      if (hooks.testBeforeCommit) await hooks.testBeforeCommit();
      return contact.id;
    });
    if (hooks.testAfterTransactionCommit) {
      await hooks.testAfterTransactionCommit();
    }
    return { ok: true, contactId };
  } catch (error) {
    if (error instanceof Error && "fieldMessage" in error) {
      return validationFailure(
        String((error as { fieldMessage: string }).fieldMessage),
      );
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

export async function updateProspectContact(
  input: {
    actor: SafeUser;
    organizationId: string;
    prospectId: string;
    contactId: string;
    raw: unknown;
  },
  hooks: ProspectMutationTestHooks = {},
): Promise<{ ok: true } | ProspectFailure> {
  const parsed = contactUpdateInputSchema.safeParse(input.raw);
  if (!parsed.success) {
    return validationFailure(
      "Please correct the highlighted fields.",
      zodFieldErrors(parsed.error),
    );
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
      permission: "org.prospects.manage",
    });
    await prisma.$transaction(async (tx) => {
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
      const [row] = await lockProspectsForUpdate(
        tx,
        {
          organizationId: input.organizationId,
          prospectIds: [input.prospectId],
        },
        hooks,
      );
      if (!row) throw new ProspectNotFoundError();
      assertActiveProspect(row);
      const contact = await tx.prospectContact.findFirst({
        where: {
          id: input.contactId,
          organizationId: input.organizationId,
          prospectId: input.prospectId,
        },
      });
      if (!contact) throw new ProspectNotFoundError();
      if (contact.version !== expected.version) throw new ConflictError();
      if (parsed.data.isPrimary) {
        await tx.prospectContact.updateMany({
          where: {
            organizationId: input.organizationId,
            prospectId: input.prospectId,
            isPrimary: true,
            id: { not: input.contactId },
          },
          data: { isPrimary: false },
        });
      }
      const updated = await tx.prospectContact.updateMany({
        where: {
          id: input.contactId,
          organizationId: input.organizationId,
          prospectId: input.prospectId,
          version: expected.version,
        },
        data: {
          firstName: parsed.data.firstName,
          lastName: parsed.data.lastName,
          displayName: contactDisplayName(parsed.data),
          title: parsed.data.title ?? null,
          preferredLanguage: parsed.data.preferredLanguage ?? null,
          isPrimary: Boolean(parsed.data.isPrimary),
          version: { increment: 1 },
          updatedByUserId: input.actor.id,
        },
      });
      if (updated.count !== 1) throw new ConflictError();
      await recordProspectAudit(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "CONTACT_UPDATED",
        metadata: { prospectId: input.prospectId, contactId: input.contactId },
      });
      if (hooks.testBeforeCommit) await hooks.testBeforeCommit();
    });
    return { ok: true };
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

export async function addProspectChannel(
  input: {
    actor: SafeUser;
    organizationId: string;
    prospectId: string;
    contactId?: string;
    expectedVersion: unknown;
    raw: unknown;
  },
  hooks: ProspectMutationTestHooks = {},
): Promise<{ ok: true; channelId: string } | ProspectFailure> {
  const parsed = channelCreateInputSchema.safeParse(input.raw);
  if (!parsed.success) {
    return validationFailure(
      "Please correct the highlighted fields.",
      zodFieldErrors(parsed.error),
    );
  }
  const expected = requireExpectedVersion(input.expectedVersion);
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
      permission: "org.prospects.manage",
    });
    const channelId = await prisma.$transaction(async (tx) => {
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
      const [row] = await lockProspectsForUpdate(
        tx,
        {
          organizationId: input.organizationId,
          prospectIds: [input.prospectId],
        },
        hooks,
      );
      if (!row) throw new ProspectNotFoundError();
      assertActiveProspect(row);
      if (row.version !== expected.version) throw new ConflictError();
      if (input.contactId) {
        const contact = await tx.prospectContact.findFirst({
          where: {
            id: input.contactId,
            organizationId: input.organizationId,
            prospectId: input.prospectId,
          },
          select: { id: true },
        });
        if (!contact) throw new ProspectNotFoundError();
      }
      const defaultCountry = await defaultPhoneCountry(
        tx,
        input.organizationId,
      );
      const channel = prepareChannel(parsed.data, defaultCountry);
      if (!channel.ok) {
        throw Object.assign(new Error(channel.message), {
          fieldMessage: channel.message,
        });
      }
      const existing = await tx.prospectChannel.findFirst({
        where: {
          organizationId: input.organizationId,
          prospectId: input.prospectId,
          contactId: input.contactId ?? null,
          kind: channel.value.kind,
          normalizedValue: channel.value.normalizedValue,
        },
      });
      if (existing) {
        throw Object.assign(
          new Error("That communication point already exists."),
          {
            fieldMessage: "That communication point already exists.",
          },
        );
      }
      await bumpProspectVersion(tx, {
        organizationId: input.organizationId,
        prospectId: input.prospectId,
        expectedVersion: expected.version,
      });
      const created = await tx.prospectChannel.create({
        data: {
          organizationId: input.organizationId,
          prospectId: input.prospectId,
          contactId: input.contactId ?? null,
          kind: channel.value.kind,
          label: channel.value.label,
          displayValue: channel.value.displayValue,
          normalizedValue: channel.value.normalizedValue,
          isPrimary: channel.value.isPrimary,
        },
      });
      await recordProspectAudit(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "PROSPECT_UPDATED",
        metadata: {
          prospectId: input.prospectId,
          channelId: created.id,
          changedFields: "channels",
        },
      });
      if (hooks.testBeforeCommit) await hooks.testBeforeCommit();
      return created.id;
    });
    return { ok: true, channelId };
  } catch (error) {
    if (error instanceof Error && "fieldMessage" in error) {
      return validationFailure(
        String((error as { fieldMessage: string }).fieldMessage),
      );
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

export type ProspectListItem = {
  id: string;
  displayName: string;
  kind: string;
  sourceKind: string;
  lifecycle: string;
  updatedAt: Date;
  primaryContactName: string | null;
  primaryPhone: string | null;
  primaryEmail: string | null;
};

export async function listProspects(input: {
  actor: SafeUser;
  organizationId: string;
  query?: unknown;
  lifecycle?: unknown;
  sourceKind?: unknown;
  page?: unknown;
  pageSize?: unknown;
}): Promise<
  | {
      ok: true;
      items: ProspectListItem[];
      page: number;
      pageSize: number;
      total: number;
      canManage: boolean;
    }
  | ProspectFailure
> {
  const query = sanitizeSearchQuery(input.query);
  const page = parsePage(input.page);
  const pageSize = parsePageSize(input.pageSize);
  const lifecycle = parseListLifecycle(input.lifecycle);
  const sourceKind = input.sourceKind === "MANUAL" ? "MANUAL" : undefined;

  try {
    const membership = await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.prospects.read",
    });
    const canManage = roleHasPermission(
      membership.role,
      "org.prospects.manage",
    );
    const defaultCountry = await defaultPhoneCountry(
      prisma,
      input.organizationId,
    );
    const phoneQuery = query
      ? normalizeSearchPhone(query, defaultCountry)
      : null;
    const emailQuery = query.includes("@") ? query.trim().toLowerCase() : null;
    const nameQuery = normalizeProspectSearchName(query);

    const where: Prisma.ProspectWhereInput = {
      organizationId: input.organizationId,
      lifecycle,
      ...(sourceKind ? { sourceKind } : {}),
      ...(query
        ? {
            OR: [
              { displayName: { contains: query, mode: "insensitive" } },
              ...(nameQuery
                ? [
                    {
                      searchName: {
                        contains: nameQuery,
                        mode: "insensitive" as const,
                      },
                    },
                  ]
                : []),
              {
                websiteNormalized: {
                  contains: query.toLowerCase().replace(/^www\./, ""),
                  mode: "insensitive",
                },
              },
              {
                contacts: {
                  some: {
                    organizationId: input.organizationId,
                    OR: [
                      { firstName: { contains: query, mode: "insensitive" } },
                      { lastName: { contains: query, mode: "insensitive" } },
                      { displayName: { contains: query, mode: "insensitive" } },
                    ],
                  },
                },
              },
              {
                channels: {
                  some: {
                    organizationId: input.organizationId,
                    normalizedValue: {
                      contains: emailQuery ?? query.toLowerCase(),
                      mode: "insensitive",
                    },
                  },
                },
              },
              ...(phoneQuery
                ? [
                    {
                      channels: {
                        some: {
                          organizationId: input.organizationId,
                          kind: "PHONE" as const,
                          normalizedValue: { contains: phoneQuery },
                        },
                      },
                    },
                  ]
                : []),
            ],
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      prisma.prospect.count({ where }),
      prisma.prospect.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          contacts: {
            where: {
              organizationId: input.organizationId,
              lifecycle: "ACTIVE",
            },
            orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
            take: 1,
            select: { displayName: true },
          },
          channels: {
            where: { organizationId: input.organizationId },
            orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
            take: 8,
            select: {
              kind: true,
              displayValue: true,
              isPrimary: true,
              contactId: true,
            },
          },
        },
      }),
    ]);

    return {
      ok: true,
      canManage,
      page,
      pageSize,
      total,
      items: rows.map((row) => {
        const phone =
          row.channels.find(
            (channel) => channel.kind === "PHONE" && channel.isPrimary,
          ) ?? row.channels.find((channel) => channel.kind === "PHONE");
        const email =
          row.channels.find(
            (channel) => channel.kind === "EMAIL" && channel.isPrimary,
          ) ?? row.channels.find((channel) => channel.kind === "EMAIL");
        return {
          id: row.id,
          displayName: row.displayName,
          kind: row.kind,
          sourceKind: row.sourceKind,
          lifecycle: row.lifecycle,
          updatedAt: row.updatedAt,
          primaryContactName: row.contacts[0]?.displayName ?? null,
          primaryPhone: phone?.displayValue ?? null,
          primaryEmail: email?.displayValue ?? null,
        };
      }),
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

export type ProspectDetail = {
  id: string;
  organizationId: string;
  kind: string;
  displayName: string;
  websiteDisplay: string | null;
  websiteHref: string | null;
  locationLabel: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  countryCode: string | null;
  timeZone: string | null;
  sourceKind: string;
  lifecycle: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  restoredAt: Date | null;
  mergedAt: Date | null;
  mergedIntoProspectId: string | null;
  mergedIntoDisplayName: string | null;
  contacts: Array<{
    id: string;
    firstName: string;
    lastName: string;
    displayName: string;
    title: string | null;
    preferredLanguage: string | null;
    isPrimary: boolean;
    lifecycle: string;
    version: number;
    channels: Array<{
      id: string;
      kind: string;
      label: string | null;
      displayValue: string;
      isPrimary: boolean;
    }>;
    customValues: Array<{
      definitionKey: string;
      label: string;
      displayValue: string;
    }>;
  }>;
  channels: Array<{
    id: string;
    kind: string;
    label: string | null;
    displayValue: string;
    isPrimary: boolean;
  }>;
  customValues: Array<{
    definitionKey: string;
    label: string;
    displayValue: string;
  }>;
  recentAudit: Array<{
    id: string;
    action: string;
    createdAt: Date;
    metadata: unknown;
  }>;
  duplicateCandidates: DuplicateCandidate[];
  canManage: boolean;
};

function displayCustomValue(row: {
  stringValue: string | null;
  numberValue: Prisma.Decimal | null;
  booleanValue: boolean | null;
  dateValue: Date | null;
  jsonValue: unknown;
  definition: { label: string; key: string };
}): { definitionKey: string; label: string; displayValue: string } {
  let displayValue = "";
  if (row.stringValue != null) displayValue = row.stringValue;
  else if (row.numberValue != null) displayValue = row.numberValue.toString();
  else if (row.booleanValue != null)
    displayValue = row.booleanValue ? "Yes" : "No";
  else if (row.dateValue != null)
    displayValue = row.dateValue.toISOString().slice(0, 10);
  else if (row.jsonValue != null) displayValue = JSON.stringify(row.jsonValue);
  return {
    definitionKey: row.definition.key,
    label: row.definition.label,
    displayValue,
  };
}

export async function getProspect(input: {
  actor: SafeUser;
  organizationId: string;
  prospectId: string;
}): Promise<{ ok: true; prospect: ProspectDetail } | ProspectFailure> {
  try {
    const membership = await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.prospects.read",
    });
    const row = await prisma.prospect.findFirst({
      where: { id: input.prospectId, organizationId: input.organizationId },
      include: {
        mergedInto: { select: { id: true, displayName: true } },
        contacts: {
          where: { organizationId: input.organizationId },
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
          include: {
            channels: {
              where: { organizationId: input.organizationId },
              orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
            },
            customValues: {
              where: { organizationId: input.organizationId },
              include: { definition: { select: { key: true, label: true } } },
            },
          },
        },
        channels: {
          where: { organizationId: input.organizationId, contactId: null },
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        },
        customValues: {
          where: { organizationId: input.organizationId },
          include: { definition: { select: { key: true, label: true } } },
        },
      },
    });
    if (!row) {
      throw new ProspectNotFoundError();
    }
    const recentAudit = await prisma.organizationAuditEvent.findMany({
      where: {
        organizationId: input.organizationId,
        action: { in: PROSPECT_AUDIT_ACTIONS },
        metadata: { path: ["prospectId"], equals: input.prospectId },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, action: true, createdAt: true, metadata: true },
    });
    const duplicateCandidates =
      row.lifecycle === "MERGED"
        ? []
        : await findDuplicateCandidates(prisma, {
            organizationId: input.organizationId,
            excludeProspectId: row.id,
            prospect: {
              displayName: row.displayName,
              searchName: row.searchName,
              websiteNormalized: row.websiteNormalized,
              locationLabel: row.locationLabel,
              city: row.city,
              region: row.region,
              postalCode: row.postalCode,
              countryCode: row.countryCode,
            },
            channels: await prisma.prospectChannel.findMany({
              where: {
                organizationId: input.organizationId,
                prospectId: row.id,
              },
              select: { kind: true, normalizedValue: true },
            }),
          });
    return {
      ok: true,
      prospect: {
        id: row.id,
        organizationId: row.organizationId,
        kind: row.kind,
        displayName: row.displayName,
        websiteDisplay: row.websiteDisplay,
        websiteHref: safeWebsiteHref(row.websiteDisplay),
        locationLabel: row.locationLabel,
        addressLine1: row.addressLine1,
        addressLine2: row.addressLine2,
        city: row.city,
        region: row.region,
        postalCode: row.postalCode,
        countryCode: row.countryCode,
        timeZone: row.timeZone,
        sourceKind: row.sourceKind,
        lifecycle: row.lifecycle,
        version: row.version,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        archivedAt: row.archivedAt,
        restoredAt: row.restoredAt,
        mergedAt: row.mergedAt,
        mergedIntoProspectId: row.mergedIntoProspectId,
        mergedIntoDisplayName: row.mergedInto?.displayName ?? null,
        canManage: roleHasPermission(membership.role, "org.prospects.manage"),
        contacts: row.contacts.map((contact) => ({
          id: contact.id,
          firstName: contact.firstName,
          lastName: contact.lastName,
          displayName: contact.displayName,
          title: contact.title,
          preferredLanguage: contact.preferredLanguage,
          isPrimary: contact.isPrimary,
          lifecycle: contact.lifecycle,
          version: contact.version,
          channels: contact.channels.map((channel) => ({
            id: channel.id,
            kind: channel.kind,
            label: channel.label,
            displayValue: channel.displayValue,
            isPrimary: channel.isPrimary,
          })),
          customValues: contact.customValues.map(displayCustomValue),
        })),
        channels: row.channels.map((channel) => ({
          id: channel.id,
          kind: channel.kind,
          label: channel.label,
          displayValue: channel.displayValue,
          isPrimary: channel.isPrimary,
        })),
        customValues: row.customValues.map(displayCustomValue),
        recentAudit,
        duplicateCandidates,
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

export async function previewDuplicateCandidates(input: {
  actor: SafeUser;
  organizationId: string;
  raw: unknown;
}): Promise<{ ok: true; candidates: DuplicateCandidate[] } | ProspectFailure> {
  const parsed = prospectCoreInputSchema.safeParse(input.raw);
  if (!parsed.success) {
    return validationFailure(
      "Please correct the highlighted fields.",
      zodFieldErrors(parsed.error),
    );
  }
  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.prospects.manage",
    });
    const website = normalizeProspectWebsite(parsed.data.website ?? "");
    if (!website.ok) {
      return validationFailure(website.message, { website: [website.message] });
    }
    const defaultCountry = await defaultPhoneCountry(
      prisma,
      input.organizationId,
    );
    const channels = collectChannels(parsed.data, defaultCountry);
    if (!channels.ok) {
      return validationFailure(channels.message);
    }
    const candidates = await prisma.$transaction(async (tx) => {
      return findDuplicateCandidates(tx, {
        organizationId: input.organizationId,
        prospect: {
          displayName: parsed.data.displayName,
          searchName: normalizeProspectSearchName(parsed.data.displayName),
          websiteNormalized: website.value.normalizedValue,
          locationLabel: parsed.data.locationLabel,
          city: parsed.data.city,
          region: parsed.data.region,
          postalCode: parsed.data.postalCode,
          countryCode: parsed.data.countryCode,
        },
        channels: channels.channels,
      });
    });
    return { ok: true, candidates };
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
