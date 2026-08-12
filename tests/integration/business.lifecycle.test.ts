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
import { updateOrganizationSettings } from "@/lib/orgs/organization-settings";
import { replaceOperatingHours } from "@/lib/orgs/operating-hours";
import { createOrganization } from "@/lib/orgs/organizations";
import { resetApplicationData } from "@/tests/integration/reset";

/**
 * Service-level lifecycle tests for Phase 3A.
 *
 * Authenticated action-boundary coverage lives in business.actions.test.ts.
 * This file covers service-level lifecycle, atomic progress, and auth races.
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

const basicsRaw = (displayName: string) => ({
  displayName,
  industry: "Retail",
  businessType: "SERVICES" as const,
});

const contactRaw = (email = "contact@example.com") => ({
  primaryEmail: email,
  primaryPhone: "4165551234",
  timeZone: "America/Toronto",
  countryCode: "CA",
  city: "Toronto",
});

const settingsRaw = (overrides?: {
  membersCanViewServices?: boolean;
  membersCanViewProducts?: boolean;
  membersCanViewBusinessInfo?: boolean;
  futureCallingAccessDefault?: "DISABLED" | "STANDARD";
}) => ({
  membersCanViewServices: false,
  membersCanViewProducts: true,
  membersCanViewBusinessInfo: true,
  futureCallingAccessDefault: "DISABLED" as const,
  ...overrides,
});

async function seedAtBasicsStep(
  prisma: PrismaClient,
  actor: SafeUser,
  organizationId: string,
) {
  await startOrganizationOnboarding({ actor, organizationId });
  const profile = await prisma.businessProfile.findUniqueOrThrow({
    where: { organizationId },
  });
  const onboarding = await prisma.organizationOnboarding.findUniqueOrThrow({
    where: { organizationId },
  });
  return { profile, onboarding };
}

async function seedAtContactStep(
  prisma: PrismaClient,
  actor: SafeUser,
  organizationId: string,
) {
  const { profile, onboarding } = await seedAtBasicsStep(
    prisma,
    actor,
    organizationId,
  );
  const result = await updateBusinessBasics({
    actor,
    organizationId,
    expectedVersion: profile.version,
    raw: basicsRaw("Seed Co"),
    progress: {
      step: "BUSINESS_BASICS",
      nextStep: "CONTACT_LOCATION",
      expectedVersion: onboarding.version,
    },
  });
  if (!result.ok) throw new Error(`seed basics: ${result.reason}`);
  const profileAfter = await prisma.businessProfile.findUniqueOrThrow({
    where: { organizationId },
  });
  const onboardingAfter = await prisma.organizationOnboarding.findUniqueOrThrow(
    {
      where: { organizationId },
    },
  );
  return { profile: profileAfter, onboarding: onboardingAfter };
}

async function seedAtHoursStep(
  prisma: PrismaClient,
  actor: SafeUser,
  organizationId: string,
) {
  const { profile, onboarding } = await seedAtContactStep(
    prisma,
    actor,
    organizationId,
  );
  const result = await updateContactAndLocation({
    actor,
    organizationId,
    expectedVersion: profile.version,
    raw: contactRaw(),
    progress: {
      step: "CONTACT_LOCATION",
      nextStep: "OPERATING_HOURS",
      expectedVersion: onboarding.version,
    },
  });
  if (!result.ok) throw new Error(`seed contact: ${result.reason}`);
  const onboardingAfter = await prisma.organizationOnboarding.findUniqueOrThrow(
    {
      where: { organizationId },
    },
  );
  return { onboarding: onboardingAfter };
}

async function seedAtCatalogueStep(
  prisma: PrismaClient,
  actor: SafeUser,
  organizationId: string,
) {
  const { onboarding } = await seedAtHoursStep(prisma, actor, organizationId);
  const result = await replaceOperatingHours({
    actor,
    organizationId,
    raw: { intervals: defaultWeek() },
    progress: {
      step: "OPERATING_HOURS",
      nextStep: "CATALOGUE",
      expectedVersion: onboarding.version,
    },
  });
  if (!result.ok) throw new Error(`seed hours: ${result.reason}`);
  const onboardingAfter = await prisma.organizationOnboarding.findUniqueOrThrow(
    {
      where: { organizationId },
    },
  );
  const settings = await prisma.organizationSettings.findUniqueOrThrow({
    where: { organizationId },
  });
  return { onboarding: onboardingAfter, settings };
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
    describe("business basics", () => {
      it("missing/malformed onboarding version creates zero writes", async () => {
        const { owner, organizationId } = await createOrgWithOwner(
          prisma,
          "lc-progress-bad",
          "Lifecycle Progress Bad Version",
        );
        const { profile: profileBefore, onboarding: onboardingBefore } =
          await seedAtBasicsStep(prisma, owner, organizationId);
        const profileAuditsBefore = await prisma.organizationAuditEvent.count({
          where: { organizationId, action: "BUSINESS_PROFILE_UPDATED" },
        });

        const result = await updateBusinessBasics({
          actor: owner,
          organizationId,
          expectedVersion: profileBefore.version,
          raw: basicsRaw("Atomic Fail"),
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
        const { profile: profileBefore, onboarding: onboardingBefore } =
          await seedAtBasicsStep(prisma, owner, organizationId);
        const profileAuditsBefore = await prisma.organizationAuditEvent.count({
          where: { organizationId, action: "BUSINESS_PROFILE_UPDATED" },
        });

        const result = await updateBusinessBasics({
          actor: owner,
          organizationId,
          expectedVersion: profileBefore.version,
          raw: basicsRaw("Should Roll Back"),
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

      it("progress failure after config write rolls back fully", async () => {
        const { owner, organizationId } = await createOrgWithOwner(
          prisma,
          "lc-progress-fail",
          "Lifecycle Progress Fail",
        );
        const { profile: profileBefore, onboarding: onboardingBefore } =
          await seedAtBasicsStep(prisma, owner, organizationId);
        const profileAuditsBefore = await prisma.organizationAuditEvent.count({
          where: { organizationId, action: "BUSINESS_PROFILE_UPDATED" },
        });

        const result = await updateBusinessBasics(
          {
            actor: owner,
            organizationId,
            expectedVersion: profileBefore.version,
            raw: basicsRaw("Should Roll Back"),
            progress: {
              step: "BUSINESS_BASICS",
              nextStep: "CONTACT_LOCATION",
              expectedVersion: onboardingBefore.version,
            },
          },
          {
            testAfterConfigWriteBeforeProgress: async () => {
              throw new Error("TEST_FORCE_PROGRESS_FAILURE");
            },
          },
        );
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.reason).toBe("failed");
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
        const { profile: profileBefore, onboarding: onboardingBefore } =
          await seedAtBasicsStep(prisma, owner, organizationId);

        const result = await updateBusinessBasics({
          actor: owner,
          organizationId,
          expectedVersion: profileBefore.version,
          raw: basicsRaw("Atomic Success Co"),
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

      it("same-version concurrent progress produces one winner", async () => {
        const { owner, organizationId } = await createOrgWithOwner(
          prisma,
          "lc-progress-conc",
          "Lifecycle Progress Concurrency",
        );
        const admin = await addAdmin(
          prisma,
          organizationId,
          "lc-progress-conc-b",
        );
        const { profile, onboarding } = await seedAtBasicsStep(
          prisma,
          owner,
          organizationId,
        );

        const aHeld = createGate();
        const bStarted = createGate();
        const bGotLock = createGate();

        const aPromise = updateBusinessBasics(
          {
            actor: owner,
            organizationId,
            expectedVersion: profile.version,
            raw: basicsRaw("Winner Basics"),
            progress: {
              step: "BUSINESS_BASICS",
              nextStep: "CONTACT_LOCATION",
              expectedVersion: onboarding.version,
            },
          },
          {
            testAfterReadinessLock: async () => {
              aHeld.markReached();
              await aHeld.waitForRelease();
            },
          },
        );
        await aHeld.waitUntilReached();

        const bPromise = updateBusinessBasics(
          {
            actor: admin,
            organizationId,
            expectedVersion: profile.version,
            raw: basicsRaw("Loser Basics"),
            progress: {
              step: "BUSINESS_BASICS",
              nextStep: "CONTACT_LOCATION",
              expectedVersion: onboarding.version,
            },
          },
          {
            testBeforeReadinessLock: async () => {
              bStarted.markReached();
            },
            testAfterReadinessLock: async () => {
              bGotLock.markReached();
            },
          },
        );
        await bStarted.waitUntilReached();
        aHeld.release();

        const aResult = await aPromise;
        await bGotLock.waitUntilReached();
        const bResult = await bPromise;

        expect(aResult.ok).toBe(true);
        expect(bResult.ok).toBe(false);
        if (!bResult.ok) expect(bResult.reason).toBe("conflict");

        const profileAfter = await prisma.businessProfile.findUniqueOrThrow({
          where: { organizationId },
        });
        expect(profileAfter.displayName).toBe("Winner Basics");
        expect(profileAfter.version).toBe(profile.version + 1);

        const onboardingAfter =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId },
          });
        expect(onboardingAfter.currentStep).toBe("CONTACT_LOCATION");
        expect(onboardingAfter.version).toBe(onboarding.version + 1);

        expect(
          await prisma.organizationAuditEvent.count({
            where: { organizationId, action: "BUSINESS_PROFILE_UPDATED" },
          }),
        ).toBe(1);
      });
    });

    describe("contact and location", () => {
      it("missing/malformed onboarding version creates zero writes", async () => {
        const { owner, organizationId } = await createOrgWithOwner(
          prisma,
          "lc-contact-bad",
          "Lifecycle Contact Bad Version",
        );
        const { profile: profileBefore, onboarding: onboardingBefore } =
          await seedAtContactStep(prisma, owner, organizationId);
        const profileAuditsBefore = await prisma.organizationAuditEvent.count({
          where: { organizationId, action: "BUSINESS_PROFILE_UPDATED" },
        });

        const result = await updateContactAndLocation({
          actor: owner,
          organizationId,
          expectedVersion: profileBefore.version,
          raw: contactRaw("bad@example.com"),
          progress: {
            step: "CONTACT_LOCATION",
            nextStep: "OPERATING_HOURS",
            expectedVersion: "abc" as unknown as number,
          },
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toBe("validation");

        const profileAfter = await prisma.businessProfile.findUniqueOrThrow({
          where: { organizationId },
        });
        expect(profileAfter.primaryEmail).toBe(profileBefore.primaryEmail);
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
          "lc-contact-stale",
          "Lifecycle Contact Stale",
        );
        const { profile: profileBefore, onboarding: onboardingBefore } =
          await seedAtContactStep(prisma, owner, organizationId);
        const profileAuditsBefore = await prisma.organizationAuditEvent.count({
          where: { organizationId, action: "BUSINESS_PROFILE_UPDATED" },
        });

        const result = await updateContactAndLocation({
          actor: owner,
          organizationId,
          expectedVersion: profileBefore.version,
          raw: contactRaw("stale@example.com"),
          progress: {
            step: "CONTACT_LOCATION",
            nextStep: "OPERATING_HOURS",
            expectedVersion: onboardingBefore.version + 99,
          },
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toBe("conflict");

        const profileAfter = await prisma.businessProfile.findUniqueOrThrow({
          where: { organizationId },
        });
        expect(profileAfter.primaryEmail).toBe(profileBefore.primaryEmail);
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

      it("progress failure after config write rolls back fully", async () => {
        const { owner, organizationId } = await createOrgWithOwner(
          prisma,
          "lc-contact-fail",
          "Lifecycle Contact Fail",
        );
        const { profile: profileBefore, onboarding: onboardingBefore } =
          await seedAtContactStep(prisma, owner, organizationId);
        const profileAuditsBefore = await prisma.organizationAuditEvent.count({
          where: { organizationId, action: "BUSINESS_PROFILE_UPDATED" },
        });

        const result = await updateContactAndLocation(
          {
            actor: owner,
            organizationId,
            expectedVersion: profileBefore.version,
            raw: contactRaw("fail@example.com"),
            progress: {
              step: "CONTACT_LOCATION",
              nextStep: "OPERATING_HOURS",
              expectedVersion: onboardingBefore.version,
            },
          },
          {
            testAfterConfigWriteBeforeProgress: async () => {
              throw new Error("TEST_FORCE_PROGRESS_FAILURE");
            },
          },
        );
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toBe("failed");

        const profileAfter = await prisma.businessProfile.findUniqueOrThrow({
          where: { organizationId },
        });
        expect(profileAfter.primaryEmail).toBe(profileBefore.primaryEmail);
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
          "lc-contact-ok",
          "Lifecycle Contact Ok",
        );
        const { profile: profileBefore, onboarding: onboardingBefore } =
          await seedAtContactStep(prisma, owner, organizationId);

        const result = await updateContactAndLocation({
          actor: owner,
          organizationId,
          expectedVersion: profileBefore.version,
          raw: contactRaw("ok@example.com"),
          progress: {
            step: "CONTACT_LOCATION",
            nextStep: "OPERATING_HOURS",
            expectedVersion: onboardingBefore.version,
          },
        });
        expect(result.ok).toBe(true);

        const profileAfter = await prisma.businessProfile.findUniqueOrThrow({
          where: { organizationId },
        });
        expect(profileAfter.primaryEmail).toBe("ok@example.com");
        expect(profileAfter.version).toBe(profileBefore.version + 1);

        const onboardingAfter =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId },
          });
        expect(onboardingAfter.currentStep).toBe("OPERATING_HOURS");
        expect(onboardingAfter.version).toBe(onboardingBefore.version + 1);
        const completedSteps = onboardingAfter.completedSteps as string[];
        expect(completedSteps).toContain("CONTACT_LOCATION");

        expect(
          await prisma.organizationAuditEvent.count({
            where: { organizationId, action: "BUSINESS_PROFILE_UPDATED" },
          }),
        ).toBeGreaterThanOrEqual(1);
      });

      it("same-version concurrent progress produces one winner", async () => {
        const { owner, organizationId } = await createOrgWithOwner(
          prisma,
          "lc-contact-conc",
          "Lifecycle Contact Concurrency",
        );
        const admin = await addAdmin(
          prisma,
          organizationId,
          "lc-contact-conc-b",
        );
        const { profile, onboarding } = await seedAtContactStep(
          prisma,
          owner,
          organizationId,
        );

        const aHeld = createGate();
        const bStarted = createGate();
        const bGotLock = createGate();
        const profileAuditsBefore = await prisma.organizationAuditEvent.count({
          where: { organizationId, action: "BUSINESS_PROFILE_UPDATED" },
        });

        const aPromise = updateContactAndLocation(
          {
            actor: owner,
            organizationId,
            expectedVersion: profile.version,
            raw: contactRaw("winner@example.com"),
            progress: {
              step: "CONTACT_LOCATION",
              nextStep: "OPERATING_HOURS",
              expectedVersion: onboarding.version,
            },
          },
          {
            testAfterReadinessLock: async () => {
              aHeld.markReached();
              await aHeld.waitForRelease();
            },
          },
        );
        await aHeld.waitUntilReached();

        const bPromise = updateContactAndLocation(
          {
            actor: admin,
            organizationId,
            expectedVersion: profile.version,
            raw: contactRaw("loser@example.com"),
            progress: {
              step: "CONTACT_LOCATION",
              nextStep: "OPERATING_HOURS",
              expectedVersion: onboarding.version,
            },
          },
          {
            testBeforeReadinessLock: async () => {
              bStarted.markReached();
            },
            testAfterReadinessLock: async () => {
              bGotLock.markReached();
            },
          },
        );
        await bStarted.waitUntilReached();
        aHeld.release();

        const aResult = await aPromise;
        await bGotLock.waitUntilReached();
        const bResult = await bPromise;

        expect(aResult.ok).toBe(true);
        expect(bResult.ok).toBe(false);
        if (!bResult.ok) expect(bResult.reason).toBe("conflict");

        const profileAfter = await prisma.businessProfile.findUniqueOrThrow({
          where: { organizationId },
        });
        expect(profileAfter.primaryEmail).toBe("winner@example.com");
        expect(profileAfter.version).toBe(profile.version + 1);

        const onboardingAfter =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId },
          });
        expect(onboardingAfter.currentStep).toBe("OPERATING_HOURS");
        expect(onboardingAfter.version).toBe(onboarding.version + 1);

        expect(
          await prisma.organizationAuditEvent.count({
            where: { organizationId, action: "BUSINESS_PROFILE_UPDATED" },
          }),
        ).toBe(profileAuditsBefore + 1);
      });
    });

    describe("operating hours", () => {
      const earlyWeek = () =>
        defaultWeek().map((day) =>
          day.dayOfWeek === "MONDAY"
            ? { ...day, startTime: "08:00", endTime: "16:00" }
            : day,
        );

      it("missing/malformed onboarding version creates zero writes", async () => {
        const { owner, organizationId } = await createOrgWithOwner(
          prisma,
          "lc-hours-bad",
          "Lifecycle Hours Bad Version",
        );
        const { onboarding: onboardingBefore } = await seedAtHoursStep(
          prisma,
          owner,
          organizationId,
        );
        const intervalsBefore = await prisma.operatingHourInterval.count({
          where: { organizationId },
        });
        const hoursAuditsBefore = await prisma.organizationAuditEvent.count({
          where: { organizationId, action: "OPERATING_HOURS_UPDATED" },
        });

        const result = await replaceOperatingHours({
          actor: owner,
          organizationId,
          raw: { intervals: earlyWeek() },
          progress: {
            step: "OPERATING_HOURS",
            nextStep: "CATALOGUE",
            expectedVersion: "abc" as unknown as number,
          },
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toBe("validation");

        expect(
          await prisma.operatingHourInterval.count({
            where: { organizationId },
          }),
        ).toBe(intervalsBefore);
        const onboardingAfter =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId },
          });
        expect(onboardingSnapshot(onboardingAfter)).toEqual(
          onboardingSnapshot(onboardingBefore),
        );
        expect(
          await prisma.organizationAuditEvent.count({
            where: { organizationId, action: "OPERATING_HOURS_UPDATED" },
          }),
        ).toBe(hoursAuditsBefore);
      });

      it("stale onboarding version rolls back hours write", async () => {
        const { owner, organizationId } = await createOrgWithOwner(
          prisma,
          "lc-hours-stale",
          "Lifecycle Hours Stale",
        );
        const { onboarding: onboardingBefore } = await seedAtHoursStep(
          prisma,
          owner,
          organizationId,
        );
        const intervalsBefore = await prisma.operatingHourInterval.count({
          where: { organizationId },
        });
        const hoursAuditsBefore = await prisma.organizationAuditEvent.count({
          where: { organizationId, action: "OPERATING_HOURS_UPDATED" },
        });

        const result = await replaceOperatingHours({
          actor: owner,
          organizationId,
          raw: { intervals: earlyWeek() },
          progress: {
            step: "OPERATING_HOURS",
            nextStep: "CATALOGUE",
            expectedVersion: onboardingBefore.version + 99,
          },
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toBe("conflict");

        expect(
          await prisma.operatingHourInterval.count({
            where: { organizationId },
          }),
        ).toBe(intervalsBefore);
        const onboardingAfter =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId },
          });
        expect(onboardingSnapshot(onboardingAfter)).toEqual(
          onboardingSnapshot(onboardingBefore),
        );
        expect(
          await prisma.organizationAuditEvent.count({
            where: { organizationId, action: "OPERATING_HOURS_UPDATED" },
          }),
        ).toBe(hoursAuditsBefore);
      });

      it("progress failure after config write rolls back fully", async () => {
        const { owner, organizationId } = await createOrgWithOwner(
          prisma,
          "lc-hours-fail",
          "Lifecycle Hours Fail",
        );
        const { onboarding: onboardingBefore } = await seedAtHoursStep(
          prisma,
          owner,
          organizationId,
        );
        const intervalsBefore = await prisma.operatingHourInterval.count({
          where: { organizationId },
        });
        const hoursAuditsBefore = await prisma.organizationAuditEvent.count({
          where: { organizationId, action: "OPERATING_HOURS_UPDATED" },
        });

        const result = await replaceOperatingHours(
          {
            actor: owner,
            organizationId,
            raw: { intervals: earlyWeek() },
            progress: {
              step: "OPERATING_HOURS",
              nextStep: "CATALOGUE",
              expectedVersion: onboardingBefore.version,
            },
          },
          {
            testAfterConfigWriteBeforeProgress: async () => {
              throw new Error("TEST_FORCE_PROGRESS_FAILURE");
            },
          },
        );
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toBe("failed");

        expect(
          await prisma.operatingHourInterval.count({
            where: { organizationId },
          }),
        ).toBe(intervalsBefore);
        const onboardingAfter =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId },
          });
        expect(onboardingSnapshot(onboardingAfter)).toEqual(
          onboardingSnapshot(onboardingBefore),
        );
        expect(
          await prisma.organizationAuditEvent.count({
            where: { organizationId, action: "OPERATING_HOURS_UPDATED" },
          }),
        ).toBe(hoursAuditsBefore);
      });

      it("success updates hours and onboarding together", async () => {
        const { owner, organizationId } = await createOrgWithOwner(
          prisma,
          "lc-hours-ok",
          "Lifecycle Hours Ok",
        );
        const { onboarding: onboardingBefore } = await seedAtHoursStep(
          prisma,
          owner,
          organizationId,
        );

        const result = await replaceOperatingHours({
          actor: owner,
          organizationId,
          raw: { intervals: earlyWeek() },
          progress: {
            step: "OPERATING_HOURS",
            nextStep: "CATALOGUE",
            expectedVersion: onboardingBefore.version,
          },
        });
        expect(result.ok).toBe(true);

        const monday = await prisma.operatingHourInterval.findFirst({
          where: { organizationId, dayOfWeek: "MONDAY" },
        });
        expect(monday?.startMinute).toBe(8 * 60);

        const onboardingAfter =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId },
          });
        expect(onboardingAfter.currentStep).toBe("CATALOGUE");
        expect(onboardingAfter.version).toBe(onboardingBefore.version + 1);
        const completedSteps = onboardingAfter.completedSteps as string[];
        expect(completedSteps).toContain("OPERATING_HOURS");

        expect(
          await prisma.organizationAuditEvent.count({
            where: { organizationId, action: "OPERATING_HOURS_UPDATED" },
          }),
        ).toBeGreaterThanOrEqual(1);
      });

      it("same-version concurrent progress produces one winner", async () => {
        const { owner, organizationId } = await createOrgWithOwner(
          prisma,
          "lc-hours-conc",
          "Lifecycle Hours Concurrency",
        );
        const admin = await addAdmin(prisma, organizationId, "lc-hours-conc-b");
        const { onboarding } = await seedAtHoursStep(
          prisma,
          owner,
          organizationId,
        );

        const winnerWeek = () =>
          defaultWeek().map((day) =>
            day.dayOfWeek === "MONDAY"
              ? { ...day, startTime: "07:00", endTime: "15:00" }
              : day,
          );
        const loserWeek = () =>
          defaultWeek().map((day) =>
            day.dayOfWeek === "MONDAY"
              ? { ...day, startTime: "10:00", endTime: "18:00" }
              : day,
          );

        const aHeld = createGate();
        const bStarted = createGate();
        const bGotLock = createGate();

        const aPromise = replaceOperatingHours(
          {
            actor: owner,
            organizationId,
            raw: { intervals: winnerWeek() },
            progress: {
              step: "OPERATING_HOURS",
              nextStep: "CATALOGUE",
              expectedVersion: onboarding.version,
            },
          },
          {
            testAfterReadinessLock: async () => {
              aHeld.markReached();
              await aHeld.waitForRelease();
            },
          },
        );
        await aHeld.waitUntilReached();

        const bPromise = replaceOperatingHours(
          {
            actor: admin,
            organizationId,
            raw: { intervals: loserWeek() },
            progress: {
              step: "OPERATING_HOURS",
              nextStep: "CATALOGUE",
              expectedVersion: onboarding.version,
            },
          },
          {
            testBeforeReadinessLock: async () => {
              bStarted.markReached();
            },
            testAfterReadinessLock: async () => {
              bGotLock.markReached();
            },
          },
        );
        await bStarted.waitUntilReached();
        aHeld.release();

        const aResult = await aPromise;
        await bGotLock.waitUntilReached();
        const bResult = await bPromise;

        expect(aResult.ok).toBe(true);
        expect(bResult.ok).toBe(false);
        if (!bResult.ok) expect(bResult.reason).toBe("conflict");

        const monday = await prisma.operatingHourInterval.findFirst({
          where: { organizationId, dayOfWeek: "MONDAY" },
        });
        expect(monday?.startMinute).toBe(7 * 60);

        const onboardingAfter =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId },
          });
        expect(onboardingAfter.currentStep).toBe("CATALOGUE");
        expect(onboardingAfter.version).toBe(onboarding.version + 1);

        expect(
          await prisma.organizationAuditEvent.count({
            where: { organizationId, action: "OPERATING_HOURS_UPDATED" },
          }),
        ).toBe(1);
      });
    });

    describe("organization settings", () => {
      it("missing/malformed onboarding version creates zero writes", async () => {
        const { owner, organizationId } = await createOrgWithOwner(
          prisma,
          "lc-settings-bad",
          "Lifecycle Settings Bad Version",
        );
        const { onboarding: onboardingBefore, settings: settingsBefore } =
          await seedAtCatalogueStep(prisma, owner, organizationId);
        const settingsAuditsBefore = await prisma.organizationAuditEvent.count({
          where: { organizationId, action: "ORGANIZATION_SETTINGS_UPDATED" },
        });

        const result = await updateOrganizationSettings({
          actor: owner,
          organizationId,
          expectedVersion: settingsBefore.version,
          raw: settingsRaw({ membersCanViewServices: true }),
          progress: {
            step: "EMPLOYEE_DEFAULTS",
            nextStep: "REVIEW",
            expectedVersion: "abc" as unknown as number,
          },
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toBe("validation");

        const settingsAfter =
          await prisma.organizationSettings.findUniqueOrThrow({
            where: { organizationId },
          });
        expect(settingsAfter.membersCanViewServices).toBe(
          settingsBefore.membersCanViewServices,
        );
        expect(settingsAfter.version).toBe(settingsBefore.version);

        const onboardingAfter =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId },
          });
        expect(onboardingSnapshot(onboardingAfter)).toEqual(
          onboardingSnapshot(onboardingBefore),
        );
        expect(
          await prisma.organizationAuditEvent.count({
            where: { organizationId, action: "ORGANIZATION_SETTINGS_UPDATED" },
          }),
        ).toBe(settingsAuditsBefore);
      });

      it("stale onboarding version rolls back settings write", async () => {
        const { owner, organizationId } = await createOrgWithOwner(
          prisma,
          "lc-settings-stale",
          "Lifecycle Settings Stale",
        );
        const { onboarding: onboardingBefore, settings: settingsBefore } =
          await seedAtCatalogueStep(prisma, owner, organizationId);
        const settingsAuditsBefore = await prisma.organizationAuditEvent.count({
          where: { organizationId, action: "ORGANIZATION_SETTINGS_UPDATED" },
        });

        const result = await updateOrganizationSettings({
          actor: owner,
          organizationId,
          expectedVersion: settingsBefore.version,
          raw: settingsRaw({ membersCanViewServices: true }),
          progress: {
            step: "EMPLOYEE_DEFAULTS",
            nextStep: "REVIEW",
            expectedVersion: onboardingBefore.version + 99,
          },
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toBe("conflict");

        const settingsAfter =
          await prisma.organizationSettings.findUniqueOrThrow({
            where: { organizationId },
          });
        expect(settingsAfter.membersCanViewServices).toBe(
          settingsBefore.membersCanViewServices,
        );
        expect(settingsAfter.version).toBe(settingsBefore.version);

        const onboardingAfter =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId },
          });
        expect(onboardingSnapshot(onboardingAfter)).toEqual(
          onboardingSnapshot(onboardingBefore),
        );
        expect(
          await prisma.organizationAuditEvent.count({
            where: { organizationId, action: "ORGANIZATION_SETTINGS_UPDATED" },
          }),
        ).toBe(settingsAuditsBefore);
      });

      it("progress failure after config write rolls back fully", async () => {
        const { owner, organizationId } = await createOrgWithOwner(
          prisma,
          "lc-settings-fail",
          "Lifecycle Settings Fail",
        );
        const { onboarding: onboardingBefore, settings: settingsBefore } =
          await seedAtCatalogueStep(prisma, owner, organizationId);
        const settingsAuditsBefore = await prisma.organizationAuditEvent.count({
          where: { organizationId, action: "ORGANIZATION_SETTINGS_UPDATED" },
        });

        const result = await updateOrganizationSettings(
          {
            actor: owner,
            organizationId,
            expectedVersion: settingsBefore.version,
            raw: settingsRaw({ membersCanViewServices: true }),
            progress: {
              step: "EMPLOYEE_DEFAULTS",
              nextStep: "REVIEW",
              expectedVersion: onboardingBefore.version,
            },
          },
          {
            testAfterConfigWriteBeforeProgress: async () => {
              throw new Error("TEST_FORCE_PROGRESS_FAILURE");
            },
          },
        );
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toBe("failed");

        const settingsAfter =
          await prisma.organizationSettings.findUniqueOrThrow({
            where: { organizationId },
          });
        expect(settingsAfter.membersCanViewServices).toBe(
          settingsBefore.membersCanViewServices,
        );
        expect(settingsAfter.version).toBe(settingsBefore.version);

        const onboardingAfter =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId },
          });
        expect(onboardingSnapshot(onboardingAfter)).toEqual(
          onboardingSnapshot(onboardingBefore),
        );
        expect(
          await prisma.organizationAuditEvent.count({
            where: { organizationId, action: "ORGANIZATION_SETTINGS_UPDATED" },
          }),
        ).toBe(settingsAuditsBefore);
      });

      it("success updates settings and onboarding together", async () => {
        const { owner, organizationId } = await createOrgWithOwner(
          prisma,
          "lc-settings-ok",
          "Lifecycle Settings Ok",
        );
        const { onboarding: onboardingBefore, settings: settingsBefore } =
          await seedAtCatalogueStep(prisma, owner, organizationId);

        const result = await updateOrganizationSettings({
          actor: owner,
          organizationId,
          expectedVersion: settingsBefore.version,
          raw: settingsRaw({ membersCanViewServices: true }),
          progress: {
            step: "EMPLOYEE_DEFAULTS",
            nextStep: "REVIEW",
            expectedVersion: onboardingBefore.version,
          },
        });
        expect(result.ok).toBe(true);

        const settingsAfter =
          await prisma.organizationSettings.findUniqueOrThrow({
            where: { organizationId },
          });
        expect(settingsAfter.membersCanViewServices).toBe(true);
        expect(settingsAfter.version).toBe(settingsBefore.version + 1);

        const onboardingAfter =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId },
          });
        expect(onboardingAfter.currentStep).toBe("REVIEW");
        expect(onboardingAfter.version).toBe(onboardingBefore.version + 1);
        const completedSteps = onboardingAfter.completedSteps as string[];
        expect(completedSteps).toContain("EMPLOYEE_DEFAULTS");

        expect(
          await prisma.organizationAuditEvent.count({
            where: { organizationId, action: "ORGANIZATION_SETTINGS_UPDATED" },
          }),
        ).toBeGreaterThanOrEqual(1);
      });

      it("same-version concurrent progress produces one winner", async () => {
        const { owner, organizationId } = await createOrgWithOwner(
          prisma,
          "lc-settings-conc",
          "Lifecycle Settings Concurrency",
        );
        const admin = await addAdmin(
          prisma,
          organizationId,
          "lc-settings-conc-b",
        );
        const { onboarding, settings } = await seedAtCatalogueStep(
          prisma,
          owner,
          organizationId,
        );

        const aHeld = createGate();
        const bStarted = createGate();
        const bGotLock = createGate();

        const aPromise = updateOrganizationSettings(
          {
            actor: owner,
            organizationId,
            expectedVersion: settings.version,
            raw: settingsRaw({ membersCanViewServices: false }),
            progress: {
              step: "EMPLOYEE_DEFAULTS",
              nextStep: "REVIEW",
              expectedVersion: onboarding.version,
            },
          },
          {
            testAfterReadinessLock: async () => {
              aHeld.markReached();
              await aHeld.waitForRelease();
            },
          },
        );
        await aHeld.waitUntilReached();

        const bPromise = updateOrganizationSettings(
          {
            actor: admin,
            organizationId,
            expectedVersion: settings.version,
            raw: settingsRaw({
              membersCanViewServices: true,
              futureCallingAccessDefault: "STANDARD",
            }),
            progress: {
              step: "EMPLOYEE_DEFAULTS",
              nextStep: "REVIEW",
              expectedVersion: onboarding.version,
            },
          },
          {
            testBeforeReadinessLock: async () => {
              bStarted.markReached();
            },
            testAfterReadinessLock: async () => {
              bGotLock.markReached();
            },
          },
        );
        await bStarted.waitUntilReached();
        aHeld.release();

        const aResult = await aPromise;
        await bGotLock.waitUntilReached();
        const bResult = await bPromise;

        expect(aResult.ok).toBe(true);
        expect(bResult.ok).toBe(false);
        if (!bResult.ok) expect(bResult.reason).toBe("conflict");

        const settingsAfter =
          await prisma.organizationSettings.findUniqueOrThrow({
            where: { organizationId },
          });
        expect(settingsAfter.membersCanViewServices).toBe(false);
        expect(settingsAfter.version).toBe(settings.version + 1);

        const onboardingAfter =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId },
          });
        expect(onboardingAfter.currentStep).toBe("REVIEW");
        expect(onboardingAfter.version).toBe(onboarding.version + 1);

        expect(
          await prisma.organizationAuditEvent.count({
            where: { organizationId, action: "ORGANIZATION_SETTINGS_UPDATED" },
          }),
        ).toBe(1);
      });
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

    it("reopen auth race: reopen-first then demotion commits; later privileged ops fail", async () => {
      const { owner, organizationId } = await createOrgWithOwner(
        prisma,
        "lc-reopen-1st-d",
        "Lifecycle Reopen Then Demote",
      );
      const admin = await addAdmin(
        prisma,
        organizationId,
        "lc-reopen-1st-d-admin",
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

      const reopenHeld = createGate();
      const demotionStarted = createGate();

      const reopenPromise = reopenOrganizationOnboarding(
        {
          actor: admin,
          organizationId,
          expectedVersion: onboarding.version,
        },
        {
          testAfterMembershipLock: async () => {
            reopenHeld.markReached();
            await reopenHeld.waitForRelease();
          },
        },
      );

      await reopenHeld.waitUntilReached();

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
      reopenHeld.release();

      const reopened = await reopenPromise;
      const demote = await demotePromise;
      expect(reopened.ok).toBe(true);
      expect(demote.ok).toBe(true);

      expect(
        await prisma.organizationAuditEvent.count({
          where: { organizationId, action: "ONBOARDING_REOPENED" },
        }),
      ).toBe(1);

      const role = await prisma.membership.findUniqueOrThrow({
        where: { id: membership.id },
      });
      expect(role.role).toBe("MEMBER");

      const afterReopen = await prisma.organizationOnboarding.findUniqueOrThrow(
        {
          where: { organizationId },
        },
      );
      expect(afterReopen.status).toBe("IN_PROGRESS");

      const laterReopen = await reopenOrganizationOnboarding({
        actor: admin,
        organizationId,
        expectedVersion: afterReopen.version,
      });
      expect(laterReopen.ok).toBe(false);

      const profile = await prisma.businessProfile.findUniqueOrThrow({
        where: { organizationId },
      });
      const laterBasics = await updateBusinessBasics({
        actor: admin,
        organizationId,
        expectedVersion: profile.version,
        raw: basicsRaw("Denied After Demote"),
      });
      expect(laterBasics.ok).toBe(false);
    });

    it("reopen auth race: deactivation-first prevents reopen", async () => {
      const { owner, organizationId } = await createOrgWithOwner(
        prisma,
        "lc-reopen-deact",
        "Lifecycle Reopen Deactivate",
      );
      const admin = await addAdmin(
        prisma,
        organizationId,
        "lc-reopen-deact-admin",
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

      const deactivationHeld = createGate();
      const reopenStarted = createGate();

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
      deactivationHeld.release();

      const deactivated = await deactivatePromise;
      const reopened = await reopenPromise;
      expect(deactivated.ok).toBe(true);
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

      const row = await prisma.membership.findUniqueOrThrow({
        where: { id: membership.id },
      });
      expect(row.status).toBe("INACTIVE");
    });

    it("reopen auth race: reopen-first then deactivation commits; later privileged ops fail", async () => {
      const { owner, organizationId } = await createOrgWithOwner(
        prisma,
        "lc-reopen-1st-a",
        "Lifecycle Reopen Then Deactivate",
      );
      const admin = await addAdmin(
        prisma,
        organizationId,
        "lc-reopen-1st-a-admin",
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

      const reopenHeld = createGate();
      const deactivationStarted = createGate();

      const reopenPromise = reopenOrganizationOnboarding(
        {
          actor: admin,
          organizationId,
          expectedVersion: onboarding.version,
        },
        {
          testAfterMembershipLock: async () => {
            reopenHeld.markReached();
            await reopenHeld.waitForRelease();
          },
        },
      );

      await reopenHeld.waitUntilReached();

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
      reopenHeld.release();

      const reopened = await reopenPromise;
      const deactivated = await deactivatePromise;
      expect(reopened.ok).toBe(true);
      expect(deactivated.ok).toBe(true);

      expect(
        await prisma.organizationAuditEvent.count({
          where: { organizationId, action: "ONBOARDING_REOPENED" },
        }),
      ).toBe(1);

      const row = await prisma.membership.findUniqueOrThrow({
        where: { id: membership.id },
      });
      expect(row.status).toBe("INACTIVE");

      const laterReopen = await reopenOrganizationOnboarding({
        actor: admin,
        organizationId,
        expectedVersion: onboarding.version + 1,
      });
      expect(laterReopen.ok).toBe(false);
    });
  });

  describe("post-commit response races (configuration and onboarding lifecycle)", () => {
    type AdminRaceCtx = {
      owner: SafeUser;
      admin: SafeUser;
      organizationId: string;
      membershipId: string;
    };

    type MutationHooks = {
      testAfterTransactionCommit?: () => Promise<void>;
      testBeforeMembershipLock?: () => Promise<void>;
    };

    type MutationOutcome = {
      ok: boolean;
      reason?: string;
      onboarding?: {
        currentStep: string;
        status: string;
        version?: number;
        isConfigurationReady?: boolean;
      };
    };

    const AUTH_FAILURE_REASONS = [
      "forbidden",
      "inactive_membership",
      "not_a_member",
    ] as const;

    function earlyWeek() {
      return defaultWeek().map((day) =>
        day.dayOfWeek === "MONDAY"
          ? { ...day, startTime: "08:00", endTime: "16:00" }
          : day,
      );
    }

    async function seedAdminMembership(
      prefix: string,
      orgName: string,
    ): Promise<AdminRaceCtx> {
      const { owner, organizationId } = await createOrgWithOwner(
        prisma,
        prefix,
        orgName,
      );
      const admin = await addAdmin(prisma, organizationId, `${prefix}-admin`);
      const membership = await prisma.membership.findFirstOrThrow({
        where: { organizationId, userId: admin.id },
      });
      return { owner, admin, organizationId, membershipId: membership.id };
    }

    async function expectDemoted(ctx: AdminRaceCtx) {
      const role = await prisma.membership.findUniqueOrThrow({
        where: { id: ctx.membershipId },
      });
      expect(role.role).toBe("MEMBER");
    }

    async function expectDeactivated(ctx: AdminRaceCtx) {
      const row = await prisma.membership.findUniqueOrThrow({
        where: { id: ctx.membershipId },
      });
      expect(row.status).toBe("INACTIVE");
    }

    function expectAuthFailure(result: MutationOutcome) {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(AUTH_FAILURE_REASONS).toContain(result.reason);
      }
    }

    async function runMutationThenDemotion(
      ctx: AdminRaceCtx,
      runMutation: (hooks: MutationHooks) => Promise<MutationOutcome>,
    ) {
      const result = await runMutation({
        testAfterTransactionCommit: async () => {
          const demote = await changeMemberRole({
            actor: ctx.owner,
            organizationId: ctx.organizationId,
            membershipId: ctx.membershipId,
            nextRole: "MEMBER",
          });
          expect(demote.ok).toBe(true);
        },
      });
      expect(result.ok).toBe(true);
      await expectDemoted(ctx);
      return result;
    }

    async function runMutationThenDeactivation(
      ctx: AdminRaceCtx,
      runMutation: (hooks: MutationHooks) => Promise<MutationOutcome>,
    ) {
      const result = await runMutation({
        testAfterTransactionCommit: async () => {
          const deactivated = await deactivateMember({
            actor: ctx.owner,
            organizationId: ctx.organizationId,
            membershipId: ctx.membershipId,
          });
          expect(deactivated.ok).toBe(true);
        },
      });
      expect(result.ok).toBe(true);
      await expectDeactivated(ctx);
      return result;
    }

    async function runAuthLossFirstDemotion(
      ctx: AdminRaceCtx,
      runMutation: (hooks: MutationHooks) => Promise<MutationOutcome>,
    ) {
      const demotionHeld = createGate();
      const mutationStarted = createGate();

      const demotePromise = changeMemberRole(
        {
          actor: ctx.owner,
          organizationId: ctx.organizationId,
          membershipId: ctx.membershipId,
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

      const mutationPromise = runMutation({
        testBeforeMembershipLock: async () => {
          mutationStarted.markReached();
        },
      });

      await mutationStarted.waitUntilReached();
      demotionHeld.release();

      const demote = await demotePromise;
      const mutation = await mutationPromise;
      expect(demote.ok).toBe(true);
      expectAuthFailure(mutation);
      return mutation;
    }

    async function runAuthLossFirstDeactivation(
      ctx: AdminRaceCtx,
      runMutation: (hooks: MutationHooks) => Promise<MutationOutcome>,
    ) {
      const deactivationHeld = createGate();
      const mutationStarted = createGate();

      const deactivatePromise = deactivateMember(
        {
          actor: ctx.owner,
          organizationId: ctx.organizationId,
          membershipId: ctx.membershipId,
        },
        {
          testAfterTargetMembershipLock: async () => {
            deactivationHeld.markReached();
            await deactivationHeld.waitForRelease();
          },
        },
      );

      await deactivationHeld.waitUntilReached();

      const mutationPromise = runMutation({
        testBeforeMembershipLock: async () => {
          mutationStarted.markReached();
        },
      });

      await mutationStarted.waitUntilReached();
      deactivationHeld.release();

      const deactivated = await deactivatePromise;
      const mutation = await mutationPromise;
      expect(deactivated.ok).toBe(true);
      expectAuthFailure(mutation);
      return mutation;
    }

    async function seedAdminAtBasics(prefix: string, orgName: string) {
      const ctx = await seedAdminMembership(prefix, orgName);
      const { profile, onboarding } = await seedAtBasicsStep(
        prisma,
        ctx.owner,
        ctx.organizationId,
      );
      return {
        ...ctx,
        profileVersion: profile.version,
        onboardingVersion: onboarding.version,
      };
    }

    async function seedAdminAtContact(prefix: string, orgName: string) {
      const ctx = await seedAdminMembership(prefix, orgName);
      const { profile, onboarding } = await seedAtContactStep(
        prisma,
        ctx.owner,
        ctx.organizationId,
      );
      return {
        ...ctx,
        profileVersion: profile.version,
        onboardingVersion: onboarding.version,
      };
    }

    async function seedAdminAtHours(prefix: string, orgName: string) {
      const ctx = await seedAdminMembership(prefix, orgName);
      const { onboarding } = await seedAtHoursStep(
        prisma,
        ctx.owner,
        ctx.organizationId,
      );
      return { ...ctx, onboardingVersion: onboarding.version };
    }

    async function seedAdminAtCatalogue(prefix: string, orgName: string) {
      const ctx = await seedAdminMembership(prefix, orgName);
      const { onboarding, settings } = await seedAtCatalogueStep(
        prisma,
        ctx.owner,
        ctx.organizationId,
      );
      return {
        ...ctx,
        onboardingVersion: onboarding.version,
        settingsVersion: settings.version,
      };
    }

    async function seedAdminNoOnboarding(prefix: string, orgName: string) {
      const ctx = await seedAdminMembership(prefix, orgName);
      expect(
        await prisma.organizationOnboarding.count({
          where: { organizationId: ctx.organizationId },
        }),
      ).toBe(0);
      return ctx;
    }

    async function seedAdminReady(prefix: string, orgName: string) {
      const { owner, organizationId } = await createOrgWithOwner(
        prisma,
        prefix,
        orgName,
      );
      await seedReadyConfig({
        prisma,
        actor: owner,
        organizationId,
        businessType: "SERVICES",
      });
      const admin = await addAdmin(prisma, organizationId, `${prefix}-admin`);
      const membership = await prisma.membership.findFirstOrThrow({
        where: { organizationId, userId: admin.id },
      });
      const onboarding = await prisma.organizationOnboarding.findUniqueOrThrow({
        where: { organizationId },
      });
      return {
        owner,
        admin,
        organizationId,
        membershipId: membership.id,
        onboardingVersion: onboarding.version,
      };
    }

    async function seedAdminCompleted(prefix: string, orgName: string) {
      const { owner, organizationId } = await createOrgWithOwner(
        prisma,
        prefix,
        orgName,
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
      if (!completed.ok) {
        throw new Error(`seed complete failed: ${completed.reason}`);
      }
      const admin = await addAdmin(prisma, organizationId, `${prefix}-admin`);
      const membership = await prisma.membership.findFirstOrThrow({
        where: { organizationId, userId: admin.id },
      });
      const onboarding = await prisma.organizationOnboarding.findUniqueOrThrow({
        where: { organizationId },
      });
      return {
        owner,
        admin,
        organizationId,
        membershipId: membership.id,
        onboardingVersion: onboarding.version,
      };
    }

    describe("updateBusinessBasics", () => {
      const auditAction = "BUSINESS_PROFILE_UPDATED";

      it("successful mutation then demotion still returns committed data", async () => {
        const ctx = await seedAdminAtBasics(
          "lc-post-basics-demote",
          "Post Commit Basics Demote",
        );

        await runMutationThenDemotion(ctx, (hooks) =>
          updateBusinessBasics(
            {
              actor: ctx.admin,
              organizationId: ctx.organizationId,
              expectedVersion: ctx.profileVersion,
              raw: basicsRaw("Committed Before Demote"),
              progress: {
                step: "BUSINESS_BASICS",
                nextStep: "CONTACT_LOCATION",
                expectedVersion: ctx.onboardingVersion,
              },
            },
            hooks,
          ),
        );

        const profile = await prisma.businessProfile.findUniqueOrThrow({
          where: { organizationId: ctx.organizationId },
        });
        expect(profile.displayName).toBe("Committed Before Demote");
        expect(profile.version).toBe(ctx.profileVersion + 1);
        expect(
          await prisma.organizationAuditEvent.count({
            where: { organizationId: ctx.organizationId, action: auditAction },
          }),
        ).toBe(1);

        const later = await updateBusinessBasics({
          actor: ctx.admin,
          organizationId: ctx.organizationId,
          expectedVersion: profile.version,
          raw: basicsRaw("Denied After Demote"),
        });
        expect(later.ok).toBe(false);
      });

      it("successful mutation then deactivation still returns committed data", async () => {
        const ctx = await seedAdminAtBasics(
          "lc-post-basics-deact",
          "Post Commit Basics Deactivate",
        );

        await runMutationThenDeactivation(ctx, (hooks) =>
          updateBusinessBasics(
            {
              actor: ctx.admin,
              organizationId: ctx.organizationId,
              expectedVersion: ctx.profileVersion,
              raw: basicsRaw("Committed Before Deactivate"),
              progress: {
                step: "BUSINESS_BASICS",
                nextStep: "CONTACT_LOCATION",
                expectedVersion: ctx.onboardingVersion,
              },
            },
            hooks,
          ),
        );

        const profile = await prisma.businessProfile.findUniqueOrThrow({
          where: { organizationId: ctx.organizationId },
        });
        expect(profile.displayName).toBe("Committed Before Deactivate");
        expect(
          await prisma.organizationAuditEvent.count({
            where: { organizationId: ctx.organizationId, action: auditAction },
          }),
        ).toBe(1);

        const later = await updateBusinessBasics({
          actor: ctx.admin,
          organizationId: ctx.organizationId,
          expectedVersion: profile.version,
          raw: basicsRaw("Denied After Deactivate"),
        });
        expect(later.ok).toBe(false);
      });

      it("auth-loss-first: demotion before membership check leaves zero writes", async () => {
        const ctx = await seedAdminAtBasics(
          "lc-auth-basics-d",
          "Auth Loss Basics Demote",
        );
        const profileBefore = await prisma.businessProfile.findUniqueOrThrow({
          where: { organizationId: ctx.organizationId },
        });
        const onboardingBefore =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId: ctx.organizationId },
          });
        const auditsBefore = await prisma.organizationAuditEvent.count({
          where: { organizationId: ctx.organizationId, action: auditAction },
        });

        await runAuthLossFirstDemotion(ctx, (hooks) =>
          updateBusinessBasics(
            {
              actor: ctx.admin,
              organizationId: ctx.organizationId,
              expectedVersion: ctx.profileVersion,
              raw: basicsRaw("Should Not Persist"),
              progress: {
                step: "BUSINESS_BASICS",
                nextStep: "CONTACT_LOCATION",
                expectedVersion: ctx.onboardingVersion,
              },
            },
            hooks,
          ),
        );

        const profileAfter = await prisma.businessProfile.findUniqueOrThrow({
          where: { organizationId: ctx.organizationId },
        });
        expect(profileAfter.displayName).toBe(profileBefore.displayName);
        expect(profileAfter.version).toBe(profileBefore.version);
        const onboardingAfter =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId: ctx.organizationId },
          });
        expect(onboardingSnapshot(onboardingAfter)).toEqual(
          onboardingSnapshot(onboardingBefore),
        );
        expect(
          await prisma.organizationAuditEvent.count({
            where: { organizationId: ctx.organizationId, action: auditAction },
          }),
        ).toBe(auditsBefore);
      });

      it("auth-loss-first: deactivation before membership check leaves zero writes", async () => {
        const ctx = await seedAdminAtBasics(
          "lc-auth-basics-a",
          "Auth Loss Basics Deactivate",
        );
        const profileBefore = await prisma.businessProfile.findUniqueOrThrow({
          where: { organizationId: ctx.organizationId },
        });
        const onboardingBefore =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId: ctx.organizationId },
          });
        const auditsBefore = await prisma.organizationAuditEvent.count({
          where: { organizationId: ctx.organizationId, action: auditAction },
        });

        await runAuthLossFirstDeactivation(ctx, (hooks) =>
          updateBusinessBasics(
            {
              actor: ctx.admin,
              organizationId: ctx.organizationId,
              expectedVersion: ctx.profileVersion,
              raw: basicsRaw("Should Not Persist"),
              progress: {
                step: "BUSINESS_BASICS",
                nextStep: "CONTACT_LOCATION",
                expectedVersion: ctx.onboardingVersion,
              },
            },
            hooks,
          ),
        );

        const profileAfter = await prisma.businessProfile.findUniqueOrThrow({
          where: { organizationId: ctx.organizationId },
        });
        expect(profileAfter.displayName).toBe(profileBefore.displayName);
        expect(profileAfter.version).toBe(profileBefore.version);
        const onboardingAfter =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId: ctx.organizationId },
          });
        expect(onboardingSnapshot(onboardingAfter)).toEqual(
          onboardingSnapshot(onboardingBefore),
        );
        expect(
          await prisma.organizationAuditEvent.count({
            where: { organizationId: ctx.organizationId, action: auditAction },
          }),
        ).toBe(auditsBefore);
      });
    });

    describe("updateContactAndLocation", () => {
      const auditAction = "BUSINESS_PROFILE_UPDATED";

      it("successful mutation then demotion still returns committed data", async () => {
        const ctx = await seedAdminAtContact(
          "lc-post-contact-demote",
          "Post Commit Contact Demote",
        );
        const auditsBefore = await prisma.organizationAuditEvent.count({
          where: { organizationId: ctx.organizationId, action: auditAction },
        });

        await runMutationThenDemotion(ctx, (hooks) =>
          updateContactAndLocation(
            {
              actor: ctx.admin,
              organizationId: ctx.organizationId,
              expectedVersion: ctx.profileVersion,
              raw: contactRaw("committed-demote@example.com"),
              progress: {
                step: "CONTACT_LOCATION",
                nextStep: "OPERATING_HOURS",
                expectedVersion: ctx.onboardingVersion,
              },
            },
            hooks,
          ),
        );

        const profile = await prisma.businessProfile.findUniqueOrThrow({
          where: { organizationId: ctx.organizationId },
        });
        expect(profile.primaryEmail).toBe("committed-demote@example.com");
        expect(profile.version).toBe(ctx.profileVersion + 1);
        expect(
          await prisma.organizationAuditEvent.count({
            where: { organizationId: ctx.organizationId, action: auditAction },
          }),
        ).toBe(auditsBefore + 1);

        const later = await updateContactAndLocation({
          actor: ctx.admin,
          organizationId: ctx.organizationId,
          expectedVersion: profile.version,
          raw: contactRaw("denied@example.com"),
        });
        expect(later.ok).toBe(false);
      });

      it("successful mutation then deactivation still returns committed data", async () => {
        const ctx = await seedAdminAtContact(
          "lc-post-contact-deact",
          "Post Commit Contact Deactivate",
        );
        const auditsBefore = await prisma.organizationAuditEvent.count({
          where: { organizationId: ctx.organizationId, action: auditAction },
        });

        await runMutationThenDeactivation(ctx, (hooks) =>
          updateContactAndLocation(
            {
              actor: ctx.admin,
              organizationId: ctx.organizationId,
              expectedVersion: ctx.profileVersion,
              raw: contactRaw("committed-deact@example.com"),
              progress: {
                step: "CONTACT_LOCATION",
                nextStep: "OPERATING_HOURS",
                expectedVersion: ctx.onboardingVersion,
              },
            },
            hooks,
          ),
        );

        const profile = await prisma.businessProfile.findUniqueOrThrow({
          where: { organizationId: ctx.organizationId },
        });
        expect(profile.primaryEmail).toBe("committed-deact@example.com");
        expect(
          await prisma.organizationAuditEvent.count({
            where: { organizationId: ctx.organizationId, action: auditAction },
          }),
        ).toBe(auditsBefore + 1);

        const later = await updateContactAndLocation({
          actor: ctx.admin,
          organizationId: ctx.organizationId,
          expectedVersion: profile.version,
          raw: contactRaw("denied@example.com"),
        });
        expect(later.ok).toBe(false);
      });

      it("auth-loss-first: demotion before membership check leaves zero writes", async () => {
        const ctx = await seedAdminAtContact(
          "lc-auth-contact-d",
          "Auth Loss Contact Demote",
        );
        const profileBefore = await prisma.businessProfile.findUniqueOrThrow({
          where: { organizationId: ctx.organizationId },
        });
        const onboardingBefore =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId: ctx.organizationId },
          });
        const auditsBefore = await prisma.organizationAuditEvent.count({
          where: { organizationId: ctx.organizationId, action: auditAction },
        });

        await runAuthLossFirstDemotion(ctx, (hooks) =>
          updateContactAndLocation(
            {
              actor: ctx.admin,
              organizationId: ctx.organizationId,
              expectedVersion: ctx.profileVersion,
              raw: contactRaw("should-not@example.com"),
              progress: {
                step: "CONTACT_LOCATION",
                nextStep: "OPERATING_HOURS",
                expectedVersion: ctx.onboardingVersion,
              },
            },
            hooks,
          ),
        );

        const profileAfter = await prisma.businessProfile.findUniqueOrThrow({
          where: { organizationId: ctx.organizationId },
        });
        expect(profileAfter.primaryEmail).toBe(profileBefore.primaryEmail);
        expect(profileAfter.version).toBe(profileBefore.version);
        const onboardingAfter =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId: ctx.organizationId },
          });
        expect(onboardingSnapshot(onboardingAfter)).toEqual(
          onboardingSnapshot(onboardingBefore),
        );
        expect(
          await prisma.organizationAuditEvent.count({
            where: { organizationId: ctx.organizationId, action: auditAction },
          }),
        ).toBe(auditsBefore);
      });

      it("auth-loss-first: deactivation before membership check leaves zero writes", async () => {
        const ctx = await seedAdminAtContact(
          "lc-auth-contact-a",
          "Auth Loss Contact Deactivate",
        );
        const profileBefore = await prisma.businessProfile.findUniqueOrThrow({
          where: { organizationId: ctx.organizationId },
        });
        const onboardingBefore =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId: ctx.organizationId },
          });
        const auditsBefore = await prisma.organizationAuditEvent.count({
          where: { organizationId: ctx.organizationId, action: auditAction },
        });

        await runAuthLossFirstDeactivation(ctx, (hooks) =>
          updateContactAndLocation(
            {
              actor: ctx.admin,
              organizationId: ctx.organizationId,
              expectedVersion: ctx.profileVersion,
              raw: contactRaw("should-not@example.com"),
              progress: {
                step: "CONTACT_LOCATION",
                nextStep: "OPERATING_HOURS",
                expectedVersion: ctx.onboardingVersion,
              },
            },
            hooks,
          ),
        );

        const profileAfter = await prisma.businessProfile.findUniqueOrThrow({
          where: { organizationId: ctx.organizationId },
        });
        expect(profileAfter.primaryEmail).toBe(profileBefore.primaryEmail);
        expect(profileAfter.version).toBe(profileBefore.version);
        const onboardingAfter =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId: ctx.organizationId },
          });
        expect(onboardingSnapshot(onboardingAfter)).toEqual(
          onboardingSnapshot(onboardingBefore),
        );
        expect(
          await prisma.organizationAuditEvent.count({
            where: { organizationId: ctx.organizationId, action: auditAction },
          }),
        ).toBe(auditsBefore);
      });
    });

    describe("replaceOperatingHours", () => {
      const auditAction = "OPERATING_HOURS_UPDATED";

      async function mondayStartMinute(organizationId: string) {
        const row = await prisma.operatingHourInterval.findFirst({
          where: { organizationId, dayOfWeek: "MONDAY" },
        });
        return row?.startMinute ?? null;
      }

      it("successful mutation then demotion still returns committed data", async () => {
        const ctx = await seedAdminAtHours(
          "lc-post-hours-demote",
          "Post Commit Hours Demote",
        );
        const auditsBefore = await prisma.organizationAuditEvent.count({
          where: { organizationId: ctx.organizationId, action: auditAction },
        });

        await runMutationThenDemotion(ctx, (hooks) =>
          replaceOperatingHours(
            {
              actor: ctx.admin,
              organizationId: ctx.organizationId,
              raw: { intervals: earlyWeek() },
              progress: {
                step: "OPERATING_HOURS",
                nextStep: "CATALOGUE",
                expectedVersion: ctx.onboardingVersion,
              },
            },
            hooks,
          ),
        );

        expect(await mondayStartMinute(ctx.organizationId)).toBe(8 * 60);
        expect(
          await prisma.organizationAuditEvent.count({
            where: { organizationId: ctx.organizationId, action: auditAction },
          }),
        ).toBe(auditsBefore + 1);

        const later = await replaceOperatingHours({
          actor: ctx.admin,
          organizationId: ctx.organizationId,
          raw: { intervals: defaultWeek() },
        });
        expect(later.ok).toBe(false);
      });

      it("successful mutation then deactivation still returns committed data", async () => {
        const ctx = await seedAdminAtHours(
          "lc-post-hours-deact",
          "Post Commit Hours Deactivate",
        );
        const auditsBefore = await prisma.organizationAuditEvent.count({
          where: { organizationId: ctx.organizationId, action: auditAction },
        });

        await runMutationThenDeactivation(ctx, (hooks) =>
          replaceOperatingHours(
            {
              actor: ctx.admin,
              organizationId: ctx.organizationId,
              raw: { intervals: earlyWeek() },
              progress: {
                step: "OPERATING_HOURS",
                nextStep: "CATALOGUE",
                expectedVersion: ctx.onboardingVersion,
              },
            },
            hooks,
          ),
        );

        expect(await mondayStartMinute(ctx.organizationId)).toBe(8 * 60);
        expect(
          await prisma.organizationAuditEvent.count({
            where: { organizationId: ctx.organizationId, action: auditAction },
          }),
        ).toBe(auditsBefore + 1);

        const later = await replaceOperatingHours({
          actor: ctx.admin,
          organizationId: ctx.organizationId,
          raw: { intervals: defaultWeek() },
        });
        expect(later.ok).toBe(false);
      });

      it("auth-loss-first: demotion before membership check leaves zero writes", async () => {
        const ctx = await seedAdminAtHours(
          "lc-auth-hours-d",
          "Auth Loss Hours Demote",
        );
        const mondayBefore = await mondayStartMinute(ctx.organizationId);
        const onboardingBefore =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId: ctx.organizationId },
          });
        const auditsBefore = await prisma.organizationAuditEvent.count({
          where: { organizationId: ctx.organizationId, action: auditAction },
        });

        await runAuthLossFirstDemotion(ctx, (hooks) =>
          replaceOperatingHours(
            {
              actor: ctx.admin,
              organizationId: ctx.organizationId,
              raw: { intervals: earlyWeek() },
              progress: {
                step: "OPERATING_HOURS",
                nextStep: "CATALOGUE",
                expectedVersion: ctx.onboardingVersion,
              },
            },
            hooks,
          ),
        );

        expect(await mondayStartMinute(ctx.organizationId)).toBe(mondayBefore);
        const onboardingAfter =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId: ctx.organizationId },
          });
        expect(onboardingSnapshot(onboardingAfter)).toEqual(
          onboardingSnapshot(onboardingBefore),
        );
        expect(
          await prisma.organizationAuditEvent.count({
            where: { organizationId: ctx.organizationId, action: auditAction },
          }),
        ).toBe(auditsBefore);
      });

      it("auth-loss-first: deactivation before membership check leaves zero writes", async () => {
        const ctx = await seedAdminAtHours(
          "lc-auth-hours-a",
          "Auth Loss Hours Deactivate",
        );
        const mondayBefore = await mondayStartMinute(ctx.organizationId);
        const onboardingBefore =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId: ctx.organizationId },
          });
        const auditsBefore = await prisma.organizationAuditEvent.count({
          where: { organizationId: ctx.organizationId, action: auditAction },
        });

        await runAuthLossFirstDeactivation(ctx, (hooks) =>
          replaceOperatingHours(
            {
              actor: ctx.admin,
              organizationId: ctx.organizationId,
              raw: { intervals: earlyWeek() },
              progress: {
                step: "OPERATING_HOURS",
                nextStep: "CATALOGUE",
                expectedVersion: ctx.onboardingVersion,
              },
            },
            hooks,
          ),
        );

        expect(await mondayStartMinute(ctx.organizationId)).toBe(mondayBefore);
        const onboardingAfter =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId: ctx.organizationId },
          });
        expect(onboardingSnapshot(onboardingAfter)).toEqual(
          onboardingSnapshot(onboardingBefore),
        );
        expect(
          await prisma.organizationAuditEvent.count({
            where: { organizationId: ctx.organizationId, action: auditAction },
          }),
        ).toBe(auditsBefore);
      });
    });

    describe("updateOrganizationSettings", () => {
      const auditAction = "ORGANIZATION_SETTINGS_UPDATED";

      it("successful mutation then demotion still returns committed data", async () => {
        const ctx = await seedAdminAtCatalogue(
          "lc-post-settings-demote",
          "Post Commit Settings Demote",
        );

        await runMutationThenDemotion(ctx, (hooks) =>
          updateOrganizationSettings(
            {
              actor: ctx.admin,
              organizationId: ctx.organizationId,
              expectedVersion: ctx.settingsVersion,
              raw: settingsRaw({ membersCanViewServices: true }),
              progress: {
                step: "EMPLOYEE_DEFAULTS",
                nextStep: "REVIEW",
                expectedVersion: ctx.onboardingVersion,
              },
            },
            hooks,
          ),
        );

        const settings = await prisma.organizationSettings.findUniqueOrThrow({
          where: { organizationId: ctx.organizationId },
        });
        expect(settings.membersCanViewServices).toBe(true);
        expect(settings.version).toBe(ctx.settingsVersion + 1);
        expect(
          await prisma.organizationAuditEvent.count({
            where: { organizationId: ctx.organizationId, action: auditAction },
          }),
        ).toBe(1);

        const later = await updateOrganizationSettings({
          actor: ctx.admin,
          organizationId: ctx.organizationId,
          expectedVersion: settings.version,
          raw: settingsRaw({ membersCanViewProducts: false }),
        });
        expect(later.ok).toBe(false);
      });

      it("successful mutation then deactivation still returns committed data", async () => {
        const ctx = await seedAdminAtCatalogue(
          "lc-post-settings-deact",
          "Post Commit Settings Deactivate",
        );

        await runMutationThenDeactivation(ctx, (hooks) =>
          updateOrganizationSettings(
            {
              actor: ctx.admin,
              organizationId: ctx.organizationId,
              expectedVersion: ctx.settingsVersion,
              raw: settingsRaw({ membersCanViewServices: true }),
              progress: {
                step: "EMPLOYEE_DEFAULTS",
                nextStep: "REVIEW",
                expectedVersion: ctx.onboardingVersion,
              },
            },
            hooks,
          ),
        );

        const settings = await prisma.organizationSettings.findUniqueOrThrow({
          where: { organizationId: ctx.organizationId },
        });
        expect(settings.membersCanViewServices).toBe(true);
        expect(
          await prisma.organizationAuditEvent.count({
            where: { organizationId: ctx.organizationId, action: auditAction },
          }),
        ).toBe(1);

        const later = await updateOrganizationSettings({
          actor: ctx.admin,
          organizationId: ctx.organizationId,
          expectedVersion: settings.version,
          raw: settingsRaw({ membersCanViewProducts: false }),
        });
        expect(later.ok).toBe(false);
      });

      it("auth-loss-first: demotion before membership check leaves zero writes", async () => {
        const ctx = await seedAdminAtCatalogue(
          "lc-auth-settings-d",
          "Auth Loss Settings Demote",
        );
        const settingsBefore =
          await prisma.organizationSettings.findUniqueOrThrow({
            where: { organizationId: ctx.organizationId },
          });
        const onboardingBefore =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId: ctx.organizationId },
          });
        const auditsBefore = await prisma.organizationAuditEvent.count({
          where: { organizationId: ctx.organizationId, action: auditAction },
        });

        await runAuthLossFirstDemotion(ctx, (hooks) =>
          updateOrganizationSettings(
            {
              actor: ctx.admin,
              organizationId: ctx.organizationId,
              expectedVersion: ctx.settingsVersion,
              raw: settingsRaw({ membersCanViewServices: true }),
              progress: {
                step: "EMPLOYEE_DEFAULTS",
                nextStep: "REVIEW",
                expectedVersion: ctx.onboardingVersion,
              },
            },
            hooks,
          ),
        );

        const settingsAfter =
          await prisma.organizationSettings.findUniqueOrThrow({
            where: { organizationId: ctx.organizationId },
          });
        expect(settingsAfter.membersCanViewServices).toBe(
          settingsBefore.membersCanViewServices,
        );
        expect(settingsAfter.version).toBe(settingsBefore.version);
        const onboardingAfter =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId: ctx.organizationId },
          });
        expect(onboardingSnapshot(onboardingAfter)).toEqual(
          onboardingSnapshot(onboardingBefore),
        );
        expect(
          await prisma.organizationAuditEvent.count({
            where: { organizationId: ctx.organizationId, action: auditAction },
          }),
        ).toBe(auditsBefore);
      });

      it("auth-loss-first: deactivation before membership check leaves zero writes", async () => {
        const ctx = await seedAdminAtCatalogue(
          "lc-auth-settings-a",
          "Auth Loss Settings Deactivate",
        );
        const settingsBefore =
          await prisma.organizationSettings.findUniqueOrThrow({
            where: { organizationId: ctx.organizationId },
          });
        const onboardingBefore =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId: ctx.organizationId },
          });
        const auditsBefore = await prisma.organizationAuditEvent.count({
          where: { organizationId: ctx.organizationId, action: auditAction },
        });

        await runAuthLossFirstDeactivation(ctx, (hooks) =>
          updateOrganizationSettings(
            {
              actor: ctx.admin,
              organizationId: ctx.organizationId,
              expectedVersion: ctx.settingsVersion,
              raw: settingsRaw({ membersCanViewServices: true }),
              progress: {
                step: "EMPLOYEE_DEFAULTS",
                nextStep: "REVIEW",
                expectedVersion: ctx.onboardingVersion,
              },
            },
            hooks,
          ),
        );

        const settingsAfter =
          await prisma.organizationSettings.findUniqueOrThrow({
            where: { organizationId: ctx.organizationId },
          });
        expect(settingsAfter.membersCanViewServices).toBe(
          settingsBefore.membersCanViewServices,
        );
        expect(settingsAfter.version).toBe(settingsBefore.version);
        const onboardingAfter =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId: ctx.organizationId },
          });
        expect(onboardingSnapshot(onboardingAfter)).toEqual(
          onboardingSnapshot(onboardingBefore),
        );
        expect(
          await prisma.organizationAuditEvent.count({
            where: { organizationId: ctx.organizationId, action: auditAction },
          }),
        ).toBe(auditsBefore);
      });
    });

    describe("startOrganizationOnboarding", () => {
      const auditAction = "ONBOARDING_STARTED";

      it("successful mutation then demotion still returns committed data", async () => {
        const ctx = await seedAdminNoOnboarding(
          "lc-post-start-demote",
          "Post Commit Start Demote",
        );

        const result = await runMutationThenDemotion(ctx, (hooks) =>
          startOrganizationOnboarding(
            {
              actor: ctx.admin,
              organizationId: ctx.organizationId,
            },
            hooks,
          ),
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.onboarding!.currentStep).toBe("BUSINESS_BASICS");
          expect(result.onboarding!.status).toBe("NOT_STARTED");
        }

        const onboarding =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId: ctx.organizationId },
          });
        expect(onboarding.currentStep).toBe("BUSINESS_BASICS");
        expect(onboarding.status).toBe("NOT_STARTED");
        expect(
          await prisma.organizationAuditEvent.count({
            where: { organizationId: ctx.organizationId, action: auditAction },
          }),
        ).toBe(1);

        const later = await startOrganizationOnboarding({
          actor: ctx.admin,
          organizationId: ctx.organizationId,
        });
        expect(later.ok).toBe(false);
      });

      it("successful mutation then deactivation still returns committed data", async () => {
        const ctx = await seedAdminNoOnboarding(
          "lc-post-start-deact",
          "Post Commit Start Deactivate",
        );

        const result = await runMutationThenDeactivation(ctx, (hooks) =>
          startOrganizationOnboarding(
            {
              actor: ctx.admin,
              organizationId: ctx.organizationId,
            },
            hooks,
          ),
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.onboarding!.status).toBe("NOT_STARTED");
        }

        const onboarding =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId: ctx.organizationId },
          });
        expect(onboarding.status).toBe("NOT_STARTED");
        expect(
          await prisma.organizationAuditEvent.count({
            where: { organizationId: ctx.organizationId, action: auditAction },
          }),
        ).toBe(1);

        const later = await startOrganizationOnboarding({
          actor: ctx.admin,
          organizationId: ctx.organizationId,
        });
        expect(later.ok).toBe(false);
      });

      it("auth-loss-first: demotion before membership check leaves zero writes", async () => {
        const ctx = await seedAdminNoOnboarding(
          "lc-auth-start-d",
          "Auth Loss Start Demote",
        );
        const auditsBefore = await prisma.organizationAuditEvent.count({
          where: { organizationId: ctx.organizationId, action: auditAction },
        });

        await runAuthLossFirstDemotion(ctx, (hooks) =>
          startOrganizationOnboarding(
            {
              actor: ctx.admin,
              organizationId: ctx.organizationId,
            },
            hooks,
          ),
        );

        expect(
          await prisma.organizationOnboarding.count({
            where: { organizationId: ctx.organizationId },
          }),
        ).toBe(0);
        expect(
          await prisma.organizationAuditEvent.count({
            where: { organizationId: ctx.organizationId, action: auditAction },
          }),
        ).toBe(auditsBefore);
      });

      it("auth-loss-first: deactivation before membership check leaves zero writes", async () => {
        const ctx = await seedAdminNoOnboarding(
          "lc-auth-start-a",
          "Auth Loss Start Deactivate",
        );
        const auditsBefore = await prisma.organizationAuditEvent.count({
          where: { organizationId: ctx.organizationId, action: auditAction },
        });

        await runAuthLossFirstDeactivation(ctx, (hooks) =>
          startOrganizationOnboarding(
            {
              actor: ctx.admin,
              organizationId: ctx.organizationId,
            },
            hooks,
          ),
        );

        expect(
          await prisma.organizationOnboarding.count({
            where: { organizationId: ctx.organizationId },
          }),
        ).toBe(0);
        expect(
          await prisma.organizationAuditEvent.count({
            where: { organizationId: ctx.organizationId, action: auditAction },
          }),
        ).toBe(auditsBefore);
      });
    });

    describe("advanceOnboardingStep", () => {
      it("successful mutation then demotion still returns committed data", async () => {
        const ctx = await seedAdminAtBasics(
          "lc-post-advance-demote",
          "Post Commit Advance Demote",
        );

        const result = await runMutationThenDemotion(ctx, (hooks) =>
          advanceOnboardingStep(
            {
              actor: ctx.admin,
              organizationId: ctx.organizationId,
              step: "BUSINESS_BASICS",
              nextStep: "CONTACT_LOCATION",
              expectedVersion: ctx.onboardingVersion,
            },
            hooks,
          ),
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.onboarding!.currentStep).toBe("CONTACT_LOCATION");
          expect(result.onboarding!.version).toBe(ctx.onboardingVersion + 1);
        }

        const onboarding =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId: ctx.organizationId },
          });
        expect(onboarding.currentStep).toBe("CONTACT_LOCATION");
        expect(onboarding.version).toBe(ctx.onboardingVersion + 1);

        const later = await advanceOnboardingStep({
          actor: ctx.admin,
          organizationId: ctx.organizationId,
          step: "CONTACT_LOCATION",
          nextStep: "OPERATING_HOURS",
          expectedVersion: onboarding.version,
        });
        expect(later.ok).toBe(false);
      });

      it("successful mutation then deactivation still returns committed data", async () => {
        const ctx = await seedAdminAtBasics(
          "lc-post-advance-deact",
          "Post Commit Advance Deactivate",
        );

        const result = await runMutationThenDeactivation(ctx, (hooks) =>
          advanceOnboardingStep(
            {
              actor: ctx.admin,
              organizationId: ctx.organizationId,
              step: "BUSINESS_BASICS",
              nextStep: "CONTACT_LOCATION",
              expectedVersion: ctx.onboardingVersion,
            },
            hooks,
          ),
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.onboarding!.currentStep).toBe("CONTACT_LOCATION");
        }

        const onboarding =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId: ctx.organizationId },
          });
        expect(onboarding.currentStep).toBe("CONTACT_LOCATION");

        const later = await advanceOnboardingStep({
          actor: ctx.admin,
          organizationId: ctx.organizationId,
          step: "CONTACT_LOCATION",
          nextStep: "OPERATING_HOURS",
          expectedVersion: onboarding.version,
        });
        expect(later.ok).toBe(false);
      });

      it("auth-loss-first: demotion before membership check leaves zero writes", async () => {
        const ctx = await seedAdminAtBasics(
          "lc-auth-advance-d",
          "Auth Loss Advance Demote",
        );
        const onboardingBefore =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId: ctx.organizationId },
          });

        await runAuthLossFirstDemotion(ctx, (hooks) =>
          advanceOnboardingStep(
            {
              actor: ctx.admin,
              organizationId: ctx.organizationId,
              step: "BUSINESS_BASICS",
              nextStep: "CONTACT_LOCATION",
              expectedVersion: ctx.onboardingVersion,
            },
            hooks,
          ),
        );

        const onboardingAfter =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId: ctx.organizationId },
          });
        expect(onboardingSnapshot(onboardingAfter)).toEqual(
          onboardingSnapshot(onboardingBefore),
        );
      });

      it("auth-loss-first: deactivation before membership check leaves zero writes", async () => {
        const ctx = await seedAdminAtBasics(
          "lc-auth-advance-a",
          "Auth Loss Advance Deactivate",
        );
        const onboardingBefore =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId: ctx.organizationId },
          });

        await runAuthLossFirstDeactivation(ctx, (hooks) =>
          advanceOnboardingStep(
            {
              actor: ctx.admin,
              organizationId: ctx.organizationId,
              step: "BUSINESS_BASICS",
              nextStep: "CONTACT_LOCATION",
              expectedVersion: ctx.onboardingVersion,
            },
            hooks,
          ),
        );

        const onboardingAfter =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId: ctx.organizationId },
          });
        expect(onboardingSnapshot(onboardingAfter)).toEqual(
          onboardingSnapshot(onboardingBefore),
        );
      });
    });

    describe("completeOrganizationOnboarding", () => {
      const auditAction = "ONBOARDING_COMPLETED";

      it("successful mutation then demotion still returns committed data", async () => {
        const ctx = await seedAdminReady(
          "lc-post-complete-demote",
          "Post Commit Complete Demote",
        );

        const result = await runMutationThenDemotion(ctx, (hooks) =>
          completeOrganizationOnboarding(
            {
              actor: ctx.admin,
              organizationId: ctx.organizationId,
            },
            hooks,
          ),
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.onboarding!.status).toBe("COMPLETED");
          expect(result.onboarding!.isConfigurationReady).toBe(true);
        }

        const onboarding =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId: ctx.organizationId },
          });
        expect(onboarding.status).toBe("COMPLETED");
        expect(onboarding.isConfigurationReady).toBe(true);
        expect(
          await prisma.organizationAuditEvent.count({
            where: { organizationId: ctx.organizationId, action: auditAction },
          }),
        ).toBe(1);

        const later = await completeOrganizationOnboarding({
          actor: ctx.admin,
          organizationId: ctx.organizationId,
        });
        expect(later.ok).toBe(false);
      });

      it("successful mutation then deactivation still returns committed data", async () => {
        const ctx = await seedAdminReady(
          "lc-post-complete-deact",
          "Post Commit Complete Deactivate",
        );

        const result = await runMutationThenDeactivation(ctx, (hooks) =>
          completeOrganizationOnboarding(
            {
              actor: ctx.admin,
              organizationId: ctx.organizationId,
            },
            hooks,
          ),
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.onboarding!.status).toBe("COMPLETED");
        }

        const onboarding =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId: ctx.organizationId },
          });
        expect(onboarding.status).toBe("COMPLETED");
        expect(
          await prisma.organizationAuditEvent.count({
            where: { organizationId: ctx.organizationId, action: auditAction },
          }),
        ).toBe(1);

        const later = await completeOrganizationOnboarding({
          actor: ctx.admin,
          organizationId: ctx.organizationId,
        });
        expect(later.ok).toBe(false);
      });

      it("auth-loss-first: demotion before membership check leaves zero writes", async () => {
        const ctx = await seedAdminReady(
          "lc-auth-complete-d",
          "Auth Loss Complete Demote",
        );
        const onboardingBefore =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId: ctx.organizationId },
          });
        const auditsBefore = await prisma.organizationAuditEvent.count({
          where: { organizationId: ctx.organizationId, action: auditAction },
        });

        await runAuthLossFirstDemotion(ctx, (hooks) =>
          completeOrganizationOnboarding(
            {
              actor: ctx.admin,
              organizationId: ctx.organizationId,
            },
            hooks,
          ),
        );

        const onboardingAfter =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId: ctx.organizationId },
          });
        expect(onboardingSnapshot(onboardingAfter)).toEqual(
          onboardingSnapshot(onboardingBefore),
        );
        expect(onboardingAfter.isConfigurationReady).toBe(
          onboardingBefore.isConfigurationReady,
        );
        expect(
          await prisma.organizationAuditEvent.count({
            where: { organizationId: ctx.organizationId, action: auditAction },
          }),
        ).toBe(auditsBefore);
      });

      it("auth-loss-first: deactivation before membership check leaves zero writes", async () => {
        const ctx = await seedAdminReady(
          "lc-auth-complete-a",
          "Auth Loss Complete Deactivate",
        );
        const onboardingBefore =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId: ctx.organizationId },
          });
        const auditsBefore = await prisma.organizationAuditEvent.count({
          where: { organizationId: ctx.organizationId, action: auditAction },
        });

        await runAuthLossFirstDeactivation(ctx, (hooks) =>
          completeOrganizationOnboarding(
            {
              actor: ctx.admin,
              organizationId: ctx.organizationId,
            },
            hooks,
          ),
        );

        const onboardingAfter =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId: ctx.organizationId },
          });
        expect(onboardingSnapshot(onboardingAfter)).toEqual(
          onboardingSnapshot(onboardingBefore),
        );
        expect(onboardingAfter.isConfigurationReady).toBe(
          onboardingBefore.isConfigurationReady,
        );
        expect(
          await prisma.organizationAuditEvent.count({
            where: { organizationId: ctx.organizationId, action: auditAction },
          }),
        ).toBe(auditsBefore);
      });
    });

    describe("reopenOrganizationOnboarding", () => {
      const auditAction = "ONBOARDING_REOPENED";

      it("successful mutation then demotion still returns committed data", async () => {
        const ctx = await seedAdminCompleted(
          "lc-post-reopen-demote",
          "Post Commit Reopen Demote",
        );

        const result = await runMutationThenDemotion(ctx, (hooks) =>
          reopenOrganizationOnboarding(
            {
              actor: ctx.admin,
              organizationId: ctx.organizationId,
              expectedVersion: ctx.onboardingVersion,
            },
            hooks,
          ),
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.onboarding!.status).toBe("IN_PROGRESS");
          expect(result.onboarding!.isConfigurationReady).toBe(false);
        }

        const onboarding =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId: ctx.organizationId },
          });
        expect(onboarding.status).toBe("IN_PROGRESS");
        expect(onboarding.isConfigurationReady).toBe(false);
        expect(onboarding.version).toBe(ctx.onboardingVersion + 1);
        expect(
          await prisma.organizationAuditEvent.count({
            where: { organizationId: ctx.organizationId, action: auditAction },
          }),
        ).toBe(1);

        const later = await reopenOrganizationOnboarding({
          actor: ctx.admin,
          organizationId: ctx.organizationId,
          expectedVersion: onboarding.version,
        });
        expect(later.ok).toBe(false);
      });

      it("successful mutation then deactivation still returns committed data", async () => {
        const ctx = await seedAdminCompleted(
          "lc-post-reopen-deact",
          "Post Commit Reopen Deactivate",
        );

        const result = await runMutationThenDeactivation(ctx, (hooks) =>
          reopenOrganizationOnboarding(
            {
              actor: ctx.admin,
              organizationId: ctx.organizationId,
              expectedVersion: ctx.onboardingVersion,
            },
            hooks,
          ),
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.onboarding!.status).toBe("IN_PROGRESS");
        }

        const onboarding =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId: ctx.organizationId },
          });
        expect(onboarding.status).toBe("IN_PROGRESS");
        expect(
          await prisma.organizationAuditEvent.count({
            where: { organizationId: ctx.organizationId, action: auditAction },
          }),
        ).toBe(1);

        const later = await reopenOrganizationOnboarding({
          actor: ctx.admin,
          organizationId: ctx.organizationId,
          expectedVersion: onboarding.version,
        });
        expect(later.ok).toBe(false);
      });

      it("auth-loss-first: demotion before membership check leaves zero writes", async () => {
        const ctx = await seedAdminCompleted(
          "lc-auth-reopen-d",
          "Auth Loss Reopen Demote",
        );
        const onboardingBefore =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId: ctx.organizationId },
          });
        const auditsBefore = await prisma.organizationAuditEvent.count({
          where: { organizationId: ctx.organizationId, action: auditAction },
        });

        await runAuthLossFirstDemotion(ctx, (hooks) =>
          reopenOrganizationOnboarding(
            {
              actor: ctx.admin,
              organizationId: ctx.organizationId,
              expectedVersion: ctx.onboardingVersion,
            },
            hooks,
          ),
        );

        const onboardingAfter =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId: ctx.organizationId },
          });
        expect(onboardingSnapshot(onboardingAfter)).toEqual(
          onboardingSnapshot(onboardingBefore),
        );
        expect(onboardingAfter.isConfigurationReady).toBe(
          onboardingBefore.isConfigurationReady,
        );
        expect(
          await prisma.organizationAuditEvent.count({
            where: { organizationId: ctx.organizationId, action: auditAction },
          }),
        ).toBe(auditsBefore);
      });

      it("auth-loss-first: deactivation before membership check leaves zero writes", async () => {
        const ctx = await seedAdminCompleted(
          "lc-auth-reopen-a",
          "Auth Loss Reopen Deactivate",
        );
        const onboardingBefore =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId: ctx.organizationId },
          });
        const auditsBefore = await prisma.organizationAuditEvent.count({
          where: { organizationId: ctx.organizationId, action: auditAction },
        });

        await runAuthLossFirstDeactivation(ctx, (hooks) =>
          reopenOrganizationOnboarding(
            {
              actor: ctx.admin,
              organizationId: ctx.organizationId,
              expectedVersion: ctx.onboardingVersion,
            },
            hooks,
          ),
        );

        const onboardingAfter =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId: ctx.organizationId },
          });
        expect(onboardingSnapshot(onboardingAfter)).toEqual(
          onboardingSnapshot(onboardingBefore),
        );
        expect(onboardingAfter.isConfigurationReady).toBe(
          onboardingBefore.isConfigurationReady,
        );
        expect(
          await prisma.organizationAuditEvent.count({
            where: { organizationId: ctx.organizationId, action: auditAction },
          }),
        ).toBe(auditsBefore);
      });
    });
  });
});
