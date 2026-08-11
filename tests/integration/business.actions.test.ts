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
  replaceOperatingHoursAction,
  updateBusinessBasicsAction,
  updateContactLocationAction,
  updateEmployeeDefaultsAction,
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
 *
 * Service/product catalogue actions omit expectedVersion parsing — not covered here.
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

type AuditCounts = {
  BUSINESS_PROFILE_UPDATED: number;
  OPERATING_HOURS_UPDATED: number;
  ORGANIZATION_SETTINGS_UPDATED: number;
  ONBOARDING_STARTED: number;
  total: number;
};

type DbSnapshot = {
  profile: {
    version: number;
    displayName: string | null;
    industry: string | null;
    primaryEmail: string | null;
  } | null;
  settings: {
    version: number;
    membersCanViewServices: boolean;
    membersCanViewProducts: boolean;
    membersCanViewBusinessInfo: boolean;
    futureCallingAccessDefault: string;
  } | null;
  onboarding: {
    version: number;
    currentStep: string;
    status: string;
    completedSteps: unknown;
  } | null;
  hoursCount: number;
  audits: AuditCounts;
};

async function captureSnapshot(
  prisma: PrismaClient,
  organizationId: string,
): Promise<DbSnapshot> {
  const [
    profile,
    settings,
    onboarding,
    hoursCount,
    profileAudits,
    hoursAudits,
    settingsAudits,
    startedAudits,
    totalAudits,
  ] = await Promise.all([
    prisma.businessProfile.findUnique({
      where: { organizationId },
      select: {
        version: true,
        displayName: true,
        industry: true,
        primaryEmail: true,
      },
    }),
    prisma.organizationSettings.findUnique({
      where: { organizationId },
      select: {
        version: true,
        membersCanViewServices: true,
        membersCanViewProducts: true,
        membersCanViewBusinessInfo: true,
        futureCallingAccessDefault: true,
      },
    }),
    prisma.organizationOnboarding.findUnique({
      where: { organizationId },
      select: {
        version: true,
        currentStep: true,
        status: true,
        completedSteps: true,
      },
    }),
    prisma.operatingHourInterval.count({ where: { organizationId } }),
    prisma.organizationAuditEvent.count({
      where: { organizationId, action: "BUSINESS_PROFILE_UPDATED" },
    }),
    prisma.organizationAuditEvent.count({
      where: { organizationId, action: "OPERATING_HOURS_UPDATED" },
    }),
    prisma.organizationAuditEvent.count({
      where: { organizationId, action: "ORGANIZATION_SETTINGS_UPDATED" },
    }),
    prisma.organizationAuditEvent.count({
      where: { organizationId, action: "ONBOARDING_STARTED" },
    }),
    prisma.organizationAuditEvent.count({ where: { organizationId } }),
  ]);

  return {
    profile,
    settings,
    onboarding,
    hoursCount,
    audits: {
      BUSINESS_PROFILE_UPDATED: profileAudits,
      OPERATING_HOURS_UPDATED: hoursAudits,
      ORGANIZATION_SETTINGS_UPDATED: settingsAudits,
      ONBOARDING_STARTED: startedAudits,
      total: totalAudits,
    },
  };
}

function expectZeroWrites(before: DbSnapshot, after: DbSnapshot) {
  expect(after).toEqual(before);
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
        expect(after.audits.BUSINESS_PROFILE_UPDATED).toBe(
          before.audits.BUSINESS_PROFILE_UPDATED + 1,
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
        expect(after.hoursCount).toBe(7);
        expect(after.onboarding!.version).toBe(before.onboarding!.version + 1);
        expect(after.onboarding!.currentStep).toBe("CATALOGUE");
        expect(after.audits.OPERATING_HOURS_UPDATED).toBe(
          before.audits.OPERATING_HOURS_UPDATED + 1,
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

      it("rejects stale expectedVersion with zero writes", async () => {
        const { organizationId, slug, onboarding, settings } =
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
        expect(after.audits.ORGANIZATION_SETTINGS_UPDATED).toBe(
          before.audits.ORGANIZATION_SETTINGS_UPDATED + 1,
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

  describe("pre-start organization (updateBusinessBasicsAction)", () => {
    it("does not initialize onboarding or business config with forged versions", async () => {
      const { owner, organizationId, slug } = await createOrgWithOwner(
        prisma,
        "act-prestart",
        "Pre Start Org",
      );
      setActor(owner);
      const before = await captureSnapshot(prisma, organizationId);
      expect(before.profile).toBeNull();
      expect(before.onboarding).toBeNull();
      expect(before.settings).toBeNull();

      const result = await updateBusinessBasicsAction(
        initialActionState,
        buildBasicsFormData({
          organizationSlug: slug,
          expectedVersion: "0",
          onboardingExpectedVersion: "0",
        }),
      );

      expect(result.status).toBe("error");
      const after = await captureSnapshot(prisma, organizationId);
      expect(after.profile).toBeNull();
      expect(after.onboarding).toBeNull();
      expect(after.settings).toBeNull();
      expectZeroWrites(before, after);
    });
  });
});
