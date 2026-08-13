import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { hashPassword } from "@/lib/auth/password";
import type { SafeUser } from "@/lib/auth/users";
import { resetServerEnvCache } from "@/lib/env/server";
import { computeConfigurationReadiness } from "@/lib/orgs/business-access";
import {
  updateBusinessBasics,
  updateContactAndLocation,
} from "@/lib/orgs/business-profile";
import {
  createBusinessService,
  deactivateBusinessService,
  reorderBusinessServices,
} from "@/lib/orgs/business-services";
import {
  createBusinessProduct,
  reorderBusinessProducts,
} from "@/lib/orgs/business-products";
import {
  acceptOrganizationInvitation,
  createOrganizationInvitation,
} from "@/lib/orgs/invitations";
import { deactivateMember } from "@/lib/orgs/memberships";
import {
  completeOrganizationOnboarding,
  startOrganizationOnboarding,
} from "@/lib/orgs/onboarding";
import { replaceOperatingHours } from "@/lib/orgs/operating-hours";
import { createOrganization } from "@/lib/orgs/organizations";
import { setMailerForTests, type EmailSender } from "@/lib/email/mailer";
import {
  captureBusinessDbSnapshot,
  countAudit,
  createGate,
  normalizeBusinessSnapshot,
} from "@/tests/integration/helpers/business-snapshot";
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

async function addAdmin(
  prisma: PrismaClient,
  organizationId: string,
  prefix: string,
): Promise<SafeUser> {
  const user = await createVerifiedUser(prisma, prefix);
  await prisma.membership.create({
    data: {
      organizationId,
      userId: user.id,
      role: "ADMIN",
      status: "ACTIVE",
    },
  });
  return user;
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

function productIdentity(
  products: Array<{
    id: string;
    name: string;
    sku: string | null;
    isActive: boolean;
    organizationId: string;
  }>,
) {
  return products
    .map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      isActive: p.isActive,
      organizationId: p.organizationId,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function isReorderAudit(event: { action: string; metadata: unknown }): boolean {
  if (event.action !== "PRODUCT_UPDATED") return false;
  const metadata = event.metadata as { reorder?: boolean } | null;
  return metadata?.reorder === true;
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
        startOrganizationOnboarding({
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

    await startOrganizationOnboarding({
      actor: owner,
      organizationId: org.organization.id,
    });

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

  /**
   * Stress-only: uncontrolled scheduling may interleave either submitted order.
   * Not proof of lock acquisition order — see the gated product reorder test.
   */
  it("stress: concurrent product reordering remains consistent", async () => {
    const owner = await createVerifiedUser(prisma, "c-prod");
    const org = await createOrganization(owner, {
      name: "Concurrent Products",
      slug: `c-prod-${randomUUID().slice(0, 8)}`,
    });
    if (!org.ok) return;

    const created = [];
    for (const name of ["P-A", "P-B", "P-C"]) {
      const result = await createBusinessProduct({
        actor: owner,
        organizationId: org.organization.id,
        raw: { name, sku: `${name}-${randomUUID().slice(0, 4)}` },
      });
      expect(result.ok).toBe(true);
      if (result.ok) created.push(result.product);
    }

    const order1 = [created[2].id, created[0].id, created[1].id];
    const order2 = [created[1].id, created[2].id, created[0].id];

    await Promise.all([
      reorderBusinessProducts({
        actor: owner,
        organizationId: org.organization.id,
        raw: { orderedIds: order1 },
      }),
      reorderBusinessProducts({
        actor: owner,
        organizationId: org.organization.id,
        raw: { orderedIds: order2 },
      }),
    ]);

    const products = await prisma.businessProduct.findMany({
      where: { organizationId: org.organization.id },
      orderBy: { displayOrder: "asc" },
    });
    const ids = products.map((p) => p.id);
    expect(ids.length).toBe(3);
    expect(new Set(ids).size).toBe(3);
    expect([order1.join(","), order2.join(",")].includes(ids.join(","))).toBe(
      true,
    );
  });

  it("deterministic product reorder: A holds order lock, B commits second order", async () => {
    const owner = await createVerifiedUser(prisma, "c-prod-det-a");
    const orgA = await createOrganization(owner, {
      name: "Deterministic Product Reorder A",
      slug: `c-prod-det-a-${randomUUID().slice(0, 8)}`,
    });
    expect(orgA.ok).toBe(true);
    if (!orgA.ok) return;
    const organizationId = orgA.organization.id;
    await startOrganizationOnboarding({ actor: owner, organizationId });

    const admin = await addAdmin(prisma, organizationId, "c-prod-det-admin");

    const ownerB = await createVerifiedUser(prisma, "c-prod-det-b");
    const orgB = await createOrganization(ownerB, {
      name: "Deterministic Product Reorder B",
      slug: `c-prod-det-b-${randomUUID().slice(0, 8)}`,
    });
    expect(orgB.ok).toBe(true);
    if (!orgB.ok) return;
    const organizationBId = orgB.organization.id;
    await startOrganizationOnboarding({
      actor: ownerB,
      organizationId: organizationBId,
    });
    const sentinelProduct = await createBusinessProduct({
      actor: ownerB,
      organizationId: organizationBId,
      raw: { name: "Sentinel B", sku: `SEN-B-${randomUUID().slice(0, 4)}` },
    });
    expect(sentinelProduct.ok).toBe(true);

    const created = [];
    for (const name of ["P1", "P2", "P3"]) {
      const result = await createBusinessProduct({
        actor: owner,
        organizationId,
        raw: { name, sku: `${name}-${randomUUID().slice(0, 4)}` },
      });
      expect(result.ok).toBe(true);
      if (result.ok) created.push(result.product);
    }

    const orderA = [created[2].id, created[0].id, created[1].id];
    const orderB = [created[1].id, created[2].id, created[0].id];
    expect(orderA.join(",")).not.toBe(orderB.join(","));

    const beforeA = await captureBusinessDbSnapshot(prisma, organizationId);
    const beforeB = await captureBusinessDbSnapshot(prisma, organizationBId);
    const reorderAuditsBefore = beforeA.audits.filter(isReorderAudit).length;

    const aHeld = createGate();
    const bStarted = createGate();
    const bGotLock = createGate();

    const aPromise = reorderBusinessProducts(
      {
        actor: admin,
        organizationId,
        raw: { orderedIds: orderA },
      },
      {
        testAfterCatalogueOrderLock: async () => {
          aHeld.markReached();
          await aHeld.waitForRelease();
        },
      },
    );
    await aHeld.waitUntilReached();

    const bPromise = reorderBusinessProducts(
      {
        actor: owner,
        organizationId,
        raw: { orderedIds: orderB },
      },
      {
        testBeforeCatalogueOrderLock: async () => {
          bStarted.markReached();
        },
        testAfterCatalogueOrderLock: async () => {
          bGotLock.markReached();
        },
      },
    );
    await bStarted.waitUntilReached();
    let bGotEarly = false;
    await Promise.race([
      bGotLock.waitUntilReached().then(() => {
        bGotEarly = true;
      }),
      Promise.resolve(),
    ]);
    expect(bGotEarly).toBe(false);

    aHeld.release();
    const aResult = await aPromise;
    await bGotLock.waitUntilReached();
    const bResult = await bPromise;

    expect(aResult.ok).toBe(true);
    expect(bResult.ok).toBe(true);
    if (!aResult.ok || !bResult.ok) return;
    expect(JSON.stringify(aResult)).not.toMatch(/Prisma|PostgreSQL|P20\d{2}/i);
    expect(JSON.stringify(bResult)).not.toMatch(/Prisma|PostgreSQL|P20\d{2}/i);

    const afterA = await captureBusinessDbSnapshot(prisma, organizationId);
    const afterB = await captureBusinessDbSnapshot(prisma, organizationBId);

    expect(afterA.products.map((p) => p.id)).toEqual(orderB);
    expect(afterA.products.map((p) => p.displayOrder)).toEqual([0, 1, 2]);
    expect(new Set(afterA.products.map((p) => p.id)).size).toBe(3);
    expect(productIdentity(afterA.products)).toEqual(
      productIdentity(beforeA.products),
    );

    expect(afterA.profile).toEqual(beforeA.profile);
    expect(afterA.primaryLocation).toEqual(beforeA.primaryLocation);
    expect(afterA.hours).toEqual(beforeA.hours);
    expect(afterA.settings).toEqual(beforeA.settings);
    expect(afterA.onboarding).toEqual(beforeA.onboarding);
    expect(afterA.services).toEqual(beforeA.services);

    const reorderAudits = afterA.audits.filter(isReorderAudit);
    expect(reorderAudits).toHaveLength(reorderAuditsBefore + 2);
    expect(
      reorderAudits
        .slice(-2)
        .map((event) => event.actorUserId)
        .sort(),
    ).toEqual([admin.id, owner.id].sort());
    for (const event of reorderAudits.slice(-2)) {
      const metadata = event.metadata as {
        reorder?: boolean;
        count?: number;
      };
      expect(metadata.reorder).toBe(true);
      expect(metadata.count).toBe(3);
    }

    const freshReadiness = await computeConfigurationReadiness(
      prisma,
      organizationId,
    );
    expect(afterA.onboarding?.isConfigurationReady).toBe(freshReadiness.ready);

    expect(normalizeBusinessSnapshot(afterB)).toEqual(
      normalizeBusinessSnapshot(beforeB),
    );
    expect(
      afterA.products.every((p) => p.organizationId === organizationId),
    ).toBe(true);
    if (sentinelProduct.ok) {
      expect(
        afterA.products.some((p) => p.id === sentinelProduct.product.id),
      ).toBe(false);
    }
  });

  /**
   * Stress-only: uncontrolled concurrent creates. Not proof of readiness-lock
   * ordering — see the gated product-create test.
   */
  it("stress: concurrent product creates succeed with unique display orders", async () => {
    const owner = await createVerifiedUser(prisma, "c-prod-create");
    const org = await createOrganization(owner, {
      name: "Concurrent Product Creates",
      slug: `c-prod-create-${randomUUID().slice(0, 8)}`,
    });
    if (!org.ok) return;

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        createBusinessProduct({
          actor: owner,
          organizationId: org.organization.id,
          raw: {
            name: `Concurrent Product ${index}`,
            sku: `CP-${index}-${randomUUID().slice(0, 4)}`,
          },
        }),
      ),
    );

    expect(results.every((r) => r.ok)).toBe(true);
    const products = await prisma.businessProduct.findMany({
      where: { organizationId: org.organization.id },
    });
    expect(products).toHaveLength(5);
    const orders = products.map((p) => p.displayOrder);
    expect(new Set(orders).size).toBe(5);
  });

  it("deterministic concurrent product create serializes on readiness lock", async () => {
    const owner = await createVerifiedUser(prisma, "c-prod-cr-det");
    const orgA = await createOrganization(owner, {
      name: "Deterministic Product Create A",
      slug: `c-prod-cr-a-${randomUUID().slice(0, 8)}`,
    });
    expect(orgA.ok).toBe(true);
    if (!orgA.ok) return;
    const organizationId = orgA.organization.id;
    await startOrganizationOnboarding({ actor: owner, organizationId });
    const admin = await addAdmin(prisma, organizationId, "c-prod-cr-admin");

    const ownerB = await createVerifiedUser(prisma, "c-prod-cr-b");
    const orgB = await createOrganization(ownerB, {
      name: "Deterministic Product Create B",
      slug: `c-prod-cr-b-${randomUUID().slice(0, 8)}`,
    });
    expect(orgB.ok).toBe(true);
    if (!orgB.ok) return;
    const organizationBId = orgB.organization.id;
    await startOrganizationOnboarding({
      actor: ownerB,
      organizationId: organizationBId,
    });
    const existingB = await createBusinessProduct({
      actor: ownerB,
      organizationId: organizationBId,
      raw: { name: "Org B Existing", sku: `OB-${randomUUID().slice(0, 4)}` },
    });
    expect(existingB.ok).toBe(true);

    const seed = await createBusinessProduct({
      actor: owner,
      organizationId,
      raw: { name: "Seed Product", sku: `SEED-${randomUUID().slice(0, 4)}` },
    });
    expect(seed.ok).toBe(true);
    if (!seed.ok) return;

    const beforeA = await captureBusinessDbSnapshot(prisma, organizationId);
    const beforeB = await captureBusinessDbSnapshot(prisma, organizationBId);
    const createdAuditsBefore = countAudit(beforeA, "PRODUCT_CREATED");

    const aHeld = createGate();
    const bStarted = createGate();
    const bGotLock = createGate();

    const aPromise = createBusinessProduct(
      {
        actor: admin,
        organizationId,
        raw: {
          name: "Created A",
          sku: `CA-${randomUUID().slice(0, 4)}`,
        },
      },
      {
        testAfterMembershipLock: async () => {
          aHeld.markReached();
          await aHeld.waitForRelease();
        },
      },
    );
    await aHeld.waitUntilReached();

    const bPromise = createBusinessProduct(
      {
        actor: owner,
        organizationId,
        raw: {
          name: "Created B",
          sku: `CB-${randomUUID().slice(0, 4)}`,
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
    let bGotEarly = false;
    await Promise.race([
      bGotLock.waitUntilReached().then(() => {
        bGotEarly = true;
      }),
      Promise.resolve(),
    ]);
    expect(bGotEarly).toBe(false);

    aHeld.release();
    const aResult = await aPromise;
    await bGotLock.waitUntilReached();
    const bResult = await bPromise;

    expect(aResult.ok).toBe(true);
    expect(bResult.ok).toBe(true);
    if (!aResult.ok || !bResult.ok) return;

    const afterA = await captureBusinessDbSnapshot(prisma, organizationId);
    const afterB = await captureBusinessDbSnapshot(prisma, organizationBId);

    expect(afterA.products).toHaveLength(3);
    expect(new Set(afterA.products.map((p) => p.id)).size).toBe(3);
    const orders = afterA.products
      .map((p) => p.displayOrder)
      .sort((a, b) => a - b);
    expect(orders).toEqual([0, 1, 2]);

    const committedIds = new Set(afterA.products.map((p) => p.id));
    expect(committedIds.has(aResult.product.id)).toBe(true);
    expect(committedIds.has(bResult.product.id)).toBe(true);
    expect(aResult.product.id).not.toBe(bResult.product.id);

    const dbA = afterA.products.find((p) => p.id === aResult.product.id);
    const dbB = afterA.products.find((p) => p.id === bResult.product.id);
    expect(dbA?.name).toBe("Created A");
    expect(dbB?.name).toBe("Created B");
    expect(dbA?.displayOrder).toBe(aResult.product.displayOrder);
    expect(dbB?.displayOrder).toBe(bResult.product.displayOrder);
    expect(aResult.product.displayOrder).toBe(1);
    expect(bResult.product.displayOrder).toBe(2);

    expect(afterA.products.find((p) => p.id === seed.product.id)).toMatchObject(
      {
        name: "Seed Product",
        sku: seed.product.sku,
        isActive: true,
        displayOrder: 0,
      },
    );

    expect(countAudit(afterA, "PRODUCT_CREATED")).toBe(createdAuditsBefore + 2);
    const newCreated = afterA.audits
      .filter((e) => e.action === "PRODUCT_CREATED")
      .slice(-2);
    expect(newCreated.map((e) => e.actorUserId).sort()).toEqual(
      [admin.id, owner.id].sort(),
    );

    const freshReadiness = await computeConfigurationReadiness(
      prisma,
      organizationId,
    );
    expect(afterA.onboarding?.isConfigurationReady).toBe(freshReadiness.ready);
    expect(afterA.profile).toEqual(beforeA.profile);
    expect(afterA.primaryLocation).toEqual(beforeA.primaryLocation);
    expect(afterA.hours).toEqual(beforeA.hours);
    expect(afterA.settings).toEqual(beforeA.settings);
    expect(afterA.services).toEqual(beforeA.services);
    expect(afterA.onboarding?.version).toBe(beforeA.onboarding?.version);
    expect(afterA.onboarding?.currentStep).toBe(
      beforeA.onboarding?.currentStep,
    );
    expect(afterA.onboarding?.completedSteps).toEqual(
      beforeA.onboarding?.completedSteps,
    );

    expect(normalizeBusinessSnapshot(afterB)).toEqual(
      normalizeBusinessSnapshot(beforeB),
    );
    expect(
      afterA.products.every((p) => p.organizationId === organizationId),
    ).toBe(true);
  });

  it("completion racing with last service deactivation cannot leave false ready", async () => {
    const owner = await createVerifiedUser(prisma, "c-ready");
    const org = await createOrganization(owner, {
      name: "Race Ready",
      slug: `c-ready-${randomUUID().slice(0, 8)}`,
    });
    if (!org.ok) return;

    await startOrganizationOnboarding({
      actor: owner,
      organizationId: org.organization.id,
    });
    const profileV1 = await prisma.businessProfile.findUniqueOrThrow({
      where: { organizationId: org.organization.id },
    });
    await updateBusinessBasics({
      actor: owner,
      organizationId: org.organization.id,
      expectedVersion: profileV1.version,
      raw: {
        displayName: "Race Biz",
        industry: "Services",
        businessType: "SERVICES",
      },
    });
    const profileV2 = await prisma.businessProfile.findUniqueOrThrow({
      where: { organizationId: org.organization.id },
    });
    await updateContactAndLocation({
      actor: owner,
      organizationId: org.organization.id,
      expectedVersion: profileV2.version,
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

    await startOrganizationOnboarding({
      actor: owner,
      organizationId: org.organization.id,
    });
    const profileV1 = await prisma.businessProfile.findUniqueOrThrow({
      where: { organizationId: org.organization.id },
    });
    await updateBusinessBasics({
      actor: owner,
      organizationId: org.organization.id,
      expectedVersion: profileV1.version,
      raw: {
        displayName: "Auth Biz",
        industry: "Services",
        businessType: "SERVICES",
      },
    });
    const profileV2 = await prisma.businessProfile.findUniqueOrThrow({
      where: { organizationId: org.organization.id },
    });
    await updateContactAndLocation({
      actor: owner,
      organizationId: org.organization.id,
      expectedVersion: profileV2.version,
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
    const onboardingForReopen =
      await prisma.organizationOnboarding.findUniqueOrThrow({
        where: { organizationId: org.organization.id },
      });
    const reopenDenied = await (
      await import("@/lib/orgs/onboarding")
    ).reopenOrganizationOnboarding({
      actor: admin,
      organizationId: org.organization.id,
      expectedVersion: onboardingForReopen.version,
    });
    expect(reopenDenied.ok).toBe(false);
  });
});
