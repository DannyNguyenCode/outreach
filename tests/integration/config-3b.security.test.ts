import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { SafeUser } from "@/lib/auth/users";
import { resetServerEnvCache } from "@/lib/env/server";
import { setMailerForTests, type EmailSender } from "@/lib/email/mailer";
import { selectBusinessTemplate } from "@/lib/orgs/business-templates";
import { createCustomField, updateCustomField } from "@/lib/orgs/custom-fields";
import { startConfigProgress } from "@/lib/orgs/config-progress";
import { updateLocaleSettings } from "@/lib/orgs/locale-settings";
import { changeMemberRole, deactivateMember } from "@/lib/orgs/memberships";
import { updateCallbackPolicy } from "@/lib/orgs/operational-defaults";
import { createServiceArea } from "@/lib/orgs/service-areas";
import {
  addInactiveMember,
  addMember,
  countConfig3bAudits,
  createGate,
  createOrgWithOwner,
  createUnverifiedActor,
  createVerifiedActor,
  seedPhase3aCompletedOrg,
} from "@/tests/integration/helpers/config-3b";
import { resetApplicationData } from "@/tests/integration/reset";

const mockMailer: EmailSender = {
  async send() {},
};

describe("Phase 3B security and auth races", () => {
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

  it("rejects missing / unauthenticated actors", async () => {
    const { organizationId } = await createOrgWithOwner(prisma, "sec-missing");
    const missingActor: SafeUser = {
      id: "missing-actor-id-that-does-not-exist",
      name: "Missing",
      email: "missing@example.com",
      emailVerifiedAt: new Date(),
      sessionVersion: 0,
      activeOrganizationId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await selectBusinessTemplate({
      actor: missingActor,
      organizationId,
      raw: { templateKey: "CUSTOM_MIXED" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(["not_a_member", "unauthenticated", "forbidden"]).toContain(
        result.reason,
      );
    }
    expect(
      await prisma.organizationTemplateAssignment.findUnique({
        where: { organizationId },
      }),
    ).toBeNull();
  });

  it("rejects unverified actors", async () => {
    const { organizationId } = await createOrgWithOwner(prisma, "sec-unv");
    const unverified = await createUnverifiedActor(prisma, "sec-unv-user");
    await prisma.membership.create({
      data: {
        organizationId,
        userId: unverified.id,
        role: "OWNER",
        status: "ACTIVE",
      },
    });

    const result = await selectBusinessTemplate({
      actor: unverified,
      organizationId,
      raw: { templateKey: "CUSTOM_MIXED" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unverified");
    expect(await countConfig3bAudits(prisma, organizationId)).toBe(0);
  });

  it("rejects inactive membership", async () => {
    const { organizationId } = await createOrgWithOwner(prisma, "sec-inact");
    const inactive = await addInactiveMember(
      prisma,
      organizationId,
      "sec-inact-admin",
    );
    const result = await startConfigProgress({
      actor: inactive,
      organizationId,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(["inactive_membership", "forbidden"]).toContain(result.reason);
    }
  });

  it("MEMBER role cannot manage Phase 3B config", async () => {
    const seeded = await seedPhase3aCompletedOrg(prisma, {
      prefix: "sec-mem",
      startProgress: true,
    });
    const member = await addMember(prisma, seeded.organizationId, "sec-member");

    const locale = await prisma.organizationLocaleSettings.findUniqueOrThrow({
      where: { organizationId: seeded.organizationId },
    });
    const denied = await updateLocaleSettings({
      actor: member,
      organizationId: seeded.organizationId,
      expectedVersion: locale.version,
      raw: {
        locale: "en-US",
        defaultLanguage: "en",
        dateDisplayPreference: "locale",
        timeDisplayPreference: "locale",
        numberDisplayPreference: "locale",
      },
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.reason).toBe("forbidden");
  });

  it("rejects non-members", async () => {
    const { organizationId } = await createOrgWithOwner(prisma, "sec-nm");
    const stranger = await createVerifiedActor(prisma, "sec-stranger");
    const result = await createServiceArea({
      actor: stranger,
      organizationId,
      raw: { label: "Nope" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not_a_member");
  });

  it("rejects cross-tenant org id usage", async () => {
    const a = await seedPhase3aCompletedOrg(prisma, {
      prefix: "sec-x-a",
      startProgress: true,
    });
    const b = await seedPhase3aCompletedOrg(prisma, {
      prefix: "sec-x-b",
      startProgress: true,
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

  it("rejects foreign resource IDs", async () => {
    const a = await createOrgWithOwner(prisma, "sec-fr-a");
    const b = await createOrgWithOwner(prisma, "sec-fr-b");
    const foreign = await createCustomField({
      actor: b.owner,
      organizationId: b.organizationId,
      raw: { key: "foreign_key", label: "Foreign", dataType: "TEXT" },
    });
    expect(foreign.ok).toBe(true);
    if (!foreign.ok) return;

    const denied = await updateCustomField({
      actor: a.owner,
      organizationId: a.organizationId,
      fieldId: foreign.field.id,
      expectedVersion: foreign.field.version,
      raw: { label: "Stolen" },
    });
    expect(denied.ok).toBe(false);

    const row = await prisma.customFieldDefinition.findUniqueOrThrow({
      where: { id: foreign.field.id },
    });
    expect(row.label).toBe("Foreign");
  });

  it("ignores forged organization/user/role fields in raw payloads", async () => {
    const seeded = await seedPhase3aCompletedOrg(prisma, {
      prefix: "sec-forge",
      startProgress: true,
    });
    const other = await createOrgWithOwner(prisma, "sec-forge-other");
    const policy = await prisma.organizationCallbackPolicy.findUniqueOrThrow({
      where: { organizationId: seeded.organizationId },
    });

    const result = await updateCallbackPolicy({
      actor: seeded.owner,
      organizationId: seeded.organizationId,
      expectedVersion: policy.version,
      raw: {
        defaultWindowMinutes: 75,
        maxSuggestedAttempts: 3,
        minSpacingMinutes: 120,
        businessHoursOnly: true,
        defaultAssignmentBehavior: "UNASSIGNED",
        organizationId: other.organizationId,
        userId: other.owner.id,
        role: "OWNER",
        actorUserId: other.owner.id,
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(
      await prisma.organizationCallbackPolicy.findUnique({
        where: { organizationId: other.organizationId },
      }),
    ).toBeNull();
    const updated = await prisma.organizationCallbackPolicy.findUniqueOrThrow({
      where: { organizationId: seeded.organizationId },
    });
    expect(updated.defaultWindowMinutes).toBe(75);
  });

  it("demotion-first prevents mutation with zero Phase 3B writes", async () => {
    const { owner, organizationId } = await createOrgWithOwner(
      prisma,
      "sec-dem1",
    );
    const admin = await addMember(
      prisma,
      organizationId,
      "sec-dem1-admin",
      "ADMIN",
    );
    const membership = await prisma.membership.findFirstOrThrow({
      where: { organizationId, userId: admin.id },
    });

    const demotionHeld = createGate();
    const mutationStarted = createGate();

    const demotePromise = changeMemberRole(
      {
        actor: owner,
        organizationId,
        membershipId: membership.id,
        nextRole: "MEMBER",
      },
      {
        testAfterTargetMembershipLock: async () => {
          demotionHeld.markReached();
          await demotionHeld.waitForRelease();
        },
      },
    );

    await demotionHeld.waitUntilReached();

    const mutationPromise = selectBusinessTemplate(
      {
        actor: admin,
        organizationId,
        raw: { templateKey: "CUSTOM_MIXED" },
      },
      {
        testBeforeMembershipLock: async () => {
          mutationStarted.markReached();
        },
      },
    );

    await mutationStarted.waitUntilReached();
    demotionHeld.release();

    const [demoted, mutated] = await Promise.all([
      demotePromise,
      mutationPromise,
    ]);
    expect(demoted.ok).toBe(true);
    expect(mutated.ok).toBe(false);
    if (!mutated.ok) {
      expect(["forbidden", "inactive_membership", "not_a_member"]).toContain(
        mutated.reason,
      );
    }
    expect(
      await prisma.organizationTemplateAssignment.findUnique({
        where: { organizationId },
      }),
    ).toBeNull();
    expect(await countConfig3bAudits(prisma, organizationId)).toBe(0);
  });

  it("mutation-first then demotion commits; later privileged ops fail", async () => {
    const { owner, organizationId } = await createOrgWithOwner(
      prisma,
      "sec-dem2",
    );
    const admin = await addMember(
      prisma,
      organizationId,
      "sec-dem2-admin",
      "ADMIN",
    );
    const membership = await prisma.membership.findFirstOrThrow({
      where: { organizationId, userId: admin.id },
    });

    const mutationHeld = createGate();
    const demotionStarted = createGate();

    const mutationPromise = selectBusinessTemplate(
      {
        actor: admin,
        organizationId,
        raw: { templateKey: "PROFESSIONAL_SERVICES" },
      },
      {
        testAfterMembershipLock: async () => {
          mutationHeld.markReached();
          await mutationHeld.waitForRelease();
        },
      },
    );

    await mutationHeld.waitUntilReached();

    const demotePromise = changeMemberRole(
      {
        actor: owner,
        organizationId,
        membershipId: membership.id,
        nextRole: "MEMBER",
      },
      {
        testBeforeTargetMembershipLock: async () => {
          demotionStarted.markReached();
        },
      },
    );

    await demotionStarted.waitUntilReached();
    mutationHeld.release();

    const [mutated, demoted] = await Promise.all([
      mutationPromise,
      demotePromise,
    ]);
    expect(mutated.ok).toBe(true);
    expect(demoted.ok).toBe(true);

    const later = await selectBusinessTemplate({
      actor: admin,
      organizationId,
      raw: { templateKey: "PRODUCT_BUSINESS" },
    });
    // Already selected → would be conflict if still privileged; as MEMBER → forbidden.
    expect(later.ok).toBe(false);
    if (!later.ok) {
      expect(["forbidden", "conflict"]).toContain(later.reason);
    }

    const role = await prisma.membership.findUniqueOrThrow({
      where: { id: membership.id },
    });
    expect(role.role).toBe("MEMBER");
    expect(
      await prisma.organizationTemplateAssignment.findUnique({
        where: { organizationId },
      }),
    ).not.toBeNull();
  });

  it("deactivation-first prevents mutation with zero writes", async () => {
    const { owner, organizationId } = await createOrgWithOwner(
      prisma,
      "sec-dea1",
    );
    const admin = await addMember(
      prisma,
      organizationId,
      "sec-dea1-admin",
      "ADMIN",
    );
    const membership = await prisma.membership.findFirstOrThrow({
      where: { organizationId, userId: admin.id },
    });

    const deactivationHeld = createGate();
    const mutationStarted = createGate();

    const deactivatePromise = deactivateMember(
      {
        actor: owner,
        organizationId,
        membershipId: membership.id,
      },
      {
        testAfterTargetMembershipLock: async () => {
          deactivationHeld.markReached();
          await deactivationHeld.waitForRelease();
        },
      },
    );

    await deactivationHeld.waitUntilReached();

    const mutationPromise = createCustomField(
      {
        actor: admin,
        organizationId,
        raw: { key: "should_fail", label: "Nope", dataType: "TEXT" },
      },
      {
        testBeforeMembershipLock: async () => {
          mutationStarted.markReached();
        },
      },
    );

    await mutationStarted.waitUntilReached();
    deactivationHeld.release();

    const [deactivated, mutated] = await Promise.all([
      deactivatePromise,
      mutationPromise,
    ]);
    expect(deactivated.ok).toBe(true);
    expect(mutated.ok).toBe(false);
    expect(
      await prisma.customFieldDefinition.count({ where: { organizationId } }),
    ).toBe(0);
  });

  it("mutation-first then deactivation commits; later ops fail", async () => {
    const { owner, organizationId } = await createOrgWithOwner(
      prisma,
      "sec-dea2",
    );
    const admin = await addMember(
      prisma,
      organizationId,
      "sec-dea2-admin",
      "ADMIN",
    );
    const membership = await prisma.membership.findFirstOrThrow({
      where: { organizationId, userId: admin.id },
    });

    const mutationHeld = createGate();
    const deactivationStarted = createGate();

    const mutationPromise = createCustomField(
      {
        actor: admin,
        organizationId,
        raw: { key: "committed_field", label: "Committed", dataType: "TEXT" },
      },
      {
        testAfterMembershipLock: async () => {
          mutationHeld.markReached();
          await mutationHeld.waitForRelease();
        },
      },
    );

    await mutationHeld.waitUntilReached();

    const deactivatePromise = deactivateMember(
      {
        actor: owner,
        organizationId,
        membershipId: membership.id,
      },
      {
        testBeforeTargetMembershipLock: async () => {
          deactivationStarted.markReached();
        },
      },
    );

    await deactivationStarted.waitUntilReached();
    mutationHeld.release();

    const [mutated, deactivated] = await Promise.all([
      mutationPromise,
      deactivatePromise,
    ]);
    expect(mutated.ok).toBe(true);
    expect(deactivated.ok).toBe(true);

    const later = await createCustomField({
      actor: admin,
      organizationId,
      raw: { key: "after_deact", label: "After", dataType: "TEXT" },
    });
    expect(later.ok).toBe(false);

    expect(
      await prisma.customFieldDefinition.count({ where: { organizationId } }),
    ).toBe(1);
  });
});
