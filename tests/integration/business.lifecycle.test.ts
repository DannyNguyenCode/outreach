import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { hashPassword } from "@/lib/auth/password";
import type { SafeUser } from "@/lib/auth/users";
import { setMailerForTests, type EmailSender } from "@/lib/email/mailer";
import { resetServerEnvCache } from "@/lib/env/server";
import {
  updateBusinessBasics,
  updateContactAndLocation,
} from "@/lib/orgs/business-profile";
import { createBusinessProduct } from "@/lib/orgs/business-products";
import { createBusinessService } from "@/lib/orgs/business-services";
import { changeMemberRole, deactivateMember } from "@/lib/orgs/memberships";
import {
  advanceOnboardingStep,
  completeOrganizationOnboarding,
  reopenOrganizationOnboarding,
  startOrganizationOnboarding,
} from "@/lib/orgs/onboarding";
import { replaceOperatingHours } from "@/lib/orgs/operating-hours";
import { createOrganization } from "@/lib/orgs/organizations";
import { resetApplicationData } from "@/tests/integration/reset";

/**
 * Service-level lifecycle tests for Phase 3A.
 *
 * Server actions require a session; these tests exercise the same mutation path
 * actions orchestrate (`updateBusinessBasics` + optional `progress`, advance,
 * complete, reopen). Action imports are intentionally skipped — without an
 * authenticated session they fail before validation/write and are not useful here.
 */

const mockMailer: EmailSender = {
  async send() {},
};

function createGate() {
  let release!: () => void;
  let reached!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reachedPromise = new Promise<void>((resolve) => {
    reached = resolve;
  });
  return {
    waitUntilReached: () => reachedPromise,
    markReached: reached,
    waitForRelease: () => released,
    release,
  };
}

async function createVerifiedUser(
  prisma: PrismaClient,
  prefix: string,
): Promise<SafeUser> {
  const user = await prisma.user.create({
    data: {
      name: prefix,
      email: `${prefix}-${randomUUID()}@example.com`,
      passwordHash: await hashPassword("CorrectHorseBatteryStaple"),
      emailVerifiedAt: new Date(),
    },
  });
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerifiedAt: user.emailVerifiedAt,
    sessionVersion: user.sessionVersion,
    activeOrganizationId: user.activeOrganizationId,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function defaultWeek() {
  return [
    "MONDAY",
    "TUESDAY",
    "WEDNESDAY",
    "THURSDAY",
    "FRIDAY",
    "SATURDAY",
    "SUNDAY",
  ].map((day) =>
    day === "SATURDAY" || day === "SUNDAY"
      ? { dayOfWeek: day, isClosed: true, sortOrder: 0 }
      : {
          dayOfWeek: day,
          isClosed: false,
          startTime: "09:00",
          endTime: "17:00",
          sortOrder: 0,
        },
  );
}

async function seedReadyConfig(input: {
  prisma: PrismaClient;
  actor: SafeUser;
  organizationId: string;
  businessType?: "SERVICES" | "PRODUCTS" | "BOTH";
}) {
  const businessType = input.businessType ?? "SERVICES";
  await startOrganizationOnboarding({
    actor: input.actor,
    organizationId: input.organizationId,
  });

  const profile = await input.prisma.businessProfile.findUniqueOrThrow({
    where: { organizationId: input.organizationId },
  });
  const basics = await updateBusinessBasics({
    actor: input.actor,
    organizationId: input.organizationId,
    expectedVersion: profile.version,
    raw: {
      displayName: "Ready Biz",
      industry: "Retail",
      businessType,
    },
  });
  if (!basics.ok) throw new Error(`seed basics failed: ${basics.reason}`);

  const profile2 = await input.prisma.businessProfile.findUniqueOrThrow({
    where: { organizationId: input.organizationId },
  });
  const contact = await updateContactAndLocation({
    actor: input.actor,
    organizationId: input.organizationId,
    expectedVersion: profile2.version,
    raw: {
      primaryEmail: "ready@example.com",
      primaryPhone: "4165551234",
      timeZone: "America/Toronto",
      countryCode: "CA",
      city: "Toronto",
    },
  });
  if (!contact.ok) throw new Error(`seed contact failed: ${contact.reason}`);

  const hours = await replaceOperatingHours({
    actor: input.actor,
    organizationId: input.organizationId,
    raw: { intervals: defaultWeek() },
  });
  if (!hours.ok) throw new Error(`seed hours failed: ${hours.reason}`);

  if (businessType === "SERVICES" || businessType === "BOTH") {
    const service = await createBusinessService({
      actor: input.actor,
      organizationId: input.organizationId,
      raw: { name: "Consult" },
    });
    if (!service.ok) throw new Error(`seed service failed: ${service.reason}`);
  }
  if (businessType === "PRODUCTS" || businessType === "BOTH") {
    const product = await createBusinessProduct({
      actor: input.actor,
      organizationId: input.organizationId,
      raw: { name: "Widget", sku: `SKU-${randomUUID().slice(0, 6)}` },
    });
    if (!product.ok) throw new Error(`seed product failed: ${product.reason}`);
  }
}

async function createOrgWithOwner(
  prisma: PrismaClient,
  prefix: string,
  name: string,
) {
  const owner = await createVerifiedUser(prisma, `${prefix}-owner`);
  const org = await createOrganization(owner, {
    name,
    slug: `${prefix}-${randomUUID().slice(0, 8)}`,
  });
  if (!org.ok) throw new Error("org create failed");
  return { owner, organizationId: org.organization.id };
}

async function addAdmin(
  prisma: PrismaClient,
  organizationId: string,
  prefix: string,
) {
  const admin = await createVerifiedUser(prisma, prefix);
  await prisma.membership.create({
    data: {
      organizationId,
      userId: admin.id,
      role: "ADMIN",
      status: "ACTIVE",
    },
  });
  return admin;
}

function onboardingSnapshot(row: {
  status: string;
  currentStep: string;
  completedSteps: unknown;
  version: number;
  isConfigurationReady: boolean;
  completedAt: Date | null;
  completedByUserId: string | null;
  reopenedAt: Date | null;
  reopenedByUserId: string | null;
}) {
  return {
    status: row.status,
    currentStep: row.currentStep,
    completedSteps: row.completedSteps,
    version: row.version,
    isConfigurationReady: row.isConfigurationReady,
    completedAt: row.completedAt?.toISOString() ?? null,
    completedByUserId: row.completedByUserId,
    reopenedAt: row.reopenedAt?.toISOString() ?? null,
    reopenedByUserId: row.reopenedByUserId,
  };
}

describe("Phase 3A lifecycle, atomic progress, and membership auth races", () => {
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

  describe("post-completion immutability and reopen", () => {
    it("rejects advance after completion with already_completed and no field changes", async () => {
      const { owner, organizationId } = await createOrgWithOwner(
        prisma,
        "lc-adv-reject",
        "Lifecycle Advance Reject",
      );
      await seedReadyConfig({
        prisma,
        actor: owner,
        organizationId,
        businessType: "SERVICES",
      });

      const completed = await completeOrganizationOnboarding({
        actor: owner,
        organizationId,
      });
      expect(completed.ok).toBe(true);

      const before = await prisma.organizationOnboarding.findUniqueOrThrow({
        where: { organizationId },
      });
      expect(before.status).toBe("COMPLETED");
      expect(before.currentStep).toBe("REVIEW");
      const beforeSnap = onboardingSnapshot(before);

      const rejectedReview = await advanceOnboardingStep({
        actor: owner,
        organizationId,
        step: "REVIEW",
        expectedVersion: before.version,
      });
      expect(rejectedReview.ok).toBe(false);
      if (!rejectedReview.ok) {
        expect(rejectedReview.reason).toBe("already_completed");
      }

      const rejectedBasics = await advanceOnboardingStep({
        actor: owner,
        organizationId,
        step: "BUSINESS_BASICS",
        expectedVersion: before.version,
      });
      expect(rejectedBasics.ok).toBe(false);
      if (!rejectedBasics.ok) {
        expect(rejectedBasics.reason).toBe("already_completed");
      }

      const after = await prisma.organizationOnboarding.findUniqueOrThrow({
        where: { organizationId },
      });
      expect(onboardingSnapshot(after)).toEqual(beforeSnap);

      expect(
        await prisma.organizationAuditEvent.count({
          where: { organizationId, action: "ONBOARDING_COMPLETED" },
        }),
      ).toBe(1);
      expect(
        await prisma.organizationAuditEvent.count({
          where: { organizationId, action: "ONBOARDING_REOPENED" },
        }),
      ).toBe(0);
    });

    it("reopen restores editability; advance then succeeds", async () => {
      const { owner, organizationId } = await createOrgWithOwner(
        prisma,
        "lc-reopen",
        "Lifecycle Reopen",
      );
      await seedReadyConfig({
        prisma,
        actor: owner,
        organizationId,
        businessType: "SERVICES",
      });

      const completed = await completeOrganizationOnboarding({
        actor: owner,
        organizationId,
      });
      expect(completed.ok).toBe(true);

      const completedRow =
        await prisma.organizationOnboarding.findUniqueOrThrow({
          where: { organizationId },
        });

      const rejected = await advanceOnboardingStep({
        actor: owner,
        organizationId,
        step: "REVIEW",
        expectedVersion: completedRow.version,
      });
      expect(rejected.ok).toBe(false);
      if (!rejected.ok) {
        expect(rejected.reason).toBe("already_completed");
      }

      const reopened = await reopenOrganizationOnboarding({
        actor: owner,
        organizationId,
        expectedVersion: completedRow.version,
      });
      expect(reopened.ok).toBe(true);

      const afterReopen = await prisma.organizationOnboarding.findUniqueOrThrow(
        {
          where: { organizationId },
        },
      );
      expect(afterReopen.status).toBe("IN_PROGRESS");
      expect(afterReopen.version).toBe(completedRow.version + 1);

      expect(
        await prisma.organizationAuditEvent.count({
          where: { organizationId, action: "ONBOARDING_COMPLETED" },
        }),
      ).toBe(1);
      expect(
        await prisma.organizationAuditEvent.count({
          where: { organizationId, action: "ONBOARDING_REOPENED" },
        }),
      ).toBe(1);

      const advanced = await advanceOnboardingStep({
        actor: owner,
        organizationId,
        step: "REVIEW",
        nextStep: "BUSINESS_BASICS",
        expectedVersion: afterReopen.version,
      });
      expect(advanced.ok).toBe(true);

      const afterAdvance =
        await prisma.organizationOnboarding.findUniqueOrThrow({
          where: { organizationId },
        });
      expect(afterAdvance.status).toBe("IN_PROGRESS");
      expect(afterAdvance.version).toBe(afterReopen.version + 1);
      expect(afterAdvance.currentStep).toBe("BUSINESS_BASICS");
      // advanceOnboardingStep does not write its own audit event
      expect(
        await prisma.organizationAuditEvent.count({
          where: { organizationId, action: "ONBOARDING_COMPLETED" },
        }),
      ).toBe(1);
      expect(
        await prisma.organizationAuditEvent.count({
          where: { organizationId, action: "ONBOARDING_REOPENED" },
        }),
      ).toBe(1);
    });

    it("updateBusinessBasics with progress after completion returns already_completed and rolls back profile", async () => {
      const { owner, organizationId } = await createOrgWithOwner(
        prisma,
        "lc-post-progress",
        "Lifecycle Post Progress",
      );
      await seedReadyConfig({
        prisma,
        actor: owner,
        organizationId,
        businessType: "SERVICES",
      });

      const completed = await completeOrganizationOnboarding({
        actor: owner,
        organizationId,
      });
      expect(completed.ok).toBe(true);

      const profileBefore = await prisma.businessProfile.findUniqueOrThrow({
        where: { organizationId },
      });
      const onboardingBefore =
        await prisma.organizationOnboarding.findUniqueOrThrow({
          where: { organizationId },
        });
      const profileAuditsBefore = await prisma.organizationAuditEvent.count({
        where: { organizationId, action: "BUSINESS_PROFILE_UPDATED" },
      });

      const result = await updateBusinessBasics({
        actor: owner,
        organizationId,
        expectedVersion: profileBefore.version,
        raw: {
          displayName: "Should Not Persist",
          industry: "Retail",
          businessType: "SERVICES",
        },
        progress: {
          step: "BUSINESS_BASICS",
          nextStep: "CONTACT_LOCATION",
          expectedVersion: onboardingBefore.version,
        },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("already_completed");
      }

      const profileAfter = await prisma.businessProfile.findUniqueOrThrow({
        where: { organizationId },
      });
      expect(profileAfter.displayName).toBe(profileBefore.displayName);
      expect(profileAfter.version).toBe(profileBefore.version);

      const onboardingAfter =
        await prisma.organizationOnboarding.findUniqueOrThrow({
          where: { organizationId },
        });
      expect(onboardingSnapshot(onboardingAfter)).toEqual(
        onboardingSnapshot(onboardingBefore),
      );

      expect(
        await prisma.organizationAuditEvent.count({
          where: { organizationId, action: "BUSINESS_PROFILE_UPDATED" },
        }),
      ).toBe(profileAuditsBefore);
    });
  });

  describe("atomic progress (config + advance in one transaction)", () => {
    it("missing/malformed onboarding version creates zero writes", async () => {
      const { owner, organizationId } = await createOrgWithOwner(
        prisma,
        "lc-progress-bad",
        "Lifecycle Progress Bad Version",
      );
      await startOrganizationOnboarding({ actor: owner, organizationId });

      const profileBefore = await prisma.businessProfile.findUniqueOrThrow({
        where: { organizationId },
      });
      const onboardingBefore =
        await prisma.organizationOnboarding.findUniqueOrThrow({
          where: { organizationId },
        });
      const profileAuditsBefore = await prisma.organizationAuditEvent.count({
        where: { organizationId, action: "BUSINESS_PROFILE_UPDATED" },
      });

      const result = await updateBusinessBasics({
        actor: owner,
        organizationId,
        expectedVersion: profileBefore.version,
        raw: {
          displayName: "Atomic Fail",
          industry: "Retail",
          businessType: "SERVICES",
        },
        progress: {
          step: "BUSINESS_BASICS",
          nextStep: "CONTACT_LOCATION",
          expectedVersion: "abc" as unknown as number,
        },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("validation");
      }

      const profileAfter = await prisma.businessProfile.findUniqueOrThrow({
        where: { organizationId },
      });
      expect(profileAfter.displayName).toBe(profileBefore.displayName);
      expect(profileAfter.version).toBe(profileBefore.version);

      const onboardingAfter =
        await prisma.organizationOnboarding.findUniqueOrThrow({
          where: { organizationId },
        });
      expect(onboardingSnapshot(onboardingAfter)).toEqual(
        onboardingSnapshot(onboardingBefore),
      );
      expect(
        await prisma.organizationAuditEvent.count({
          where: { organizationId, action: "BUSINESS_PROFILE_UPDATED" },
        }),
      ).toBe(profileAuditsBefore);
    });

    it("stale onboarding version rolls back profile write", async () => {
      const { owner, organizationId } = await createOrgWithOwner(
        prisma,
        "lc-progress-stale",
        "Lifecycle Progress Stale",
      );
      await startOrganizationOnboarding({ actor: owner, organizationId });

      const profileBefore = await prisma.businessProfile.findUniqueOrThrow({
        where: { organizationId },
      });
      const onboardingBefore =
        await prisma.organizationOnboarding.findUniqueOrThrow({
          where: { organizationId },
        });
      const profileAuditsBefore = await prisma.organizationAuditEvent.count({
        where: { organizationId, action: "BUSINESS_PROFILE_UPDATED" },
      });

      const result = await updateBusinessBasics({
        actor: owner,
        organizationId,
        expectedVersion: profileBefore.version,
        raw: {
          displayName: "Should Roll Back",
          industry: "Retail",
          businessType: "SERVICES",
        },
        progress: {
          step: "BUSINESS_BASICS",
          nextStep: "CONTACT_LOCATION",
          expectedVersion: onboardingBefore.version + 99,
        },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("conflict");
      }

      const profileAfter = await prisma.businessProfile.findUniqueOrThrow({
        where: { organizationId },
      });
      expect(profileAfter.displayName).toBe(profileBefore.displayName);
      expect(profileAfter.version).toBe(profileBefore.version);

      const onboardingAfter =
        await prisma.organizationOnboarding.findUniqueOrThrow({
          where: { organizationId },
        });
      expect(onboardingSnapshot(onboardingAfter)).toEqual(
        onboardingSnapshot(onboardingBefore),
      );
      expect(
        await prisma.organizationAuditEvent.count({
          where: { organizationId, action: "BUSINESS_PROFILE_UPDATED" },
        }),
      ).toBe(profileAuditsBefore);
    });

    it("success updates profile and onboarding together", async () => {
      const { owner, organizationId } = await createOrgWithOwner(
        prisma,
        "lc-progress-ok",
        "Lifecycle Progress Ok",
      );
      await startOrganizationOnboarding({ actor: owner, organizationId });

      const profileBefore = await prisma.businessProfile.findUniqueOrThrow({
        where: { organizationId },
      });
      const onboardingBefore =
        await prisma.organizationOnboarding.findUniqueOrThrow({
          where: { organizationId },
        });

      const result = await updateBusinessBasics({
        actor: owner,
        organizationId,
        expectedVersion: profileBefore.version,
        raw: {
          displayName: "Atomic Success Co",
          industry: "Retail",
          businessType: "SERVICES",
        },
        progress: {
          step: "BUSINESS_BASICS",
          nextStep: "CONTACT_LOCATION",
          expectedVersion: onboardingBefore.version,
        },
      });
      expect(result.ok).toBe(true);

      const profileAfter = await prisma.businessProfile.findUniqueOrThrow({
        where: { organizationId },
      });
      expect(profileAfter.displayName).toBe("Atomic Success Co");
      expect(profileAfter.version).toBe(profileBefore.version + 1);

      const onboardingAfter =
        await prisma.organizationOnboarding.findUniqueOrThrow({
          where: { organizationId },
        });
      expect(onboardingAfter.currentStep).toBe("CONTACT_LOCATION");
      expect(onboardingAfter.version).toBe(onboardingBefore.version + 1);
      expect(onboardingAfter.status).toBe("IN_PROGRESS");
      const completedSteps = onboardingAfter.completedSteps as string[];
      expect(completedSteps).toContain("BUSINESS_BASICS");

      expect(
        await prisma.organizationAuditEvent.count({
          where: { organizationId, action: "BUSINESS_PROFILE_UPDATED" },
        }),
      ).toBeGreaterThanOrEqual(1);
    });
  });

  describe("membership lock auth races (demotion / deactivation)", () => {
    it("demotion-first prevents completion", async () => {
      const { owner, organizationId } = await createOrgWithOwner(
        prisma,
        "lc-demote-1st",
        "Lifecycle Demote First",
      );
      const admin = await addAdmin(
        prisma,
        organizationId,
        "lc-demote-1st-admin",
      );
      await seedReadyConfig({
        prisma,
        actor: owner,
        organizationId,
        businessType: "SERVICES",
      });
      const membership = await prisma.membership.findFirstOrThrow({
        where: { organizationId, userId: admin.id },
      });

      const demotionHeld = createGate();
      const completionStarted = createGate();

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

      const completePromise = completeOrganizationOnboarding(
        { actor: admin, organizationId },
        {
          testBeforeMembershipLock: async () => {
            completionStarted.markReached();
          },
        },
      );

      await completionStarted.waitUntilReached();
      demotionHeld.release();

      const demote = await demotePromise;
      const complete = await completePromise;
      expect(demote.ok).toBe(true);
      expect(complete.ok).toBe(false);
      if (!complete.ok) {
        expect(["forbidden", "inactive_membership", "not_a_member"]).toContain(
          complete.reason,
        );
      }

      const role = await prisma.membership.findUniqueOrThrow({
        where: { id: membership.id },
      });
      expect(role.role).toBe("MEMBER");
      expect(
        await prisma.organizationAuditEvent.count({
          where: { organizationId, action: "ONBOARDING_COMPLETED" },
        }),
      ).toBe(0);
    });

    it("completion-first then demotion: complete ok, role becomes MEMBER", async () => {
      const { owner, organizationId } = await createOrgWithOwner(
        prisma,
        "lc-complete-1st-d",
        "Lifecycle Complete Then Demote",
      );
      const admin = await addAdmin(
        prisma,
        organizationId,
        "lc-complete-1st-d-admin",
      );
      await seedReadyConfig({
        prisma,
        actor: owner,
        organizationId,
        businessType: "SERVICES",
      });
      const membership = await prisma.membership.findFirstOrThrow({
        where: { organizationId, userId: admin.id },
      });

      const completionHeld = createGate();
      const demotionStarted = createGate();

      const completePromise = completeOrganizationOnboarding(
        { actor: admin, organizationId },
        {
          testAfterMembershipLock: async () => {
            completionHeld.markReached();
            await completionHeld.waitForRelease();
          },
        },
      );

      await completionHeld.waitUntilReached();

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
      completionHeld.release();

      const complete = await completePromise;
      const demote = await demotePromise;
      expect(complete.ok).toBe(true);
      expect(demote.ok).toBe(true);

      expect(
        await prisma.organizationAuditEvent.count({
          where: { organizationId, action: "ONBOARDING_COMPLETED" },
        }),
      ).toBe(1);

      const role = await prisma.membership.findUniqueOrThrow({
        where: { id: membership.id },
      });
      expect(role.role).toBe("MEMBER");

      const laterComplete = await completeOrganizationOnboarding({
        actor: admin,
        organizationId,
      });
      expect(laterComplete.ok).toBe(false);

      const onboarding = await prisma.organizationOnboarding.findUniqueOrThrow({
        where: { organizationId },
      });
      const laterAdvance = await advanceOnboardingStep({
        actor: admin,
        organizationId,
        step: "REVIEW",
        expectedVersion: onboarding.version,
      });
      expect(laterAdvance.ok).toBe(false);
    });

    it("deactivation-first prevents completion", async () => {
      const { owner, organizationId } = await createOrgWithOwner(
        prisma,
        "lc-deact-1st",
        "Lifecycle Deactivate First",
      );
      const admin = await addAdmin(
        prisma,
        organizationId,
        "lc-deact-1st-admin",
      );
      await seedReadyConfig({
        prisma,
        actor: owner,
        organizationId,
        businessType: "SERVICES",
      });
      const membership = await prisma.membership.findFirstOrThrow({
        where: { organizationId, userId: admin.id },
      });

      const deactivationHeld = createGate();
      const completionStarted = createGate();

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

      const completePromise = completeOrganizationOnboarding(
        { actor: admin, organizationId },
        {
          testBeforeMembershipLock: async () => {
            completionStarted.markReached();
          },
        },
      );

      await completionStarted.waitUntilReached();
      deactivationHeld.release();

      const deactivated = await deactivatePromise;
      const complete = await completePromise;
      expect(deactivated.ok).toBe(true);
      expect(complete.ok).toBe(false);
      if (!complete.ok) {
        expect(["forbidden", "inactive_membership", "not_a_member"]).toContain(
          complete.reason,
        );
      }

      const row = await prisma.membership.findUniqueOrThrow({
        where: { id: membership.id },
      });
      expect(row.status).toBe("INACTIVE");
      expect(
        await prisma.organizationAuditEvent.count({
          where: { organizationId, action: "ONBOARDING_COMPLETED" },
        }),
      ).toBe(0);
    });

    it("completion-first then deactivation: complete ok, membership inactive", async () => {
      const { owner, organizationId } = await createOrgWithOwner(
        prisma,
        "lc-complete-1st-a",
        "Lifecycle Complete Then Deactivate",
      );
      const admin = await addAdmin(
        prisma,
        organizationId,
        "lc-complete-1st-a-admin",
      );
      await seedReadyConfig({
        prisma,
        actor: owner,
        organizationId,
        businessType: "SERVICES",
      });
      const membership = await prisma.membership.findFirstOrThrow({
        where: { organizationId, userId: admin.id },
      });

      const completionHeld = createGate();
      const deactivationStarted = createGate();

      const completePromise = completeOrganizationOnboarding(
        { actor: admin, organizationId },
        {
          testAfterMembershipLock: async () => {
            completionHeld.markReached();
            await completionHeld.waitForRelease();
          },
        },
      );

      await completionHeld.waitUntilReached();

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
      completionHeld.release();

      const complete = await completePromise;
      const deactivated = await deactivatePromise;
      expect(complete.ok).toBe(true);
      expect(deactivated.ok).toBe(true);

      expect(
        await prisma.organizationAuditEvent.count({
          where: { organizationId, action: "ONBOARDING_COMPLETED" },
        }),
      ).toBe(1);

      const row = await prisma.membership.findUniqueOrThrow({
        where: { id: membership.id },
      });
      expect(row.status).toBe("INACTIVE");

      const laterComplete = await completeOrganizationOnboarding({
        actor: admin,
        organizationId,
      });
      expect(laterComplete.ok).toBe(false);
    });

    it("reopen auth race: demotion-first prevents reopen", async () => {
      const { owner, organizationId } = await createOrgWithOwner(
        prisma,
        "lc-reopen-demote",
        "Lifecycle Reopen Demote",
      );
      const admin = await addAdmin(
        prisma,
        organizationId,
        "lc-reopen-demote-admin",
      );
      await seedReadyConfig({
        prisma,
        actor: owner,
        organizationId,
        businessType: "SERVICES",
      });

      const completed = await completeOrganizationOnboarding({
        actor: owner,
        organizationId,
      });
      expect(completed.ok).toBe(true);

      const onboarding = await prisma.organizationOnboarding.findUniqueOrThrow({
        where: { organizationId },
      });
      const membership = await prisma.membership.findFirstOrThrow({
        where: { organizationId, userId: admin.id },
      });

      const demotionHeld = createGate();
      const reopenStarted = createGate();

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

      const reopenPromise = reopenOrganizationOnboarding(
        {
          actor: admin,
          organizationId,
          expectedVersion: onboarding.version,
        },
        {
          testBeforeMembershipLock: async () => {
            reopenStarted.markReached();
          },
        },
      );

      await reopenStarted.waitUntilReached();
      demotionHeld.release();

      const demote = await demotePromise;
      const reopened = await reopenPromise;
      expect(demote.ok).toBe(true);
      expect(reopened.ok).toBe(false);
      if (!reopened.ok) {
        expect(["forbidden", "inactive_membership", "not_a_member"]).toContain(
          reopened.reason,
        );
      }

      const after = await prisma.organizationOnboarding.findUniqueOrThrow({
        where: { organizationId },
      });
      expect(after.status).toBe("COMPLETED");
      expect(after.version).toBe(onboarding.version);
      expect(
        await prisma.organizationAuditEvent.count({
          where: { organizationId, action: "ONBOARDING_REOPENED" },
        }),
      ).toBe(0);

      const role = await prisma.membership.findUniqueOrThrow({
        where: { id: membership.id },
      });
      expect(role.role).toBe("MEMBER");
    });
  });
});
