import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { hashPassword } from "@/lib/auth/password";
import type { SafeUser } from "@/lib/auth/users";
import { setMailerForTests, type EmailSender } from "@/lib/email/mailer";
import { resetServerEnvCache } from "@/lib/env/server";
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
import {
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
import { deactivateMember } from "@/lib/orgs/memberships";
import { resetApplicationData } from "@/tests/integration/reset";

const mockMailer: EmailSender = {
  async send() {},
};

function createGate() {
  let release!: () => void;
  let reached = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    gate,
    release: () => release(),
    markReached: () => {
      reached = true;
    },
    isReached: () => reached,
  };
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 5_000,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for test seam");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
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
  actor: SafeUser;
  organizationId: string;
  businessType?: "SERVICES" | "PRODUCTS" | "BOTH";
}) {
  const businessType = input.businessType ?? "SERVICES";
  await startOrganizationOnboarding({
    actor: input.actor,
    organizationId: input.organizationId,
  });
  await updateBusinessBasics({
    actor: input.actor,
    organizationId: input.organizationId,
    raw: {
      displayName: "Ready Biz",
      industry: "Retail",
      businessType,
    },
  });
  await updateContactAndLocation({
    actor: input.actor,
    organizationId: input.organizationId,
    raw: {
      primaryEmail: "ready@example.com",
      primaryPhone: "4165551234",
      timeZone: "America/Toronto",
      countryCode: "CA",
      city: "Toronto",
    },
  });
  await replaceOperatingHours({
    actor: input.actor,
    organizationId: input.organizationId,
    raw: { intervals: defaultWeek() },
  });
  if (businessType === "SERVICES" || businessType === "BOTH") {
    await createBusinessService({
      actor: input.actor,
      organizationId: input.organizationId,
      raw: { name: "Consult" },
    });
  }
  if (businessType === "PRODUCTS" || businessType === "BOTH") {
    await createBusinessProduct({
      actor: input.actor,
      organizationId: input.organizationId,
      raw: { name: "Widget", sku: `SKU-${randomUUID().slice(0, 6)}` },
    });
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
      // ORGANIZATION_CREATED audit exists from org creation; Phase 3A reads add nothing.
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
      const owner = await createVerifiedUser(prisma, "start-owner");
      const org = await createOrganization(owner, {
        name: "Start Co",
        slug: `start-${randomUUID().slice(0, 8)}`,
      });
      if (!org.ok) throw new Error("org create failed");

      const first = await startOrganizationOnboarding({
        actor: owner,
        organizationId: org.organization.id,
      });
      const second = await startOrganizationOnboarding({
        actor: owner,
        organizationId: org.organization.id,
      });
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);

      expect(
        await prisma.organizationOnboarding.count({
          where: { organizationId: org.organization.id },
        }),
      ).toBe(1);
      expect(
        await prisma.organizationAuditEvent.count({
          where: {
            organizationId: org.organization.id,
            action: "ONBOARDING_STARTED",
          },
        }),
      ).toBe(1);
    });
  });

  describe("shared readiness lock completion races", () => {
    it("completion wins first; deactivation then invalidates readiness", async () => {
      const owner = await createVerifiedUser(prisma, "race-svc-owner");
      const org = await createOrganization(owner, {
        name: "Race Svc",
        slug: `race-svc-${randomUUID().slice(0, 8)}`,
      });
      if (!org.ok) throw new Error("org create failed");
      await seedReadyConfig({
        actor: owner,
        organizationId: org.organization.id,
        businessType: "SERVICES",
      });
      const service = await prisma.businessService.findFirstOrThrow({
        where: { organizationId: org.organization.id, isActive: true },
      });

      const completionHeld = createGate();
      const deactivateStarted = createGate();
      const deactivateGotLock = createGate();

      const completePromise = completeOrganizationOnboarding(
        { actor: owner, organizationId: org.organization.id },
        {
          testAfterReadinessLock: async () => {
            completionHeld.markReached();
            await completionHeld.gate;
          },
        },
      );

      await waitUntil(completionHeld.isReached);

      const deactivatePromise = deactivateBusinessService(
        {
          actor: owner,
          organizationId: org.organization.id,
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

      await waitUntil(deactivateStarted.isReached);
      expect(deactivateGotLock.isReached()).toBe(false);

      completionHeld.release();
      const completeResult = await completePromise;
      expect(completeResult.ok).toBe(true);

      await waitUntil(deactivateGotLock.isReached);
      const deactivateResult = await deactivatePromise;
      expect(deactivateResult.ok).toBe(true);

      const onboarding = await prisma.organizationOnboarding.findUniqueOrThrow({
        where: { organizationId: org.organization.id },
      });
      const active = await prisma.businessService.count({
        where: { organizationId: org.organization.id, isActive: true },
      });
      expect(active).toBe(0);
      expect(onboarding.isConfigurationReady).toBe(false);
      expect(onboarding.status).toBe("IN_PROGRESS");
      expect(
        await prisma.organizationAuditEvent.count({
          where: {
            organizationId: org.organization.id,
            action: "ONBOARDING_COMPLETED",
          },
        }),
      ).toBe(1);
      expect(
        await prisma.organizationAuditEvent.count({
          where: {
            organizationId: org.organization.id,
            action: "SERVICE_DEACTIVATED",
          },
        }),
      ).toBe(1);
    });

    it("deactivation wins first; completion fails not_ready without audit", async () => {
      const owner = await createVerifiedUser(prisma, "race-prod-owner");
      const org = await createOrganization(owner, {
        name: "Race Prod",
        slug: `race-prod-${randomUUID().slice(0, 8)}`,
      });
      if (!org.ok) throw new Error("org create failed");
      await seedReadyConfig({
        actor: owner,
        organizationId: org.organization.id,
        businessType: "PRODUCTS",
      });
      const product = await prisma.businessProduct.findFirstOrThrow({
        where: { organizationId: org.organization.id, isActive: true },
      });

      const deactivateHeld = createGate();
      const completeStarted = createGate();
      const completeGotLock = createGate();

      const deactivatePromise = deactivateBusinessProduct(
        {
          actor: owner,
          organizationId: org.organization.id,
          productId: product.id,
        },
        {
          testAfterReadinessLock: async () => {
            deactivateHeld.markReached();
            await deactivateHeld.gate;
          },
        },
      );

      await waitUntil(deactivateHeld.isReached);

      const completePromise = completeOrganizationOnboarding(
        { actor: owner, organizationId: org.organization.id },
        {
          testBeforeReadinessLock: async () => {
            completeStarted.markReached();
          },
          testAfterReadinessLock: async () => {
            completeGotLock.markReached();
          },
        },
      );

      await waitUntil(completeStarted.isReached);
      expect(completeGotLock.isReached()).toBe(false);

      deactivateHeld.release();
      const deactivateResult = await deactivatePromise;
      expect(deactivateResult.ok).toBe(true);

      await waitUntil(completeGotLock.isReached);
      const completeResult = await completePromise;
      expect(completeResult.ok).toBe(false);
      if (!completeResult.ok) {
        expect(completeResult.reason).toBe("not_ready");
      }

      const onboarding = await prisma.organizationOnboarding.findUniqueOrThrow({
        where: { organizationId: org.organization.id },
      });
      expect(onboarding.status).not.toBe("COMPLETED");
      expect(onboarding.isConfigurationReady).toBe(false);
      expect(
        await prisma.organizationAuditEvent.count({
          where: {
            organizationId: org.organization.id,
            action: "ONBOARDING_COMPLETED",
          },
        }),
      ).toBe(0);
    });

    it("completion racing actor deactivation rechecks authority", async () => {
      const owner = await createVerifiedUser(prisma, "race-auth-owner");
      const admin = await createVerifiedUser(prisma, "race-auth-admin");
      const org = await createOrganization(owner, {
        name: "Race Auth",
        slug: `race-auth-${randomUUID().slice(0, 8)}`,
      });
      if (!org.ok) throw new Error("org create failed");
      await prisma.membership.create({
        data: {
          organizationId: org.organization.id,
          userId: admin.id,
          role: "ADMIN",
          status: "ACTIVE",
        },
      });
      await seedReadyConfig({
        actor: owner,
        organizationId: org.organization.id,
        businessType: "SERVICES",
      });

      const seam = createGate();
      const completePromise = completeOrganizationOnboarding(
        { actor: admin, organizationId: org.organization.id },
        {
          testAfterReadinessLock: async () => {
            seam.markReached();
            await seam.gate;
          },
        },
      );

      await waitUntil(seam.isReached);
      const membership = await prisma.membership.findFirstOrThrow({
        where: {
          organizationId: org.organization.id,
          userId: admin.id,
        },
      });
      await deactivateMember({
        actor: owner,
        organizationId: org.organization.id,
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
          where: {
            organizationId: org.organization.id,
            action: "ONBOARDING_COMPLETED",
          },
        }),
      ).toBe(0);
    });
  });

  describe("atomic optimistic concurrency", () => {
    it("same-version profile updates produce one winner and one conflict", async () => {
      const owner = await createVerifiedUser(prisma, "opt-prof-a");
      const admin = await createVerifiedUser(prisma, "opt-prof-b");
      const org = await createOrganization(owner, {
        name: "Opt Profile",
        slug: `opt-prof-${randomUUID().slice(0, 8)}`,
      });
      if (!org.ok) throw new Error("org create failed");
      await prisma.membership.create({
        data: {
          organizationId: org.organization.id,
          userId: admin.id,
          role: "ADMIN",
          status: "ACTIVE",
        },
      });
      await startOrganizationOnboarding({
        actor: owner,
        organizationId: org.organization.id,
      });

      const profile = await prisma.businessProfile.findUniqueOrThrow({
        where: { organizationId: org.organization.id },
      });
      const version = profile.version;

      const aHeld = createGate();
      const bStarted = createGate();
      const bGotLock = createGate();

      const aPromise = updateBusinessBasics(
        {
          actor: owner,
          organizationId: org.organization.id,
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
            await aHeld.gate;
          },
        },
      );

      await waitUntil(aHeld.isReached);

      const bPromise = updateBusinessBasics(
        {
          actor: admin,
          organizationId: org.organization.id,
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

      await waitUntil(bStarted.isReached);
      expect(bGotLock.isReached()).toBe(false);
      aHeld.release();

      const aResult = await aPromise;
      await waitUntil(bGotLock.isReached);
      const bResult = await bPromise;

      expect(aResult.ok).toBe(true);
      expect(bResult.ok).toBe(false);
      if (!bResult.ok) expect(bResult.reason).toBe("conflict");

      const final = await prisma.businessProfile.findUniqueOrThrow({
        where: { organizationId: org.organization.id },
      });
      expect(final.displayName).toBe("Winner Name");
      expect(final.industry).toBe("Healthcare");
      expect(final.version).toBe(version + 1);

      const audits = await prisma.organizationAuditEvent.count({
        where: {
          organizationId: org.organization.id,
          action: "BUSINESS_PROFILE_UPDATED",
        },
      });
      expect(audits).toBe(1);
    });

    it("same-version settings updates produce one winner and one conflict", async () => {
      const owner = await createVerifiedUser(prisma, "opt-set-a");
      const admin = await createVerifiedUser(prisma, "opt-set-b");
      const org = await createOrganization(owner, {
        name: "Opt Settings",
        slug: `opt-set-${randomUUID().slice(0, 8)}`,
      });
      if (!org.ok) throw new Error("org create failed");
      await prisma.membership.create({
        data: {
          organizationId: org.organization.id,
          userId: admin.id,
          role: "ADMIN",
          status: "ACTIVE",
        },
      });
      await startOrganizationOnboarding({
        actor: owner,
        organizationId: org.organization.id,
      });
      const settings = await prisma.organizationSettings.findUniqueOrThrow({
        where: { organizationId: org.organization.id },
      });

      const [aResult, bResult] = await Promise.all([
        updateOrganizationSettings({
          actor: owner,
          organizationId: org.organization.id,
          expectedVersion: settings.version,
          raw: {
            membersCanViewServices: false,
            membersCanViewProducts: true,
            membersCanViewBusinessInfo: true,
            futureCallingAccessDefault: "DISABLED",
          },
        }),
        updateOrganizationSettings({
          actor: admin,
          organizationId: org.organization.id,
          expectedVersion: settings.version,
          raw: {
            membersCanViewServices: true,
            membersCanViewProducts: false,
            membersCanViewBusinessInfo: false,
            futureCallingAccessDefault: "STANDARD",
          },
        }),
      ]);

      const outcomes = [aResult, bResult];
      expect(outcomes.filter((r) => r.ok)).toHaveLength(1);
      expect(
        outcomes.filter((r) => !r.ok && r.reason === "conflict"),
      ).toHaveLength(1);

      const final = await prisma.organizationSettings.findUniqueOrThrow({
        where: { organizationId: org.organization.id },
      });
      expect(final.version).toBe(settings.version + 1);
      expect(
        await prisma.organizationAuditEvent.count({
          where: {
            organizationId: org.organization.id,
            action: "ORGANIZATION_SETTINGS_UPDATED",
          },
        }),
      ).toBe(1);
    });

    it("same-version reopen produces one winner and one conflict", async () => {
      const owner = await createVerifiedUser(prisma, "opt-reopen-a");
      const admin = await createVerifiedUser(prisma, "opt-reopen-b");
      const org = await createOrganization(owner, {
        name: "Opt Reopen",
        slug: `opt-reopen-${randomUUID().slice(0, 8)}`,
      });
      if (!org.ok) throw new Error("org create failed");
      await prisma.membership.create({
        data: {
          organizationId: org.organization.id,
          userId: admin.id,
          role: "ADMIN",
          status: "ACTIVE",
        },
      });
      await seedReadyConfig({
        actor: owner,
        organizationId: org.organization.id,
        businessType: "SERVICES",
      });
      const completed = await completeOrganizationOnboarding({
        actor: owner,
        organizationId: org.organization.id,
      });
      expect(completed.ok).toBe(true);
      if (!completed.ok) return;

      const version = completed.onboarding.version;
      const aHeld = createGate();
      const bStarted = createGate();

      const aPromise = reopenOrganizationOnboarding(
        {
          actor: owner,
          organizationId: org.organization.id,
          expectedVersion: version,
        },
        {
          testAfterReadinessLock: async () => {
            aHeld.markReached();
            await aHeld.gate;
          },
        },
      );
      await waitUntil(aHeld.isReached);

      const bPromise = reopenOrganizationOnboarding(
        {
          actor: admin,
          organizationId: org.organization.id,
          expectedVersion: version,
        },
        {
          testBeforeReadinessLock: async () => {
            bStarted.markReached();
          },
        },
      );
      await waitUntil(bStarted.isReached);
      aHeld.release();

      const [aResult, bResult] = await Promise.all([aPromise, bPromise]);
      const okCount = [aResult, bResult].filter((r) => r.ok).length;
      const conflictCount = [aResult, bResult].filter(
        (r) => !r.ok && r.reason === "conflict",
      ).length;
      expect(okCount).toBe(1);
      expect(conflictCount).toBe(1);
      expect(
        await prisma.organizationAuditEvent.count({
          where: {
            organizationId: org.organization.id,
            action: "ONBOARDING_REOPENED",
          },
        }),
      ).toBe(1);
    });
  });
});
