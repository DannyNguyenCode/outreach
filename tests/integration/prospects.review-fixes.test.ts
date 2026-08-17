import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  createCustomField,
  deactivateCustomField,
} from "@/lib/orgs/custom-fields";
import {
  addProspectChannel,
  addProspectContact,
  archiveProspectChannel,
  archiveProspectContact,
  createProspect,
  getProspect,
  restoreProspectContact,
  updateProspect,
  updateProspectContact,
} from "@/lib/orgs/prospects";
import {
  addMember,
  createGate,
  createOrgWithOwner,
} from "@/tests/integration/helpers/config-3b";
import { resetApplicationData } from "@/tests/integration/reset";

describe("Phase 5A prospect edit preservation", () => {
  const prisma = new PrismaClient();

  beforeEach(async () => {
    await resetApplicationData(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("preserves address, website, timezone, and custom values on a name-only edit", async () => {
    const ctx = await createOrgWithOwner(prisma, "p-preserve");
    const notes = await createCustomField({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: {
        key: "intake_notes",
        label: "Intake notes",
        dataType: "TEXT",
        scope: "PROSPECT",
      },
    });
    expect(notes.ok).toBe(true);
    const created = await createProspect({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: {
        displayName: "ABC Plumbing",
        website: "abcplumbing.ca",
        locationLabel: "Toronto",
        addressLine1: "100 Main St",
        addressLine2: "Suite 2",
        city: "Toronto",
        region: "ON",
        postalCode: "M5V 1A1",
        countryCode: "CA",
        timeZone: "America/Toronto",
        customValues: [{ definitionKey: "intake_notes", value: "keep me" }],
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const updated = await updateProspect({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      prospectId: created.prospectId,
      raw: { displayName: "ABC Plumbing Ltd", expectedVersion: 0 },
    });
    expect(updated.ok).toBe(true);

    const row = await prisma.prospect.findUniqueOrThrow({
      where: { id: created.prospectId },
    });
    expect(row.displayName).toBe("ABC Plumbing Ltd");
    expect(row.websiteDisplay).toBe("abcplumbing.ca");
    expect(row.locationLabel).toBe("Toronto");
    expect(row.addressLine1).toBe("100 Main St");
    expect(row.addressLine2).toBe("Suite 2");
    expect(row.city).toBe("Toronto");
    expect(row.region).toBe("ON");
    expect(row.postalCode).toBe("M5V 1A1");
    expect(row.countryCode).toBe("CA");
    expect(row.timeZone).toBe("America/Toronto");
    expect(
      await prisma.prospectCustomValue.findFirst({
        where: { prospectId: created.prospectId },
      }),
    ).toMatchObject({ stringValue: "keep me" });

    const audit = await prisma.organizationAuditEvent.findFirst({
      where: {
        organizationId: ctx.organizationId,
        action: "PROSPECT_UPDATED",
      },
    });
    expect(JSON.stringify(audit?.metadata)).toBe(
      JSON.stringify({
        prospectId: created.prospectId,
        changedFields: "displayName",
      }),
    );
  });

  it("lets a required stored custom value survive an unrelated edit", async () => {
    const ctx = await createOrgWithOwner(prisma, "p-req");
    const field = await createCustomField({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: {
        key: "job_size",
        label: "Job size",
        dataType: "TEXT",
        scope: "PROSPECT",
        required: true,
      },
    });
    expect(field.ok).toBe(true);
    const created = await createProspect({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: {
        displayName: "Required prospect",
        customValues: [{ definitionKey: "job_size", value: "large" }],
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const updated = await updateProspect({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      prospectId: created.prospectId,
      raw: { displayName: "Renamed", expectedVersion: 0 },
    });
    expect(updated.ok).toBe(true);
    expect(
      await prisma.prospectCustomValue.findFirst({
        where: { prospectId: created.prospectId },
      }),
    ).toMatchObject({ stringValue: "large" });
  });

  it("clears an optional field only when explicitly requested", async () => {
    const ctx = await createOrgWithOwner(prisma, "p-clear");
    const field = await createCustomField({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: {
        key: "intake_notes",
        label: "Intake notes",
        dataType: "TEXT",
        scope: "PROSPECT",
      },
    });
    expect(field.ok).toBe(true);
    const created = await createProspect({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: {
        displayName: "Clear prospect",
        website: "example.com",
        addressLine1: "100 Main St",
        customValues: [{ definitionKey: "intake_notes", value: "temp" }],
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const cleared = await updateProspect({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      prospectId: created.prospectId,
      raw: {
        website: null,
        addressLine1: "",
        customValues: [{ definitionKey: "intake_notes", value: null }],
        expectedVersion: 0,
      },
    });
    expect(cleared.ok).toBe(true);
    const row = await prisma.prospect.findUniqueOrThrow({
      where: { id: created.prospectId },
    });
    expect(row.websiteDisplay).toBeNull();
    expect(row.addressLine1).toBeNull();
    expect(
      await prisma.prospectCustomValue.count({
        where: { prospectId: created.prospectId },
      }),
    ).toBe(0);
  });

  it("rejects a stale update without changing stored data", async () => {
    const ctx = await createOrgWithOwner(prisma, "p-stale");
    const created = await createProspect({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: {
        displayName: "Stale prospect",
        addressLine1: "100 Main St",
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const stale = await updateProspect({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      prospectId: created.prospectId,
      raw: { displayName: "Hijacked", expectedVersion: 99 },
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.reason).toBe("conflict");
    const row = await prisma.prospect.findUniqueOrThrow({
      where: { id: created.prospectId },
    });
    expect(row.displayName).toBe("Stale prospect");
    expect(row.addressLine1).toBe("100 Main St");
    expect(row.version).toBe(0);
  });

  it("rolls back a failed update completely", async () => {
    const ctx = await createOrgWithOwner(prisma, "p-rollback");
    const created = await createProspect({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: {
        displayName: "Rollback prospect",
        addressLine1: "100 Main St",
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const failed = await updateProspect(
      {
        actor: ctx.owner,
        organizationId: ctx.organizationId,
        prospectId: created.prospectId,
        raw: { displayName: "Should not stick", expectedVersion: 0 },
      },
      {
        testBeforeCommit: async () => {
          throw new Error("forced failure");
        },
      },
    );
    expect(failed.ok).toBe(false);
    const row = await prisma.prospect.findUniqueOrThrow({
      where: { id: created.prospectId },
    });
    expect(row.displayName).toBe("Rollback prospect");
    expect(row.addressLine1).toBe("100 Main St");
    expect(row.version).toBe(0);
    expect(
      await prisma.organizationAuditEvent.count({
        where: {
          organizationId: ctx.organizationId,
          action: "PROSPECT_UPDATED",
        },
      }),
    ).toBe(0);
  });

  it("validates every custom-field type and fails closed for invalid, inactive, and foreign definitions", async () => {
    const ctx = await createOrgWithOwner(prisma, "p-types");
    const other = await createOrgWithOwner(prisma, "p-types-b");
    const definitions = [
      { key: "cf_text", label: "Text", dataType: "TEXT" },
      { key: "cf_long", label: "Long", dataType: "LONG_TEXT" },
      { key: "cf_num", label: "Num", dataType: "NUMBER" },
      { key: "cf_bool", label: "Bool", dataType: "BOOLEAN" },
      { key: "cf_date", label: "Date", dataType: "DATE" },
      {
        key: "cf_single",
        label: "Single",
        dataType: "SINGLE_SELECT",
        options: ["alpha", "beta"],
      },
      {
        key: "cf_multi",
        label: "Multi",
        dataType: "MULTI_SELECT",
        options: ["alpha", "beta"],
      },
      { key: "cf_url", label: "Url", dataType: "URL" },
      { key: "cf_email", label: "Email", dataType: "EMAIL" },
      { key: "cf_phone", label: "Phone", dataType: "PHONE" },
    ] as const;
    for (const definition of definitions) {
      const createdField = await createCustomField({
        actor: ctx.owner,
        organizationId: ctx.organizationId,
        raw: { ...definition, scope: "PROSPECT" },
      });
      expect(createdField.ok).toBe(true);
    }
    const created = await createProspect({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: {
        displayName: "Typed prospect",
        customValues: [
          { definitionKey: "cf_text", value: "hello" },
          { definitionKey: "cf_long", value: "longer" },
          { definitionKey: "cf_num", value: "12.50" },
          { definitionKey: "cf_bool", value: true },
          { definitionKey: "cf_date", value: "2026-01-15" },
          { definitionKey: "cf_single", value: "alpha" },
          { definitionKey: "cf_multi", value: ["beta"] },
          { definitionKey: "cf_url", value: "https://example.com" },
          { definitionKey: "cf_email", value: "a@example.com" },
          { definitionKey: "cf_phone", value: "+14165551234" },
        ],
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(
      await prisma.prospectCustomValue.count({
        where: { prospectId: created.prospectId },
      }),
    ).toBe(10);

    const badChoice = await updateProspect({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      prospectId: created.prospectId,
      raw: {
        customValues: [{ definitionKey: "cf_single", value: "gamma" }],
        expectedVersion: 0,
      },
    });
    expect(badChoice.ok).toBe(false);

    const badType = await updateProspect({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      prospectId: created.prospectId,
      raw: {
        customValues: [{ definitionKey: "cf_num", value: "nope" }],
        expectedVersion: 0,
      },
    });
    expect(badType.ok).toBe(false);

    const textField = await prisma.customFieldDefinition.findFirstOrThrow({
      where: { organizationId: ctx.organizationId, key: "cf_text" },
    });
    const deactivated = await deactivateCustomField({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      fieldId: textField.id,
      expectedVersion: textField.version,
    });
    expect(deactivated.ok).toBe(true);
    const inactivePatch = await updateProspect({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      prospectId: created.prospectId,
      raw: {
        customValues: [{ definitionKey: "cf_text", value: "changed" }],
        expectedVersion: 0,
      },
    });
    expect(inactivePatch.ok).toBe(false);
    expect(
      await prisma.prospectCustomValue.findFirst({
        where: {
          prospectId: created.prospectId,
          definitionKey: "cf_text",
        },
      }),
    ).toMatchObject({ stringValue: "hello" });

    const foreignField = await createCustomField({
      actor: other.owner,
      organizationId: other.organizationId,
      raw: {
        key: "cf_foreign",
        label: "Foreign",
        dataType: "TEXT",
        scope: "PROSPECT",
      },
    });
    expect(foreignField.ok).toBe(true);
    const foreignPatch = await updateProspect({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      prospectId: created.prospectId,
      raw: {
        customValues: [{ definitionKey: "cf_foreign", value: "nope" }],
        expectedVersion: 0,
      },
    });
    expect(foreignPatch.ok).toBe(false);
    expect(
      await prisma.prospectCustomValue.count({
        where: { prospectId: created.prospectId },
      }),
    ).toBe(10);
  });
});

describe("Phase 5A contact lifecycle", () => {
  const prisma = new PrismaClient();

  beforeEach(async () => {
    await resetApplicationData(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function seedProspectWithContacts() {
    const ctx = await createOrgWithOwner(prisma, "p-contacts");
    const role = await createCustomField({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: {
        key: "contact_role",
        label: "Role",
        dataType: "TEXT",
        scope: "CONTACT",
        required: true,
      },
    });
    const optional = await createCustomField({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: {
        key: "contact_note",
        label: "Note",
        dataType: "TEXT",
        scope: "CONTACT",
      },
    });
    expect(role.ok && optional.ok).toBe(true);
    const created = await createProspect({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: {
        displayName: "ABC Plumbing",
        contacts: [
          {
            firstName: "John",
            lastName: "Smith",
            isPrimary: true,
            customValues: [
              { definitionKey: "contact_role", value: "Owner" },
              { definitionKey: "contact_note", value: "keep" },
            ],
          },
          {
            firstName: "Jane",
            lastName: "Doe",
            customValues: [{ definitionKey: "contact_role", value: "Office" }],
          },
        ],
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("seed failed");
    const detail = await getProspect({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      prospectId: created.prospectId,
    });
    expect(detail.ok).toBe(true);
    if (!detail.ok) throw new Error("detail failed");
    const john = detail.prospect.contacts.find(
      (contact) => contact.firstName === "John",
    );
    const jane = detail.prospect.contacts.find(
      (contact) => contact.firstName === "Jane",
    );
    if (!john || !jane) throw new Error("contacts missing");
    return { ctx, prospectId: created.prospectId, john, jane };
  }

  it("updates a contact, preserves unrelated custom values, and records field names", async () => {
    const { ctx, prospectId, jane } = await seedProspectWithContacts();
    const updated = await updateProspectContact({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      prospectId,
      contactId: jane.id,
      raw: {
        title: "Office Manager",
        isPrimary: true,
        expectedVersion: jane.version,
      },
    });
    expect(updated.ok).toBe(true);
    const detail = await getProspect({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      prospectId,
    });
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    const nextJane = detail.prospect.contacts.find(
      (item) => item.id === jane.id,
    );
    const nextJohn = detail.prospect.contacts.find(
      (item) => item.firstName === "John",
    );
    expect(nextJane?.title).toBe("Office Manager");
    expect(nextJane?.isPrimary).toBe(true);
    expect(nextJohn?.isPrimary).toBe(false);
    expect(nextJohn?.customValues.map((value) => value.displayValue)).toEqual(
      expect.arrayContaining(["Owner", "keep"]),
    );
    const audit = await prisma.organizationAuditEvent.findFirst({
      where: {
        organizationId: ctx.organizationId,
        action: "CONTACT_UPDATED",
      },
    });
    const serialized = JSON.stringify(audit?.metadata);
    expect(serialized).toContain("title");
    expect(serialized).toContain("isPrimary");
    expect(serialized).not.toContain("Office Manager");
    expect(serialized).not.toContain("keep");
  });

  it("rejects a stale contact update without changing data", async () => {
    const { ctx, prospectId, jane } = await seedProspectWithContacts();
    const stale = await updateProspectContact({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      prospectId,
      contactId: jane.id,
      raw: { title: "Hijacked", expectedVersion: 99 },
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.reason).toBe("conflict");
    const row = await prisma.prospectContact.findUniqueOrThrow({
      where: { id: jane.id },
    });
    expect(row.title).toBeNull();
    expect(row.version).toBe(0);
  });

  it("archives and restores a contact without deleting channels or custom values", async () => {
    const { ctx, prospectId, john, jane } = await seedProspectWithContacts();
    const archived = await archiveProspectContact({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      prospectId,
      contactId: john.id,
      expectedVersion: john.version,
    });
    expect(archived.ok).toBe(true);
    const afterArchive = await prisma.prospectContact.findUniqueOrThrow({
      where: { id: john.id },
    });
    expect(afterArchive.lifecycle).toBe("ARCHIVED");
    expect(afterArchive.isPrimary).toBe(false);
    const remainingPrimary = await prisma.prospectContact.count({
      where: { prospectId, isPrimary: true, lifecycle: "ACTIVE" },
    });
    expect(remainingPrimary).toBe(0);
    const denied = await updateProspectContact({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      prospectId,
      contactId: john.id,
      raw: { title: "Nope", expectedVersion: afterArchive.version },
    });
    expect(denied.ok).toBe(false);
    const restored = await restoreProspectContact({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      prospectId,
      contactId: john.id,
      expectedVersion: afterArchive.version,
    });
    expect(restored.ok).toBe(true);
    const afterRestore = await prisma.prospectContact.findUniqueOrThrow({
      where: { id: john.id },
    });
    expect(afterRestore.lifecycle).toBe("ACTIVE");
    expect(afterRestore.isPrimary).toBe(false);
    expect(
      await prisma.prospectContactCustomValue.count({
        where: { contactId: john.id },
      }),
    ).toBe(2);
    expect(jane.isPrimary).toBe(false);
    expect(
      await prisma.organizationAuditEvent.count({
        where: {
          organizationId: ctx.organizationId,
          action: { in: ["CONTACT_ARCHIVED", "CONTACT_RESTORED"] },
        },
      }),
    ).toBe(2);
  });

  it("adds and retires a contact communication point while restoring identity", async () => {
    const { ctx, prospectId, jane } = await seedProspectWithContacts();
    const added = await addProspectChannel({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      prospectId,
      contactId: jane.id,
      expectedVersion: jane.version,
      raw: { kind: "PHONE", value: "+14165554099" },
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const stored = await prisma.prospectChannel.findUniqueOrThrow({
      where: { id: added.channelId },
    });
    expect(stored.normalizedValue).toBe("+14165554099");
    expect(stored.contactId).toBe(jane.id);
    const nextJane = await prisma.prospectContact.findUniqueOrThrow({
      where: { id: jane.id },
    });
    const retired = await archiveProspectChannel({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      prospectId,
      channelId: added.channelId,
      expectedVersion: nextJane.version,
    });
    expect(retired.ok).toBe(true);
    const archived = await prisma.prospectChannel.findUniqueOrThrow({
      where: { id: added.channelId },
    });
    expect(archived.lifecycle).toBe("ARCHIVED");
    const afterArchive = await prisma.prospectContact.findUniqueOrThrow({
      where: { id: jane.id },
    });
    const restored = await addProspectChannel({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      prospectId,
      contactId: jane.id,
      expectedVersion: afterArchive.version,
      raw: { kind: "PHONE", value: "+14165554099" },
    });
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.channelId).toBe(added.channelId);
    expect(
      await prisma.prospectChannel.findUniqueOrThrow({
        where: { id: added.channelId },
      }),
    ).toMatchObject({ lifecycle: "ACTIVE" });
  });

  it("requires contact custom fields on create and add, and preserves them on unrelated edits", async () => {
    const { ctx, prospectId, jane } = await seedProspectWithContacts();
    const missing = await addProspectContact({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      prospectId,
      expectedVersion: 0,
      raw: { firstName: "Sam", lastName: "Lee" },
    });
    expect(missing.ok).toBe(false);
    const added = await addProspectContact({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      prospectId,
      expectedVersion: 0,
      raw: {
        firstName: "Sam",
        lastName: "Lee",
        customValues: [{ definitionKey: "contact_role", value: "Tech" }],
      },
    });
    expect(added.ok).toBe(true);
    const preserved = await updateProspectContact({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      prospectId,
      contactId: jane.id,
      raw: { title: "Coordinator", expectedVersion: jane.version },
    });
    expect(preserved.ok).toBe(true);
    expect(
      await prisma.prospectContactCustomValue.findFirst({
        where: { contactId: jane.id, definitionKey: "contact_role" },
      }),
    ).toMatchObject({ stringValue: "Office" });
  });

  it("denies foreign IDs, members, and keeps audit metadata free of PII", async () => {
    const { ctx, prospectId, jane } = await seedProspectWithContacts();
    const member = await addMember(
      prisma,
      ctx.organizationId,
      "p-contacts-member",
      "MEMBER",
    );
    const other = await createOrgWithOwner(prisma, "p-contacts-b");
    const memberUpdate = await updateProspectContact({
      actor: member,
      organizationId: ctx.organizationId,
      prospectId,
      contactId: jane.id,
      raw: { title: "Denied", expectedVersion: jane.version },
    });
    expect(memberUpdate.ok).toBe(false);
    const memberRead = await getProspect({
      actor: member,
      organizationId: ctx.organizationId,
      prospectId,
    });
    expect(memberRead.ok).toBe(true);
    if (memberRead.ok) expect(memberRead.prospect.canManage).toBe(false);
    const foreign = await updateProspectContact({
      actor: other.owner,
      organizationId: other.organizationId,
      prospectId,
      contactId: jane.id,
      raw: { title: "Stolen", expectedVersion: jane.version },
    });
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.reason).toBe("not_found");
    const missing = await archiveProspectContact({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      prospectId,
      contactId: "clmissingcontact00000000000",
      expectedVersion: 0,
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toBe("not_found");
    const events = await prisma.organizationAuditEvent.findMany({
      where: { organizationId: ctx.organizationId },
    });
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("keep");
    expect(serialized).not.toContain("Owner");
    expect(serialized).not.toContain("John Smith");
  });

  it("serializes concurrent contact updates and archive-vs-update races", async () => {
    const { ctx, prospectId, jane } = await seedProspectWithContacts();
    const firstHeld = createGate();
    const secondBefore = createGate();
    const first = updateProspectContact(
      {
        actor: ctx.owner,
        organizationId: ctx.organizationId,
        prospectId,
        contactId: jane.id,
        raw: { title: "First", expectedVersion: jane.version },
      },
      {
        testAfterProspectLock: async () => {
          firstHeld.markReached();
          await firstHeld.waitForRelease();
        },
      },
    );
    await firstHeld.waitUntilReached();
    const second = updateProspectContact(
      {
        actor: ctx.owner,
        organizationId: ctx.organizationId,
        prospectId,
        contactId: jane.id,
        raw: { title: "Second", expectedVersion: jane.version },
      },
      {
        testBeforeProspectLock: async () => {
          secondBefore.markReached();
        },
      },
    );
    await secondBefore.waitUntilReached();
    firstHeld.release();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect([firstResult.ok, secondResult.ok].filter(Boolean)).toHaveLength(1);
    const row = await prisma.prospectContact.findUniqueOrThrow({
      where: { id: jane.id },
    });
    expect(["First", "Second"]).toContain(row.title);

    const current = await prisma.prospectContact.findUniqueOrThrow({
      where: { id: jane.id },
    });
    const archiveHeld = createGate();
    const updateBefore = createGate();
    const archive = archiveProspectContact(
      {
        actor: ctx.owner,
        organizationId: ctx.organizationId,
        prospectId,
        contactId: jane.id,
        expectedVersion: current.version,
      },
      {
        testAfterProspectLock: async () => {
          archiveHeld.markReached();
          await archiveHeld.waitForRelease();
        },
      },
    );
    await archiveHeld.waitUntilReached();
    const racingUpdate = updateProspectContact(
      {
        actor: ctx.owner,
        organizationId: ctx.organizationId,
        prospectId,
        contactId: jane.id,
        raw: { title: "Race", expectedVersion: current.version },
      },
      {
        testBeforeProspectLock: async () => {
          updateBefore.markReached();
        },
      },
    );
    await updateBefore.waitUntilReached();
    archiveHeld.release();
    const [archiveResult, raceUpdate] = await Promise.all([
      archive,
      racingUpdate,
    ]);
    expect([archiveResult.ok, raceUpdate.ok].filter(Boolean)).toHaveLength(1);
  });
});
