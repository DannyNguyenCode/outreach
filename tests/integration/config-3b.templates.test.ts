import { PrismaClient, type BusinessTemplateKey } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { resetServerEnvCache } from "@/lib/env/server";
import { setMailerForTests, type EmailSender } from "@/lib/email/mailer";
import { getTemplateDefinition } from "@/lib/orgs/business-templates-registry";
import {
  confirmTemplateSwitch,
  getTemplateAssignment,
  listAvailableTemplates,
  previewTemplateSwitch,
  selectBusinessTemplate,
  updateTemplateCustomization,
} from "@/lib/orgs/business-templates";
import { BUSINESS_TEMPLATE_KEYS } from "@/lib/orgs/config-3b-validation";
import { createCustomField } from "@/lib/orgs/custom-fields";
import {
  addInactiveMember,
  addMember,
  countConfig3bAudits,
  createGate,
  createOrgWithOwner,
  seedPhase3aCompletedOrg,
  snapshotPhase3aCore,
} from "@/tests/integration/helpers/config-3b";
import { resetApplicationData } from "@/tests/integration/reset";

const mockMailer: EmailSender = {
  async send() {},
};

describe("Phase 3B business templates", () => {
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

  it("selects each of the 6 templates without persisting examples", async () => {
    expect(BUSINESS_TEMPLATE_KEYS).toHaveLength(6);

    for (const templateKey of BUSINESS_TEMPLATE_KEYS) {
      const { owner, organizationId } = await createOrgWithOwner(
        prisma,
        `tpl-${templateKey.slice(0, 8).toLowerCase()}`,
      );
      const definition = getTemplateDefinition(templateKey);

      const selected = await selectBusinessTemplate({
        actor: owner,
        organizationId,
        raw: { templateKey },
      });
      expect(selected.ok).toBe(true);
      if (!selected.ok) return;

      expect(selected.assignment.templateKey).toBe(templateKey);
      expect(selected.assignment.templateDefinitionVersion).toBe(
        definition.version,
      );

      const [services, products, fields, audits] = await Promise.all([
        prisma.businessService.count({ where: { organizationId } }),
        prisma.businessProduct.count({ where: { organizationId } }),
        prisma.customFieldDefinition.count({ where: { organizationId } }),
        countConfig3bAudits(
          prisma,
          organizationId,
          "BUSINESS_TEMPLATE_SELECTED",
        ),
      ]);
      expect(services).toBe(0);
      expect(products).toBe(0);
      expect(fields).toBe(0);
      expect(audits).toBe(1);
      expect(
        definition.exampleServices.length + definition.exampleProducts.length,
      ).toBeGreaterThanOrEqual(0);
    }
  });

  it("updates customization on the current version only", async () => {
    const { owner, organizationId } = await createOrgWithOwner(
      prisma,
      "tpl-custom",
    );
    const selected = await selectBusinessTemplate({
      actor: owner,
      organizationId,
      raw: { templateKey: "PROFESSIONAL_SERVICES" },
    });
    expect(selected.ok).toBe(true);
    if (!selected.ok) return;

    const updated = await updateTemplateCustomization({
      actor: owner,
      organizationId,
      expectedVersion: selected.assignment.version,
      raw: {
        confirmedFieldKeys: ["engagement_type"],
        notes: "Confirmed engagement type suggestion only",
      },
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.assignment.version).toBe(selected.assignment.version + 1);
    expect(updated.assignment.customization).toMatchObject({
      confirmedFieldKeys: ["engagement_type"],
    });
    expect(
      await prisma.customFieldDefinition.count({ where: { organizationId } }),
    ).toBe(0);

    const stale = await updateTemplateCustomization({
      actor: owner,
      organizationId,
      expectedVersion: selected.assignment.version,
      raw: { confirmedFieldKeys: ["target_company_size"], notes: null },
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.reason).toBe("conflict");
  });

  it("rejects missing, malformed, and stale versions on switch/customize", async () => {
    const { owner, organizationId } = await createOrgWithOwner(
      prisma,
      "tpl-ver",
    );
    const selected = await selectBusinessTemplate({
      actor: owner,
      organizationId,
      raw: { templateKey: "HOME_TRADE_SERVICES" },
    });
    expect(selected.ok).toBe(true);
    if (!selected.ok) return;

    const missing = await confirmTemplateSwitch({
      actor: owner,
      organizationId,
      raw: { templateKey: "PRODUCT_BUSINESS" },
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toBe("validation");

    const malformed = await confirmTemplateSwitch({
      actor: owner,
      organizationId,
      raw: {
        templateKey: "PRODUCT_BUSINESS",
        expectedVersion: "not-a-number",
      },
    });
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.reason).toBe("validation");

    const staleSwitch = await confirmTemplateSwitch({
      actor: owner,
      organizationId,
      raw: {
        templateKey: "PRODUCT_BUSINESS",
        expectedVersion: selected.assignment.version + 99,
      },
    });
    expect(staleSwitch.ok).toBe(false);
    if (!staleSwitch.ok) expect(staleSwitch.reason).toBe("conflict");

    const staleCustom = await updateTemplateCustomization({
      actor: owner,
      organizationId,
      expectedVersion: -1,
      raw: { confirmedFieldKeys: [] },
    });
    expect(staleCustom.ok).toBe(false);
    if (!staleCustom.ok) expect(staleCustom.reason).toBe("validation");

    const assignment = await getTemplateAssignment({
      actor: owner,
      organizationId,
    });
    expect(assignment.ok).toBe(true);
    if (!assignment.ok) return;
    expect(assignment.assignment.templateKey).toBe("HOME_TRADE_SERVICES");
    expect(assignment.assignment.version).toBe(selected.assignment.version);
  });

  it("safe switch preview performs no writes", async () => {
    const seeded = await seedPhase3aCompletedOrg(prisma, {
      prefix: "tpl-prev",
      startProgress: false,
    });
    const selected = await selectBusinessTemplate({
      actor: seeded.owner,
      organizationId: seeded.organizationId,
      raw: { templateKey: "PROFESSIONAL_SERVICES" },
    });
    expect(selected.ok).toBe(true);
    if (!selected.ok) return;

    await createCustomField({
      actor: seeded.owner,
      organizationId: seeded.organizationId,
      raw: {
        key: "engagement_type",
        label: "Engagement type",
        dataType: "SINGLE_SELECT",
        scope: "OFFERING",
        options: ["Project", "Retainer"],
      },
    });

    const beforeAudits = await countConfig3bAudits(
      prisma,
      seeded.organizationId,
    );
    const beforeCore = await snapshotPhase3aCore(prisma, seeded.organizationId);
    const beforeAssignment =
      await prisma.organizationTemplateAssignment.findUniqueOrThrow({
        where: { organizationId: seeded.organizationId },
      });

    const preview = await previewTemplateSwitch({
      actor: seeded.owner,
      organizationId: seeded.organizationId,
      templateKey: "PRODUCT_BUSINESS",
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.preview.fromKey).toBe("PROFESSIONAL_SERVICES");
    expect(preview.preview.toKey).toBe("PRODUCT_BUSINESS");
    expect(preview.preview.retainedCustomFields.length).toBe(1);

    const afterAssignment =
      await prisma.organizationTemplateAssignment.findUniqueOrThrow({
        where: { organizationId: seeded.organizationId },
      });
    expect(afterAssignment.version).toBe(beforeAssignment.version);
    expect(afterAssignment.templateKey).toBe(beforeAssignment.templateKey);
    expect(await countConfig3bAudits(prisma, seeded.organizationId)).toBe(
      beforeAudits,
    );
    expect(await snapshotPhase3aCore(prisma, seeded.organizationId)).toEqual(
      beforeCore,
    );
  });

  it("confirmed switch preserves services, products, and custom fields", async () => {
    const seeded = await seedPhase3aCompletedOrg(prisma, {
      prefix: "tpl-sw",
      businessType: "BOTH",
    });
    await selectBusinessTemplate({
      actor: seeded.owner,
      organizationId: seeded.organizationId,
      raw: { templateKey: "CUSTOM_MIXED" },
    });
    const field = await createCustomField({
      actor: seeded.owner,
      organizationId: seeded.organizationId,
      raw: {
        key: "priority_note",
        label: "Priority note",
        dataType: "TEXT",
        scope: "PROSPECT",
      },
    });
    expect(field.ok).toBe(true);
    if (!field.ok) return;

    const before = await snapshotPhase3aCore(prisma, seeded.organizationId);
    const assignment =
      await prisma.organizationTemplateAssignment.findUniqueOrThrow({
        where: { organizationId: seeded.organizationId },
      });

    const switched = await confirmTemplateSwitch({
      actor: seeded.owner,
      organizationId: seeded.organizationId,
      raw: {
        templateKey: "APPOINTMENT_BASED",
        expectedVersion: assignment.version,
      },
    });
    expect(switched.ok).toBe(true);
    if (!switched.ok) return;
    expect(switched.assignment.templateKey).toBe("APPOINTMENT_BASED");

    const after = await snapshotPhase3aCore(prisma, seeded.organizationId);
    expect(after.serviceIds).toEqual(before.serviceIds);
    expect(after.productIds).toEqual(before.productIds);
    expect(
      await prisma.customFieldDefinition.findMany({
        where: { organizationId: seeded.organizationId },
        select: { id: true, key: true },
      }),
    ).toEqual([{ id: field.field.id, key: "priority_note" }]);
  });

  it("rolls back switch on optimistic conflict", async () => {
    const { owner, organizationId } = await createOrgWithOwner(
      prisma,
      "tpl-rb",
    );
    const selected = await selectBusinessTemplate({
      actor: owner,
      organizationId,
      raw: { templateKey: "SUBSCRIPTIONS_PLANS" },
    });
    expect(selected.ok).toBe(true);
    if (!selected.ok) return;

    const first = await confirmTemplateSwitch({
      actor: owner,
      organizationId,
      raw: {
        templateKey: "PRODUCT_BUSINESS",
        expectedVersion: selected.assignment.version,
      },
    });
    expect(first.ok).toBe(true);

    const second = await confirmTemplateSwitch({
      actor: owner,
      organizationId,
      raw: {
        templateKey: "CUSTOM_MIXED",
        expectedVersion: selected.assignment.version,
      },
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("conflict");

    const assignment =
      await prisma.organizationTemplateAssignment.findUniqueOrThrow({
        where: { organizationId },
      });
    expect(assignment.templateKey).toBe("PRODUCT_BUSINESS");
    expect(
      await countConfig3bAudits(
        prisma,
        organizationId,
        "BUSINESS_TEMPLATE_SWITCHED",
      ),
    ).toBe(1);
  });

  it("denies cross-tenant template assignment mutations", async () => {
    const a = await createOrgWithOwner(prisma, "tpl-a");
    const b = await createOrgWithOwner(prisma, "tpl-b");
    await selectBusinessTemplate({
      actor: a.owner,
      organizationId: a.organizationId,
      raw: { templateKey: "PROFESSIONAL_SERVICES" },
    });

    const denied = await selectBusinessTemplate({
      actor: a.owner,
      organizationId: b.organizationId,
      raw: { templateKey: "PRODUCT_BUSINESS" },
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(["not_a_member", "forbidden"]).toContain(denied.reason);
    }

    expect(
      await prisma.organizationTemplateAssignment.findUnique({
        where: { organizationId: b.organizationId },
      }),
    ).toBeNull();
  });

  it("concurrent same-version selection: exactly one winner", async () => {
    const { owner, organizationId } = await createOrgWithOwner(
      prisma,
      "tpl-race",
    );
    const aHeld = createGate();
    const bStarted = createGate();
    const bGotLock = createGate();

    const keys: BusinessTemplateKey[] = [
      "PROFESSIONAL_SERVICES",
      "HOME_TRADE_SERVICES",
    ];

    const firstPromise = selectBusinessTemplate(
      {
        actor: owner,
        organizationId,
        raw: { templateKey: keys[0] },
      },
      {
        testAfterConfig3bLock: async () => {
          aHeld.markReached();
          await aHeld.waitForRelease();
        },
      },
    );

    await aHeld.waitUntilReached();

    const secondPromise = selectBusinessTemplate(
      {
        actor: owner,
        organizationId,
        raw: { templateKey: keys[1] },
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
    const outcomes = [first, second];
    expect(outcomes.filter((r) => r.ok).length).toBe(1);
    expect(
      outcomes.filter((r) => !r.ok && r.reason === "conflict").length,
    ).toBe(1);

    const assignment =
      await prisma.organizationTemplateAssignment.findUniqueOrThrow({
        where: { organizationId },
      });
    expect(keys).toContain(assignment.templateKey);
    expect(
      await countConfig3bAudits(
        prisma,
        organizationId,
        "BUSINESS_TEMPLATE_SELECTED",
      ),
    ).toBe(1);
  });

  it("denies MEMBER and inactive members from managing templates", async () => {
    const { organizationId } = await createOrgWithOwner(prisma, "tpl-auth");
    const member = await addMember(prisma, organizationId, "tpl-member");
    const inactive = await addInactiveMember(
      prisma,
      organizationId,
      "tpl-inactive",
    );

    const memberDenied = await selectBusinessTemplate({
      actor: member,
      organizationId,
      raw: { templateKey: "CUSTOM_MIXED" },
    });
    expect(memberDenied.ok).toBe(false);
    if (!memberDenied.ok) expect(memberDenied.reason).toBe("forbidden");

    const inactiveDenied = await selectBusinessTemplate({
      actor: inactive,
      organizationId,
      raw: { templateKey: "CUSTOM_MIXED" },
    });
    expect(inactiveDenied.ok).toBe(false);
    if (!inactiveDenied.ok) {
      expect(["inactive_membership", "forbidden"]).toContain(
        inactiveDenied.reason,
      );
    }

    const listed = await listAvailableTemplates({
      actor: member,
      organizationId,
    });
    expect(listed.ok).toBe(true);
    if (listed.ok) expect(listed.templates).toHaveLength(6);

    expect(
      await prisma.organizationTemplateAssignment.findUnique({
        where: { organizationId },
      }),
    ).toBeNull();
    expect(await countConfig3bAudits(prisma, organizationId)).toBe(0);
  });
});
