import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createCustomField } from "@/lib/orgs/custom-fields";
import {
  addProspectChannel,
  addProspectContact,
  archiveProspect,
  createProspect,
  getProspect,
  listProspects,
  restoreProspect,
  updateProspect,
  updateProspectContact,
} from "@/lib/orgs/prospects";
import {
  addInactiveMember,
  addMember,
  createOrgWithOwner,
  createVerifiedActor,
} from "@/tests/integration/helpers/config-3b";
import { resetApplicationData } from "@/tests/integration/reset";

describe("Phase 5A prospect core", () => {
  const prisma = new PrismaClient();

  beforeEach(async () => {
    await resetApplicationData(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates business and individual prospects with contacts and channels", async () => {
    const ctx = await createOrgWithOwner(prisma, "p-create");
    const business = await createProspect({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: {
        kind: "BUSINESS",
        displayName: "ABC Plumbing",
        website: "abcplumbing.ca",
        locationLabel: "Toronto, ON",
        contacts: [
          {
            firstName: "John",
            lastName: "Smith",
            title: "Owner",
            isPrimary: true,
            channels: [
              { kind: "PHONE", label: "work", value: "+14165551001" },
              { kind: "EMAIL", value: "John@AbcPlumbing.CA" },
            ],
          },
          {
            firstName: "Jane",
            lastName: "Doe",
            title: "Office Manager",
            channels: [
              { kind: "PHONE", label: "mobile", value: "+14165551002" },
            ],
          },
        ],
      },
    });
    expect(business.ok).toBe(true);
    if (!business.ok) return;

    const individual = await createProspect({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: {
        kind: "INDIVIDUAL",
        displayName: "Alex Rivera",
        contacts: [
          {
            firstName: "Alex",
            lastName: "Rivera",
            channels: [{ kind: "EMAIL", value: "alex@example.com" }],
          },
        ],
      },
    });
    expect(individual.ok).toBe(true);

    const detail = await getProspect({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      prospectId: business.prospectId,
    });
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.prospect.contacts).toHaveLength(2);
    expect(detail.prospect.contacts[0]?.displayName).toBe("John Smith");
    expect(
      detail.prospect.contacts.flatMap((contact) => contact.channels),
    ).toHaveLength(3);
    expect(
      await prisma.prospectChannel.findFirst({
        where: { prospectId: business.prospectId, kind: "EMAIL" },
      }),
    ).toMatchObject({
      displayValue: "John@AbcPlumbing.CA",
      normalizedValue: "john@abcplumbing.ca",
    });
    expect(
      await prisma.organizationAuditEvent.count({
        where: {
          organizationId: ctx.organizationId,
          action: { in: ["PROSPECT_CREATED", "CONTACT_CREATED"] },
        },
      }),
    ).toBe(5);
  });

  it("rejects stale updates, archives, and restores with OCC", async () => {
    const ctx = await createOrgWithOwner(prisma, "p-occ");
    const created = await createProspect({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: { displayName: "OCC Prospect" },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const stale = await updateProspect({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      prospectId: created.prospectId,
      raw: { displayName: "Stale", expectedVersion: 99 },
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.reason).toBe("conflict");

    const updated = await updateProspect({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      prospectId: created.prospectId,
      raw: { displayName: "Updated Prospect", expectedVersion: 0 },
    });
    expect(updated.ok).toBe(true);

    const staleArchive = await archiveProspect({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      prospectId: created.prospectId,
      expectedVersion: 0,
    });
    expect(staleArchive.ok).toBe(false);

    const archived = await archiveProspect({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      prospectId: created.prospectId,
      expectedVersion: 1,
    });
    expect(archived.ok).toBe(true);

    const listedActive = await listProspects({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      lifecycle: "ACTIVE",
    });
    expect(listedActive.ok && listedActive.items).toHaveLength(0);

    const listedArchived = await listProspects({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      lifecycle: "ARCHIVED",
    });
    expect(listedArchived.ok && listedArchived.items[0]?.id).toBe(
      created.prospectId,
    );

    const child = await addProspectContact({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      prospectId: created.prospectId,
      expectedVersion: 2,
      raw: { firstName: "Pat", lastName: "Lee" },
    });
    expect(child.ok).toBe(false);

    const staleRestore = await restoreProspect({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      prospectId: created.prospectId,
      expectedVersion: 1,
    });
    expect(staleRestore.ok).toBe(false);

    const restored = await restoreProspect({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      prospectId: created.prospectId,
      expectedVersion: 2,
    });
    expect(restored.ok).toBe(true);

    const contact = await addProspectContact({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      prospectId: created.prospectId,
      expectedVersion: 3,
      raw: { firstName: "Kim", lastName: "Ng" },
    });
    expect(contact.ok).toBe(true);
    if (!contact.ok) return;
    const staleContact = await updateProspectContact({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      prospectId: created.prospectId,
      contactId: contact.contactId,
      raw: { firstName: "Kim", lastName: "Ng", expectedVersion: 9 },
    });
    expect(staleContact.ok).toBe(false);
    const after = await getProspect({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      prospectId: created.prospectId,
    });
    expect(after.ok && after.prospect.lifecycle).toBe("ACTIVE");
    expect(after.ok && after.prospect.id).toBe(created.prospectId);
  });

  it("warns on duplicate phone/email without auto-merging", async () => {
    const ctx = await createOrgWithOwner(prisma, "p-dup");
    const first = await createProspect({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: {
        displayName: "ABC Plumbing",
        contacts: [
          {
            firstName: "John",
            lastName: "Smith",
            channels: [
              { kind: "PHONE", value: "+14165551999" },
              { kind: "EMAIL", value: "office@abcplumbing.ca" },
            ],
          },
        ],
      },
    });
    expect(first.ok).toBe(true);

    const phoneDup = await createProspect({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: {
        displayName: "ABC Plumbing Inc.",
        contacts: [
          {
            firstName: "John",
            lastName: "Smith",
            channels: [
              { kind: "PHONE", value: "+14165551999", isPrimary: true },
            ],
          },
        ],
      },
    });
    expect(phoneDup.ok).toBe(false);
    if (!phoneDup.ok) {
      expect(phoneDup.reason).toBe("duplicate_candidates");
      expect(phoneDup.candidates?.[0]?.reasons).toContain("phone");
    }

    const continued = await createProspect({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: {
        displayName: "ABC Plumbing Inc.",
        website: "abcplumbing.com",
        acknowledgeDuplicates: true,
        contacts: [
          {
            firstName: "John",
            lastName: "Smith",
            channels: [{ kind: "PHONE", value: "+14165551999" }],
          },
        ],
      },
    });
    expect(continued.ok).toBe(true);
    expect(
      await prisma.prospect.count({
        where: { organizationId: ctx.organizationId },
      }),
    ).toBe(2);
  });

  it("searches and paginates deterministically with tenant isolation", async () => {
    const ctx = await createOrgWithOwner(prisma, "p-search");
    const other = await createOrgWithOwner(prisma, "p-search-b");
    for (let index = 0; index < 3; index += 1) {
      const created = await createProspect({
        actor: ctx.owner,
        organizationId: ctx.organizationId,
        raw: {
          displayName: `Acme ${index}`,
          contacts: [
            {
              firstName: "Casey",
              lastName: `Number${index}`,
              channels: [
                { kind: "PHONE", value: `+1416555200${index}` },
                { kind: "EMAIL", value: `casey${index}@acme.test` },
              ],
            },
          ],
        },
      });
      expect(created.ok).toBe(true);
    }
    await createProspect({
      actor: other.owner,
      organizationId: other.organizationId,
      raw: { displayName: "Acme foreign" },
    });

    const byName = await listProspects({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      query: "Acme",
    });
    expect(byName.ok && byName.items).toHaveLength(3);

    const byContact = await listProspects({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      query: "Number1",
    });
    expect(byContact.ok && byContact.items).toHaveLength(1);

    const byPhone = await listProspects({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      query: "+14165552002",
    });
    expect(byPhone.ok && byPhone.items[0]?.displayName).toBe("Acme 2");

    const byEmail = await listProspects({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      query: "casey0@acme.test",
    });
    expect(byEmail.ok && byEmail.items[0]?.displayName).toBe("Acme 0");

    const page1 = await listProspects({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      page: 1,
      pageSize: 2,
    });
    const page2 = await listProspects({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      page: 2,
      pageSize: 2,
    });
    expect(page1.ok).toBe(true);
    expect(page2.ok).toBe(true);
    if (!page1.ok || !page2.ok) return;
    expect(page1.items).toHaveLength(2);
    expect(page2.items).toHaveLength(1);
    expect(page1.items[0]?.id).not.toBe(page2.items[0]?.id);

    const isolated = await listProspects({
      actor: other.owner,
      organizationId: other.organizationId,
      query: "Acme",
    });
    expect(isolated.ok && isolated.items).toHaveLength(1);
    expect(isolated.ok && isolated.items[0]?.displayName).toBe("Acme foreign");
  });

  it("enforces custom-field target, type, and tenant boundaries", async () => {
    const ctx = await createOrgWithOwner(prisma, "p-cf");
    const other = await createOrgWithOwner(prisma, "p-cf-b");
    const prospectField = await createCustomField({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: {
        key: "job_size",
        label: "Job size",
        dataType: "TEXT",
        scope: "PROSPECT",
      },
    });
    const offeringField = await createCustomField({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: {
        key: "sku_note",
        label: "SKU note",
        dataType: "TEXT",
        scope: "OFFERING",
      },
    });
    expect(prospectField.ok && offeringField.ok).toBe(true);

    const valid = await createProspect({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: {
        displayName: "Custom prospect",
        customValues: [{ definitionKey: "job_size", value: "large" }],
      },
    });
    expect(valid.ok).toBe(true);

    const wrongTarget = await createProspect({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: {
        displayName: "Wrong target",
        customValues: [{ definitionKey: "sku_note", value: "nope" }],
      },
    });
    expect(wrongTarget.ok).toBe(false);

    const foreign = await createProspect({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: {
        displayName: "Foreign field",
        customValues: [{ definitionKey: "missing", value: "nope" }],
      },
    });
    expect(foreign.ok).toBe(false);

    const otherField = await createCustomField({
      actor: other.owner,
      organizationId: other.organizationId,
      raw: {
        key: "job_size",
        label: "Other",
        dataType: "TEXT",
        scope: "PROSPECT",
      },
    });
    expect(otherField.ok).toBe(true);
    const crossTenant = await createProspect({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: {
        displayName: "Cross tenant field",
        customValues: [{ definitionKey: "job_size", value: "from-other" }],
      },
    });
    expect(crossTenant.ok).toBe(true);
    if (crossTenant.ok) {
      const stored = await prisma.prospectCustomValue.findMany({
        where: { prospectId: crossTenant.prospectId },
      });
      expect(stored[0]?.organizationId).toBe(ctx.organizationId);
    }
  });

  it("authorizes owner and admin, denies member, inactive, and foreign IDs", async () => {
    const ctx = await createOrgWithOwner(prisma, "p-auth");
    const admin = await addMember(
      prisma,
      ctx.organizationId,
      "p-auth-admin",
      "ADMIN",
    );
    const member = await addMember(
      prisma,
      ctx.organizationId,
      "p-auth-member",
      "MEMBER",
    );
    const inactive = await addInactiveMember(
      prisma,
      ctx.organizationId,
      "p-auth-inactive",
      "ADMIN",
    );
    const stranger = await createVerifiedActor(prisma, "p-auth-stranger");
    const other = await createOrgWithOwner(prisma, "p-auth-b");

    const created = await createProspect({
      actor: admin,
      organizationId: ctx.organizationId,
      raw: { displayName: "Auth prospect" },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const memberCreate = await createProspect({
      actor: member,
      organizationId: ctx.organizationId,
      raw: { displayName: "Denied" },
    });
    expect(memberCreate.ok).toBe(false);

    const memberRead = await getProspect({
      actor: member,
      organizationId: ctx.organizationId,
      prospectId: created.prospectId,
    });
    expect(memberRead.ok).toBe(true);

    const inactiveCreate = await createProspect({
      actor: inactive,
      organizationId: ctx.organizationId,
      raw: { displayName: "Inactive" },
    });
    expect(inactiveCreate.ok).toBe(false);

    const foreign = await getProspect({
      actor: other.owner,
      organizationId: other.organizationId,
      prospectId: created.prospectId,
    });
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.reason).toBe("not_found");

    const forgedOrg = await getProspect({
      actor: stranger,
      organizationId: ctx.organizationId,
      prospectId: created.prospectId,
    });
    expect(forgedOrg.ok).toBe(false);

    const contact = await addProspectContact({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      prospectId: created.prospectId,
      expectedVersion: 0,
      raw: { firstName: "Sam", lastName: "Lee" },
    });
    expect(contact.ok).toBe(true);
    if (!contact.ok) return;
    const foreignContact = await updateProspectContact({
      actor: other.owner,
      organizationId: other.organizationId,
      prospectId: created.prospectId,
      contactId: contact.contactId,
      raw: { firstName: "Sam", lastName: "Stolen", expectedVersion: 0 },
    });
    expect(foreignContact.ok).toBe(false);
  });

  it("keeps audit metadata free of contact payloads", async () => {
    const ctx = await createOrgWithOwner(prisma, "p-audit");
    const created = await createProspect({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: {
        displayName: "Audit prospect",
        contacts: [
          {
            firstName: "Secret",
            lastName: "Person",
            channels: [{ kind: "EMAIL", value: "secret.person@example.com" }],
          },
        ],
      },
    });
    expect(created.ok).toBe(true);
    const events = await prisma.organizationAuditEvent.findMany({
      where: { organizationId: ctx.organizationId },
    });
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("secret.person@example.com");
    expect(serialized).not.toContain("Secret Person");
  });

  it("rejects invalid phone and email channels", async () => {
    const ctx = await createOrgWithOwner(prisma, "p-invalid");
    const created = await createProspect({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: { displayName: "Channels" },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const badPhone = await addProspectChannel({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      prospectId: created.prospectId,
      expectedVersion: 0,
      raw: { kind: "PHONE", value: "abc" },
    });
    expect(badPhone.ok).toBe(false);
    const badEmail = await addProspectChannel({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      prospectId: created.prospectId,
      expectedVersion: 0,
      raw: { kind: "EMAIL", value: "not-valid" },
    });
    expect(badEmail.ok).toBe(false);
  });
});
