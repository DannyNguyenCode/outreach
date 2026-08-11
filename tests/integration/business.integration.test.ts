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
  createBusinessProduct,
  listBusinessProducts,
  reorderBusinessProducts,
  updateBusinessProduct,
} from "@/lib/orgs/business-products";
import {
  createBusinessService,
  deactivateBusinessService,
  listBusinessServices,
  reorderBusinessServices,
} from "@/lib/orgs/business-services";
import { createOrganization } from "@/lib/orgs/organizations";
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
import { updateOrganizationSettings } from "@/lib/orgs/organization-settings";
import { deactivateMember } from "@/lib/orgs/memberships";
import {
  acceptOrganizationInvitation,
  createOrganizationInvitation,
} from "@/lib/orgs/invitations";
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

function defaultWeek(open = true) {
  return [
    "MONDAY",
    "TUESDAY",
    "WEDNESDAY",
    "THURSDAY",
    "FRIDAY",
    "SATURDAY",
    "SUNDAY",
  ].map((day) =>
    open && day !== "SATURDAY" && day !== "SUNDAY"
      ? {
          dayOfWeek: day,
          isClosed: false,
          startTime: "09:00",
          endTime: "17:00",
          sortOrder: 0,
        }
      : {
          dayOfWeek: day,
          isClosed: true,
          sortOrder: 0,
        },
  );
}

async function seedReadyConfig(input: {
  actor: SafeUser;
  organizationId: string;
  businessType?: "SERVICES" | "PRODUCTS" | "BOTH";
}) {
  const businessType = input.businessType ?? "BOTH";
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

describe("Phase 3A business onboarding integration", () => {
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

  it("creates exactly one onboarding state idempotently", async () => {
    const owner = await createVerifiedUser(prisma, "ob-owner");
    const org = await createOrganization(owner, {
      name: "Onboard Co",
      slug: `ob-${randomUUID().slice(0, 8)}`,
    });
    expect(org.ok).toBe(true);
    if (!org.ok) return;

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
    const count = await prisma.organizationOnboarding.count({
      where: { organizationId: org.organization.id },
    });
    expect(count).toBe(1);
  });

  it("replaces operating hours atomically and rejects overlaps", async () => {
    const owner = await createVerifiedUser(prisma, "hours-owner");
    const org = await createOrganization(owner, {
      name: "Hours Co",
      slug: `hours-${randomUUID().slice(0, 8)}`,
    });
    if (!org.ok) return;

    const ok = await replaceOperatingHours({
      actor: owner,
      organizationId: org.organization.id,
      raw: { intervals: defaultWeek() },
    });
    expect(ok.ok).toBe(true);

    const overlap = await replaceOperatingHours({
      actor: owner,
      organizationId: org.organization.id,
      raw: {
        intervals: [
          {
            dayOfWeek: "MONDAY",
            isClosed: false,
            startTime: "09:00",
            endTime: "12:00",
            sortOrder: 0,
          },
          {
            dayOfWeek: "MONDAY",
            isClosed: false,
            startTime: "11:00",
            endTime: "15:00",
            sortOrder: 1,
          },
          ...defaultWeek().filter((d) => d.dayOfWeek !== "MONDAY"),
        ],
      },
    });
    expect(overlap.ok).toBe(false);

    const overnight = await replaceOperatingHours({
      actor: owner,
      organizationId: org.organization.id,
      raw: {
        intervals: [
          {
            dayOfWeek: "MONDAY",
            isClosed: false,
            startTime: "22:00",
            endTime: "02:00",
            sortOrder: 0,
          },
          ...defaultWeek().filter((d) => d.dayOfWeek !== "MONDAY"),
        ],
      },
    });
    expect(overnight.ok).toBe(false);

    const still = await getOperatingHours({
      actor: owner,
      organizationId: org.organization.id,
    });
    expect(still.ok).toBe(true);
    if (still.ok) {
      expect(still.intervals.length).toBeGreaterThanOrEqual(7);
    }
  });

  it("enforces completion readiness by business type", async () => {
    const owner = await createVerifiedUser(prisma, "ready-owner");
    const org = await createOrganization(owner, {
      name: "Ready Co",
      slug: `ready-${randomUUID().slice(0, 8)}`,
    });
    if (!org.ok) return;
    await startOrganizationOnboarding({
      actor: owner,
      organizationId: org.organization.id,
    });

    const incomplete = await completeOrganizationOnboarding({
      actor: owner,
      organizationId: org.organization.id,
    });
    expect(incomplete.ok).toBe(false);
    if (!incomplete.ok) {
      expect(incomplete.reason).toBe("not_ready");
      expect(incomplete.missingRequirements?.length).toBeGreaterThan(0);
    }

    await seedReadyConfig({
      actor: owner,
      organizationId: org.organization.id,
      businessType: "SERVICES",
    });
    const complete = await completeOrganizationOnboarding({
      actor: owner,
      organizationId: org.organization.id,
    });
    expect(complete.ok).toBe(true);
    if (complete.ok) {
      expect(complete.onboarding.status).toBe("COMPLETED");
      expect(complete.onboarding.completedByUserId).toBe(owner.id);
      expect(complete.onboarding.isConfigurationReady).toBe(true);
    }
  });

  it("reopens onboarding and invalidates readiness when required config is removed", async () => {
    const owner = await createVerifiedUser(prisma, "reopen-owner");
    const org = await createOrganization(owner, {
      name: "Reopen Co",
      slug: `reopen-${randomUUID().slice(0, 8)}`,
    });
    if (!org.ok) return;
    await startOrganizationOnboarding({
      actor: owner,
      organizationId: org.organization.id,
    });
    await seedReadyConfig({
      actor: owner,
      organizationId: org.organization.id,
      businessType: "SERVICES",
    });
    await completeOrganizationOnboarding({
      actor: owner,
      organizationId: org.organization.id,
    });

    const services = await listBusinessServices({
      actor: owner,
      organizationId: org.organization.id,
    });
    expect(services.ok).toBe(true);
    if (!services.ok) return;
    const active = services.services.find((s) => s.isActive);
    expect(active).toBeTruthy();
    if (!active) return;

    await deactivateBusinessService({
      actor: owner,
      organizationId: org.organization.id,
      serviceId: active.id,
    });

    const after = await getOrganizationOnboarding({
      actor: owner,
      organizationId: org.organization.id,
    });
    expect(after.ok).toBe(true);
    if (after.ok) {
      expect(after.onboarding.isConfigurationReady).toBe(false);
      expect(after.onboarding.status).toBe("IN_PROGRESS");
    }

    await seedReadyConfig({
      actor: owner,
      organizationId: org.organization.id,
      businessType: "SERVICES",
    });
    await completeOrganizationOnboarding({
      actor: owner,
      organizationId: org.organization.id,
    });
    const reopened = await reopenOrganizationOnboarding({
      actor: owner,
      organizationId: org.organization.id,
    });
    expect(reopened.ok).toBe(true);
    if (reopened.ok) {
      expect(reopened.onboarding.status).toBe("IN_PROGRESS");
      expect(reopened.onboarding.reopenedByUserId).toBe(owner.id);
    }
  });

  it("isolates tenants for profile, hours, services, products, settings, and onboarding", async () => {
    const ownerA = await createVerifiedUser(prisma, "ten-a");
    const ownerB = await createVerifiedUser(prisma, "ten-b");
    const orgA = await createOrganization(ownerA, {
      name: "Tenant A",
      slug: `ten-a-${randomUUID().slice(0, 8)}`,
    });
    const orgB = await createOrganization(ownerB, {
      name: "Tenant B",
      slug: `ten-b-${randomUUID().slice(0, 8)}`,
    });
    if (!orgA.ok || !orgB.ok) return;

    await seedReadyConfig({
      actor: ownerA,
      organizationId: orgA.organization.id,
    });
    await seedReadyConfig({
      actor: ownerB,
      organizationId: orgB.organization.id,
    });

    const servicesB = await listBusinessServices({
      actor: ownerB,
      organizationId: orgB.organization.id,
    });
    expect(servicesB.ok).toBe(true);
    if (!servicesB.ok) return;
    const serviceB = servicesB.services[0];

    const crossUpdate = await deactivateBusinessService({
      actor: ownerA,
      organizationId: orgA.organization.id,
      serviceId: serviceB.id,
    });
    expect(crossUpdate.ok).toBe(false);

    const stillB = await prisma.businessService.findUnique({
      where: { id: serviceB.id },
    });
    expect(stillB?.isActive).toBe(true);

    const productsB = await listBusinessProducts({
      actor: ownerB,
      organizationId: orgB.organization.id,
    });
    if (!productsB.ok) return;
    const crossProduct = await updateBusinessProduct({
      actor: ownerA,
      organizationId: orgA.organization.id,
      productId: productsB.products[0].id,
      raw: { name: "Hijacked" },
    });
    expect(crossProduct.ok).toBe(false);

    const crossComplete = await completeOrganizationOnboarding({
      actor: ownerA,
      organizationId: orgB.organization.id,
    });
    expect(crossComplete.ok).toBe(false);

    const crossHours = await replaceOperatingHours({
      actor: ownerA,
      organizationId: orgB.organization.id,
      raw: { intervals: defaultWeek(false) },
    });
    expect(crossHours.ok).toBe(false);

    const crossSettings = await updateOrganizationSettings({
      actor: ownerA,
      organizationId: orgB.organization.id,
      raw: {
        membersCanViewServices: false,
        membersCanViewProducts: false,
        membersCanViewBusinessInfo: false,
        futureCallingAccessDefault: "DISABLED",
      },
    });
    expect(crossSettings.ok).toBe(false);
  });

  it("enforces member authorization and settings-gated reads", async () => {
    const owner = await createVerifiedUser(prisma, "authz-owner");
    const memberUser = await createVerifiedUser(prisma, "authz-member");
    const org = await createOrganization(owner, {
      name: "Authz Co",
      slug: `authz-${randomUUID().slice(0, 8)}`,
    });
    if (!org.ok) return;

    await createOrganizationInvitation({
      actor: owner,
      organizationId: org.organization.id,
      email: memberUser.email,
      role: "MEMBER",
    });
    const tokenText = sent.at(-1)?.text ?? "";
    const token = tokenText.match(/[?&]token=([A-Za-z0-9_-]+)/)?.[1];
    expect(token).toBeTruthy();
    await acceptOrganizationInvitation({
      actor: memberUser,
      rawToken: token!,
    });

    await seedReadyConfig({
      actor: owner,
      organizationId: org.organization.id,
    });

    const memberUpdate = await updateBusinessBasics({
      actor: memberUser,
      organizationId: org.organization.id,
      raw: {
        displayName: "Nope",
        industry: "X",
        businessType: "SERVICES",
      },
    });
    expect(memberUpdate.ok).toBe(false);

    const memberHours = await replaceOperatingHours({
      actor: memberUser,
      organizationId: org.organization.id,
      raw: { intervals: defaultWeek() },
    });
    expect(memberHours.ok).toBe(false);

    const memberService = await createBusinessService({
      actor: memberUser,
      organizationId: org.organization.id,
      raw: { name: "Nope" },
    });
    expect(memberService.ok).toBe(false);

    const memberComplete = await completeOrganizationOnboarding({
      actor: memberUser,
      organizationId: org.organization.id,
    });
    expect(memberComplete.ok).toBe(false);

    const memberOnboarding = await getOrganizationOnboarding({
      actor: memberUser,
      organizationId: org.organization.id,
    });
    expect(memberOnboarding.ok).toBe(false);

    await updateOrganizationSettings({
      actor: owner,
      organizationId: org.organization.id,
      raw: {
        membersCanViewServices: false,
        membersCanViewProducts: true,
        membersCanViewBusinessInfo: true,
        futureCallingAccessDefault: "DISABLED",
      },
    });

    const servicesRead = await listBusinessServices({
      actor: memberUser,
      organizationId: org.organization.id,
    });
    expect(servicesRead.ok).toBe(false);

    const productsRead = await listBusinessProducts({
      actor: memberUser,
      organizationId: org.organization.id,
    });
    expect(productsRead.ok).toBe(true);
  });

  it("revokes configuration access immediately after offboarding", async () => {
    const owner = await createVerifiedUser(prisma, "off-owner");
    const adminUser = await createVerifiedUser(prisma, "off-admin");
    const org = await createOrganization(owner, {
      name: "Offboard Co",
      slug: `off-${randomUUID().slice(0, 8)}`,
    });
    if (!org.ok) return;

    await createOrganizationInvitation({
      actor: owner,
      organizationId: org.organization.id,
      email: adminUser.email,
      role: "ADMIN",
    });
    const token = sent.at(-1)?.text.match(/[?&]token=([A-Za-z0-9_-]+)/)?.[1];
    await acceptOrganizationInvitation({
      actor: adminUser,
      rawToken: token!,
    });

    const memberships = await prisma.membership.findMany({
      where: { organizationId: org.organization.id },
    });
    const adminMembership = memberships.find((m) => m.userId === adminUser.id);
    expect(adminMembership).toBeTruthy();

    await deactivateMember({
      actor: owner,
      organizationId: org.organization.id,
      membershipId: adminMembership!.id,
    });

    const denied = await updateBusinessBasics({
      actor: adminUser,
      organizationId: org.organization.id,
      raw: {
        displayName: "Denied",
        industry: "X",
        businessType: "SERVICES",
      },
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(["inactive_membership", "not_a_member", "forbidden"]).toContain(
        denied.reason,
      );
    }
  });

  it("keeps SKU uniqueness organization-scoped and allows null SKUs", async () => {
    const owner = await createVerifiedUser(prisma, "sku-owner");
    const org = await createOrganization(owner, {
      name: "SKU Co",
      slug: `sku-${randomUUID().slice(0, 8)}`,
    });
    if (!org.ok) return;

    const first = await createBusinessProduct({
      actor: owner,
      organizationId: org.organization.id,
      raw: { name: "A", sku: "SAME" },
    });
    expect(first.ok).toBe(true);
    const dup = await createBusinessProduct({
      actor: owner,
      organizationId: org.organization.id,
      raw: { name: "B", sku: "SAME" },
    });
    expect(dup.ok).toBe(false);

    const nullA = await createBusinessProduct({
      actor: owner,
      organizationId: org.organization.id,
      raw: { name: "C" },
    });
    const nullB = await createBusinessProduct({
      actor: owner,
      organizationId: org.organization.id,
      raw: { name: "D" },
    });
    expect(nullA.ok).toBe(true);
    expect(nullB.ok).toBe(true);
  });

  it("reorders services and products within a tenant only", async () => {
    const owner = await createVerifiedUser(prisma, "order-owner");
    const ownerB = await createVerifiedUser(prisma, "order-b");
    const org = await createOrganization(owner, {
      name: "Order Co",
      slug: `order-${randomUUID().slice(0, 8)}`,
    });
    const orgB = await createOrganization(ownerB, {
      name: "Order B",
      slug: `order-b-${randomUUID().slice(0, 8)}`,
    });
    if (!org.ok || !orgB.ok) return;

    const a = await createBusinessService({
      actor: owner,
      organizationId: org.organization.id,
      raw: { name: "A" },
    });
    const b = await createBusinessService({
      actor: owner,
      organizationId: org.organization.id,
      raw: { name: "B" },
    });
    const serviceB = await createBusinessService({
      actor: ownerB,
      organizationId: orgB.organization.id,
      raw: { name: "XB" },
    });
    if (!a.ok || !b.ok || !serviceB.ok) return;

    const reordered = await reorderBusinessServices({
      actor: owner,
      organizationId: org.organization.id,
      raw: { orderedIds: [b.service.id, a.service.id] },
    });
    expect(reordered.ok).toBe(true);
    if (reordered.ok) {
      expect(reordered.services[0].id).toBe(b.service.id);
    }

    const crossReorder = await reorderBusinessServices({
      actor: owner,
      organizationId: org.organization.id,
      raw: { orderedIds: [serviceB.service.id, a.service.id] },
    });
    expect(crossReorder.ok).toBe(false);

    const p1 = await createBusinessProduct({
      actor: owner,
      organizationId: org.organization.id,
      raw: { name: "P1" },
    });
    const p2 = await createBusinessProduct({
      actor: owner,
      organizationId: org.organization.id,
      raw: { name: "P2" },
    });
    if (!p1.ok || !p2.ok) return;
    const productsReordered = await reorderBusinessProducts({
      actor: owner,
      organizationId: org.organization.id,
      raw: { orderedIds: [p2.product.id, p1.product.id] },
    });
    expect(productsReordered.ok).toBe(true);
  });
});
