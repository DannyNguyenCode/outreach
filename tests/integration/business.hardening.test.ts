import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { hashPassword } from "@/lib/auth/password";
import type { SafeUser } from "@/lib/auth/users";
import { setMailerForTests, type EmailSender } from "@/lib/email/mailer";
import { resetServerEnvCache } from "@/lib/env/server";
import {
  acquireOrganizationReadinessLock,
  refreshConfigurationReadiness,
} from "@/lib/orgs/business-access";
import {
  getBusinessConfiguration,
  updateBusinessBasics,
  updateContactAndLocation,
} from "@/lib/orgs/business-profile";
import {
  createBusinessProduct,
  deactivateBusinessProduct,
  listBusinessProducts,
} from "@/lib/orgs/business-products";
import {
  createBusinessService,
  deactivateBusinessService,
  listBusinessServices,
} from "@/lib/orgs/business-services";
import { requireExpectedVersion } from "@/lib/orgs/business-validation";
import { changeMemberRole, deactivateMember } from "@/lib/orgs/memberships";
import {
  advanceOnboardingStep,
  completeOrganizationOnboarding,
  getOrganizationOnboarding,
  reopenOrganizationOnboarding,
  startOrganizationOnboarding,
} from "@/lib/orgs/onboarding";
import {
  getOperatingHours,
  replaceOperatingHours,
} from "@/lib/orgs/operating-hours";
import {
  getOrganizationSettings,
  updateOrganizationSettings,
} from "@/lib/orgs/organization-settings";
import { createOrganization } from "@/lib/orgs/organizations";
import { resetApplicationData } from "@/tests/integration/reset";

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

async function phase3aCounts(prisma: PrismaClient, organizationId: string) {
  const [settings, profiles, locations, hours, onboarding, audits] =
    await Promise.all([
      prisma.organizationSettings.count({ where: { organizationId } }),
      prisma.businessProfile.count({ where: { organizationId } }),
      prisma.businessLocation.count({ where: { organizationId } }),
      prisma.operatingHourInterval.count({ where: { organizationId } }),
      prisma.organizationOnboarding.count({ where: { organizationId } }),
      prisma.organizationAuditEvent.count({ where: { organizationId } }),
    ]);
  return { settings, profiles, locations, hours, onboarding, audits };
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

describe("Phase 3A hardening: reads, readiness races, optimistic concurrency", () => {
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

  describe("GET/read paths are non-mutating", () => {
    it("leaves a new organization unchanged across Phase 3A reads", async () => {
      const owner = await createVerifiedUser(prisma, "ro-owner");
      const stranger = await createVerifiedUser(prisma, "ro-stranger");
      const org = await createOrganization(owner, {
        name: "Read Only Co",
        slug: `ro-${randomUUID().slice(0, 8)}`,
      });
      if (!org.ok) throw new Error("org create failed");
      const organizationId = org.organization.id;

      const before = await phase3aCounts(prisma, organizationId);

      const reads = [
        await getOrganizationOnboarding({ actor: owner, organizationId }),
        await getBusinessConfiguration({ actor: owner, organizationId }),
        await getOperatingHours({ actor: owner, organizationId }),
        await listBusinessServices({ actor: owner, organizationId }),
        await listBusinessProducts({ actor: owner, organizationId }),
        await getOrganizationSettings({ actor: owner, organizationId }),
        await getOrganizationOnboarding({ actor: owner, organizationId }),
        await getBusinessConfiguration({
          actor: stranger,
          organizationId,
        }),
      ];

      expect(reads[0]).toMatchObject({ ok: false, reason: "not_started" });
      expect(reads[1]).toMatchObject({ ok: false, reason: "not_initialized" });
      expect(reads[5]).toMatchObject({ ok: false, reason: "not_initialized" });
      expect(reads[7].ok).toBe(false);

      const after = await phase3aCounts(prisma, organizationId);
      expect(after).toEqual(before);
      expect(after).toEqual({
        settings: 0,
        profiles: 0,
        locations: 0,
        hours: 0,
        onboarding: 0,
        audits: 1,
      });
    });

    it("starts onboarding intentionally and idempotently with one audit", async () => {
      const { owner, organizationId } = await createOrgWithOwner(
        prisma,
        "start",
        "Start Co",
      );

      const first = await startOrganizationOnboarding({
        actor: owner,
        organizationId,
      });
      const second = await startOrganizationOnboarding({
        actor: owner,
        organizationId,
      });
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);

      expect(
        await prisma.organizationOnboarding.count({
          where: { organizationId },
        }),
      ).toBe(1);
      expect(
        await prisma.organizationAuditEvent.count({
          where: {
            organizationId,
            action: "ONBOARDING_STARTED",
          },
        }),
      ).toBe(1);
    });
  });

  describe("pre-start mutations do not initialize", () => {
    it("updateBusinessBasics before start fails and creates no Phase 3A rows", async () => {
      const { owner, organizationId } = await createOrgWithOwner(
        prisma,
        "pre",
        "Pre Start Co",
      );
      const before = await phase3aCounts(prisma, organizationId);

      const result = await updateBusinessBasics({
        actor: owner,
        organizationId,
        expectedVersion: 0,
        raw: {
          displayName: "Too Early",
          industry: "Retail",
          businessType: "SERVICES",
        },
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(["organization_not_found", "not_found", "failed"]).toContain(
          result.reason,
        );
      }

      const after = await phase3aCounts(prisma, organizationId);
      expect(after).toEqual(before);
      expect(after.profiles).toBe(0);
      expect(after.settings).toBe(0);
      expect(after.onboarding).toBe(0);
      expect(
        await prisma.organizationAuditEvent.count({
          where: {
            organizationId,
            action: "BUSINESS_PROFILE_UPDATED",
          },
        }),
      ).toBe(0);
    });
  });

  describe("shared readiness lock completion races", () => {
    it("SERVICES: completion wins first; deactivation then invalidates readiness", async () => {
      const { owner, organizationId } = await createOrgWithOwner(
        prisma,
        "race-svc-c",
        "Race Svc Complete First",
      );
      await seedReadyConfig({
        prisma,
        actor: owner,
        organizationId,
        businessType: "SERVICES",
      });
      const service = await prisma.businessService.findFirstOrThrow({
        where: { organizationId, isActive: true },
      });

      const completionHeld = createGate();
      const deactivateStarted = createGate();
      const deactivateGotLock = createGate();

      const completePromise = completeOrganizationOnboarding(
        { actor: owner, organizationId },
        {
          testAfterReadinessLock: async () => {
            completionHeld.markReached();
            await completionHeld.waitForRelease();
          },
        },
      );

      await completionHeld.waitUntilReached();

      const deactivatePromise = deactivateBusinessService(
        {
          actor: owner,
          organizationId,
          serviceId: service.id,
        },
        {
          testBeforeReadinessLock: async () => {
            deactivateStarted.markReached();
          },
          testAfterReadinessLock: async () => {
            deactivateGotLock.markReached();
          },
        },
      );

      await deactivateStarted.waitUntilReached();
      completionHeld.release();
      const completeResult = await completePromise;
      expect(completeResult.ok).toBe(true);

      await deactivateGotLock.waitUntilReached();
      const deactivateResult = await deactivatePromise;
      expect(deactivateResult.ok).toBe(true);

      const onboarding = await prisma.organizationOnboarding.findUniqueOrThrow({
        where: { organizationId },
      });
      const active = await prisma.businessService.count({
        where: { organizationId, isActive: true },
      });
      expect(active).toBe(0);
      expect(onboarding.isConfigurationReady).toBe(false);
      expect(onboarding.status).toBe("IN_PROGRESS");
      expect(
        await prisma.organizationAuditEvent.count({
          where: { organizationId, action: "ONBOARDING_COMPLETED" },
        }),
      ).toBe(1);
      expect(
        await prisma.organizationAuditEvent.count({
          where: { organizationId, action: "SERVICE_DEACTIVATED" },
        }),
      ).toBe(1);
    });

    it("SERVICES: deactivation wins first; completion fails not_ready without audit", async () => {
      const { owner, organizationId } = await createOrgWithOwner(
        prisma,
        "race-svc-d",
        "Race Svc Deactivate First",
      );
      await seedReadyConfig({
        prisma,
        actor: owner,
        organizationId,
        businessType: "SERVICES",
      });
      const service = await prisma.businessService.findFirstOrThrow({
        where: { organizationId, isActive: true },
      });

      const deactivateHeld = createGate();
      const completeStarted = createGate();
      const completeGotLock = createGate();

      const deactivatePromise = deactivateBusinessService(
        {
          actor: owner,
          organizationId,
          serviceId: service.id,
        },
        {
          testAfterReadinessLock: async () => {
            deactivateHeld.markReached();
            await deactivateHeld.waitForRelease();
          },
        },
      );

      await deactivateHeld.waitUntilReached();

      const completePromise = completeOrganizationOnboarding(
        { actor: owner, organizationId },
        {
          testBeforeReadinessLock: async () => {
            completeStarted.markReached();
          },
          testAfterReadinessLock: async () => {
            completeGotLock.markReached();
          },
        },
      );

      await completeStarted.waitUntilReached();
      deactivateHeld.release();
      const deactivateResult = await deactivatePromise;
      expect(deactivateResult.ok).toBe(true);

      await completeGotLock.waitUntilReached();
      const completeResult = await completePromise;
      expect(completeResult.ok).toBe(false);
      if (!completeResult.ok) {
        expect(completeResult.reason).toBe("not_ready");
      }

      const onboarding = await prisma.organizationOnboarding.findUniqueOrThrow({
        where: { organizationId },
      });
      expect(onboarding.status).not.toBe("COMPLETED");
      expect(onboarding.isConfigurationReady).toBe(false);
      expect(
        await prisma.organizationAuditEvent.count({
          where: { organizationId, action: "ONBOARDING_COMPLETED" },
        }),
      ).toBe(0);
    });

    it("PRODUCTS: completion wins first; deactivation then invalidates readiness", async () => {
      const { owner, organizationId } = await createOrgWithOwner(
        prisma,
        "race-prod-c",
        "Race Prod Complete First",
      );
      await seedReadyConfig({
        prisma,
        actor: owner,
        organizationId,
        businessType: "PRODUCTS",
      });
      const product = await prisma.businessProduct.findFirstOrThrow({
        where: { organizationId, isActive: true },
      });

      const completionHeld = createGate();
      const deactivateStarted = createGate();
      const deactivateGotLock = createGate();

      const completePromise = completeOrganizationOnboarding(
        { actor: owner, organizationId },
        {
          testAfterReadinessLock: async () => {
            completionHeld.markReached();
            await completionHeld.waitForRelease();
          },
        },
      );

      await completionHeld.waitUntilReached();

      const deactivatePromise = deactivateBusinessProduct(
        {
          actor: owner,
          organizationId,
          productId: product.id,
        },
        {
          testBeforeReadinessLock: async () => {
            deactivateStarted.markReached();
          },
          testAfterReadinessLock: async () => {
            deactivateGotLock.markReached();
          },
        },
      );

      await deactivateStarted.waitUntilReached();
      completionHeld.release();
      const completeResult = await completePromise;
      expect(completeResult.ok).toBe(true);

      await deactivateGotLock.waitUntilReached();
      const deactivateResult = await deactivatePromise;
      expect(deactivateResult.ok).toBe(true);

      const onboarding = await prisma.organizationOnboarding.findUniqueOrThrow({
        where: { organizationId },
      });
      expect(onboarding.isConfigurationReady).toBe(false);
      expect(onboarding.status).toBe("IN_PROGRESS");
      expect(
        await prisma.organizationAuditEvent.count({
          where: { organizationId, action: "ONBOARDING_COMPLETED" },
        }),
      ).toBe(1);
    });

    it("PRODUCTS: deactivation wins first; completion fails not_ready without audit", async () => {
      const { owner, organizationId } = await createOrgWithOwner(
        prisma,
        "race-prod-d",
        "Race Prod Deactivate First",
      );
      await seedReadyConfig({
        prisma,
        actor: owner,
        organizationId,
        businessType: "PRODUCTS",
      });
      const product = await prisma.businessProduct.findFirstOrThrow({
        where: { organizationId, isActive: true },
      });

      const deactivateHeld = createGate();
      const completeStarted = createGate();
      const completeGotLock = createGate();

      const deactivatePromise = deactivateBusinessProduct(
        {
          actor: owner,
          organizationId,
          productId: product.id,
        },
        {
          testAfterReadinessLock: async () => {
            deactivateHeld.markReached();
            await deactivateHeld.waitForRelease();
          },
        },
      );

      await deactivateHeld.waitUntilReached();

      const completePromise = completeOrganizationOnboarding(
        { actor: owner, organizationId },
        {
          testBeforeReadinessLock: async () => {
            completeStarted.markReached();
          },
          testAfterReadinessLock: async () => {
            completeGotLock.markReached();
          },
        },
      );

      await completeStarted.waitUntilReached();
      deactivateHeld.release();
      expect((await deactivatePromise).ok).toBe(true);

      await completeGotLock.waitUntilReached();
      const completeResult = await completePromise;
      expect(completeResult.ok).toBe(false);
      if (!completeResult.ok) {
        expect(completeResult.reason).toBe("not_ready");
      }
      expect(
        await prisma.organizationAuditEvent.count({
          where: { organizationId, action: "ONBOARDING_COMPLETED" },
        }),
      ).toBe(0);
    });

    it("BOTH: deactivate last service while product remains invalidates after completion", async () => {
      const { owner, organizationId } = await createOrgWithOwner(
        prisma,
        "race-both-svc",
        "Race Both Service",
      );
      await seedReadyConfig({
        prisma,
        actor: owner,
        organizationId,
        businessType: "BOTH",
      });
      const service = await prisma.businessService.findFirstOrThrow({
        where: { organizationId, isActive: true },
      });

      const completionHeld = createGate();
      const deactivateStarted = createGate();

      const completePromise = completeOrganizationOnboarding(
        { actor: owner, organizationId },
        {
          testAfterReadinessLock: async () => {
            completionHeld.markReached();
            await completionHeld.waitForRelease();
          },
        },
      );
      await completionHeld.waitUntilReached();

      const deactivatePromise = deactivateBusinessService(
        {
          actor: owner,
          organizationId,
          serviceId: service.id,
        },
        {
          testBeforeReadinessLock: async () => {
            deactivateStarted.markReached();
          },
        },
      );
      await deactivateStarted.waitUntilReached();
      completionHeld.release();

      expect((await completePromise).ok).toBe(true);
      expect((await deactivatePromise).ok).toBe(true);

      const onboarding = await prisma.organizationOnboarding.findUniqueOrThrow({
        where: { organizationId },
      });
      const activeServices = await prisma.businessService.count({
        where: { organizationId, isActive: true },
      });
      const activeProducts = await prisma.businessProduct.count({
        where: { organizationId, isActive: true },
      });
      expect(activeServices).toBe(0);
      expect(activeProducts).toBe(1);
      expect(onboarding.isConfigurationReady).toBe(false);
      expect(onboarding.status).toBe("IN_PROGRESS");
    });

    it("BOTH: deactivate last product while service remains invalidates after completion", async () => {
      const { owner, organizationId } = await createOrgWithOwner(
        prisma,
        "race-both-prod",
        "Race Both Product",
      );
      await seedReadyConfig({
        prisma,
        actor: owner,
        organizationId,
        businessType: "BOTH",
      });
      const product = await prisma.businessProduct.findFirstOrThrow({
        where: { organizationId, isActive: true },
      });

      const deactivateHeld = createGate();
      const completeStarted = createGate();

      const deactivatePromise = deactivateBusinessProduct(
        {
          actor: owner,
          organizationId,
          productId: product.id,
        },
        {
          testAfterReadinessLock: async () => {
            deactivateHeld.markReached();
            await deactivateHeld.waitForRelease();
          },
        },
      );
      await deactivateHeld.waitUntilReached();

      const completePromise = completeOrganizationOnboarding(
        { actor: owner, organizationId },
        {
          testBeforeReadinessLock: async () => {
            completeStarted.markReached();
          },
        },
      );
      await completeStarted.waitUntilReached();
      deactivateHeld.release();

      expect((await deactivatePromise).ok).toBe(true);
      const completeResult = await completePromise;
      expect(completeResult.ok).toBe(false);
      if (!completeResult.ok) {
        expect(completeResult.reason).toBe("not_ready");
      }

      const activeServices = await prisma.businessService.count({
        where: { organizationId, isActive: true },
      });
      const activeProducts = await prisma.businessProduct.count({
        where: { organizationId, isActive: true },
      });
      expect(activeServices).toBe(1);
      expect(activeProducts).toBe(0);
      expect(
        await prisma.organizationAuditEvent.count({
          where: { organizationId, action: "ONBOARDING_COMPLETED" },
        }),
      ).toBe(0);
    });

    it("hours invalidation: completion first then competing readiness refresh clears ready", async () => {
      const { owner, organizationId } = await createOrgWithOwner(
        prisma,
        "race-hours-c",
        "Race Hours Complete First",
      );
      await seedReadyConfig({
        prisma,
        actor: owner,
        organizationId,
        businessType: "SERVICES",
      });

      const completionHeld = createGate();
      const competitorStarted = createGate();
      const competitorGotLock = createGate();

      const completePromise = completeOrganizationOnboarding(
        { actor: owner, organizationId },
        {
          testAfterReadinessLock: async () => {
            completionHeld.markReached();
            await completionHeld.waitForRelease();
          },
        },
      );
      await completionHeld.waitUntilReached();

      const hoursPromise = prisma.$transaction(async (tx) => {
        await acquireOrganizationReadinessLock(tx, organizationId, {
          testBeforeReadinessLock: async () => {
            competitorStarted.markReached();
          },
          testAfterReadinessLock: async () => {
            competitorGotLock.markReached();
          },
        });
        await tx.operatingHourInterval.deleteMany({
          where: { organizationId },
        });
        await refreshConfigurationReadiness(tx, organizationId);
      });

      await competitorStarted.waitUntilReached();
      completionHeld.release();
      expect((await completePromise).ok).toBe(true);

      await competitorGotLock.waitUntilReached();
      await hoursPromise;

      const onboarding = await prisma.organizationOnboarding.findUniqueOrThrow({
        where: { organizationId },
      });
      expect(
        await prisma.operatingHourInterval.count({ where: { organizationId } }),
      ).toBe(0);
      expect(onboarding.isConfigurationReady).toBe(false);
      expect(onboarding.status).toBe("IN_PROGRESS");
    });

    it("hours invalidation: competing refresh wins first; completion fails not_ready", async () => {
      const { owner, organizationId } = await createOrgWithOwner(
        prisma,
        "race-hours-d",
        "Race Hours Delete First",
      );
      await seedReadyConfig({
        prisma,
        actor: owner,
        organizationId,
        businessType: "SERVICES",
      });

      const hoursHeld = createGate();
      const completeStarted = createGate();
      const completeGotLock = createGate();

      const hoursPromise = prisma.$transaction(async (tx) => {
        await acquireOrganizationReadinessLock(tx, organizationId, {
          testAfterReadinessLock: async () => {
            hoursHeld.markReached();
            await hoursHeld.waitForRelease();
          },
        });
        await tx.operatingHourInterval.deleteMany({
          where: { organizationId },
        });
        await refreshConfigurationReadiness(tx, organizationId);
      });
      await hoursHeld.waitUntilReached();

      const completePromise = completeOrganizationOnboarding(
        { actor: owner, organizationId },
        {
          testBeforeReadinessLock: async () => {
            completeStarted.markReached();
          },
          testAfterReadinessLock: async () => {
            completeGotLock.markReached();
          },
        },
      );
      await completeStarted.waitUntilReached();
      hoursHeld.release();
      await hoursPromise;

      await completeGotLock.waitUntilReached();
      const completeResult = await completePromise;
      expect(completeResult.ok).toBe(false);
      if (!completeResult.ok) {
        expect(completeResult.reason).toBe("not_ready");
      }
      expect(
        await prisma.organizationAuditEvent.count({
          where: { organizationId, action: "ONBOARDING_COMPLETED" },
        }),
      ).toBe(0);
    });

    it("business-type race: completion vs SERVICES→BOTH without product fails or invalidates", async () => {
      const { owner, organizationId } = await createOrgWithOwner(
        prisma,
        "race-type",
        "Race Business Type",
      );
      await seedReadyConfig({
        prisma,
        actor: owner,
        organizationId,
        businessType: "SERVICES",
      });
      const profile = await prisma.businessProfile.findUniqueOrThrow({
        where: { organizationId },
      });

      const completionHeld = createGate();
      const typeStarted = createGate();
      const typeGotLock = createGate();

      const completePromise = completeOrganizationOnboarding(
        { actor: owner, organizationId },
        {
          testAfterReadinessLock: async () => {
            completionHeld.markReached();
            await completionHeld.waitForRelease();
          },
        },
      );
      await completionHeld.waitUntilReached();

      const typePromise = updateBusinessBasics(
        {
          actor: owner,
          organizationId,
          expectedVersion: profile.version,
          raw: {
            displayName: "Ready Biz",
            industry: "Retail",
            businessType: "BOTH",
          },
        },
        {
          testBeforeReadinessLock: async () => {
            typeStarted.markReached();
          },
          testAfterReadinessLock: async () => {
            typeGotLock.markReached();
          },
        },
      );
      await typeStarted.waitUntilReached();
      completionHeld.release();

      const completeResult = await completePromise;
      expect(completeResult.ok).toBe(true);

      await typeGotLock.waitUntilReached();
      const typeResult = await typePromise;
      expect(typeResult.ok).toBe(true);

      const onboarding = await prisma.organizationOnboarding.findUniqueOrThrow({
        where: { organizationId },
      });
      const activeProducts = await prisma.businessProduct.count({
        where: { organizationId, isActive: true },
      });
      expect(activeProducts).toBe(0);
      expect(onboarding.isConfigurationReady).toBe(false);
      expect(onboarding.status).toBe("IN_PROGRESS");
    });

    it("demotion race: admin completing vs ADMIN→MEMBER while holding readiness lock", async () => {
      const { owner, organizationId } = await createOrgWithOwner(
        prisma,
        "race-demote",
        "Race Demote",
      );
      const admin = await addAdmin(prisma, organizationId, "race-demote-admin");
      await seedReadyConfig({
        prisma,
        actor: owner,
        organizationId,
        businessType: "SERVICES",
      });
      const membership = await prisma.membership.findFirstOrThrow({
        where: { organizationId, userId: admin.id },
      });

      const seam = createGate();
      const completePromise = completeOrganizationOnboarding(
        { actor: admin, organizationId },
        {
          testAfterReadinessLock: async () => {
            seam.markReached();
            await seam.waitForRelease();
          },
        },
      );

      await seam.waitUntilReached();
      const demote = await changeMemberRole({
        actor: owner,
        organizationId,
        membershipId: membership.id,
        nextRole: "MEMBER",
      });
      expect(demote.ok).toBe(true);
      seam.release();

      const result = await completePromise;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(["forbidden", "inactive_membership", "not_a_member"]).toContain(
          result.reason,
        );
      }
      expect(
        await prisma.organizationAuditEvent.count({
          where: { organizationId, action: "ONBOARDING_COMPLETED" },
        }),
      ).toBe(0);
    });

    it("deactivation race: completion racing actor deactivation rechecks authority", async () => {
      const { owner, organizationId } = await createOrgWithOwner(
        prisma,
        "race-auth",
        "Race Auth",
      );
      const admin = await addAdmin(prisma, organizationId, "race-auth-admin");
      await seedReadyConfig({
        prisma,
        actor: owner,
        organizationId,
        businessType: "SERVICES",
      });

      const seam = createGate();
      const completePromise = completeOrganizationOnboarding(
        { actor: admin, organizationId },
        {
          testAfterReadinessLock: async () => {
            seam.markReached();
            await seam.waitForRelease();
          },
        },
      );

      await seam.waitUntilReached();
      const membership = await prisma.membership.findFirstOrThrow({
        where: { organizationId, userId: admin.id },
      });
      await deactivateMember({
        actor: owner,
        organizationId,
        membershipId: membership.id,
      });
      seam.release();

      const result = await completePromise;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(["inactive_membership", "not_a_member", "forbidden"]).toContain(
          result.reason,
        );
      }
      expect(
        await prisma.organizationAuditEvent.count({
          where: { organizationId, action: "ONBOARDING_COMPLETED" },
        }),
      ).toBe(0);
    });
  });

  describe("step advance races with completion and reopen", () => {
    it("advance wins first; completion then succeeds", async () => {
      const { owner, organizationId } = await createOrgWithOwner(
        prisma,
        "adv-comp-a",
        "Advance Complete A",
      );
      await seedReadyConfig({
        prisma,
        actor: owner,
        organizationId,
        businessType: "SERVICES",
      });
      const onboarding = await prisma.organizationOnboarding.findUniqueOrThrow({
        where: { organizationId },
      });

      const advanceHeld = createGate();
      const completeStarted = createGate();
      const completeGotLock = createGate();

      const advancePromise = advanceOnboardingStep(
        {
          actor: owner,
          organizationId,
          step: "REVIEW",
          nextStep: "REVIEW",
          expectedVersion: onboarding.version,
        },
        {
          testAfterReadinessLock: async () => {
            advanceHeld.markReached();
            await advanceHeld.waitForRelease();
          },
        },
      );
      await advanceHeld.waitUntilReached();

      const completePromise = completeOrganizationOnboarding(
        { actor: owner, organizationId },
        {
          testBeforeReadinessLock: async () => {
            completeStarted.markReached();
          },
          testAfterReadinessLock: async () => {
            completeGotLock.markReached();
          },
        },
      );
      await completeStarted.waitUntilReached();
      advanceHeld.release();

      expect((await advancePromise).ok).toBe(true);
      await completeGotLock.waitUntilReached();
      expect((await completePromise).ok).toBe(true);

      const final = await prisma.organizationOnboarding.findUniqueOrThrow({
        where: { organizationId },
      });
      expect(final.status).toBe("COMPLETED");
      expect(final.isConfigurationReady).toBe(true);
    });

    it("completion wins first; advance with stale version conflicts", async () => {
      const { owner, organizationId } = await createOrgWithOwner(
        prisma,
        "adv-comp-b",
        "Advance Complete B",
      );
      await seedReadyConfig({
        prisma,
        actor: owner,
        organizationId,
        businessType: "SERVICES",
      });
      const onboarding = await prisma.organizationOnboarding.findUniqueOrThrow({
        where: { organizationId },
      });
      const staleVersion = onboarding.version;

      const completionHeld = createGate();
      const advanceStarted = createGate();
      const advanceGotLock = createGate();

      const completePromise = completeOrganizationOnboarding(
        { actor: owner, organizationId },
        {
          testAfterReadinessLock: async () => {
            completionHeld.markReached();
            await completionHeld.waitForRelease();
          },
        },
      );
      await completionHeld.waitUntilReached();

      const advancePromise = advanceOnboardingStep(
        {
          actor: owner,
          organizationId,
          step: "CATALOGUE",
          nextStep: "EMPLOYEE_DEFAULTS",
          expectedVersion: staleVersion,
        },
        {
          testBeforeReadinessLock: async () => {
            advanceStarted.markReached();
          },
          testAfterReadinessLock: async () => {
            advanceGotLock.markReached();
          },
        },
      );
      await advanceStarted.waitUntilReached();
      completionHeld.release();

      expect((await completePromise).ok).toBe(true);
      await advanceGotLock.waitUntilReached();
      const advanceResult = await advancePromise;
      expect(advanceResult.ok).toBe(false);
      if (!advanceResult.ok) {
        expect(["already_completed", "conflict"]).toContain(
          advanceResult.reason,
        );
      }
      const after = await prisma.organizationOnboarding.findUniqueOrThrow({
        where: { organizationId },
      });
      expect(after.status).toBe("COMPLETED");
      expect(after.currentStep).toBe("REVIEW");
    });

    it("advance on completed rejects; reopen then succeeds with same version", async () => {
      const { owner, organizationId } = await createOrgWithOwner(
        prisma,
        "adv-reopen-a",
        "Advance Reopen A",
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
      if (!completed.ok) return;
      const version = completed.onboarding.version;

      const advanceHeld = createGate();
      const reopenStarted = createGate();

      const advancePromise = advanceOnboardingStep(
        {
          actor: owner,
          organizationId,
          step: "REVIEW",
          nextStep: "REVIEW",
          expectedVersion: version,
        },
        {
          testAfterReadinessLock: async () => {
            advanceHeld.markReached();
            await advanceHeld.waitForRelease();
          },
        },
      );
      await advanceHeld.waitUntilReached();

      const reopenPromise = reopenOrganizationOnboarding(
        {
          actor: owner,
          organizationId,
          expectedVersion: version,
        },
        {
          testBeforeReadinessLock: async () => {
            reopenStarted.markReached();
          },
        },
      );
      await reopenStarted.waitUntilReached();
      advanceHeld.release();

      const advanceResult = await advancePromise;
      expect(advanceResult.ok).toBe(false);
      if (!advanceResult.ok) {
        expect(advanceResult.reason).toBe("already_completed");
      }
      const reopenResult = await reopenPromise;
      expect(reopenResult.ok).toBe(true);
      if (reopenResult.ok) {
        expect(reopenResult.onboarding.status).toBe("IN_PROGRESS");
      }
    });

    it("reopen wins first; advance with stale version conflicts", async () => {
      const { owner, organizationId } = await createOrgWithOwner(
        prisma,
        "adv-reopen-b",
        "Advance Reopen B",
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
      if (!completed.ok) return;
      const version = completed.onboarding.version;

      const reopenHeld = createGate();
      const advanceStarted = createGate();

      const reopenPromise = reopenOrganizationOnboarding(
        {
          actor: owner,
          organizationId,
          expectedVersion: version,
        },
        {
          testAfterReadinessLock: async () => {
            reopenHeld.markReached();
            await reopenHeld.waitForRelease();
          },
        },
      );
      await reopenHeld.waitUntilReached();

      const advancePromise = advanceOnboardingStep(
        {
          actor: owner,
          organizationId,
          step: "REVIEW",
          nextStep: "REVIEW",
          expectedVersion: version,
        },
        {
          testBeforeReadinessLock: async () => {
            advanceStarted.markReached();
          },
        },
      );
      await advanceStarted.waitUntilReached();
      reopenHeld.release();

      expect((await reopenPromise).ok).toBe(true);
      const advanceResult = await advancePromise;
      expect(advanceResult.ok).toBe(false);
      if (!advanceResult.ok) {
        // Stale pre-reopen version, or completed-state rejection if scheduling differs.
        expect(["conflict", "already_completed"]).toContain(
          advanceResult.reason,
        );
      }
    });
  });

  describe("atomic optimistic concurrency", () => {
    it("same-version profile updates produce one winner and one conflict", async () => {
      const { owner, organizationId } = await createOrgWithOwner(
        prisma,
        "opt-prof",
        "Opt Profile",
      );
      const admin = await addAdmin(prisma, organizationId, "opt-prof-b");
      await startOrganizationOnboarding({ actor: owner, organizationId });

      const profile = await prisma.businessProfile.findUniqueOrThrow({
        where: { organizationId },
      });
      const version = profile.version;

      const aHeld = createGate();
      const bStarted = createGate();
      const bGotLock = createGate();

      const aPromise = updateBusinessBasics(
        {
          actor: owner,
          organizationId,
          expectedVersion: version,
          raw: {
            displayName: "Winner Name",
            industry: "Healthcare",
            businessType: "SERVICES",
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
          expectedVersion: version,
          raw: {
            displayName: "Loser Name",
            industry: "Retail",
            businessType: "PRODUCTS",
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

      const final = await prisma.businessProfile.findUniqueOrThrow({
        where: { organizationId },
      });
      expect(final.displayName).toBe("Winner Name");
      expect(final.industry).toBe("Healthcare");
      expect(final.version).toBe(version + 1);
      expect(
        await prisma.organizationAuditEvent.count({
          where: { organizationId, action: "BUSINESS_PROFILE_UPDATED" },
        }),
      ).toBe(1);
    });

    it("same-version settings updates produce one winner and one conflict", async () => {
      const { owner, organizationId } = await createOrgWithOwner(
        prisma,
        "opt-set",
        "Opt Settings",
      );
      const admin = await addAdmin(prisma, organizationId, "opt-set-b");
      await startOrganizationOnboarding({ actor: owner, organizationId });
      const settings = await prisma.organizationSettings.findUniqueOrThrow({
        where: { organizationId },
      });

      const aHeld = createGate();
      const bStarted = createGate();
      const bGotLock = createGate();

      const aPromise = updateOrganizationSettings(
        {
          actor: owner,
          organizationId,
          expectedVersion: settings.version,
          raw: {
            membersCanViewServices: false,
            membersCanViewProducts: true,
            membersCanViewBusinessInfo: true,
            futureCallingAccessDefault: "DISABLED",
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
          raw: {
            membersCanViewServices: true,
            membersCanViewProducts: false,
            membersCanViewBusinessInfo: false,
            futureCallingAccessDefault: "STANDARD",
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

      const final = await prisma.organizationSettings.findUniqueOrThrow({
        where: { organizationId },
      });
      expect(final.version).toBe(settings.version + 1);
      expect(final.membersCanViewServices).toBe(false);
      expect(
        await prisma.organizationAuditEvent.count({
          where: { organizationId, action: "ORGANIZATION_SETTINGS_UPDATED" },
        }),
      ).toBe(1);
    });

    it("same-version reopen produces one winner and one conflict", async () => {
      const { owner, organizationId } = await createOrgWithOwner(
        prisma,
        "opt-reopen",
        "Opt Reopen",
      );
      const admin = await addAdmin(prisma, organizationId, "opt-reopen-b");
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
      if (!completed.ok) return;

      const version = completed.onboarding.version;
      const aHeld = createGate();
      const bStarted = createGate();
      const bGotLock = createGate();

      const aPromise = reopenOrganizationOnboarding(
        {
          actor: owner,
          organizationId,
          expectedVersion: version,
        },
        {
          testAfterReadinessLock: async () => {
            aHeld.markReached();
            await aHeld.waitForRelease();
          },
        },
      );
      await aHeld.waitUntilReached();

      const bPromise = reopenOrganizationOnboarding(
        {
          actor: admin,
          organizationId,
          expectedVersion: version,
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

      const okCount = [aResult, bResult].filter((r) => r.ok).length;
      const conflictCount = [aResult, bResult].filter(
        (r) => !r.ok && r.reason === "conflict",
      ).length;
      expect(okCount).toBe(1);
      expect(conflictCount).toBe(1);
      expect(
        await prisma.organizationAuditEvent.count({
          where: { organizationId, action: "ONBOARDING_REOPENED" },
        }),
      ).toBe(1);
    });
  });

  describe("expectedVersion validation and conflicts", () => {
    it("requireExpectedVersion rejects malformed values and accepts safe integers", () => {
      expect(requireExpectedVersion(undefined).ok).toBe(false);
      expect(requireExpectedVersion(null).ok).toBe(false);
      expect(requireExpectedVersion("").ok).toBe(false);
      expect(requireExpectedVersion("abc").ok).toBe(false);
      expect(requireExpectedVersion("1.5").ok).toBe(false);
      expect(requireExpectedVersion("-1").ok).toBe(false);
      expect(requireExpectedVersion(-1).ok).toBe(false);
      expect(requireExpectedVersion(1.5).ok).toBe(false);
      expect(requireExpectedVersion(Number.MAX_SAFE_INTEGER + 1).ok).toBe(
        false,
      );
      expect(requireExpectedVersion("9007199254740992").ok).toBe(false);

      const zero = requireExpectedVersion(0);
      expect(zero).toEqual({ ok: true, version: 0 });
      const positive = requireExpectedVersion(42);
      expect(positive).toEqual({ ok: true, version: 42 });
      const stringInt = requireExpectedVersion("7");
      expect(stringInt).toEqual({ ok: true, version: 7 });
    });

    it("service mutations reject bad versions, conflict on stale, succeed on current", async () => {
      const { owner, organizationId } = await createOrgWithOwner(
        prisma,
        "ver",
        "Version Co",
      );
      await startOrganizationOnboarding({ actor: owner, organizationId });
      const profile = await prisma.businessProfile.findUniqueOrThrow({
        where: { organizationId },
      });

      const missing = await updateBusinessBasics({
        actor: owner,
        organizationId,
        expectedVersion: undefined as unknown as number,
        raw: {
          displayName: "X",
          industry: "Retail",
          businessType: "SERVICES",
        },
      });
      expect(missing.ok).toBe(false);
      if (!missing.ok) expect(missing.reason).toBe("validation");

      const alpha = await updateBusinessBasics({
        actor: owner,
        organizationId,
        expectedVersion: "abc" as unknown as number,
        raw: {
          displayName: "X",
          industry: "Retail",
          businessType: "SERVICES",
        },
      });
      expect(alpha.ok).toBe(false);
      if (!alpha.ok) expect(alpha.reason).toBe("validation");

      const decimal = await updateBusinessBasics({
        actor: owner,
        organizationId,
        expectedVersion: "1.5" as unknown as number,
        raw: {
          displayName: "X",
          industry: "Retail",
          businessType: "SERVICES",
        },
      });
      expect(decimal.ok).toBe(false);
      if (!decimal.ok) expect(decimal.reason).toBe("validation");

      const negative = await updateBusinessBasics({
        actor: owner,
        organizationId,
        expectedVersion: -1 as unknown as number,
        raw: {
          displayName: "X",
          industry: "Retail",
          businessType: "SERVICES",
        },
      });
      expect(negative.ok).toBe(false);
      if (!negative.ok) expect(negative.reason).toBe("validation");

      const unsafe = await updateBusinessBasics({
        actor: owner,
        organizationId,
        expectedVersion: (Number.MAX_SAFE_INTEGER + 1) as unknown as number,
        raw: {
          displayName: "X",
          industry: "Retail",
          businessType: "SERVICES",
        },
      });
      expect(unsafe.ok).toBe(false);
      if (!unsafe.ok) expect(unsafe.reason).toBe("validation");

      expect(
        await prisma.organizationAuditEvent.count({
          where: { organizationId, action: "BUSINESS_PROFILE_UPDATED" },
        }),
      ).toBe(0);

      const stale = await updateBusinessBasics({
        actor: owner,
        organizationId,
        expectedVersion: profile.version + 99,
        raw: {
          displayName: "Stale",
          industry: "Retail",
          businessType: "SERVICES",
        },
      });
      expect(stale.ok).toBe(false);
      if (!stale.ok) expect(stale.reason).toBe("conflict");

      const good = await updateBusinessBasics({
        actor: owner,
        organizationId,
        expectedVersion: profile.version,
        raw: {
          displayName: "Good Version",
          industry: "Retail",
          businessType: "SERVICES",
        },
      });
      expect(good.ok).toBe(true);

      const final = await prisma.businessProfile.findUniqueOrThrow({
        where: { organizationId },
      });
      expect(final.displayName).toBe("Good Version");
      expect(final.version).toBe(profile.version + 1);
    });
  });
});
