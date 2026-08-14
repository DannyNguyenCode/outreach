import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { hashPassword } from "@/lib/auth/password";
import type { SafeUser } from "@/lib/auth/users";
import {
  updateBusinessBasics,
  updateContactAndLocation,
} from "@/lib/orgs/business-profile";
import { createBusinessProduct } from "@/lib/orgs/business-products";
import { createBusinessService } from "@/lib/orgs/business-services";
import {
  completeOrganizationOnboarding,
  startOrganizationOnboarding,
} from "@/lib/orgs/onboarding";
import { replaceOperatingHours } from "@/lib/orgs/operating-hours";
import { createOrganization } from "@/lib/orgs/organizations";
import { startConfigProgress } from "@/lib/orgs/config-progress";

export { createGate } from "@/tests/integration/helpers/business-snapshot";

const CONFIG_3B_AUDIT_ACTIONS = [
  "BUSINESS_TEMPLATE_SELECTED",
  "BUSINESS_TEMPLATE_SWITCHED",
  "CUSTOM_FIELD_CREATED",
  "CUSTOM_FIELD_UPDATED",
  "CUSTOM_FIELD_DEACTIVATED",
  "CUSTOM_FIELDS_REORDERED",
  "SERVICE_AREA_CREATED",
  "SERVICE_AREA_UPDATED",
  "SERVICE_AREA_DEACTIVATED",
  "HOLIDAY_CLOSURE_CREATED",
  "HOLIDAY_CLOSURE_UPDATED",
  "HOLIDAY_CLOSURE_DEACTIVATED",
  "OPERATIONAL_DEFAULTS_UPDATED",
  "LEAD_STAGES_UPDATED",
  "CALL_DISPOSITIONS_UPDATED",
  "ORGANIZATION_LOCALE_UPDATED",
  "CONFIG_PROGRESS_UPDATED",
] as const;

export async function createVerifiedActor(
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

export async function createUnverifiedActor(
  prisma: PrismaClient,
  prefix: string,
): Promise<SafeUser> {
  const user = await prisma.user.create({
    data: {
      name: prefix,
      email: `${prefix}-${randomUUID()}@example.com`,
      passwordHash: await hashPassword("CorrectHorseBatteryStaple"),
      emailVerifiedAt: null,
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

export async function createOrgWithOwner(
  prisma: PrismaClient,
  prefix: string,
  name = "Config 3B Org",
) {
  const owner = await createVerifiedActor(prisma, `${prefix}-owner`);
  const org = await createOrganization(owner, {
    name,
    slug: `${prefix}-${randomUUID().slice(0, 8)}`,
  });
  if (!org.ok) {
    throw new Error(`createOrganization failed: ${org.reason}`);
  }
  return {
    owner,
    organizationId: org.organization.id,
    slug: org.organization.slug,
  };
}

export async function addMember(
  prisma: PrismaClient,
  organizationId: string,
  prefix: string,
  role: "MEMBER" | "ADMIN" = "MEMBER",
) {
  const user = await createVerifiedActor(prisma, prefix);
  await prisma.membership.create({
    data: {
      organizationId,
      userId: user.id,
      role,
      status: "ACTIVE",
    },
  });
  return user;
}

export async function addInactiveMember(
  prisma: PrismaClient,
  organizationId: string,
  prefix: string,
  role: "MEMBER" | "ADMIN" = "ADMIN",
) {
  const user = await createVerifiedActor(prisma, prefix);
  await prisma.membership.create({
    data: {
      organizationId,
      userId: user.id,
      role,
      status: "INACTIVE",
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

/**
 * Seed a Phase 3A COMPLETED org (profile + hours + catalogue + onboarding).
 * Does not create Phase 3B rows unless `startProgress` is true.
 */
export async function seedPhase3aCompletedOrg(
  prisma: PrismaClient,
  input: {
    prefix: string;
    name?: string;
    businessType?: "SERVICES" | "PRODUCTS" | "BOTH";
    startProgress?: boolean;
  },
) {
  const { owner, organizationId, slug } = await createOrgWithOwner(
    prisma,
    input.prefix,
    input.name ?? "Phase 3A Completed",
  );
  const businessType = input.businessType ?? "BOTH";

  const started = await startOrganizationOnboarding({
    actor: owner,
    organizationId,
  });
  if (!started.ok) {
    throw new Error(`start onboarding failed: ${started.reason}`);
  }

  const profileV1 = await prisma.businessProfile.findUniqueOrThrow({
    where: { organizationId },
  });
  await updateBusinessBasics({
    actor: owner,
    organizationId,
    expectedVersion: profileV1.version,
    raw: {
      displayName: input.name ?? "Phase 3A Completed",
      industry: "Retail",
      businessType,
    },
  });

  const profileV2 = await prisma.businessProfile.findUniqueOrThrow({
    where: { organizationId },
  });
  await updateContactAndLocation({
    actor: owner,
    organizationId,
    expectedVersion: profileV2.version,
    raw: {
      primaryEmail: "ready@example.com",
      primaryPhone: "4165551234",
      timeZone: "America/Toronto",
      countryCode: "CA",
      city: "Toronto",
      region: "ON",
    },
  });

  await replaceOperatingHours({
    actor: owner,
    organizationId,
    raw: { intervals: defaultWeek() },
  });

  if (businessType === "SERVICES" || businessType === "BOTH") {
    await createBusinessService({
      actor: owner,
      organizationId,
      raw: { name: "Consult" },
    });
  }
  if (businessType === "PRODUCTS" || businessType === "BOTH") {
    await createBusinessProduct({
      actor: owner,
      organizationId,
      raw: { name: "Widget", sku: `SKU-${randomUUID().slice(0, 6)}` },
    });
  }

  const completed = await completeOrganizationOnboarding({
    actor: owner,
    organizationId,
  });
  if (!completed.ok) {
    throw new Error(
      `complete onboarding failed: ${completed.reason} ${JSON.stringify(
        "missingRequirements" in completed
          ? completed.missingRequirements
          : null,
      )}`,
    );
  }

  if (input.startProgress) {
    const progress = await startConfigProgress({
      actor: owner,
      organizationId,
    });
    if (!progress.ok) {
      throw new Error(`startConfigProgress failed: ${progress.reason}`);
    }
  }

  return { owner, organizationId, slug };
}

export async function countConfig3bAudits(
  prisma: PrismaClient,
  organizationId: string,
  action?: string,
): Promise<number> {
  return prisma.organizationAuditEvent.count({
    where: {
      organizationId,
      ...(action
        ? { action: action as (typeof CONFIG_3B_AUDIT_ACTIONS)[number] }
        : {
            action: {
              in: [...CONFIG_3B_AUDIT_ACTIONS],
            },
          }),
    },
  });
}

export async function snapshotPhase3aCore(
  prisma: PrismaClient,
  organizationId: string,
) {
  const [profile, onboarding, hours, services, products, settings] =
    await Promise.all([
      prisma.businessProfile.findUnique({ where: { organizationId } }),
      prisma.organizationOnboarding.findUnique({ where: { organizationId } }),
      prisma.operatingHourInterval.findMany({
        where: { organizationId },
        orderBy: [{ dayOfWeek: "asc" }, { sortOrder: "asc" }, { id: "asc" }],
      }),
      prisma.businessService.findMany({
        where: { organizationId },
        orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
      }),
      prisma.businessProduct.findMany({
        where: { organizationId },
        orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
      }),
      prisma.organizationSettings.findUnique({ where: { organizationId } }),
    ]);

  return {
    profileVersion: profile?.version ?? null,
    onboarding: onboarding
      ? {
          status: onboarding.status,
          isConfigurationReady: onboarding.isConfigurationReady,
          version: onboarding.version,
          completedSteps: onboarding.completedSteps,
        }
      : null,
    hours: hours.map((h) => ({
      id: h.id,
      dayOfWeek: h.dayOfWeek,
      isClosed: h.isClosed,
      startMinute: h.startMinute,
      endMinute: h.endMinute,
      sortOrder: h.sortOrder,
    })),
    serviceIds: services.map((s) => s.id),
    productIds: products.map((p) => p.id),
    settingsVersion: settings?.version ?? null,
  };
}
