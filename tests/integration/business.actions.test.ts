import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const requireVerifiedUserMock = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  requireVerifiedUser: (...args: unknown[]) => requireVerifiedUserMock(...args),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "x-forwarded-for": "127.0.0.1" })),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    const err = new Error(`NEXT_REDIRECT:${url}`);
    (err as Error & { digest?: string }).digest = `NEXT_REDIRECT;${url}`;
    throw err;
  },
}));

import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";

import {
  createProductAction,
  createServiceAction,
  deactivateProductAction,
  deactivateServiceAction,
  markCatalogueStepAction,
  replaceOperatingHoursAction,
  reorderProductsAction,
  reorderServicesAction,
  updateBusinessBasicsAction,
  updateContactLocationAction,
  updateEmployeeDefaultsAction,
  updateProductAction,
  updateServiceAction,
} from "@/app/actions/business";
import type { ActionState } from "@/app/actions/auth-state";
import { hashPassword } from "@/lib/auth/password";
import type { SafeUser } from "@/lib/auth/users";
import { setMailerForTests, type EmailSender } from "@/lib/email/mailer";
import { resetServerEnvCache } from "@/lib/env/server";
import { computeConfigurationReadiness } from "@/lib/orgs/business-access";
import { runMarkCatalogueStepAction } from "@/lib/orgs/mark-catalogue-step-action";
import { changeMemberRole, deactivateMember } from "@/lib/orgs/memberships";
import {
  advanceOnboardingStep,
  completeOrganizationOnboarding,
  startOrganizationOnboarding,
} from "@/lib/orgs/onboarding";
import { createOrganization } from "@/lib/orgs/organizations";
import { resetApplicationData } from "@/tests/integration/reset";
import {
  captureBusinessDbSnapshot,
  normalizeBusinessSnapshot,
} from "@/tests/integration/helpers/business-snapshot";

/**
 * Server-action boundary tests for Phase 3A.
 * Mocks only auth/session and Next.js framework boundaries; mutation services hit real PostgreSQL.
 */

const mockMailer: EmailSender = {
  async send() {},
};

const initialActionState: ActionState = { status: "idle" };

const MAX_SAFE_PLUS_ONE = String(Number.MAX_SAFE_INTEGER + 1);

const MALFORMED_VERSION_VALUES: Array<[string, string]> = [
  ["alphabetic abc", "abc"],
  ["decimal 1.5", "1.5"],
  ["negative -1", "-1"],
  ["whitespace-only", "   "],
  ["NaN string", "NaN"],
  ["Infinity", "Infinity"],
  ["mixed 12abc", "12abc"],
  ["above MAX_SAFE_INTEGER", MAX_SAFE_PLUS_ONE],
];

type VersionField = "expectedVersion" | "onboardingExpectedVersion";

type BusinessActionRunner = (
  prev: ActionState,
  formData: FormData,
) => Promise<ActionState>;

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
  return {
    owner,
    organizationId: org.organization.id,
    slug: org.organization.slug,
  };
}

async function addMember(
  prisma: PrismaClient,
  organizationId: string,
  prefix: string,
  role: "MEMBER" | "ADMIN" = "MEMBER",
) {
  const user = await createVerifiedUser(prisma, prefix);
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

async function addInactiveMember(
  prisma: PrismaClient,
  organizationId: string,
  prefix: string,
) {
  const user = await createVerifiedUser(prisma, prefix);
  await prisma.membership.create({
    data: {
      organizationId,
      userId: user.id,
      role: "ADMIN",
      status: "INACTIVE",
    },
  });
  return user;
}

function setActor(user: SafeUser) {
  requireVerifiedUserMock.mockResolvedValue(user);
}

function setUnauthenticated(returnTo = "/app") {
  requireVerifiedUserMock.mockImplementation(async () => {
    const err = new Error(
      `NEXT_REDIRECT:/login?callbackUrl=${encodeURIComponent(returnTo)}`,
    );
    (err as Error & { digest?: string }).digest =
      `NEXT_REDIRECT;/login?callbackUrl=${encodeURIComponent(returnTo)}`;
    throw err;
  });
}

async function startOnboarding(actor: SafeUser, organizationId: string) {
  const result = await startOrganizationOnboarding({ actor, organizationId });
  if (!result.ok) throw new Error(`start onboarding failed: ${result.reason}`);
}

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

type AuditProjection = {
  id: string;
  action: string;
  actorUserId: string | null;
  metadata: unknown;
};

type HourIntervalSnapshot = {
  id: string;
  organizationId: string;
  dayOfWeek: string;
  isClosed: boolean;
  startMinute: number | null;
  endMinute: number | null;
  sortOrder: number;
  customerNote: string | null;
};

type ProfileSnapshot = {
  id: string;
  organizationId: string;
  legalName: string | null;
  displayName: string | null;
  description: string | null;
  industry: string | null;
  websiteUrl: string | null;
  primaryEmail: string | null;
  primaryPhoneE164: string | null;
  preferredContactMethod: string | null;
  timeZone: string | null;
  businessType: string | null;
  logoUrl: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

type PrimaryLocationSnapshot = {
  id: string;
  organizationId: string;
  label: string;
  isPrimary: boolean;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  countryCode: string | null;
  createdAt: string;
  updatedAt: string;
};

type SettingsSnapshot = {
  id: string;
  organizationId: string;
  membersCanViewServices: boolean;
  membersCanViewProducts: boolean;
  membersCanViewBusinessInfo: boolean;
  futureCallingAccessDefault: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

type OnboardingSnapshot = {
  id: string;
  organizationId: string;
  status: string;
  currentStep: string;
  completedSteps: unknown;
  isConfigurationReady: boolean;
  version: number;
  completedAt: string | null;
  completedByUserId: string | null;
  reopenedAt: string | null;
  reopenedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

type CatalogueServiceSnapshot = {
  id: string;
  name: string;
  isActive: boolean;
  displayOrder: number;
  organizationId: string;
};

type CatalogueProductSnapshot = {
  id: string;
  name: string;
  sku: string | null;
  isActive: boolean;
  displayOrder: number;
  organizationId: string;
};

type DbSnapshot = {
  organizationId: string;
  profile: ProfileSnapshot | null;
  primaryLocation: PrimaryLocationSnapshot | null;
  settings: SettingsSnapshot | null;
  hours: HourIntervalSnapshot[];
  onboarding: OnboardingSnapshot | null;
  audits: AuditProjection[];
  services: CatalogueServiceSnapshot[];
  products: CatalogueProductSnapshot[];
};

function mapProfile(
  profile: Awaited<ReturnType<PrismaClient["businessProfile"]["findUnique"]>>,
): ProfileSnapshot | null {
  if (!profile) return null;
  return {
    id: profile.id,
    organizationId: profile.organizationId,
    legalName: profile.legalName,
    displayName: profile.displayName,
    description: profile.description,
    industry: profile.industry,
    websiteUrl: profile.websiteUrl,
    primaryEmail: profile.primaryEmail,
    primaryPhoneE164: profile.primaryPhoneE164,
    preferredContactMethod: profile.preferredContactMethod,
    timeZone: profile.timeZone,
    businessType: profile.businessType,
    logoUrl: profile.logoUrl,
    version: profile.version,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

function mapPrimaryLocation(
  location: Awaited<ReturnType<PrismaClient["businessLocation"]["findFirst"]>>,
): PrimaryLocationSnapshot | null {
  if (!location) return null;
  return {
    id: location.id,
    organizationId: location.organizationId,
    label: location.label,
    isPrimary: location.isPrimary,
    addressLine1: location.addressLine1,
    addressLine2: location.addressLine2,
    city: location.city,
    region: location.region,
    postalCode: location.postalCode,
    countryCode: location.countryCode,
    createdAt: location.createdAt.toISOString(),
    updatedAt: location.updatedAt.toISOString(),
  };
}

function mapSettings(
  settings: Awaited<
    ReturnType<PrismaClient["organizationSettings"]["findUnique"]>
  >,
): SettingsSnapshot | null {
  if (!settings) return null;
  return {
    id: settings.id,
    organizationId: settings.organizationId,
    membersCanViewServices: settings.membersCanViewServices,
    membersCanViewProducts: settings.membersCanViewProducts,
    membersCanViewBusinessInfo: settings.membersCanViewBusinessInfo,
    futureCallingAccessDefault: settings.futureCallingAccessDefault,
    version: settings.version,
    createdAt: settings.createdAt.toISOString(),
    updatedAt: settings.updatedAt.toISOString(),
  };
}

function mapOnboarding(
  onboarding: Awaited<
    ReturnType<PrismaClient["organizationOnboarding"]["findUnique"]>
  >,
): OnboardingSnapshot | null {
  if (!onboarding) return null;
  return {
    id: onboarding.id,
    organizationId: onboarding.organizationId,
    status: onboarding.status,
    currentStep: onboarding.currentStep,
    completedSteps: onboarding.completedSteps,
    isConfigurationReady: onboarding.isConfigurationReady,
    version: onboarding.version,
    completedAt: toIso(onboarding.completedAt),
    completedByUserId: onboarding.completedByUserId,
    reopenedAt: toIso(onboarding.reopenedAt),
    reopenedByUserId: onboarding.reopenedByUserId,
    createdAt: onboarding.createdAt.toISOString(),
    updatedAt: onboarding.updatedAt.toISOString(),
  };
}

async function captureSnapshot(
  prisma: PrismaClient,
  organizationId: string,
): Promise<DbSnapshot> {
  const [
    profile,
    primaryLocation,
    settings,
    hours,
    onboarding,
    audits,
    services,
    products,
  ] = await Promise.all([
    prisma.businessProfile.findUnique({ where: { organizationId } }),
    prisma.businessLocation.findFirst({
      where: { organizationId, isPrimary: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.organizationSettings.findUnique({ where: { organizationId } }),
    prisma.operatingHourInterval.findMany({
      where: { organizationId },
      orderBy: [{ dayOfWeek: "asc" }, { sortOrder: "asc" }, { id: "asc" }],
    }),
    prisma.organizationOnboarding.findUnique({ where: { organizationId } }),
    prisma.organizationAuditEvent.findMany({
      where: { organizationId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        action: true,
        actorUserId: true,
        metadata: true,
      },
    }),
    prisma.businessService.findMany({
      where: { organizationId },
      orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        isActive: true,
        displayOrder: true,
        organizationId: true,
      },
    }),
    prisma.businessProduct.findMany({
      where: { organizationId },
      orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        sku: true,
        isActive: true,
        displayOrder: true,
        organizationId: true,
      },
    }),
  ]);

  return {
    organizationId,
    profile: mapProfile(profile),
    primaryLocation: mapPrimaryLocation(primaryLocation),
    settings: mapSettings(settings),
    hours: hours.map((interval) => ({
      id: interval.id,
      organizationId: interval.organizationId,
      dayOfWeek: interval.dayOfWeek,
      isClosed: interval.isClosed,
      startMinute: interval.startMinute,
      endMinute: interval.endMinute,
      sortOrder: interval.sortOrder,
      customerNote: interval.customerNote,
    })),
    onboarding: mapOnboarding(onboarding),
    audits,
    services,
    products,
  };
}

function countAudit(snapshot: DbSnapshot, action: string): number {
  return snapshot.audits.filter((event) => event.action === action).length;
}

function expectZeroWrites(before: DbSnapshot, after: DbSnapshot) {
  expect(after).toEqual(before);
}

async function assertPreStartRecordsAbsent(
  prisma: PrismaClient,
  organizationId: string,
) {
  await Promise.all([
    expect(
      prisma.businessProfile.count({ where: { organizationId } }),
    ).resolves.toBe(0),
    expect(
      prisma.businessLocation.count({ where: { organizationId } }),
    ).resolves.toBe(0),
    expect(
      prisma.organizationSettings.count({ where: { organizationId } }),
    ).resolves.toBe(0),
    expect(
      prisma.operatingHourInterval.count({ where: { organizationId } }),
    ).resolves.toBe(0),
    expect(
      prisma.organizationOnboarding.count({ where: { organizationId } }),
    ).resolves.toBe(0),
  ]);
}

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

function applyVersionFields(
  formData: FormData,
  fields: Partial<Record<VersionField, string | null>>,
) {
  for (const [field, value] of Object.entries(fields) as Array<
    [VersionField, string | null | undefined]
  >) {
    if (value === null || value === undefined) {
      continue;
    }
    formData.set(field, value);
  }
}

function buildBasicsFormData(input: {
  organizationSlug: string;
  expectedVersion?: string | null;
  onboardingExpectedVersion?: string | null;
  markStep?: boolean;
}) {
  const formData = new FormData();
  formData.set("organizationSlug", input.organizationSlug);
  if (input.markStep !== false) {
    formData.set("markStep", "BUSINESS_BASICS");
  }
  applyVersionFields(formData, {
    expectedVersion: input.expectedVersion,
    onboardingExpectedVersion: input.onboardingExpectedVersion,
  });
  formData.set("displayName", "Action Test Co");
  formData.set("industry", "Retail");
  formData.set("businessType", "SERVICES");
  return formData;
}

function buildContactFormData(input: {
  organizationSlug: string;
  expectedVersion?: string | null;
  onboardingExpectedVersion?: string | null;
  markStep?: boolean;
}) {
  const formData = new FormData();
  formData.set("organizationSlug", input.organizationSlug);
  if (input.markStep !== false) {
    formData.set("markStep", "CONTACT_LOCATION");
  }
  applyVersionFields(formData, {
    expectedVersion: input.expectedVersion,
    onboardingExpectedVersion: input.onboardingExpectedVersion,
  });
  formData.set("primaryEmail", "contact@example.com");
  formData.set("primaryPhone", "4165551234");
  formData.set("timeZone", "America/Toronto");
  formData.set("countryCode", "CA");
  formData.set("city", "Toronto");
  return formData;
}

function buildHoursFormData(input: {
  organizationSlug: string;
  onboardingExpectedVersion?: string | null;
  markStep?: boolean;
}) {
  const formData = new FormData();
  formData.set("organizationSlug", input.organizationSlug);
  if (input.markStep !== false) {
    formData.set("markStep", "OPERATING_HOURS");
  }
  applyVersionFields(formData, {
    onboardingExpectedVersion: input.onboardingExpectedVersion,
  });
  formData.set("intervalsJson", JSON.stringify(defaultWeek()));
  return formData;
}

function buildEmployeeDefaultsFormData(input: {
  organizationSlug: string;
  expectedVersion?: string | null;
  onboardingExpectedVersion?: string | null;
  markStep?: boolean;
}) {
  const formData = new FormData();
  formData.set("organizationSlug", input.organizationSlug);
  if (input.markStep !== false) {
    formData.set("markStep", "EMPLOYEE_DEFAULTS");
  }
  applyVersionFields(formData, {
    expectedVersion: input.expectedVersion,
    onboardingExpectedVersion: input.onboardingExpectedVersion,
  });
  formData.set("membersCanViewServices", "on");
  formData.set("membersCanViewProducts", "on");
  formData.set("membersCanViewBusinessInfo", "on");
  formData.set("futureCallingAccessDefault", "DISABLED");
  return formData;
}

function buildProductCreateFormData(input: {
  organizationSlug: string;
  name?: string | null;
  sku?: string | null;
  isActive?: boolean;
  expectedVersion?: string;
  onboardingExpectedVersion?: string;
}) {
  const formData = new FormData();
  formData.set("organizationSlug", input.organizationSlug);
  if (input.name !== null && input.name !== undefined) {
    formData.set("name", input.name);
  }
  if (input.sku !== null && input.sku !== undefined) {
    formData.set("sku", input.sku);
  }
  if (input.isActive === false) {
    formData.set("isActive", "false");
  }
  if (input.expectedVersion !== undefined) {
    formData.set("expectedVersion", input.expectedVersion);
  }
  if (input.onboardingExpectedVersion !== undefined) {
    formData.set("onboardingExpectedVersion", input.onboardingExpectedVersion);
  }
  return formData;
}

function buildProductUpdateFormData(input: {
  organizationSlug: string;
  productId: string;
  name: string;
  sku?: string;
  expectedVersion?: string;
  onboardingExpectedVersion?: string;
}) {
  const formData = new FormData();
  formData.set("organizationSlug", input.organizationSlug);
  formData.set("productId", input.productId);
  formData.set("name", input.name);
  if (input.sku !== undefined) {
    formData.set("sku", input.sku);
  }
  applyVersionFields(formData, {
    expectedVersion: input.expectedVersion,
    onboardingExpectedVersion: input.onboardingExpectedVersion,
  });
  return formData;
}

function buildProductDeactivateFormData(input: {
  organizationSlug: string;
  productId: string;
}) {
  const formData = new FormData();
  formData.set("organizationSlug", input.organizationSlug);
  formData.set("productId", input.productId);
  return formData;
}

function buildProductReorderFormData(input: {
  organizationSlug: string;
  orderedIdsJson: string;
}) {
  const formData = new FormData();
  formData.set("organizationSlug", input.organizationSlug);
  formData.set("orderedIdsJson", input.orderedIdsJson);
  return formData;
}

function buildMarkCatalogueStepFormData(input: {
  organizationSlug: string;
  onboardingExpectedVersion?: string | null;
}) {
  const formData = new FormData();
  formData.set("organizationSlug", input.organizationSlug);
  applyVersionFields(formData, {
    onboardingExpectedVersion: input.onboardingExpectedVersion,
  });
  return formData;
}

async function expectVersionValidationFailure(input: {
  prisma: PrismaClient;
  organizationId: string;
  run: () => Promise<ActionState>;
}) {
  const before = await captureSnapshot(input.prisma, input.organizationId);
  const result = await input.run();
  const after = await captureSnapshot(input.prisma, input.organizationId);

  expect(result.status).toBe("error");
  expectZeroWrites(before, after);
  return result;
}

describe("Phase 3A business server actions", () => {
  const prisma = new PrismaClient();

  beforeAll(() => {
    resetServerEnvCache();
    setMailerForTests(mockMailer);
  });

  beforeEach(async () => {
    requireVerifiedUserMock.mockReset();
    await resetApplicationData(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("updateBusinessBasicsAction", () => {
    async function seedBasicsContext(prefix: string) {
      const { owner, organizationId, slug } = await createOrgWithOwner(
        prisma,
        prefix,
        "Basics Action Org",
      );
      await startOnboarding(owner, organizationId);
      const profile = await prisma.businessProfile.findUniqueOrThrow({
        where: { organizationId },
      });
      const onboarding = await prisma.organizationOnboarding.findUniqueOrThrow({
        where: { organizationId },
      });
      setActor(owner);
      return { owner, organizationId, slug, profile, onboarding };
    }

    describe("version validation (markStep set)", () => {
      it.each(MALFORMED_VERSION_VALUES)(
        "rejects malformed expectedVersion (%s) with zero writes",
        async (_label, badValue) => {
          const { organizationId, slug, profile, onboarding } =
            await seedBasicsContext("act-basics-bad-primary");
          await expectVersionValidationFailure({
            prisma,
            organizationId,
            run: () =>
              updateBusinessBasicsAction(
                initialActionState,
                buildBasicsFormData({
                  organizationSlug: slug,
                  expectedVersion: badValue,
                  onboardingExpectedVersion: String(onboarding.version),
                }),
              ),
          });
          expect(profile.version).toBe(0);
        },
      );

      it("rejects missing expectedVersion with zero writes", async () => {
        const { organizationId, slug, onboarding } = await seedBasicsContext(
          "act-basics-missing-primary",
        );
        const result = await expectVersionValidationFailure({
          prisma,
          organizationId,
          run: () =>
            updateBusinessBasicsAction(
              initialActionState,
              buildBasicsFormData({
                organizationSlug: slug,
                expectedVersion: null,
                onboardingExpectedVersion: String(onboarding.version),
              }),
            ),
        });
        expect(result.fieldErrors?.expectedVersion?.length).toBeGreaterThan(0);
      });

      it.each(MALFORMED_VERSION_VALUES)(
        "rejects malformed onboardingExpectedVersion (%s) with zero writes",
        async (_label, badValue) => {
          const { organizationId, slug, profile } = await seedBasicsContext(
            "act-basics-bad-onboarding",
          );
          await expectVersionValidationFailure({
            prisma,
            organizationId,
            run: () =>
              updateBusinessBasicsAction(
                initialActionState,
                buildBasicsFormData({
                  organizationSlug: slug,
                  expectedVersion: String(profile.version),
                  onboardingExpectedVersion: badValue,
                }),
              ),
          });
        },
      );

      it("rejects missing onboardingExpectedVersion with zero writes", async () => {
        const { organizationId, slug, profile } = await seedBasicsContext(
          "act-basics-missing-onboarding",
        );
        const result = await expectVersionValidationFailure({
          prisma,
          organizationId,
          run: () =>
            updateBusinessBasicsAction(
              initialActionState,
              buildBasicsFormData({
                organizationSlug: slug,
                expectedVersion: String(profile.version),
                onboardingExpectedVersion: null,
              }),
            ),
        });
        expect(
          result.fieldErrors?.onboardingExpectedVersion?.length,
        ).toBeGreaterThan(0);
      });

      it("rejects stale expectedVersion with zero writes", async () => {
        const { organizationId, slug, profile, onboarding } =
          await seedBasicsContext("act-basics-stale-primary");
        const result = await expectVersionValidationFailure({
          prisma,
          organizationId,
          run: () =>
            updateBusinessBasicsAction(
              initialActionState,
              buildBasicsFormData({
                organizationSlug: slug,
                expectedVersion: String(profile.version + 99),
                onboardingExpectedVersion: String(onboarding.version),
              }),
            ),
        });
        expect(result.message).toMatch(/elsewhere|Reload/i);
      });

      it("rejects stale onboardingExpectedVersion with zero writes", async () => {
        const { organizationId, slug, profile, onboarding } =
          await seedBasicsContext("act-basics-stale-onboarding");
        const result = await expectVersionValidationFailure({
          prisma,
          organizationId,
          run: () =>
            updateBusinessBasicsAction(
              initialActionState,
              buildBasicsFormData({
                organizationSlug: slug,
                expectedVersion: String(profile.version),
                onboardingExpectedVersion: String(onboarding.version + 99),
              }),
            ),
        });
        expect(result.message).toMatch(/elsewhere|Reload/i);
      });

      it("accepts current versions and increments both", async () => {
        const { organizationId, slug, profile, onboarding } =
          await seedBasicsContext("act-basics-success");
        const before = await captureSnapshot(prisma, organizationId);

        const result = await updateBusinessBasicsAction(
          initialActionState,
          buildBasicsFormData({
            organizationSlug: slug,
            expectedVersion: String(profile.version),
            onboardingExpectedVersion: String(onboarding.version),
          }),
        );

        expect(result.status).toBe("success");
        const after = await captureSnapshot(prisma, organizationId);
        expect(after.profile!.version).toBe(before.profile!.version + 1);
        expect(after.onboarding!.version).toBe(before.onboarding!.version + 1);
        expect(after.profile!.displayName).toBe("Action Test Co");
        expect(after.onboarding!.currentStep).toBe("CONTACT_LOCATION");
        expect(countAudit(after, "BUSINESS_PROFILE_UPDATED")).toBe(
          countAudit(before, "BUSINESS_PROFILE_UPDATED") + 1,
        );
      });
    });
  });

  describe("updateContactLocationAction", () => {
    async function seedContactContext(prefix: string) {
      const { owner, organizationId, slug } = await createOrgWithOwner(
        prisma,
        prefix,
        "Contact Action Org",
      );
      await startOnboarding(owner, organizationId);
      const profile = await prisma.businessProfile.findUniqueOrThrow({
        where: { organizationId },
      });
      const onboarding = await prisma.organizationOnboarding.findUniqueOrThrow({
        where: { organizationId },
      });
      setActor(owner);
      return { owner, organizationId, slug, profile, onboarding };
    }

    describe("version validation (markStep set)", () => {
      it.each(MALFORMED_VERSION_VALUES)(
        "rejects malformed expectedVersion (%s) with zero writes",
        async (_label, badValue) => {
          const { organizationId, slug, onboarding } = await seedContactContext(
            "act-contact-bad-primary",
          );
          await expectVersionValidationFailure({
            prisma,
            organizationId,
            run: () =>
              updateContactLocationAction(
                initialActionState,
                buildContactFormData({
                  organizationSlug: slug,
                  expectedVersion: badValue,
                  onboardingExpectedVersion: String(onboarding.version),
                }),
              ),
          });
        },
      );

      it("rejects missing expectedVersion with zero writes", async () => {
        const { organizationId, slug, onboarding } = await seedContactContext(
          "act-contact-missing-primary",
        );
        const result = await expectVersionValidationFailure({
          prisma,
          organizationId,
          run: () =>
            updateContactLocationAction(
              initialActionState,
              buildContactFormData({
                organizationSlug: slug,
                expectedVersion: null,
                onboardingExpectedVersion: String(onboarding.version),
              }),
            ),
        });
        expect(result.fieldErrors?.expectedVersion?.length).toBeGreaterThan(0);
      });

      it.each(MALFORMED_VERSION_VALUES)(
        "rejects malformed onboardingExpectedVersion (%s) with zero writes",
        async (_label, badValue) => {
          const { organizationId, slug, profile } = await seedContactContext(
            "act-contact-bad-onboarding",
          );
          await expectVersionValidationFailure({
            prisma,
            organizationId,
            run: () =>
              updateContactLocationAction(
                initialActionState,
                buildContactFormData({
                  organizationSlug: slug,
                  expectedVersion: String(profile.version),
                  onboardingExpectedVersion: badValue,
                }),
              ),
          });
        },
      );

      it("rejects completely omitted onboardingExpectedVersion with zero writes", async () => {
        const { organizationId, slug, profile } = await seedContactContext(
          "act-contact-omit-onboarding",
        );
        const formData = new FormData();
        formData.set("organizationSlug", slug);
        formData.set("markStep", "CONTACT_LOCATION");
        formData.set("expectedVersion", String(profile.version));
        formData.set("primaryEmail", "contact@example.com");
        formData.set("primaryPhone", "4165551234");
        formData.set("timeZone", "America/Toronto");
        formData.set("countryCode", "CA");
        formData.set("city", "Toronto");

        const result = await expectVersionValidationFailure({
          prisma,
          organizationId,
          run: () => updateContactLocationAction(initialActionState, formData),
        });
        expect(
          result.fieldErrors?.onboardingExpectedVersion?.length,
        ).toBeGreaterThan(0);
      });

      it("rejects stale expectedVersion with zero writes", async () => {
        const { organizationId, slug, profile, onboarding } =
          await seedContactContext("act-contact-stale-primary");
        const result = await expectVersionValidationFailure({
          prisma,
          organizationId,
          run: () =>
            updateContactLocationAction(
              initialActionState,
              buildContactFormData({
                organizationSlug: slug,
                expectedVersion: String(profile.version + 99),
                onboardingExpectedVersion: String(onboarding.version),
              }),
            ),
        });
        expect(result.message).toMatch(/elsewhere|Reload/i);
      });

      it("rejects stale onboardingExpectedVersion with zero writes", async () => {
        const { organizationId, slug, profile, onboarding } =
          await seedContactContext("act-contact-stale-onboarding");
        const result = await expectVersionValidationFailure({
          prisma,
          organizationId,
          run: () =>
            updateContactLocationAction(
              initialActionState,
              buildContactFormData({
                organizationSlug: slug,
                expectedVersion: String(profile.version),
                onboardingExpectedVersion: String(onboarding.version + 99),
              }),
            ),
        });
        expect(result.message).toMatch(/elsewhere|Reload/i);
      });

      it("accepts current versions and increments both", async () => {
        const { organizationId, slug, profile, onboarding } =
          await seedContactContext("act-contact-success");
        const before = await captureSnapshot(prisma, organizationId);

        const result = await updateContactLocationAction(
          initialActionState,
          buildContactFormData({
            organizationSlug: slug,
            expectedVersion: String(profile.version),
            onboardingExpectedVersion: String(onboarding.version),
          }),
        );

        expect(result.status).toBe("success");
        const after = await captureSnapshot(prisma, organizationId);
        expect(after.profile!.version).toBe(before.profile!.version + 1);
        expect(after.onboarding!.version).toBe(before.onboarding!.version + 1);
        expect(after.profile!.primaryEmail).toBe("contact@example.com");
        expect(after.onboarding!.currentStep).toBe("OPERATING_HOURS");
      });
    });
  });

  describe("replaceOperatingHoursAction", () => {
    async function seedHoursContext(prefix: string) {
      const { owner, organizationId, slug } = await createOrgWithOwner(
        prisma,
        prefix,
        "Hours Action Org",
      );
      await startOnboarding(owner, organizationId);
      const onboarding = await prisma.organizationOnboarding.findUniqueOrThrow({
        where: { organizationId },
      });
      setActor(owner);
      return { owner, organizationId, slug, onboarding };
    }

    describe("version validation (markStep set — no primary expectedVersion)", () => {
      it.each(MALFORMED_VERSION_VALUES)(
        "rejects malformed onboardingExpectedVersion (%s) with zero writes",
        async (_label, badValue) => {
          const { organizationId, slug } = await seedHoursContext(
            "act-hours-bad-onboarding",
          );
          await expectVersionValidationFailure({
            prisma,
            organizationId,
            run: () =>
              replaceOperatingHoursAction(
                initialActionState,
                buildHoursFormData({
                  organizationSlug: slug,
                  onboardingExpectedVersion: badValue,
                }),
              ),
          });
        },
      );

      it("rejects missing onboardingExpectedVersion with zero writes", async () => {
        const { organizationId, slug } = await seedHoursContext(
          "act-hours-missing-onboarding",
        );
        const result = await expectVersionValidationFailure({
          prisma,
          organizationId,
          run: () =>
            replaceOperatingHoursAction(
              initialActionState,
              buildHoursFormData({
                organizationSlug: slug,
                onboardingExpectedVersion: null,
              }),
            ),
        });
        expect(
          result.fieldErrors?.onboardingExpectedVersion?.length,
        ).toBeGreaterThan(0);
      });

      it("rejects stale onboardingExpectedVersion with zero writes", async () => {
        const { organizationId, slug, onboarding } = await seedHoursContext(
          "act-hours-stale-onboarding",
        );
        const result = await expectVersionValidationFailure({
          prisma,
          organizationId,
          run: () =>
            replaceOperatingHoursAction(
              initialActionState,
              buildHoursFormData({
                organizationSlug: slug,
                onboardingExpectedVersion: String(onboarding.version + 99),
              }),
            ),
        });
        expect(result.message).toMatch(/elsewhere|Reload/i);
      });

      it("accepts current onboarding version and writes hours", async () => {
        const { organizationId, slug, onboarding } =
          await seedHoursContext("act-hours-success");
        const before = await captureSnapshot(prisma, organizationId);

        const result = await replaceOperatingHoursAction(
          initialActionState,
          buildHoursFormData({
            organizationSlug: slug,
            onboardingExpectedVersion: String(onboarding.version),
          }),
        );

        expect(result.status).toBe("success");
        const after = await captureSnapshot(prisma, organizationId);
        expect(after.hours).toHaveLength(7);
        expect(after.onboarding!.version).toBe(before.onboarding!.version + 1);
        expect(after.onboarding!.currentStep).toBe("CATALOGUE");
        expect(countAudit(after, "OPERATING_HOURS_UPDATED")).toBe(
          countAudit(before, "OPERATING_HOURS_UPDATED") + 1,
        );
      });
    });
  });

  describe("updateEmployeeDefaultsAction", () => {
    async function seedDefaultsContext(prefix: string) {
      const { owner, organizationId, slug } = await createOrgWithOwner(
        prisma,
        prefix,
        "Defaults Action Org",
      );
      await startOnboarding(owner, organizationId);
      const settings = await prisma.organizationSettings.findUniqueOrThrow({
        where: { organizationId },
      });
      const onboarding = await prisma.organizationOnboarding.findUniqueOrThrow({
        where: { organizationId },
      });
      setActor(owner);
      return { owner, organizationId, slug, settings, onboarding };
    }

    describe("version validation (markStep set)", () => {
      it.each(MALFORMED_VERSION_VALUES)(
        "rejects malformed expectedVersion (%s) with zero writes",
        async (_label, badValue) => {
          const { organizationId, slug, onboarding } =
            await seedDefaultsContext("act-defaults-bad-primary");
          await expectVersionValidationFailure({
            prisma,
            organizationId,
            run: () =>
              updateEmployeeDefaultsAction(
                initialActionState,
                buildEmployeeDefaultsFormData({
                  organizationSlug: slug,
                  expectedVersion: badValue,
                  onboardingExpectedVersion: String(onboarding.version),
                }),
              ),
          });
        },
      );

      it("rejects missing expectedVersion with zero writes", async () => {
        const { organizationId, slug, onboarding } = await seedDefaultsContext(
          "act-defaults-missing-primary",
        );
        const result = await expectVersionValidationFailure({
          prisma,
          organizationId,
          run: () =>
            updateEmployeeDefaultsAction(
              initialActionState,
              buildEmployeeDefaultsFormData({
                organizationSlug: slug,
                expectedVersion: null,
                onboardingExpectedVersion: String(onboarding.version),
              }),
            ),
        });
        expect(result.fieldErrors?.expectedVersion?.length).toBeGreaterThan(0);
      });

      it.each(MALFORMED_VERSION_VALUES)(
        "rejects malformed onboardingExpectedVersion (%s) with zero writes",
        async (_label, badValue) => {
          const { organizationId, slug, settings } = await seedDefaultsContext(
            "act-defaults-bad-onboarding",
          );
          await expectVersionValidationFailure({
            prisma,
            organizationId,
            run: () =>
              updateEmployeeDefaultsAction(
                initialActionState,
                buildEmployeeDefaultsFormData({
                  organizationSlug: slug,
                  expectedVersion: String(settings.version),
                  onboardingExpectedVersion: badValue,
                }),
              ),
          });
        },
      );

      it("rejects completely omitted onboardingExpectedVersion with zero writes", async () => {
        const { organizationId, slug, settings } = await seedDefaultsContext(
          "act-defaults-omit-onboarding",
        );
        const formData = new FormData();
        formData.set("organizationSlug", slug);
        formData.set("markStep", "EMPLOYEE_DEFAULTS");
        formData.set("expectedVersion", String(settings.version));
        formData.set("membersCanViewServices", "on");
        formData.set("membersCanViewProducts", "on");
        formData.set("membersCanViewBusinessInfo", "on");
        formData.set("futureCallingAccessDefault", "DISABLED");

        const result = await expectVersionValidationFailure({
          prisma,
          organizationId,
          run: () => updateEmployeeDefaultsAction(initialActionState, formData),
        });
        expect(
          result.fieldErrors?.onboardingExpectedVersion?.length,
        ).toBeGreaterThan(0);
      });

      it("rejects stale expectedVersion with zero writes", async () => {
        const { organizationId, slug, settings, onboarding } =
          await seedDefaultsContext("act-defaults-stale-primary");
        const result = await expectVersionValidationFailure({
          prisma,
          organizationId,
          run: () =>
            updateEmployeeDefaultsAction(
              initialActionState,
              buildEmployeeDefaultsFormData({
                organizationSlug: slug,
                expectedVersion: String(settings.version + 99),
                onboardingExpectedVersion: String(onboarding.version),
              }),
            ),
        });
        expect(result.message).toMatch(/elsewhere|Reload/i);
      });

      it("rejects stale onboardingExpectedVersion with zero writes", async () => {
        const { organizationId, slug, settings, onboarding } =
          await seedDefaultsContext("act-defaults-stale-onboarding");
        const result = await expectVersionValidationFailure({
          prisma,
          organizationId,
          run: () =>
            updateEmployeeDefaultsAction(
              initialActionState,
              buildEmployeeDefaultsFormData({
                organizationSlug: slug,
                expectedVersion: String(settings.version),
                onboardingExpectedVersion: String(onboarding.version + 99),
              }),
            ),
        });
        expect(result.message).toMatch(/elsewhere|Reload/i);
      });

      it("accepts current versions and increments both", async () => {
        const { organizationId, slug, settings, onboarding } =
          await seedDefaultsContext("act-defaults-success");
        const before = await captureSnapshot(prisma, organizationId);

        const result = await updateEmployeeDefaultsAction(
          initialActionState,
          buildEmployeeDefaultsFormData({
            organizationSlug: slug,
            expectedVersion: String(settings.version),
            onboardingExpectedVersion: String(onboarding.version),
          }),
        );

        expect(result.status).toBe("success");
        const after = await captureSnapshot(prisma, organizationId);
        expect(after.settings!.version).toBe(before.settings!.version + 1);
        expect(after.onboarding!.version).toBe(before.onboarding!.version + 1);
        expect(after.settings!.membersCanViewServices).toBe(true);
        expect(after.onboarding!.currentStep).toBe("REVIEW");
        expect(countAudit(after, "ORGANIZATION_SETTINGS_UPDATED")).toBe(
          countAudit(before, "ORGANIZATION_SETTINGS_UPDATED") + 1,
        );
      });
    });
  });

  describe("authorization (all four actions)", () => {
    const actionCases: Array<{
      id: string;
      name: string;
      markStep: boolean;
      run: (
        slug: string,
        versions: { profile: number; settings: number; onboarding: number },
      ) => FormData;
      action: BusinessActionRunner;
    }> = [
      {
        id: "basics",
        name: "updateBusinessBasicsAction",
        markStep: true,
        run: (slug, versions) =>
          buildBasicsFormData({
            organizationSlug: slug,
            expectedVersion: String(versions.profile),
            onboardingExpectedVersion: String(versions.onboarding),
          }),
        action: updateBusinessBasicsAction,
      },
      {
        id: "contact",
        name: "updateContactLocationAction",
        markStep: true,
        run: (slug, versions) =>
          buildContactFormData({
            organizationSlug: slug,
            expectedVersion: String(versions.profile),
            onboardingExpectedVersion: String(versions.onboarding),
          }),
        action: updateContactLocationAction,
      },
      {
        id: "hours",
        name: "replaceOperatingHoursAction",
        markStep: true,
        run: (slug, versions) =>
          buildHoursFormData({
            organizationSlug: slug,
            onboardingExpectedVersion: String(versions.onboarding),
          }),
        action: replaceOperatingHoursAction,
      },
      {
        id: "defaults",
        name: "updateEmployeeDefaultsAction",
        markStep: true,
        run: (slug, versions) =>
          buildEmployeeDefaultsFormData({
            organizationSlug: slug,
            expectedVersion: String(versions.settings),
            onboardingExpectedVersion: String(versions.onboarding),
          }),
        action: updateEmployeeDefaultsAction,
      },
    ];

    async function seededOrg(prefix: string) {
      const { owner, organizationId, slug } = await createOrgWithOwner(
        prisma,
        prefix,
        "Auth Action Org",
      );
      await startOnboarding(owner, organizationId);
      const profile = await prisma.businessProfile.findUniqueOrThrow({
        where: { organizationId },
      });
      const settings = await prisma.organizationSettings.findUniqueOrThrow({
        where: { organizationId },
      });
      const onboarding = await prisma.organizationOnboarding.findUniqueOrThrow({
        where: { organizationId },
      });
      return {
        owner,
        organizationId,
        slug,
        versions: {
          profile: profile.version,
          settings: settings.version,
          onboarding: onboarding.version,
        },
      };
    }

    describe.each(actionCases)("$name", ({ id, run, action }) => {
      it("unauthenticated throws NEXT_REDIRECT with zero writes", async () => {
        const { organizationId, slug, versions } = await seededOrg(
          `act-au-${id}`,
        );
        setUnauthenticated(`/app/orgs/${slug}/onboarding`);
        const before = await captureSnapshot(prisma, organizationId);

        await expect(
          action(initialActionState, run(slug, versions)),
        ).rejects.toThrow(/NEXT_REDIRECT/);

        const after = await captureSnapshot(prisma, organizationId);
        expectZeroWrites(before, after);
      });

      it("inactive membership returns access error with zero writes", async () => {
        const { organizationId, slug, versions } = await seededOrg(
          `act-in-${id}`,
        );
        const inactive = await addInactiveMember(
          prisma,
          organizationId,
          `act-in-u-${id}`,
        );
        setActor(inactive);
        const before = await captureSnapshot(prisma, organizationId);

        const result = await action(initialActionState, run(slug, versions));

        expect(result.status).toBe("error");
        expect(result.message).toBe(
          "You do not have access to this organization.",
        );
        expectZeroWrites(before, await captureSnapshot(prisma, organizationId));
      });

      it("MEMBER role cannot update with zero writes", async () => {
        const { organizationId, slug, versions } = await seededOrg(
          `act-mb-${id}`,
        );
        const member = await addMember(
          prisma,
          organizationId,
          `act-mb-u-${id}`,
          "MEMBER",
        );
        setActor(member);
        const before = await captureSnapshot(prisma, organizationId);

        const result = await action(initialActionState, run(slug, versions));

        expect(result.status).toBe("error");
        expect(result.message).toBe(
          "You do not have permission to perform this action.",
        );
        expectZeroWrites(before, await captureSnapshot(prisma, organizationId));
      });

      it("cross-tenant slug cannot modify either organization", async () => {
        const orgA = await seededOrg(`act-xa-${id}`);
        const orgB = await seededOrg(`act-xb-${id}`);
        setActor(orgA.owner);

        const beforeA = await captureSnapshot(prisma, orgA.organizationId);
        const beforeB = await captureSnapshot(prisma, orgB.organizationId);

        const result = await action(
          initialActionState,
          run(orgB.slug, orgB.versions),
        );

        expect(result.status).toBe("error");
        expect(result.message).toBe(
          "You do not have access to this organization.",
        );
        expectZeroWrites(
          beforeA,
          await captureSnapshot(prisma, orgA.organizationId),
        );
        expectZeroWrites(
          beforeB,
          await captureSnapshot(prisma, orgB.organizationId),
        );
      });
    });

    it("replaceOperatingHoursAction without markStep still enforces auth", async () => {
      const { organizationId, slug, owner } = await seededOrg(
        "act-auth-hours-no-mark",
      );
      setUnauthenticated();
      const before = await captureSnapshot(prisma, organizationId);
      const formData = buildHoursFormData({
        organizationSlug: slug,
        markStep: false,
        onboardingExpectedVersion: "0",
      });

      await expect(
        replaceOperatingHoursAction(initialActionState, formData),
      ).rejects.toThrow(/NEXT_REDIRECT/);
      expectZeroWrites(before, await captureSnapshot(prisma, organizationId));

      setActor(owner);
      const authed = await replaceOperatingHoursAction(
        initialActionState,
        buildHoursFormData({ organizationSlug: slug, markStep: false }),
      );
      expect(authed.status).toBe("success");
    });
  });

  describe("snapshot sensitivity", () => {
    it("mutating primary location city changes snapshot", async () => {
      const { organizationId } = await (async () => {
        const { owner, organizationId, slug } = await createOrgWithOwner(
          prisma,
          "act-snap-loc",
          "Snapshot Location Org",
        );
        await startOnboarding(owner, organizationId);
        setActor(owner);
        const profile = await prisma.businessProfile.findUniqueOrThrow({
          where: { organizationId },
        });
        const onboarding =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId },
          });
        await updateContactLocationAction(
          initialActionState,
          buildContactFormData({
            organizationSlug: slug,
            expectedVersion: String(profile.version),
            onboardingExpectedVersion: String(onboarding.version),
          }),
        );
        return { organizationId };
      })();

      const before = await captureSnapshot(prisma, organizationId);
      await prisma.businessLocation.updateMany({
        where: { organizationId, isPrimary: true },
        data: { city: "Vancouver" },
      });
      const after = await captureSnapshot(prisma, organizationId);

      expect(after).not.toEqual(before);
      expect(after.primaryLocation?.city).toBe("Vancouver");
    });

    it("replacing hours with same count but different times changes snapshot", async () => {
      const { organizationId, slug, onboarding } = await (async () => {
        const { owner, organizationId, slug } = await createOrgWithOwner(
          prisma,
          "act-snap-hours",
          "Snapshot Hours Org",
        );
        await startOnboarding(owner, organizationId);
        setActor(owner);
        const onboarding =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId },
          });
        await replaceOperatingHoursAction(
          initialActionState,
          buildHoursFormData({
            organizationSlug: slug,
            onboardingExpectedVersion: String(onboarding.version),
          }),
        );
        const refreshedOnboarding =
          await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId },
          });
        return { organizationId, slug, onboarding: refreshedOnboarding };
      })();

      const before = await captureSnapshot(prisma, organizationId);
      const shiftedWeek = defaultWeek().map((day) =>
        day.isClosed ? day : { ...day, startTime: "10:00", endTime: "18:00" },
      );

      const formData = buildHoursFormData({
        organizationSlug: slug,
        markStep: false,
      });
      formData.set("intervalsJson", JSON.stringify(shiftedWeek));

      const result = await replaceOperatingHoursAction(
        initialActionState,
        formData,
      );
      expect(result.status).toBe("success");

      const after = await captureSnapshot(prisma, organizationId);
      expect(after.hours).toHaveLength(before.hours.length);
      expect(after).not.toEqual(before);
      expect(after.onboarding?.version).toBe(onboarding.version);
    });
  });

  describe("pre-start organization (all four combined actions)", () => {
    const preStartCases: Array<{
      id: string;
      action: BusinessActionRunner;
      build: (slug: string) => FormData;
    }> = [
      {
        id: "basics",
        action: updateBusinessBasicsAction,
        build: (slug) =>
          buildBasicsFormData({
            organizationSlug: slug,
            expectedVersion: "0",
            onboardingExpectedVersion: "0",
          }),
      },
      {
        id: "contact",
        action: updateContactLocationAction,
        build: (slug) =>
          buildContactFormData({
            organizationSlug: slug,
            expectedVersion: "0",
            onboardingExpectedVersion: "0",
          }),
      },
      {
        id: "hours",
        action: replaceOperatingHoursAction,
        build: (slug) =>
          buildHoursFormData({
            organizationSlug: slug,
            onboardingExpectedVersion: "0",
          }),
      },
      {
        id: "defaults",
        action: updateEmployeeDefaultsAction,
        build: (slug) =>
          buildEmployeeDefaultsFormData({
            organizationSlug: slug,
            expectedVersion: "0",
            onboardingExpectedVersion: "0",
          }),
      },
    ];

    describe.each(preStartCases)("$id", ({ id, action, build }) => {
      it("does not initialize onboarding or business config with forged versions", async () => {
        const { owner, organizationId, slug } = await createOrgWithOwner(
          prisma,
          `act-prestart-${id}`,
          "Pre Start Org",
        );
        setActor(owner);
        const before = await captureSnapshot(prisma, organizationId);
        await assertPreStartRecordsAbsent(prisma, organizationId);

        const result = await action(initialActionState, build(slug));

        expect(result.status).toBe("error");
        expect(result.message).toBe("Organization not found.");
        const after = await captureSnapshot(prisma, organizationId);
        expectZeroWrites(before, after);
        await assertPreStartRecordsAbsent(prisma, organizationId);
        expect(countAudit(after, "BUSINESS_PROFILE_UPDATED")).toBe(
          countAudit(before, "BUSINESS_PROFILE_UPDATED"),
        );
        expect(countAudit(after, "OPERATING_HOURS_UPDATED")).toBe(
          countAudit(before, "OPERATING_HOURS_UPDATED"),
        );
        expect(countAudit(after, "ORGANIZATION_SETTINGS_UPDATED")).toBe(
          countAudit(before, "ORGANIZATION_SETTINGS_UPDATED"),
        );
        expect(countAudit(after, "ONBOARDING_STARTED")).toBe(
          countAudit(before, "ONBOARDING_STARTED"),
        );
      });
    });
  });

  describe("catalogue actions — no action-level expectedVersion", () => {
    /**
     * Executed coverage (Phase 3A action boundary):
     * - Services: create / update / deactivate / reorder (partial matrix above)
     * - Products: create / update / deactivate / reorder (full matrix below)
     *
     * Products intentionally do NOT parse expectedVersion/onboardingExpectedVersion.
     * Concurrency via:
     * - create/update/deactivate: readiness advisory lock → membership FOR UPDATE →
     *   refreshConfigurationReadiness; audits PRODUCT_*
     * - reorder: membership FOR UPDATE → products-order:<orgId> advisory lock (NO
     *   readiness lock — same as services reorder); audit PRODUCT_UPDATED w/ reorder
     * Tenant scope: always organizationId in where clauses.
     * Validation: productInputSchema (name 1–120, sku optional max 64 [A-Za-z0-9._-])
     * before mutation. Extra version fields in FormData are ignored.
     * Onboarding progress: markCatalogueStepAction (separate describe) uses
     * onboardingExpectedVersion only.
     */

    async function seedCatalogueOrg(prefix: string) {
      const { owner, organizationId, slug } = await createOrgWithOwner(
        prisma,
        prefix,
        "Catalogue Action Org",
      );
      await startOnboarding(owner, organizationId);
      setActor(owner);
      return { owner, organizationId, slug };
    }

    async function seedCompletedCatalogueOrg(prefix: string) {
      const ctx = await seedCatalogueOrg(prefix);
      await prisma.businessProfile.update({
        where: { organizationId: ctx.organizationId },
        data: {
          displayName: "Done Co",
          industry: "Retail",
          businessType: "BOTH",
          primaryEmail: "done@example.com",
          primaryPhoneE164: "+14165551234",
          timeZone: "America/Toronto",
        },
      });
      await prisma.businessLocation.updateMany({
        where: { organizationId: ctx.organizationId, isPrimary: true },
        data: { countryCode: "CA", city: "Toronto" },
      });
      await replaceOperatingHoursAction(
        initialActionState,
        buildHoursFormData({
          organizationSlug: ctx.slug,
          markStep: false,
        }),
      );
      await createServiceAction(
        initialActionState,
        (() => {
          const fd = new FormData();
          fd.set("organizationSlug", ctx.slug);
          fd.set("name", "Completion Service");
          return fd;
        })(),
      );
      await createProductAction(
        initialActionState,
        buildProductCreateFormData({
          organizationSlug: ctx.slug,
          name: "Completion Widget",
          sku: "DONE-1",
        }),
      );
      await createProductAction(
        initialActionState,
        buildProductCreateFormData({
          organizationSlug: ctx.slug,
          name: "Spare Widget",
          sku: "DONE-2",
        }),
      );
      const completed = await completeOrganizationOnboarding({
        actor: ctx.owner,
        organizationId: ctx.organizationId,
      });
      if (!completed.ok)
        throw new Error(`complete failed: ${completed.reason}`);
      return ctx;
    }

    async function createProductInOrg(
      organizationId: string,
      slug: string,
      name: string,
      sku?: string,
    ) {
      const result = await createProductAction(
        initialActionState,
        buildProductCreateFormData({
          organizationSlug: slug,
          name,
          sku,
        }),
      );
      expect(result.status).toBe("success");
      const product = await prisma.businessProduct.findFirstOrThrow({
        where: { organizationId, name },
      });
      return product;
    }

    it("createServiceAction ignores expectedVersion and onboardingExpectedVersion", async () => {
      const { organizationId, slug } = await seedCatalogueOrg(
        "act-cat-create-ignore",
      );
      const before = await captureSnapshot(prisma, organizationId);

      const formData = new FormData();
      formData.set("organizationSlug", slug);
      formData.set("expectedVersion", "999");
      formData.set("onboardingExpectedVersion", "999");
      formData.set("name", "Version Ignored Service");

      const result = await createServiceAction(initialActionState, formData);

      expect(result.status).toBe("success");
      const after = await captureSnapshot(prisma, organizationId);
      expect(after.services).toHaveLength(before.services.length + 1);
      expect(
        after.services.some((s) => s.name === "Version Ignored Service"),
      ).toBe(true);
    });

    it("createServiceAction rejects empty name with zero catalogue writes", async () => {
      const { organizationId, slug } = await seedCatalogueOrg(
        "act-cat-create-empty",
      );
      const before = await captureSnapshot(prisma, organizationId);

      const formData = new FormData();
      formData.set("organizationSlug", slug);
      formData.set("name", "");

      const result = await createServiceAction(initialActionState, formData);

      expect(result.status).toBe("error");
      expectZeroWrites(before, await captureSnapshot(prisma, organizationId));
    });

    it("cross-tenant updateServiceAction cannot modify another org service", async () => {
      const orgA = await seedCatalogueOrg("act-cat-xa");
      const orgB = await seedCatalogueOrg("act-cat-xb");

      const serviceB = await prisma.businessService.create({
        data: {
          organizationId: orgB.organizationId,
          name: "Org B Service",
          displayOrder: 0,
        },
      });

      setActor(orgA.owner);
      const beforeA = await captureSnapshot(prisma, orgA.organizationId);
      const beforeB = await captureSnapshot(prisma, orgB.organizationId);

      const formData = new FormData();
      formData.set("organizationSlug", orgA.slug);
      formData.set("serviceId", serviceB.id);
      formData.set("name", "Cross Tenant Hijack");

      const result = await updateServiceAction(initialActionState, formData);

      expect(result.status).toBe("error");
      expect(result.message).toBe("Organization not found.");
      expectZeroWrites(
        beforeA,
        await captureSnapshot(prisma, orgA.organizationId),
      );
      expectZeroWrites(
        beforeB,
        await captureSnapshot(prisma, orgB.organizationId),
      );
    });

    it("cross-tenant deactivateServiceAction cannot modify another org service", async () => {
      const orgA = await seedCatalogueOrg("act-cat-da");
      const orgB = await seedCatalogueOrg("act-cat-db");

      const serviceB = await prisma.businessService.create({
        data: {
          organizationId: orgB.organizationId,
          name: "Org B Deactivate Target",
          displayOrder: 0,
        },
      });

      setActor(orgA.owner);
      const beforeA = await captureSnapshot(prisma, orgA.organizationId);
      const beforeB = await captureSnapshot(prisma, orgB.organizationId);

      const formData = new FormData();
      formData.set("organizationSlug", orgA.slug);
      formData.set("serviceId", serviceB.id);

      const result = await deactivateServiceAction(
        initialActionState,
        formData,
      );

      expect(result.status).toBe("error");
      expect(result.message).toBe("Organization not found.");
      expectZeroWrites(
        beforeA,
        await captureSnapshot(prisma, orgA.organizationId),
      );
      expectZeroWrites(
        beforeB,
        await captureSnapshot(prisma, orgB.organizationId),
      );
    });

    it("reorderServicesAction rejects malformed orderedIdsJson with zero writes", async () => {
      const { organizationId, slug } = await seedCatalogueOrg(
        "act-cat-reorder-bad",
      );
      await prisma.businessService.create({
        data: {
          organizationId,
          name: "Reorder Target",
          displayOrder: 0,
        },
      });
      const before = await captureSnapshot(prisma, organizationId);

      const formData = new FormData();
      formData.set("organizationSlug", slug);
      formData.set("orderedIdsJson", "not-valid-json");

      const result = await reorderServicesAction(initialActionState, formData);

      expect(result.status).toBe("error");
      expect(result.message).toBe("Invalid reorder payload.");
      expectZeroWrites(before, await captureSnapshot(prisma, organizationId));
    });

    describe("createProductAction", () => {
      it("creates product with name and sku, org-scoped, PRODUCT_CREATED audit", async () => {
        const { organizationId, slug } =
          await seedCatalogueOrg("act-prod-create-ok");
        const before = await captureSnapshot(prisma, organizationId);

        const result = await createProductAction(
          initialActionState,
          buildProductCreateFormData({
            organizationSlug: slug,
            name: "Widget Pro",
            sku: "WDG-001",
            expectedVersion: "999",
            onboardingExpectedVersion: "999",
          }),
        );

        expect(result.status).toBe("success");
        const after = await captureSnapshot(prisma, organizationId);
        expect(after.products).toHaveLength(before.products.length + 1);
        const created = after.products.find((p) => p.name === "Widget Pro");
        expect(created).toBeDefined();
        expect(created!.sku).toBe("WDG-001");
        expect(created!.organizationId).toBe(organizationId);
        expect(countAudit(after, "PRODUCT_CREATED")).toBe(
          countAudit(before, "PRODUCT_CREATED") + 1,
        );
      });

      it.each([
        ["missing name", { omitName: true }],
        ["whitespace name", { name: "   " }],
        ["name too long", { name: "x".repeat(121) }],
        ["invalid sku chars", { name: "Valid", sku: "bad sku!" }],
        ["sku too long", { name: "Valid", sku: "a".repeat(65) }],
      ] as const)(
        "rejects %s with controlled error and zero writes",
        async (_label, input) => {
          const { organizationId, slug } = await seedCatalogueOrg(
            `act-prod-inv-${_label.replace(/\s+/g, "-")}`,
          );
          const before = await captureSnapshot(prisma, organizationId);
          const formData = buildProductCreateFormData({
            organizationSlug: slug,
            name: "omitName" in input ? undefined : input.name,
            sku: "sku" in input ? input.sku : undefined,
          });
          if ("omitName" in input) {
            formData.delete("name");
          }

          const result = await createProductAction(
            initialActionState,
            formData,
          );

          expect(result.status).toBe("error");
          expectZeroWrites(
            before,
            await captureSnapshot(prisma, organizationId),
          );
        },
      );

      it("pre-start create allowed without initializing onboarding or business defaults", async () => {
        const { owner, organizationId, slug } = await createOrgWithOwner(
          prisma,
          "act-prod-prestart",
          "Pre Start Product Org",
        );
        setActor(owner);
        await assertPreStartRecordsAbsent(prisma, organizationId);
        const before = await captureSnapshot(prisma, organizationId);

        const result = await createProductAction(
          initialActionState,
          buildProductCreateFormData({
            organizationSlug: slug,
            name: "Pre Start Widget",
            sku: "PRE-1",
          }),
        );

        expect(result.status).toBe("success");
        const after = await captureSnapshot(prisma, organizationId);
        expect(after.products).toHaveLength(1);
        expect(after.products[0].name).toBe("Pre Start Widget");
        expect(after.onboarding).toBeNull();
        expect(after.profile).toBeNull();
        expect(after.settings).toBeNull();
        expect(after.hours).toHaveLength(0);
        expect(after.primaryLocation).toBeNull();
        expect(countAudit(after, "PRODUCT_CREATED")).toBe(
          countAudit(before, "PRODUCT_CREATED") + 1,
        );
        expect(countAudit(after, "ONBOARDING_STARTED")).toBe(
          countAudit(before, "ONBOARDING_STARTED"),
        );
      });
    });

    describe("updateProductAction", () => {
      it("updates target product only and ignores extra version fields", async () => {
        const { organizationId, slug } =
          await seedCatalogueOrg("act-prod-update-ok");
        const p1 = await createProductInOrg(
          organizationId,
          slug,
          "Alpha",
          "A1",
        );
        const p2 = await createProductInOrg(organizationId, slug, "Beta", "B1");
        const before = await captureSnapshot(prisma, organizationId);

        const result = await updateProductAction(
          initialActionState,
          buildProductUpdateFormData({
            organizationSlug: slug,
            productId: p1.id,
            name: "Alpha Updated",
            sku: "A1-NEW",
            expectedVersion: "999",
            onboardingExpectedVersion: "999",
          }),
        );

        expect(result.status).toBe("success");
        const after = await captureSnapshot(prisma, organizationId);
        const updated = after.products.find((p) => p.id === p1.id);
        const untouched = after.products.find((p) => p.id === p2.id);
        expect(updated!.name).toBe("Alpha Updated");
        expect(updated!.sku).toBe("A1-NEW");
        expect(untouched!.name).toBe("Beta");
        expect(countAudit(after, "PRODUCT_UPDATED")).toBe(
          countAudit(before, "PRODUCT_UPDATED") + 1,
        );
      });

      it.each([
        ["missing productId", ""],
        ["unknown productId", "clh123456789012345678901234"],
      ])("rejects %s with zero writes", async (_label, productId) => {
        const { organizationId, slug } = await seedCatalogueOrg(
          "act-prod-update-bad-id",
        );
        const before = await captureSnapshot(prisma, organizationId);
        const formData = buildProductUpdateFormData({
          organizationSlug: slug,
          productId,
          name: "Nope",
        });
        if (_label === "missing productId") {
          formData.delete("productId");
        }

        const result = await updateProductAction(initialActionState, formData);

        expect(result.status).toBe("error");
        expectZeroWrites(before, await captureSnapshot(prisma, organizationId));
      });

      it("rejects empty name with zero writes", async () => {
        const { organizationId, slug } = await seedCatalogueOrg(
          "act-prod-update-empty",
        );
        const product = await createProductInOrg(
          organizationId,
          slug,
          "To Update",
        );
        const before = await captureSnapshot(prisma, organizationId);

        const result = await updateProductAction(
          initialActionState,
          buildProductUpdateFormData({
            organizationSlug: slug,
            productId: product.id,
            name: "   ",
          }),
        );

        expect(result.status).toBe("error");
        expectZeroWrites(before, await captureSnapshot(prisma, organizationId));
      });

      it("cross-tenant update with own slug and foreign productId leaves both orgs unchanged", async () => {
        const orgA = await seedCatalogueOrg("act-prod-xupd-a");
        const orgB = await seedCatalogueOrg("act-prod-xupd-b");
        const productB = await createProductInOrg(
          orgB.organizationId,
          orgB.slug,
          "Org B Product",
        );
        setActor(orgA.owner);
        const beforeA = await captureSnapshot(prisma, orgA.organizationId);
        const beforeB = await captureSnapshot(prisma, orgB.organizationId);

        const result = await updateProductAction(
          initialActionState,
          buildProductUpdateFormData({
            organizationSlug: orgA.slug,
            productId: productB.id,
            name: "Hijacked",
          }),
        );

        expect(result.status).toBe("error");
        expect(result.message).toBe("Organization not found.");
        expectZeroWrites(
          beforeA,
          await captureSnapshot(prisma, orgA.organizationId),
        );
        expectZeroWrites(
          beforeB,
          await captureSnapshot(prisma, orgB.organizationId),
        );
      });

      it("still succeeds after onboarding completion (products not frozen)", async () => {
        const { organizationId, slug } = await seedCompletedCatalogueOrg(
          "act-prod-post-complete-upd",
        );
        const product = await prisma.businessProduct.findFirstOrThrow({
          where: { organizationId },
        });
        const before = await captureSnapshot(prisma, organizationId);

        const result = await updateProductAction(
          initialActionState,
          buildProductUpdateFormData({
            organizationSlug: slug,
            productId: product.id,
            name: "Post Complete Name",
          }),
        );

        expect(result.status).toBe("success");
        const after = await captureSnapshot(prisma, organizationId);
        expect(after.products.find((p) => p.id === product.id)!.name).toBe(
          "Post Complete Name",
        );
        expect(after.onboarding!.status).toBe("COMPLETED");
        expect(countAudit(after, "PRODUCT_UPDATED")).toBe(
          countAudit(before, "PRODUCT_UPDATED") + 1,
        );
      });
    });

    describe("deactivateProductAction", () => {
      it("deactivates target only and writes PRODUCT_DEACTIVATED once", async () => {
        const { organizationId, slug } =
          await seedCatalogueOrg("act-prod-deact-ok");
        const p1 = await createProductInOrg(organizationId, slug, "Keep", "K1");
        const p2 = await createProductInOrg(
          organizationId,
          slug,
          "Remove",
          "R1",
        );
        const before = await captureSnapshot(prisma, organizationId);

        const result = await deactivateProductAction(
          initialActionState,
          buildProductDeactivateFormData({
            organizationSlug: slug,
            productId: p2.id,
          }),
        );

        expect(result.status).toBe("success");
        const after = await captureSnapshot(prisma, organizationId);
        expect(after.products.find((p) => p.id === p1.id)!.isActive).toBe(true);
        expect(after.products.find((p) => p.id === p2.id)!.isActive).toBe(
          false,
        );
        expect(countAudit(after, "PRODUCT_DEACTIVATED")).toBe(
          countAudit(before, "PRODUCT_DEACTIVATED") + 1,
        );
      });

      it.each([
        ["missing productId", ""],
        ["unknown productId", "clh123456789012345678901234"],
      ])(
        "rejects %s with zero writes on both orgs for cross-tenant",
        async (_label, productId) => {
          const orgA = await seedCatalogueOrg("act-prod-deact-bad-a");
          const orgB = await seedCatalogueOrg("act-prod-deact-bad-b");
          const productB = await createProductInOrg(
            orgB.organizationId,
            orgB.slug,
            "Target",
          );
          setActor(orgA.owner);
          const beforeA = await captureSnapshot(prisma, orgA.organizationId);
          const beforeB = await captureSnapshot(prisma, orgB.organizationId);
          const formData = buildProductDeactivateFormData({
            organizationSlug: orgA.slug,
            productId: _label === "missing productId" ? productId : productB.id,
          });
          if (_label === "missing productId") {
            formData.delete("productId");
          }

          const result = await deactivateProductAction(
            initialActionState,
            formData,
          );

          expect(result.status).toBe("error");
          expectZeroWrites(
            beforeA,
            await captureSnapshot(prisma, orgA.organizationId),
          );
          expectZeroWrites(
            beforeB,
            await captureSnapshot(prisma, orgB.organizationId),
          );
        },
      );

      it("repeat deactivate is idempotent (ok with isActive false)", async () => {
        const { organizationId, slug } = await seedCatalogueOrg(
          "act-prod-deact-repeat",
        );
        const product = await createProductInOrg(
          organizationId,
          slug,
          "Once",
          "O1",
        );
        const first = await deactivateProductAction(
          initialActionState,
          buildProductDeactivateFormData({
            organizationSlug: slug,
            productId: product.id,
          }),
        );
        expect(first.status).toBe("success");
        const before = await captureSnapshot(prisma, organizationId);

        const second = await deactivateProductAction(
          initialActionState,
          buildProductDeactivateFormData({
            organizationSlug: slug,
            productId: product.id,
          }),
        );

        expect(second.status).toBe("success");
        const after = await captureSnapshot(prisma, organizationId);
        expect(after.products.find((p) => p.id === product.id)!.isActive).toBe(
          false,
        );
        expect(countAudit(after, "PRODUCT_DEACTIVATED")).toBe(
          countAudit(before, "PRODUCT_DEACTIVATED") + 1,
        );
      });

      it("still allowed after onboarding completion", async () => {
        const { organizationId, slug } = await seedCompletedCatalogueOrg(
          "act-prod-post-complete-deact",
        );
        const product = await prisma.businessProduct.findFirstOrThrow({
          where: { organizationId, sku: "DONE-2" },
        });
        const before = await captureSnapshot(prisma, organizationId);

        const result = await deactivateProductAction(
          initialActionState,
          buildProductDeactivateFormData({
            organizationSlug: slug,
            productId: product.id,
          }),
        );

        expect(result.status).toBe("success");
        const after = await captureSnapshot(prisma, organizationId);
        expect(after.products.find((p) => p.id === product.id)!.isActive).toBe(
          false,
        );
        // Deactivate is allowed after completion; spare catalogue item keeps readiness.
        expect(after.onboarding!.status).toBe("COMPLETED");
        expect(countAudit(after, "PRODUCT_DEACTIVATED")).toBe(
          countAudit(before, "PRODUCT_DEACTIVATED") + 1,
        );
      });
    });

    describe("reorderProductsAction", () => {
      async function seedThreeProducts(organizationId: string, slug: string) {
        const created = [];
        for (const name of ["P-A", "P-B", "P-C"]) {
          created.push(await createProductInOrg(organizationId, slug, name));
        }
        return created;
      }

      it("reorders products exactly and writes one PRODUCT_UPDATED reorder audit", async () => {
        const { organizationId, slug } = await seedCatalogueOrg(
          "act-prod-reorder-ok",
        );
        const [pA, pB, pC] = await seedThreeProducts(organizationId, slug);
        const before = await captureSnapshot(prisma, organizationId);
        const targetOrder = [pC.id, pA.id, pB.id];

        const result = await reorderProductsAction(
          initialActionState,
          buildProductReorderFormData({
            organizationSlug: slug,
            orderedIdsJson: JSON.stringify(targetOrder),
          }),
        );

        expect(result.status).toBe("success");
        const after = await captureSnapshot(prisma, organizationId);
        expect(after.products.map((p) => p.id)).toEqual(targetOrder);
        expect(after.products.every((p) => p.isActive)).toBe(true);
        const reorderAudits = after.audits.filter(
          (e) =>
            e.action === "PRODUCT_UPDATED" &&
            (e.metadata as { reorder?: boolean })?.reorder === true,
        );
        expect(reorderAudits).toHaveLength(
          before.audits.filter(
            (e) =>
              e.action === "PRODUCT_UPDATED" &&
              (e.metadata as { reorder?: boolean })?.reorder === true,
          ).length + 1,
        );
      });

      it.each([
        ["malformed JSON", "not-json"],
        ["non-array payload", JSON.stringify({})],
        ["invalid cuid in list", JSON.stringify(["not-a-cuid"])],
      ])("rejects %s with zero writes", async (_label, orderedIdsJson) => {
        const { organizationId, slug } = await seedCatalogueOrg(
          "act-prod-reorder-val",
        );
        await seedThreeProducts(organizationId, slug);
        const before = await captureSnapshot(prisma, organizationId);

        const result = await reorderProductsAction(
          initialActionState,
          buildProductReorderFormData({
            organizationSlug: slug,
            orderedIdsJson,
          }),
        );

        expect(result.status).toBe("error");
        expect(result.message).toBe("Invalid reorder payload.");
        expectZeroWrites(before, await captureSnapshot(prisma, organizationId));
      });

      it("rejects duplicate, missing, unknown, and cross-tenant ids with zero writes", async () => {
        const orgA = await seedCatalogueOrg("act-prod-reorder-xa");
        const orgB = await seedCatalogueOrg("act-prod-reorder-xb");
        setActor(orgA.owner);
        const [a1, a2, a3] = await seedThreeProducts(
          orgA.organizationId,
          orgA.slug,
        );
        setActor(orgB.owner);
        const b1 = await createProductInOrg(
          orgB.organizationId,
          orgB.slug,
          "Foreign",
        );
        setActor(orgA.owner);
        const beforeA = await captureSnapshot(prisma, orgA.organizationId);
        const beforeB = await captureSnapshot(prisma, orgB.organizationId);

        const cases = [
          JSON.stringify([a1.id, a1.id, a2.id]),
          JSON.stringify([a1.id, a2.id]),
          JSON.stringify([a1.id, a2.id, a3.id, "clh123456789012345678901234"]),
          JSON.stringify([b1.id, a2.id, a3.id]),
        ];

        for (const orderedIdsJson of cases) {
          const result = await reorderProductsAction(
            initialActionState,
            buildProductReorderFormData({
              organizationSlug: orgA.slug,
              orderedIdsJson,
            }),
          );
          expect(result.status).toBe("error");
          expect(result.message).toBe(
            "You do not have permission to perform this action.",
          );
        }

        expectZeroWrites(
          beforeA,
          await captureSnapshot(prisma, orgA.organizationId),
        );
        expectZeroWrites(
          beforeB,
          await captureSnapshot(prisma, orgB.organizationId),
        );
      });
    });

    describe("catalogue product/service auth matrix", () => {
      type CatalogueAuthCase = {
        id: string;
        name: string;
        run: (slug: string, productId?: string) => FormData;
        action: BusinessActionRunner;
        needsProduct?: boolean;
      };

      const authCases: CatalogueAuthCase[] = [
        {
          id: "create-product",
          name: "createProductAction",
          run: (slug) =>
            buildProductCreateFormData({
              organizationSlug: slug,
              name: "Auth Product",
            }),
          action: createProductAction,
        },
        {
          id: "update-product",
          name: "updateProductAction",
          run: (slug, productId) =>
            buildProductUpdateFormData({
              organizationSlug: slug,
              productId: productId!,
              name: "Auth Updated",
            }),
          action: updateProductAction,
          needsProduct: true,
        },
        {
          id: "deactivate-product",
          name: "deactivateProductAction",
          run: (slug, productId) =>
            buildProductDeactivateFormData({
              organizationSlug: slug,
              productId: productId!,
            }),
          action: deactivateProductAction,
          needsProduct: true,
        },
        {
          id: "reorder-products",
          name: "reorderProductsAction",
          run: (slug, productId) =>
            buildProductReorderFormData({
              organizationSlug: slug,
              orderedIdsJson: JSON.stringify([productId!]),
            }),
          action: reorderProductsAction,
          needsProduct: true,
        },
      ];

      async function seededProductOrg(prefix: string) {
        const ctx = await seedCatalogueOrg(prefix);
        const product = await createProductInOrg(
          ctx.organizationId,
          ctx.slug,
          "Auth Target",
        );
        return { ...ctx, productId: product.id };
      }

      describe.each(authCases)("$name", ({ id, run, action, needsProduct }) => {
        it("unauthenticated throws NEXT_REDIRECT with zero writes", async () => {
          const { organizationId, slug, productId } = await seededProductOrg(
            `act-pau-${id}`,
          );
          setUnauthenticated(`/app/orgs/${slug}/onboarding`);
          const before = await captureSnapshot(prisma, organizationId);

          await expect(
            action(
              initialActionState,
              run(slug, needsProduct ? productId : undefined),
            ),
          ).rejects.toThrow(/NEXT_REDIRECT/);

          expectZeroWrites(
            before,
            await captureSnapshot(prisma, organizationId),
          );
        });

        it("inactive membership returns access error with zero writes", async () => {
          const { organizationId, slug, productId } = await seededProductOrg(
            `act-pin-${id}`,
          );
          const inactive = await addInactiveMember(
            prisma,
            organizationId,
            `act-pin-u-${id}`,
          );
          setActor(inactive);
          const before = await captureSnapshot(prisma, organizationId);

          const result = await action(
            initialActionState,
            run(slug, needsProduct ? productId : undefined),
          );

          expect(result.status).toBe("error");
          expect(result.message).toBe(
            "You do not have access to this organization.",
          );
          expectZeroWrites(
            before,
            await captureSnapshot(prisma, organizationId),
          );
        });

        it("MEMBER role is forbidden with zero writes", async () => {
          const { organizationId, slug, productId } = await seededProductOrg(
            `act-pmb-${id}`,
          );
          const member = await addMember(
            prisma,
            organizationId,
            `act-pmb-u-${id}`,
            "MEMBER",
          );
          setActor(member);
          const before = await captureSnapshot(prisma, organizationId);

          const result = await action(
            initialActionState,
            run(slug, needsProduct ? productId : undefined),
          );

          expect(result.status).toBe("error");
          expect(result.message).toBe(
            "You do not have permission to perform this action.",
          );
          expectZeroWrites(
            before,
            await captureSnapshot(prisma, organizationId),
          );
        });

        it("cross-tenant slug cannot modify either organization", async () => {
          const orgA = await seededProductOrg(`act-pxa-${id}`);
          const orgB = await seededProductOrg(`act-pxb-${id}`);
          setActor(orgA.owner);
          const beforeA = await captureSnapshot(prisma, orgA.organizationId);
          const beforeB = await captureSnapshot(prisma, orgB.organizationId);

          const result = await action(
            initialActionState,
            run(orgB.slug, needsProduct ? orgB.productId : undefined),
          );

          expect(result.status).toBe("error");
          expect(result.message).toBe(
            "You do not have access to this organization.",
          );
          expectZeroWrites(
            beforeA,
            await captureSnapshot(prisma, orgA.organizationId),
          );
          expectZeroWrites(
            beforeB,
            await captureSnapshot(prisma, orgB.organizationId),
          );
        });
      });
    });
  });

  describe("markCatalogueStepAction", () => {
    async function seedCatalogueStepContext(prefix: string) {
      const { owner, organizationId, slug } = await createOrgWithOwner(
        prisma,
        prefix,
        "Catalogue Step Org",
      );
      await startOnboarding(owner, organizationId);
      const onboarding = await prisma.organizationOnboarding.findUniqueOrThrow({
        where: { organizationId },
      });
      setActor(owner);
      return { owner, organizationId, slug, onboarding };
    }

    async function seedReadinessFixtures(input: {
      owner: SafeUser;
      organizationId: string;
      slug: string;
      businessType: "SERVICES" | "PRODUCTS" | "BOTH";
      withActiveService?: boolean;
      withActiveProduct?: boolean;
      inactiveProduct?: boolean;
    }) {
      const profile = await prisma.businessProfile.findUniqueOrThrow({
        where: { organizationId: input.organizationId },
      });
      const onboarding = await prisma.organizationOnboarding.findUniqueOrThrow({
        where: { organizationId: input.organizationId },
      });
      await updateBusinessBasicsAction(
        initialActionState,
        buildBasicsFormData({
          organizationSlug: input.slug,
          expectedVersion: String(profile.version),
          onboardingExpectedVersion: String(onboarding.version),
          markStep: false,
        }),
      );
      await prisma.businessProfile.update({
        where: { organizationId: input.organizationId },
        data: { businessType: input.businessType },
      });
      await updateContactLocationAction(
        initialActionState,
        buildContactFormData({
          organizationSlug: input.slug,
          expectedVersion: String(
            (
              await prisma.businessProfile.findUniqueOrThrow({
                where: { organizationId: input.organizationId },
              })
            ).version,
          ),
          onboardingExpectedVersion: String(
            (
              await prisma.organizationOnboarding.findUniqueOrThrow({
                where: { organizationId: input.organizationId },
              })
            ).version,
          ),
          markStep: false,
        }),
      );
      const onboarding4 = await prisma.organizationOnboarding.findUniqueOrThrow(
        {
          where: { organizationId: input.organizationId },
        },
      );
      await replaceOperatingHoursAction(
        initialActionState,
        buildHoursFormData({
          organizationSlug: input.slug,
          onboardingExpectedVersion: String(onboarding4.version),
          markStep: false,
        }),
      );
      if (input.withActiveService) {
        await createServiceAction(
          initialActionState,
          (() => {
            const fd = new FormData();
            fd.set("organizationSlug", input.slug);
            fd.set("name", "Ready Service");
            return fd;
          })(),
        );
      }
      if (input.withActiveProduct) {
        await createProductAction(
          initialActionState,
          buildProductCreateFormData({
            organizationSlug: input.slug,
            name: "Ready Product",
            sku: `RDY-${randomUUID().slice(0, 6)}`,
            isActive: input.inactiveProduct ? false : true,
          }),
        );
      }
    }

    describe("version validation", () => {
      it("rejects omitted onboardingExpectedVersion with zero writes", async () => {
        const { organizationId, slug } =
          await seedCatalogueStepContext("act-catstep-omit");
        const formData = new FormData();
        formData.set("organizationSlug", slug);
        const result = await expectVersionValidationFailure({
          prisma,
          organizationId,
          run: () => markCatalogueStepAction(initialActionState, formData),
        });
        expect(
          result.fieldErrors?.onboardingExpectedVersion?.length,
        ).toBeGreaterThan(0);
      });

      it("rejects empty onboardingExpectedVersion with zero writes", async () => {
        const { organizationId, slug } =
          await seedCatalogueStepContext("act-catstep-empty");
        const result = await expectVersionValidationFailure({
          prisma,
          organizationId,
          run: () =>
            markCatalogueStepAction(
              initialActionState,
              buildMarkCatalogueStepFormData({
                organizationSlug: slug,
                onboardingExpectedVersion: "",
              }),
            ),
        });
        expect(
          result.fieldErrors?.onboardingExpectedVersion?.length,
        ).toBeGreaterThan(0);
      });

      it.each(MALFORMED_VERSION_VALUES)(
        "rejects malformed onboardingExpectedVersion (%s) with zero writes",
        async (_label, badValue) => {
          const { organizationId, slug } =
            await seedCatalogueStepContext("act-catstep-bad");
          await expectVersionValidationFailure({
            prisma,
            organizationId,
            run: () =>
              markCatalogueStepAction(
                initialActionState,
                buildMarkCatalogueStepFormData({
                  organizationSlug: slug,
                  onboardingExpectedVersion: badValue,
                }),
              ),
          });
        },
      );

      it("rejects stale onboardingExpectedVersion with zero writes", async () => {
        const { organizationId, slug, onboarding } =
          await seedCatalogueStepContext("act-catstep-stale");
        const result = await expectVersionValidationFailure({
          prisma,
          organizationId,
          run: () =>
            markCatalogueStepAction(
              initialActionState,
              buildMarkCatalogueStepFormData({
                organizationSlug: slug,
                onboardingExpectedVersion: String(onboarding.version + 99),
              }),
            ),
        });
        expect(result.message).toMatch(/elsewhere|Reload/i);
      });

      it("accepts current version, advances step once, no progress audit", async () => {
        const { organizationId, slug, onboarding } =
          await seedCatalogueStepContext("act-catstep-ok");
        const before = await captureSnapshot(prisma, organizationId);

        const result = await markCatalogueStepAction(
          initialActionState,
          buildMarkCatalogueStepFormData({
            organizationSlug: slug,
            onboardingExpectedVersion: String(onboarding.version),
          }),
        );

        expect(result.status).toBe("success");
        const after = await captureSnapshot(prisma, organizationId);
        expect(after.onboarding!.currentStep).toBe("EMPLOYEE_DEFAULTS");
        expect(after.onboarding!.version).toBe(before.onboarding!.version + 1);
        expect(
          (after.onboarding!.completedSteps as string[]).includes("CATALOGUE"),
        ).toBe(true);
        expect(after.services).toEqual(before.services);
        expect(after.products).toEqual(before.products);
        expect(countAudit(after, "ONBOARDING_STARTED")).toBe(
          countAudit(before, "ONBOARDING_STARTED"),
        );
        expect(
          after.audits.filter((e) => e.action.startsWith("ONBOARDING_")).length,
        ).toBe(
          before.audits.filter((e) => e.action.startsWith("ONBOARDING_"))
            .length,
        );
      });

      it("resubmitting stale version after success is rejected", async () => {
        const { organizationId, slug, onboarding } =
          await seedCatalogueStepContext("act-catstep-resubmit");
        const first = await markCatalogueStepAction(
          initialActionState,
          buildMarkCatalogueStepFormData({
            organizationSlug: slug,
            onboardingExpectedVersion: String(onboarding.version),
          }),
        );
        expect(first.status).toBe("success");
        const afterFirst = await captureSnapshot(prisma, organizationId);

        const second = await markCatalogueStepAction(
          initialActionState,
          buildMarkCatalogueStepFormData({
            organizationSlug: slug,
            onboardingExpectedVersion: String(onboarding.version),
          }),
        );

        expect(second.status).toBe("error");
        expect(second.message).toMatch(/elsewhere|Reload/i);
        const afterSecond = await captureSnapshot(prisma, organizationId);
        expect(afterSecond.onboarding!.version).toBe(
          afterFirst.onboarding!.version,
        );
      });
    });

    describe("authorization", () => {
      it("unauthenticated throws NEXT_REDIRECT with zero writes", async () => {
        const { organizationId, slug, onboarding } =
          await seedCatalogueStepContext("act-catstep-unauth");
        setUnauthenticated(`/app/orgs/${slug}/onboarding`);
        const before = await captureSnapshot(prisma, organizationId);

        await expect(
          markCatalogueStepAction(
            initialActionState,
            buildMarkCatalogueStepFormData({
              organizationSlug: slug,
              onboardingExpectedVersion: String(onboarding.version),
            }),
          ),
        ).rejects.toThrow(/NEXT_REDIRECT/);

        expectZeroWrites(before, await captureSnapshot(prisma, organizationId));
      });

      it("inactive membership, MEMBER, and cross-tenant slug leave zero writes", async () => {
        const orgA = await seedCatalogueStepContext("act-catstep-auth-a");
        const orgB = await seedCatalogueStepContext("act-catstep-auth-b");
        const inactive = await addInactiveMember(
          prisma,
          orgA.organizationId,
          "act-catstep-inactive",
        );
        const member = await addMember(
          prisma,
          orgA.organizationId,
          "act-catstep-member",
          "MEMBER",
        );

        for (const [actor, message] of [
          [inactive, "You do not have access to this organization."],
          [member, "You do not have permission to perform this action."],
        ] as const) {
          setActor(actor);
          const before = await captureSnapshot(prisma, orgA.organizationId);
          const result = await markCatalogueStepAction(
            initialActionState,
            buildMarkCatalogueStepFormData({
              organizationSlug: orgA.slug,
              onboardingExpectedVersion: String(orgA.onboarding.version),
            }),
          );
          expect(result.status).toBe("error");
          expect(result.message).toBe(message);
          expectZeroWrites(
            before,
            await captureSnapshot(prisma, orgA.organizationId),
          );
        }

        setActor(orgA.owner);
        const beforeA = await captureSnapshot(prisma, orgA.organizationId);
        const beforeB = await captureSnapshot(prisma, orgB.organizationId);
        const cross = await markCatalogueStepAction(
          initialActionState,
          buildMarkCatalogueStepFormData({
            organizationSlug: orgB.slug,
            onboardingExpectedVersion: String(orgB.onboarding.version),
          }),
        );
        expect(cross.status).toBe("error");
        expect(cross.message).toBe(
          "You do not have access to this organization.",
        );
        expectZeroWrites(
          beforeA,
          await captureSnapshot(prisma, orgA.organizationId),
        );
        expectZeroWrites(
          beforeB,
          await captureSnapshot(prisma, orgB.organizationId),
        );
      });
    });

    it("pre-start request does not initialize onboarding or business defaults", async () => {
      const { owner, organizationId, slug } = await createOrgWithOwner(
        prisma,
        "act-catstep-prestart",
        "Pre Start Catalogue",
      );
      setActor(owner);
      await assertPreStartRecordsAbsent(prisma, organizationId);
      const before = await captureSnapshot(prisma, organizationId);

      const result = await markCatalogueStepAction(
        initialActionState,
        buildMarkCatalogueStepFormData({
          organizationSlug: slug,
          onboardingExpectedVersion: "0",
        }),
      );

      expect(result.status).toBe("error");
      expect(result.message).toBe("Organization not found.");
      expectZeroWrites(before, await captureSnapshot(prisma, organizationId));
      await assertPreStartRecordsAbsent(prisma, organizationId);
    });

    it("after completion returns already_completed without version change", async () => {
      const { owner, organizationId, slug } = await createOrgWithOwner(
        prisma,
        "act-catstep-complete",
        "Completed Catalogue",
      );
      await startOnboarding(owner, organizationId);
      setActor(owner);
      await seedReadinessFixtures({
        owner,
        organizationId,
        slug,
        businessType: "SERVICES",
        withActiveService: true,
      });
      const completed = await completeOrganizationOnboarding({
        actor: owner,
        organizationId,
      });
      expect(completed.ok).toBe(true);
      const onboardingBefore =
        await prisma.organizationOnboarding.findUniqueOrThrow({
          where: { organizationId },
        });
      const before = await captureSnapshot(prisma, organizationId);

      const result = await markCatalogueStepAction(
        initialActionState,
        buildMarkCatalogueStepFormData({
          organizationSlug: slug,
          onboardingExpectedVersion: String(onboardingBefore.version),
        }),
      );

      expect(result.status).toBe("error");
      expect(result.message).toBe(
        "Onboarding is complete. Reopen it before changing progress.",
      );
      const after = await captureSnapshot(prisma, organizationId);
      expect(after.onboarding!.status).toBe("COMPLETED");
      expect(after.onboarding!.version).toBe(onboardingBefore.version);
      expectZeroWrites(before, after);
    });

    describe("readiness after successful mark (step not readiness-gated)", () => {
      it.each([
        ["SERVICES with active service", "SERVICES", true, false, true],
        ["PRODUCTS with active product", "PRODUCTS", false, true, true],
        ["BOTH with service and product", "BOTH", true, true, true],
        ["BOTH missing product", "BOTH", true, false, false],
        ["PRODUCTS with inactive product only", "PRODUCTS", false, true, false],
      ] as const)(
        "%s → ready=%s",
        async (
          _label,
          businessType,
          withActiveService,
          withActiveProduct,
          expectedReady,
        ) => {
          const { owner, organizationId, slug } = await createOrgWithOwner(
            prisma,
            `act-catstep-ready-${businessType}`,
            "Readiness Org",
          );
          await startOnboarding(owner, organizationId);
          setActor(owner);
          await seedReadinessFixtures({
            owner,
            organizationId,
            slug,
            businessType,
            withActiveService,
            withActiveProduct,
            inactiveProduct: _label.includes("inactive"),
          });
          const onboarding =
            await prisma.organizationOnboarding.findUniqueOrThrow({
              where: { organizationId },
            });

          const result = await markCatalogueStepAction(
            initialActionState,
            buildMarkCatalogueStepFormData({
              organizationSlug: slug,
              onboardingExpectedVersion: String(onboarding.version),
            }),
          );
          expect(result.status).toBe("success");

          const readiness = await computeConfigurationReadiness(
            prisma,
            organizationId,
          );
          expect(readiness.ready).toBe(expectedReady);
          const row = await prisma.organizationOnboarding.findUniqueOrThrow({
            where: { organizationId },
          });
          expect(row.currentStep).toBe("EMPLOYEE_DEFAULTS");
        },
      );
    });

    /**
     * Stress-only: uncontrolled Promise.all does not prove lock ordering.
     * See deterministic runMarkCatalogueStepAction race below for gated evidence.
     */
    it("stress: concurrent markCatalogueStepAction with same version yields one success", async () => {
      const { organizationId, slug, onboarding } =
        await seedCatalogueStepContext("act-catstep-pall");

      const [aResult, bResult] = await Promise.all([
        markCatalogueStepAction(
          initialActionState,
          buildMarkCatalogueStepFormData({
            organizationSlug: slug,
            onboardingExpectedVersion: String(onboarding.version),
          }),
        ),
        markCatalogueStepAction(
          initialActionState,
          buildMarkCatalogueStepFormData({
            organizationSlug: slug,
            onboardingExpectedVersion: String(onboarding.version),
          }),
        ),
      ]);

      const outcomes = [aResult, bResult];
      expect(outcomes.filter((r) => r.status === "success")).toHaveLength(1);
      expect(
        outcomes.filter(
          (r) =>
            r.status === "error" && /elsewhere|Reload/i.test(r.message ?? ""),
        ),
      ).toHaveLength(1);

      const after = await prisma.organizationOnboarding.findUniqueOrThrow({
        where: { organizationId },
      });
      expect(after.version).toBe(onboarding.version + 1);
      expect(after.currentStep).toBe("EMPLOYEE_DEFAULTS");
    });

    it("deterministic markCatalogueStepAction same-version race: one success, one conflict", async () => {
      const { owner, organizationId, slug, onboarding } =
        await seedCatalogueStepContext("act-catstep-det");
      const admin = await addMember(
        prisma,
        organizationId,
        "act-catstep-det-admin",
        "ADMIN",
      );

      const before = await captureBusinessDbSnapshot(prisma, organizationId);
      const auditsBefore = before.audits.length;

      const aHeld = createGate();
      const bStarted = createGate();
      const bGotLock = createGate();

      setActor(owner);
      const aPromise = runMarkCatalogueStepAction(
        initialActionState,
        buildMarkCatalogueStepFormData({
          organizationSlug: slug,
          onboardingExpectedVersion: String(onboarding.version),
        }),
        {
          advanceHooks: {
            testAfterMembershipLock: async () => {
              aHeld.markReached();
              await aHeld.waitForRelease();
            },
          },
        },
      );
      await aHeld.waitUntilReached();

      setActor(admin);
      const bPromise = runMarkCatalogueStepAction(
        initialActionState,
        buildMarkCatalogueStepFormData({
          organizationSlug: slug,
          onboardingExpectedVersion: String(onboarding.version),
        }),
        {
          advanceHooks: {
            testBeforeReadinessLock: async () => {
              bStarted.markReached();
            },
            testAfterReadinessLock: async () => {
              bGotLock.markReached();
            },
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

      expect(aResult.status).toBe("success");
      expect(aResult.message).toBe("Catalogue step saved.");
      expect(bResult.status).toBe("error");
      expect(bResult.message).toMatch(/elsewhere|Reload/i);

      const after = await captureBusinessDbSnapshot(prisma, organizationId);
      expect(after.onboarding?.version).toBe(onboarding.version + 1);
      expect(after.onboarding?.currentStep).toBe("EMPLOYEE_DEFAULTS");
      const steps = after.onboarding?.completedSteps as string[];
      expect(steps.filter((s) => s === "CATALOGUE")).toHaveLength(1);
      expect(after.onboarding?.status).toBe("IN_PROGRESS");
      expect(after.onboarding?.completedAt).toBe(
        before.onboarding?.completedAt,
      );
      expect(after.onboarding?.reopenedAt).toBe(before.onboarding?.reopenedAt);
      expect(after.onboarding?.completedByUserId).toBe(
        before.onboarding?.completedByUserId,
      );
      expect(after.onboarding?.reopenedByUserId).toBe(
        before.onboarding?.reopenedByUserId,
      );

      const freshReadiness = await computeConfigurationReadiness(
        prisma,
        organizationId,
      );
      expect(after.onboarding?.isConfigurationReady).toBe(freshReadiness.ready);

      expect(after.services).toEqual(before.services);
      expect(after.products).toEqual(before.products);
      expect(after.profile).toEqual(before.profile);
      expect(after.primaryLocation).toEqual(before.primaryLocation);
      expect(after.hours).toEqual(before.hours);
      expect(after.settings).toEqual(before.settings);
      // Advancement intentionally creates no progress audit event.
      expect(after.audits).toHaveLength(auditsBefore);

      setActor(owner);
      const third = await runMarkCatalogueStepAction(
        initialActionState,
        buildMarkCatalogueStepFormData({
          organizationSlug: slug,
          onboardingExpectedVersion: String(onboarding.version),
        }),
      );
      expect(third.status).toBe("error");
      expect(third.message).toMatch(/elsewhere|Reload/i);
      const afterThird = await captureBusinessDbSnapshot(
        prisma,
        organizationId,
      );
      expect(normalizeBusinessSnapshot(afterThird)).toEqual(
        normalizeBusinessSnapshot(after),
      );
    });

    /**
     * Service-level evidence (advanceOnboardingStep), not the direct action boundary.
     * Retained for lock-order coverage of the orchestration service.
     */
    it("deterministic advanceOnboardingStep CATALOGUE race serializes version (service-level)", async () => {
      const { owner, organizationId, onboarding } =
        await seedCatalogueStepContext("act-catstep-gate");
      const admin = await addMember(
        prisma,
        organizationId,
        "act-catstep-gate-admin",
        "ADMIN",
      );

      const aHeld = createGate();
      const bStarted = createGate();
      const bGotLock = createGate();

      const aPromise = advanceOnboardingStep(
        {
          actor: owner,
          organizationId,
          step: "CATALOGUE",
          nextStep: "EMPLOYEE_DEFAULTS",
          expectedVersion: onboarding.version,
        },
        {
          testAfterMembershipLock: async () => {
            aHeld.markReached();
            await aHeld.waitForRelease();
          },
        },
      );
      await aHeld.waitUntilReached();

      const bPromise = advanceOnboardingStep(
        {
          actor: admin,
          organizationId,
          step: "CATALOGUE",
          nextStep: "EMPLOYEE_DEFAULTS",
          expectedVersion: onboarding.version,
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

      const after = await prisma.organizationOnboarding.findUniqueOrThrow({
        where: { organizationId },
      });
      expect(after.version).toBe(onboarding.version + 1);
      expect(after.currentStep).toBe("EMPLOYEE_DEFAULTS");
    });

    /**
     * Service-level demotion-first race (advanceOnboardingStep).
     * Direct action-boundary coverage is in the markCatalogueStepAction tests below.
     */
    it("demotion-first prevents CATALOGUE advance with zero writes (service-level)", async () => {
      const { owner, organizationId, onboarding } =
        await seedCatalogueStepContext("act-catstep-demote-1st");
      const admin = await addMember(
        prisma,
        organizationId,
        "act-catstep-demote-1st-admin",
        "ADMIN",
      );
      const membership = await prisma.membership.findFirstOrThrow({
        where: { organizationId, userId: admin.id },
      });

      const demotionHeld = createGate();
      const advanceStarted = createGate();

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

      const advancePromise = advanceOnboardingStep(
        {
          actor: admin,
          organizationId,
          step: "CATALOGUE",
          nextStep: "EMPLOYEE_DEFAULTS",
          expectedVersion: onboarding.version,
        },
        {
          testBeforeMembershipLock: async () => {
            advanceStarted.markReached();
          },
        },
      );
      await advanceStarted.waitUntilReached();
      demotionHeld.release();

      const demote = await demotePromise;
      const advanced = await advancePromise;
      expect(demote.ok).toBe(true);
      expect(advanced.ok).toBe(false);
      if (!advanced.ok) {
        expect(["forbidden", "inactive_membership", "not_a_member"]).toContain(
          advanced.reason,
        );
      }

      const after = await prisma.organizationOnboarding.findUniqueOrThrow({
        where: { organizationId },
      });
      expect(after.version).toBe(onboarding.version);
      expect(after.currentStep).toBe(onboarding.currentStep);
    });

    /**
     * Service-level advance-first then demotion.
     * Direct action-boundary coverage is in the markCatalogueStepAction tests below.
     */
    it("CATALOGUE advance-first then demotion commits; later privileged ops fail (service-level)", async () => {
      const { owner, organizationId, onboarding } =
        await seedCatalogueStepContext("act-catstep-adv-1st");
      const admin = await addMember(
        prisma,
        organizationId,
        "act-catstep-adv-1st-admin",
        "ADMIN",
      );
      const membership = await prisma.membership.findFirstOrThrow({
        where: { organizationId, userId: admin.id },
      });

      const advanceHeld = createGate();
      const demotionStarted = createGate();

      const advancePromise = advanceOnboardingStep(
        {
          actor: admin,
          organizationId,
          step: "CATALOGUE",
          nextStep: "EMPLOYEE_DEFAULTS",
          expectedVersion: onboarding.version,
        },
        {
          testAfterMembershipLock: async () => {
            advanceHeld.markReached();
            await advanceHeld.waitForRelease();
          },
        },
      );
      await advanceHeld.waitUntilReached();

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
      advanceHeld.release();

      const advanced = await advancePromise;
      const demote = await demotePromise;
      expect(advanced.ok).toBe(true);
      expect(demote.ok).toBe(true);

      const after = await prisma.organizationOnboarding.findUniqueOrThrow({
        where: { organizationId },
      });
      expect(after.version).toBe(onboarding.version + 1);
      expect(after.currentStep).toBe("EMPLOYEE_DEFAULTS");

      const later = await advanceOnboardingStep({
        actor: admin,
        organizationId,
        step: "EMPLOYEE_DEFAULTS",
        nextStep: "REVIEW",
        expectedVersion: after.version,
      });
      expect(later.ok).toBe(false);
    });

    /**
     * Service-level deactivation-first race (advanceOnboardingStep).
     */
    it("deactivation-first prevents CATALOGUE advance with zero writes (service-level)", async () => {
      const { owner, organizationId, onboarding } =
        await seedCatalogueStepContext("act-catstep-deact-1st");
      const admin = await addMember(
        prisma,
        organizationId,
        "act-catstep-deact-1st-admin",
        "ADMIN",
      );
      const membership = await prisma.membership.findFirstOrThrow({
        where: { organizationId, userId: admin.id },
      });

      const deactivationHeld = createGate();
      const advanceStarted = createGate();

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

      const advancePromise = advanceOnboardingStep(
        {
          actor: admin,
          organizationId,
          step: "CATALOGUE",
          nextStep: "EMPLOYEE_DEFAULTS",
          expectedVersion: onboarding.version,
        },
        {
          testBeforeMembershipLock: async () => {
            advanceStarted.markReached();
          },
        },
      );
      await advanceStarted.waitUntilReached();
      deactivationHeld.release();

      const deactivated = await deactivatePromise;
      const advanced = await advancePromise;
      expect(deactivated.ok).toBe(true);
      expect(advanced.ok).toBe(false);
      if (!advanced.ok) {
        expect(["forbidden", "inactive_membership", "not_a_member"]).toContain(
          advanced.reason,
        );
      }

      const after = await prisma.organizationOnboarding.findUniqueOrThrow({
        where: { organizationId },
      });
      expect(after.version).toBe(onboarding.version);
    });

    /**
     * Service-level advance-first then deactivation; later uses action boundary for the
     * post-deactivation privileged attempt only.
     */
    it("CATALOGUE advance-first then deactivation commits; later privileged ops fail (service-level)", async () => {
      const { owner, organizationId, slug, onboarding } =
        await seedCatalogueStepContext("act-catstep-adv-deact");
      const admin = await addMember(
        prisma,
        organizationId,
        "act-catstep-adv-deact-admin",
        "ADMIN",
      );
      const membership = await prisma.membership.findFirstOrThrow({
        where: { organizationId, userId: admin.id },
      });

      const advanceHeld = createGate();
      const deactivationStarted = createGate();

      const advancePromise = advanceOnboardingStep(
        {
          actor: admin,
          organizationId,
          step: "CATALOGUE",
          nextStep: "EMPLOYEE_DEFAULTS",
          expectedVersion: onboarding.version,
        },
        {
          testAfterMembershipLock: async () => {
            advanceHeld.markReached();
            await advanceHeld.waitForRelease();
          },
        },
      );
      await advanceHeld.waitUntilReached();

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
      advanceHeld.release();

      const advanced = await advancePromise;
      const deactivated = await deactivatePromise;
      expect(advanced.ok).toBe(true);
      expect(deactivated.ok).toBe(true);

      const after = await prisma.organizationOnboarding.findUniqueOrThrow({
        where: { organizationId },
      });
      expect(after.version).toBe(onboarding.version + 1);

      setActor(admin);
      const laterAsAdmin = await markCatalogueStepAction(
        initialActionState,
        buildMarkCatalogueStepFormData({
          organizationSlug: slug,
          onboardingExpectedVersion: String(after.version),
        }),
      );
      expect(laterAsAdmin.status).toBe("error");
      expect(laterAsAdmin.message).toMatch(/no longer active|access/i);
    });

    it("action-boundary demotion-first: markCatalogueStepAction fails with zero writes", async () => {
      const { owner, organizationId, slug, onboarding } =
        await seedCatalogueStepContext("act-catstep-act-demote-1st");
      const admin = await addMember(
        prisma,
        organizationId,
        "act-catstep-act-demote-1st-admin",
        "ADMIN",
      );
      const membership = await prisma.membership.findFirstOrThrow({
        where: { organizationId, userId: admin.id },
      });
      const before = await captureBusinessDbSnapshot(prisma, organizationId);

      const demotionHeld = createGate();
      const actionStarted = createGate();

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

      setActor(admin);
      const actionPromise = runMarkCatalogueStepAction(
        initialActionState,
        buildMarkCatalogueStepFormData({
          organizationSlug: slug,
          onboardingExpectedVersion: String(onboarding.version),
        }),
        {
          advanceHooks: {
            testBeforeMembershipLock: async () => {
              actionStarted.markReached();
            },
          },
        },
      );
      await actionStarted.waitUntilReached();
      demotionHeld.release();

      const demote = await demotePromise;
      const actionResult = await actionPromise;
      expect(demote.ok).toBe(true);
      expect(actionResult.status).toBe("error");
      expect(actionResult.message).toMatch(/access|permission|member|active/i);

      const after = await captureBusinessDbSnapshot(prisma, organizationId);
      expect(after.onboarding).toEqual(before.onboarding);
      expect(after.audits).toEqual(expect.arrayContaining(before.audits));
      // Only demotion-related audits may be added; onboarding must be unchanged.
      expect(after.onboarding?.version).toBe(onboarding.version);
      expect(after.onboarding?.currentStep).toBe(onboarding.currentStep);
      expect(after.products).toEqual(before.products);
      expect(after.services).toEqual(before.services);
    });

    it("action-boundary catalogue-first then demotion: action succeeds", async () => {
      const { owner, organizationId, slug, onboarding } =
        await seedCatalogueStepContext("act-catstep-act-adv-1st");
      const admin = await addMember(
        prisma,
        organizationId,
        "act-catstep-act-adv-1st-admin",
        "ADMIN",
      );
      const membership = await prisma.membership.findFirstOrThrow({
        where: { organizationId, userId: admin.id },
      });

      const actionHeld = createGate();
      const demotionStarted = createGate();

      setActor(admin);
      const actionPromise = runMarkCatalogueStepAction(
        initialActionState,
        buildMarkCatalogueStepFormData({
          organizationSlug: slug,
          onboardingExpectedVersion: String(onboarding.version),
        }),
        {
          advanceHooks: {
            testAfterMembershipLock: async () => {
              actionHeld.markReached();
              await actionHeld.waitForRelease();
            },
          },
        },
      );
      await actionHeld.waitUntilReached();

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
      actionHeld.release();

      const actionResult = await actionPromise;
      const demote = await demotePromise;
      expect(actionResult.status).toBe("success");
      expect(demote.ok).toBe(true);

      const after = await prisma.organizationOnboarding.findUniqueOrThrow({
        where: { organizationId },
      });
      expect(after.version).toBe(onboarding.version + 1);
      expect(after.currentStep).toBe("EMPLOYEE_DEFAULTS");

      setActor(admin);
      const later = await runMarkCatalogueStepAction(
        initialActionState,
        buildMarkCatalogueStepFormData({
          organizationSlug: slug,
          onboardingExpectedVersion: String(after.version),
        }),
      );
      expect(later.status).toBe("error");
    });

    it("action-boundary deactivation-first: markCatalogueStepAction fails with zero writes", async () => {
      const { owner, organizationId, slug, onboarding } =
        await seedCatalogueStepContext("act-catstep-act-deact-1st");
      const admin = await addMember(
        prisma,
        organizationId,
        "act-catstep-act-deact-1st-admin",
        "ADMIN",
      );
      const membership = await prisma.membership.findFirstOrThrow({
        where: { organizationId, userId: admin.id },
      });
      const before = await captureBusinessDbSnapshot(prisma, organizationId);

      const deactivationHeld = createGate();
      const actionStarted = createGate();

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

      setActor(admin);
      const actionPromise = runMarkCatalogueStepAction(
        initialActionState,
        buildMarkCatalogueStepFormData({
          organizationSlug: slug,
          onboardingExpectedVersion: String(onboarding.version),
        }),
        {
          advanceHooks: {
            testBeforeMembershipLock: async () => {
              actionStarted.markReached();
            },
          },
        },
      );
      await actionStarted.waitUntilReached();
      deactivationHeld.release();

      const deactivated = await deactivatePromise;
      const actionResult = await actionPromise;
      expect(deactivated.ok).toBe(true);
      expect(actionResult.status).toBe("error");

      const after = await captureBusinessDbSnapshot(prisma, organizationId);
      expect(after.onboarding?.version).toBe(onboarding.version);
      expect(after.onboarding?.currentStep).toBe(
        before.onboarding?.currentStep,
      );
      expect(after.products).toEqual(before.products);
      expect(after.services).toEqual(before.services);
    });

    it("action-boundary catalogue-first then deactivation: action succeeds", async () => {
      const { owner, organizationId, slug, onboarding } =
        await seedCatalogueStepContext("act-catstep-act-adv-deact");
      const admin = await addMember(
        prisma,
        organizationId,
        "act-catstep-act-adv-deact-admin",
        "ADMIN",
      );
      const membership = await prisma.membership.findFirstOrThrow({
        where: { organizationId, userId: admin.id },
      });

      const actionHeld = createGate();
      const deactivationStarted = createGate();

      setActor(admin);
      const actionPromise = runMarkCatalogueStepAction(
        initialActionState,
        buildMarkCatalogueStepFormData({
          organizationSlug: slug,
          onboardingExpectedVersion: String(onboarding.version),
        }),
        {
          advanceHooks: {
            testAfterMembershipLock: async () => {
              actionHeld.markReached();
              await actionHeld.waitForRelease();
            },
          },
        },
      );
      await actionHeld.waitUntilReached();

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
      actionHeld.release();

      const actionResult = await actionPromise;
      const deactivated = await deactivatePromise;
      expect(actionResult.status).toBe("success");
      expect(deactivated.ok).toBe(true);

      const after = await prisma.organizationOnboarding.findUniqueOrThrow({
        where: { organizationId },
      });
      expect(after.version).toBe(onboarding.version + 1);

      setActor(admin);
      const later = await markCatalogueStepAction(
        initialActionState,
        buildMarkCatalogueStepFormData({
          organizationSlug: slug,
          onboardingExpectedVersion: String(after.version),
        }),
      );
      expect(later.status).toBe("error");
      expect(later.message).toMatch(/no longer active|access/i);
    });
  });
});
