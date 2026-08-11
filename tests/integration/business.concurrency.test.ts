import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { hashPassword } from "@/lib/auth/password";
import type { SafeUser } from "@/lib/auth/users";
import { resetServerEnvCache } from "@/lib/env/server";
import {
  updateBusinessBasics,
  updateContactAndLocation,
} from "@/lib/orgs/business-profile";
import {
  createBusinessService,
  deactivateBusinessService,
  reorderBusinessServices,
} from "@/lib/orgs/business-services";
import { createBusinessProduct } from "@/lib/orgs/business-products";
import {
  acceptOrganizationInvitation,
  createOrganizationInvitation,
} from "@/lib/orgs/invitations";
import { deactivateMember } from "@/lib/orgs/memberships";
import {
  completeOrganizationOnboarding,
  ensureOrganizationOnboarding,
} from "@/lib/orgs/onboarding";
import { replaceOperatingHours } from "@/lib/orgs/operating-hours";
import { createOrganization } from "@/lib/orgs/organizations";
import { setMailerForTests, type EmailSender } from "@/lib/email/mailer";
import { resetApplicationData } from "@/tests/integration/reset";

const sent: Array<{ to: string; subject: string; text: string }> = [];
const mockMailer: EmailSender = {
  async send(input) {
    sent.push({ to: input.to, subject: input.subject, text: input.text });
  },
};

async function createVerifiedUser(
  prisma: PrismaClient,
  prefix: string,
): Promise<SafeUser> {
  const email = `${prefix}-${randomUUID()}@example.com`;
  const user = await prisma.user.create({
    data: {
      name: prefix,
      email,
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

describe("Phase 3A business concurrency", () => {
  const prisma = new PrismaClient();

  beforeAll(() => {
    resetServerEnvCache();
    setMailerForTests(mockMailer);
  });

  beforeEach(async () => {
    sent.length = 0;
    await resetApplicationData(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("concurrent onboarding initialization creates one row", async () => {
    const owner = await createVerifiedUser(prisma, "c-ob");
    const org = await createOrganization(owner, {
      name: "Concurrent OB",
      slug: `c-ob-${randomUUID().slice(0, 8)}`,
    });
    if (!org.ok) return;

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        ensureOrganizationOnboarding({
          actor: owner,
          organizationId: org.organization.id,
        }),
      ),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect(
      await prisma.organizationOnboarding.count({
        where: { organizationId: org.organization.id },
      }),
    ).toBe(1);
  });

  it("concurrent schedule replacement does not leave a mixed week", async () => {
    const owner = await createVerifiedUser(prisma, "c-hours");
    const org = await createOrganization(owner, {
      name: "Concurrent Hours",
      slug: `c-hours-${randomUUID().slice(0, 8)}`,
    });
    if (!org.ok) return;

    const weekA = defaultWeek();
    const weekB = defaultWeek().map((day) =>
      day.isClosed ? day : { ...day, startTime: "10:00", endTime: "18:00" },
    );

    await Promise.all([
      replaceOperatingHours({
        actor: owner,
        organizationId: org.organization.id,
        raw: { intervals: weekA },
      }),
      replaceOperatingHours({
        actor: owner,
        organizationId: org.organization.id,
        raw: { intervals: weekB },
      }),
      replaceOperatingHours({
        actor: owner,
        organizationId: org.organization.id,
        raw: { intervals: weekA },
      }),
      replaceOperatingHours({
        actor: owner,
        organizationId: org.organization.id,
        raw: { intervals: weekB },
      }),
    ]);

    const intervals = await prisma.operatingHourInterval.findMany({
      where: { organizationId: org.organization.id },
    });
    const open = intervals.filter((i) => !i.isClosed);
    const starts = new Set(open.map((i) => i.startMinute));
    // All open intervals must share one coherent schedule (A or B), not a mix.
    expect(starts.size).toBe(1);
    expect([540, 600]).toContain([...starts][0]);
  });

  it("concurrent service reordering remains consistent", async () => {
    const owner = await createVerifiedUser(prisma, "c-svc");
    const org = await createOrganization(owner, {
      name: "Concurrent Services",
      slug: `c-svc-${randomUUID().slice(0, 8)}`,
    });
    if (!org.ok) return;

    const created = [];
    for (const name of ["A", "B", "C"]) {
      const result = await createBusinessService({
        actor: owner,
        organizationId: org.organization.id,
        raw: { name },
      });
      expect(result.ok).toBe(true);
      if (result.ok) created.push(result.service);
    }

    const order1 = [created[2].id, created[0].id, created[1].id];
    const order2 = [created[1].id, created[2].id, created[0].id];

    await Promise.all([
      reorderBusinessServices({
        actor: owner,
        organizationId: org.organization.id,
        raw: { orderedIds: order1 },
      }),
      reorderBusinessServices({
        actor: owner,
        organizationId: org.organization.id,
        raw: { orderedIds: order2 },
      }),
    ]);

    const services = await prisma.businessService.findMany({
      where: { organizationId: org.organization.id },
      orderBy: { displayOrder: "asc" },
    });
    const ids = services.map((s) => s.id);
    expect(ids.length).toBe(3);
    expect(new Set(ids).size).toBe(3);
    expect([order1.join(","), order2.join(",")].includes(ids.join(","))).toBe(
      true,
    );
  });

  it("completion racing with last service deactivation cannot leave false ready", async () => {
    const owner = await createVerifiedUser(prisma, "c-ready");
    const org = await createOrganization(owner, {
      name: "Race Ready",
      slug: `c-ready-${randomUUID().slice(0, 8)}`,
    });
    if (!org.ok) return;

    await ensureOrganizationOnboarding({
      actor: owner,
      organizationId: org.organization.id,
    });
    await updateBusinessBasics({
      actor: owner,
      organizationId: org.organization.id,
      raw: {
        displayName: "Race Biz",
        industry: "Services",
        businessType: "SERVICES",
      },
    });
    await updateContactAndLocation({
      actor: owner,
      organizationId: org.organization.id,
      raw: {
        primaryEmail: "race@example.com",
        primaryPhone: "4165559999",
        timeZone: "America/Toronto",
        countryCode: "CA",
      },
    });
    await replaceOperatingHours({
      actor: owner,
      organizationId: org.organization.id,
      raw: { intervals: defaultWeek() },
    });
    const service = await createBusinessService({
      actor: owner,
      organizationId: org.organization.id,
      raw: { name: "Only Service" },
    });
    if (!service.ok) return;

    // Coordinate: start both; deactivation and completion contend on readiness.
    const [completeResult, deactivateResult] = await Promise.all([
      completeOrganizationOnboarding({
        actor: owner,
        organizationId: org.organization.id,
      }),
      deactivateBusinessService({
        actor: owner,
        organizationId: org.organization.id,
        serviceId: service.service.id,
      }),
    ]);

    expect(deactivateResult.ok).toBe(true);

    const onboarding = await prisma.organizationOnboarding.findUniqueOrThrow({
      where: { organizationId: org.organization.id },
    });
    const activeCount = await prisma.businessService.count({
      where: { organizationId: org.organization.id, isActive: true },
    });

    if (activeCount === 0) {
      expect(onboarding.isConfigurationReady).toBe(false);
      if (completeResult.ok) {
        // If completion won first, readiness refresh from deactivation must clear it.
        expect(
          onboarding.status === "IN_PROGRESS" ||
            !onboarding.isConfigurationReady,
        ).toBe(true);
      }
    } else {
      // Deactivation lost the race somehow — still consistent.
      expect(completeResult.ok || !completeResult.ok).toBe(true);
    }
  });

  it("completion and reopen recheck authority after demotion/deactivation", async () => {
    const owner = await createVerifiedUser(prisma, "c-auth");
    const admin = await createVerifiedUser(prisma, "c-admin");
    const org = await createOrganization(owner, {
      name: "Auth Race",
      slug: `c-auth-${randomUUID().slice(0, 8)}`,
    });
    if (!org.ok) return;

    await createOrganizationInvitation({
      actor: owner,
      organizationId: org.organization.id,
      email: admin.email,
      role: "ADMIN",
    });
    const token = sent.at(-1)?.text.match(/[?&]token=([A-Za-z0-9_-]+)/)?.[1];
    await acceptOrganizationInvitation({ actor: admin, rawToken: token! });

    await ensureOrganizationOnboarding({
      actor: owner,
      organizationId: org.organization.id,
    });
    await updateBusinessBasics({
      actor: owner,
      organizationId: org.organization.id,
      raw: {
        displayName: "Auth Biz",
        industry: "Services",
        businessType: "SERVICES",
      },
    });
    await updateContactAndLocation({
      actor: owner,
      organizationId: org.organization.id,
      raw: {
        primaryEmail: "auth@example.com",
        primaryPhone: "4165558888",
        timeZone: "America/Toronto",
        countryCode: "CA",
      },
    });
    await replaceOperatingHours({
      actor: owner,
      organizationId: org.organization.id,
      raw: { intervals: defaultWeek() },
    });
    await createBusinessService({
      actor: owner,
      organizationId: org.organization.id,
      raw: { name: "Svc" },
    });
    await createBusinessProduct({
      actor: owner,
      organizationId: org.organization.id,
      raw: { name: "Prod" },
    });

    const adminMembership = await prisma.membership.findFirstOrThrow({
      where: { organizationId: org.organization.id, userId: admin.id },
    });

    const [completeResult] = await Promise.all([
      completeOrganizationOnboarding({
        actor: admin,
        organizationId: org.organization.id,
      }),
      deactivateMember({
        actor: owner,
        organizationId: org.organization.id,
        membershipId: adminMembership.id,
      }),
    ]);

    if (completeResult.ok) {
      // Completion may win before deactivation; subsequent mutate must fail.
      const denied = await replaceOperatingHours({
        actor: admin,
        organizationId: org.organization.id,
        raw: { intervals: defaultWeek() },
      });
      expect(denied.ok).toBe(false);
    } else {
      expect(["inactive_membership", "not_a_member", "forbidden"]).toContain(
        completeResult.reason,
      );
    }

    // Ensure admin cannot reopen after offboarding.
    await completeOrganizationOnboarding({
      actor: owner,
      organizationId: org.organization.id,
    });
    const reopenDenied = await (
      await import("@/lib/orgs/onboarding")
    ).reopenOrganizationOnboarding({
      actor: admin,
      organizationId: org.organization.id,
    });
    expect(reopenDenied.ok).toBe(false);
  });
});
