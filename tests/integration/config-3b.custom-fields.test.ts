import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { resetServerEnvCache } from "@/lib/env/server";
import { setMailerForTests, type EmailSender } from "@/lib/email/mailer";
import { CUSTOM_FIELD_DATA_TYPES } from "@/lib/orgs/config-3b-validation";
import { getTemplateDefinition } from "@/lib/orgs/business-templates-registry";
import { selectBusinessTemplate } from "@/lib/orgs/business-templates";
import {
  createCustomField,
  deactivateCustomField,
  listCustomFields,
  reorderCustomFields,
  updateCustomField,
} from "@/lib/orgs/custom-fields";
import {
  addMember,
  countConfig3bAudits,
  createGate,
  createOrgWithOwner,
  seedPhase3aCompletedOrg,
} from "@/tests/integration/helpers/config-3b";
import { resetApplicationData } from "@/tests/integration/reset";

const mockMailer: EmailSender = {
  async send() {},
};

describe("Phase 3B custom fields", () => {
  const prisma = new PrismaClient();

  beforeAll(() => {
    resetServerEnvCache();
    setMailerForTests(mockMailer);
  });

  beforeEach(async () => {
    await resetApplicationData(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates each supported data type", async () => {
    const { owner, organizationId } = await createOrgWithOwner(
      prisma,
      "cf-types",
    );

    for (const [index, dataType] of CUSTOM_FIELD_DATA_TYPES.entries()) {
      const raw: Record<string, unknown> = {
        key: `field_${dataType.toLowerCase()}`,
        label: `Field ${dataType}`,
        dataType,
        scope: "BUSINESS",
      };
      if (dataType === "SINGLE_SELECT" || dataType === "MULTI_SELECT") {
        raw.options = ["Alpha", "Beta"];
      }
      const created = await createCustomField({
        actor: owner,
        organizationId,
        raw,
      });
      expect(created.ok, `${dataType} create`).toBe(true);
      if (!created.ok) return;
      expect(created.field.dataType).toBe(dataType);
      expect(created.field.displayOrder).toBe(index);
    }

    const listed = await listCustomFields({ actor: owner, organizationId });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.fields).toHaveLength(CUSTOM_FIELD_DATA_TYPES.length);
  });

  it("rejects reserved keys", async () => {
    const { owner, organizationId } = await createOrgWithOwner(
      prisma,
      "cf-rsv",
    );
    for (const key of [
      "email",
      "phone",
      "name",
      "organization_id",
      "api_key",
    ]) {
      const result = await createCustomField({
        actor: owner,
        organizationId,
        raw: { key, label: "Reserved", dataType: "TEXT" },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("validation");
    }
    expect(
      await prisma.customFieldDefinition.count({ where: { organizationId } }),
    ).toBe(0);
  });

  it("rejects duplicate keys within the same scope", async () => {
    const { owner, organizationId } = await createOrgWithOwner(
      prisma,
      "cf-dup",
    );
    const first = await createCustomField({
      actor: owner,
      organizationId,
      raw: { key: "lead_source", label: "Lead source", dataType: "TEXT" },
    });
    expect(first.ok).toBe(true);

    const dup = await createCustomField({
      actor: owner,
      organizationId,
      raw: { key: "lead_source", label: "Lead source 2", dataType: "TEXT" },
    });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.reason).toBe("conflict");

    const otherScope = await createCustomField({
      actor: owner,
      organizationId,
      raw: {
        key: "lead_source",
        label: "Lead source offering",
        dataType: "TEXT",
        scope: "OFFERING",
      },
    });
    expect(otherScope.ok).toBe(true);
  });

  it("rejects invalid option sets", async () => {
    const { owner, organizationId } = await createOrgWithOwner(
      prisma,
      "cf-opt",
    );

    const missingOptions = await createCustomField({
      actor: owner,
      organizationId,
      raw: {
        key: "status_tag",
        label: "Status",
        dataType: "SINGLE_SELECT",
      },
    });
    expect(missingOptions.ok).toBe(false);
    if (!missingOptions.ok) expect(missingOptions.reason).toBe("validation");

    const emptyOptions = await createCustomField({
      actor: owner,
      organizationId,
      raw: {
        key: "status_tag",
        label: "Status",
        dataType: "MULTI_SELECT",
        options: [],
      },
    });
    expect(emptyOptions.ok).toBe(false);
    if (!emptyOptions.ok) expect(emptyOptions.reason).toBe("validation");

    const duplicateOptions = await createCustomField({
      actor: owner,
      organizationId,
      raw: {
        key: "status_tag",
        label: "Status",
        dataType: "SINGLE_SELECT",
        options: ["Open", "open"],
      },
    });
    expect(duplicateOptions.ok).toBe(false);
    if (!duplicateOptions.ok)
      expect(duplicateOptions.reason).toBe("validation");

    const optionsOnText = await createCustomField({
      actor: owner,
      organizationId,
      raw: {
        key: "plain_text",
        label: "Plain",
        dataType: "TEXT",
        options: ["Nope"],
      },
    });
    expect(optionsOnText.ok).toBe(false);
    if (!optionsOnText.ok) expect(optionsOnText.reason).toBe("validation");
  });

  it("validates reorder: duplicates, omissions, unknown, and foreign IDs", async () => {
    const a = await createOrgWithOwner(prisma, "cf-ord-a");
    const b = await createOrgWithOwner(prisma, "cf-ord-b");

    const f1 = await createCustomField({
      actor: a.owner,
      organizationId: a.organizationId,
      raw: { key: "one", label: "One", dataType: "TEXT" },
    });
    const f2 = await createCustomField({
      actor: a.owner,
      organizationId: a.organizationId,
      raw: { key: "two", label: "Two", dataType: "TEXT" },
    });
    const foreign = await createCustomField({
      actor: b.owner,
      organizationId: b.organizationId,
      raw: { key: "foreign", label: "Foreign", dataType: "TEXT" },
    });
    expect(f1.ok && f2.ok && foreign.ok).toBe(true);
    if (!f1.ok || !f2.ok || !foreign.ok) return;

    const dupes = await reorderCustomFields({
      actor: a.owner,
      organizationId: a.organizationId,
      raw: { orderedIds: [f1.field.id, f1.field.id] },
    });
    expect(dupes.ok).toBe(false);

    const omission = await reorderCustomFields({
      actor: a.owner,
      organizationId: a.organizationId,
      raw: { orderedIds: [f1.field.id] },
    });
    expect(omission.ok).toBe(false);

    const unknown = await reorderCustomFields({
      actor: a.owner,
      organizationId: a.organizationId,
      raw: {
        orderedIds: [f1.field.id, "clxxxxxxxxxxxxxxxxxxxxxx"],
      },
    });
    expect(unknown.ok).toBe(false);

    const foreignIds = await reorderCustomFields({
      actor: a.owner,
      organizationId: a.organizationId,
      raw: { orderedIds: [f1.field.id, foreign.field.id] },
    });
    expect(foreignIds.ok).toBe(false);

    const ok = await reorderCustomFields({
      actor: a.owner,
      organizationId: a.organizationId,
      raw: { orderedIds: [f2.field.id, f1.field.id] },
    });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.fields.map((f) => f.id)).toEqual([f2.field.id, f1.field.id]);
  });

  it("deactivates without hard delete", async () => {
    const { owner, organizationId } = await createOrgWithOwner(
      prisma,
      "cf-deact",
    );
    const created = await createCustomField({
      actor: owner,
      organizationId,
      raw: { key: "legacy_tag", label: "Legacy", dataType: "BOOLEAN" },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const deactivated = await deactivateCustomField({
      actor: owner,
      organizationId,
      fieldId: created.field.id,
      expectedVersion: created.field.version,
    });
    expect(deactivated.ok).toBe(true);
    if (!deactivated.ok) return;
    expect(deactivated.field.isActive).toBe(false);

    const row = await prisma.customFieldDefinition.findUniqueOrThrow({
      where: { id: created.field.id },
    });
    expect(row.isActive).toBe(false);
    expect(
      await countConfig3bAudits(
        prisma,
        organizationId,
        "CUSTOM_FIELD_DEACTIVATED",
      ),
    ).toBe(1);
  });

  it("enforces tenant isolation", async () => {
    const a = await createOrgWithOwner(prisma, "cf-iso-a");
    const b = await createOrgWithOwner(prisma, "cf-iso-b");
    const created = await createCustomField({
      actor: a.owner,
      organizationId: a.organizationId,
      raw: { key: "secret_field", label: "Secret", dataType: "TEXT" },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const updateDenied = await updateCustomField({
      actor: b.owner,
      organizationId: b.organizationId,
      fieldId: created.field.id,
      expectedVersion: created.field.version,
      raw: { label: "Hijacked" },
    });
    expect(updateDenied.ok).toBe(false);

    const deactivateDenied = await deactivateCustomField({
      actor: b.owner,
      organizationId: a.organizationId,
      fieldId: created.field.id,
      expectedVersion: created.field.version,
    });
    expect(deactivateDenied.ok).toBe(false);

    const listed = await listCustomFields({
      actor: b.owner,
      organizationId: b.organizationId,
    });
    expect(listed.ok).toBe(true);
    if (listed.ok) expect(listed.fields).toHaveLength(0);

    const untouched = await prisma.customFieldDefinition.findUniqueOrThrow({
      where: { id: created.field.id },
    });
    expect(untouched.label).toBe("Secret");
  });

  it("deterministic concurrency: one update wins on the same version", async () => {
    const { owner, organizationId } = await createOrgWithOwner(
      prisma,
      "cf-race",
    );
    const created = await createCustomField({
      actor: owner,
      organizationId,
      raw: { key: "race_field", label: "Race", dataType: "TEXT" },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const aHeld = createGate();
    const bStarted = createGate();
    const bGotLock = createGate();

    const firstPromise = updateCustomField(
      {
        actor: owner,
        organizationId,
        fieldId: created.field.id,
        expectedVersion: created.field.version,
        raw: { label: "Winner A" },
      },
      {
        testAfterConfig3bLock: async () => {
          aHeld.markReached();
          await aHeld.waitForRelease();
        },
      },
    );

    await aHeld.waitUntilReached();

    const secondPromise = updateCustomField(
      {
        actor: owner,
        organizationId,
        fieldId: created.field.id,
        expectedVersion: created.field.version,
        raw: { label: "Winner B" },
      },
      {
        testBeforeConfig3bLock: async () => {
          bStarted.markReached();
        },
        testAfterConfig3bLock: async () => {
          bGotLock.markReached();
        },
      },
    );

    await bStarted.waitUntilReached();
    aHeld.release();
    await bGotLock.waitUntilReached();

    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    expect([first, second].filter((r) => r.ok).length).toBe(1);
    expect(
      [first, second].filter((r) => !r.ok && r.reason === "conflict").length,
    ).toBe(1);

    const row = await prisma.customFieldDefinition.findUniqueOrThrow({
      where: { id: created.field.id },
    });
    expect(["Winner A", "Winner B"]).toContain(row.label);
    expect(row.version).toBe(created.field.version + 1);
  });

  it("template suggestions never auto-create definitions or values", async () => {
    const seeded = await seedPhase3aCompletedOrg(prisma, {
      prefix: "cf-sug",
    });
    const definition = getTemplateDefinition("PROFESSIONAL_SERVICES");
    expect(definition.suggestedCustomFields.length).toBeGreaterThan(0);

    const selected = await selectBusinessTemplate({
      actor: seeded.owner,
      organizationId: seeded.organizationId,
      raw: {
        templateKey: "PROFESSIONAL_SERVICES",
        customization: {
          confirmedFieldKeys: definition.suggestedCustomFields.map(
            (f) => f.key,
          ),
          notes: "confirming suggestions must not materialize rows",
        },
      },
    });
    expect(selected.ok).toBe(true);

    expect(
      await prisma.customFieldDefinition.count({
        where: { organizationId: seeded.organizationId },
      }),
    ).toBe(0);

    const member = await addMember(
      prisma,
      seeded.organizationId,
      "cf-sug-member",
    );
    const denied = await createCustomField({
      actor: member,
      organizationId: seeded.organizationId,
      raw: {
        key: definition.suggestedCustomFields[0]!.key,
        label: definition.suggestedCustomFields[0]!.label,
        dataType: definition.suggestedCustomFields[0]!.dataType,
        scope: definition.suggestedCustomFields[0]!.scope,
        options: definition.suggestedCustomFields[0]!.options,
      },
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.reason).toBe("forbidden");
  });
});
