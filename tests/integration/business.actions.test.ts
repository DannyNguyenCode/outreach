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
  createServiceAction,
  deactivateServiceAction,
  replaceOperatingHoursAction,
  reorderServicesAction,
  updateBusinessBasicsAction,
  updateContactLocationAction,
  updateEmployeeDefaultsAction,
  updateServiceAction,
} from "@/app/actions/business";
import type { ActionState } from "@/app/actions/auth-state";
import { hashPassword } from "@/lib/auth/password";
import type { SafeUser } from "@/lib/auth/users";
import { setMailerForTests, type EmailSender } from "@/lib/email/mailer";
import { resetServerEnvCache } from "@/lib/env/server";
import { startOrganizationOnboarding } from "@/lib/orgs/onboarding";
import { createOrganization } from "@/lib/orgs/organizations";
import { resetApplicationData } from "@/tests/integration/reset";

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
     * Inventory disposition:
     * - createServiceAction / updateServiceAction / deactivateServiceAction / reorderServicesAction
     * - createProductAction / updateProductAction / deactivateProductAction / reorderProductsAction
     *
     * They do NOT accept expectedVersion or onboardingExpectedVersion; parsing is N/A.
     * Entity payload validation runs before mutation. Concurrency uses the shared
     * organization readiness advisory lock plus membership FOR UPDATE (and reorder
     * advisory locks). All mutations are tenant-scoped by organizationId. Catalogue
     * onboarding progress is handled separately via markCatalogueStepAction with
     * onboardingExpectedVersion — not in these catalogue CRUD actions.
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
  });
});
