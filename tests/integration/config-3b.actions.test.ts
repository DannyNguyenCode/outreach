import { PrismaClient } from "@prisma/client";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const requireVerifiedUserMock = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  requireVerifiedUser: (...args: unknown[]) => requireVerifiedUserMock(...args),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "x-forwarded-for": "127.0.0.1" })),
}));

import {
  advanceConfigSectionAction,
  deactivateCustomFieldAction,
  deactivateHolidayClosureAction,
  deactivateServiceAreaAction,
} from "@/app/actions/config-3b";
import type { ActionState } from "@/app/actions/auth-state";
import { setMailerForTests, type EmailSender } from "@/lib/email/mailer";
import { resetServerEnvCache } from "@/lib/env/server";
import { startConfigProgress } from "@/lib/orgs/config-progress";
import { createCustomField } from "@/lib/orgs/custom-fields";
import { createHolidayClosure } from "@/lib/orgs/holiday-closures";
import { createServiceArea } from "@/lib/orgs/service-areas";
import {
  countConfig3bAudits,
  createOrgWithOwner,
} from "@/tests/integration/helpers/config-3b";
import { resetApplicationData } from "@/tests/integration/reset";

const initialState: ActionState = { status: "idle" };
const mockMailer: EmailSender = { async send() {} };

describe("Phase 3B progress action boundary", () => {
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

  async function setup(prefix: string, withTemplate = true) {
    const ctx = await createOrgWithOwner(prisma, prefix);
    requireVerifiedUserMock.mockResolvedValue(ctx.owner);
    const started = await startConfigProgress({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
    });
    if (!started.ok) throw new Error(started.message);
    if (withTemplate) {
      await prisma.organizationTemplateAssignment.create({
        data: {
          organizationId: ctx.organizationId,
          templateKey: "CUSTOM_MIXED",
          templateDefinitionVersion: 1,
          selectedByUserId: ctx.owner.id,
        },
      });
    }
    return { ...ctx, progress: started.progress };
  }

  function form(slug: string, section: string, version?: string): FormData {
    const data = new FormData();
    data.set("organizationSlug", slug);
    data.set("section", section);
    if (version !== undefined) data.set("expectedVersion", version);
    return data;
  }

  it("returns controlled errors for forged REVIEW and malformed versions", async () => {
    const ctx = await setup("action-controlled");
    const review = await advanceConfigSectionAction(
      initialState,
      form(ctx.slug, "REVIEW", String(ctx.progress.version)),
    );
    expect(review.status).toBe("error");
    expect(review.message).toMatch(/current configuration section/i);

    for (const malformed of [undefined, "", "abc", "-1", "1.5"]) {
      const result = await advanceConfigSectionAction(
        initialState,
        form(ctx.slug, "BUSINESS_TEMPLATE", malformed),
      );
      expect(result.status).toBe("error");
      expect(result.message).toBeTruthy();
    }
  });

  it("ignores forged nextSection and advances only to the server next section", async () => {
    const ctx = await setup("action-forged-next");
    const data = form(
      ctx.slug,
      "BUSINESS_TEMPLATE",
      String(ctx.progress.version),
    );
    data.set("nextSection", "REVIEW");
    data.set("markCompleted", "false");
    const result = await advanceConfigSectionAction(initialState, data);
    expect(result.status).toBe("success");
    expect(
      await prisma.organizationConfigProgress.findUniqueOrThrow({
        where: { organizationId: ctx.organizationId },
      }),
    ).toMatchObject({ currentSection: "LOCALE" });
  });

  it("maps stale versions and cross-tenant slugs to controlled errors", async () => {
    const ctx = await setup("action-stale");
    const stale = await advanceConfigSectionAction(
      initialState,
      form(ctx.slug, "BUSINESS_TEMPLATE", String(ctx.progress.version + 1)),
    );
    expect(stale.status).toBe("error");
    expect(stale.message).toMatch(/reload/i);

    const foreign = await createOrgWithOwner(prisma, "action-foreign");
    requireVerifiedUserMock.mockResolvedValue(ctx.owner);
    const crossTenant = await advanceConfigSectionAction(
      initialState,
      form(foreign.slug, "BUSINESS_TEMPLATE", String(ctx.progress.version)),
    );
    expect(crossTenant).toMatchObject({
      status: "error",
      message: "You do not have access to this organization.",
    });
  });
});

describe("Phase 3B deactivation action boundary", () => {
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

  const malformedVersions = ["", "abc", "-1", "1.5"];

  it("rejects missing, malformed, stale, and cross-tenant deactivation versions", async () => {
    const ctx = await createOrgWithOwner(prisma, "action-deact");
    requireVerifiedUserMock.mockResolvedValue(ctx.owner);

    const field = await createCustomField({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: { key: "action_field", label: "Action field", dataType: "TEXT" },
    });
    const area = await createServiceArea({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: { label: "Action area", countryCode: "CA", isRemote: false },
    });
    const closure = await createHolidayClosure({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: { localDateStart: "2026-12-25", isClosedAllDay: true },
    });
    expect(field.ok && area.ok && closure.ok).toBe(true);
    if (!field.ok || !area.ok || !closure.ok) return;

    const auditsBefore = await countConfig3bAudits(prisma, ctx.organizationId);

    const cases = [
      {
        action: deactivateCustomFieldAction,
        idName: "fieldId",
        id: field.field.id,
        version: field.field.version,
      },
      {
        action: deactivateServiceAreaAction,
        idName: "serviceAreaId",
        id: area.area.id,
        version: area.area.version,
      },
      {
        action: deactivateHolidayClosureAction,
        idName: "closureId",
        id: closure.closure.id,
        version: closure.closure.version,
      },
    ] as const;

    for (const testCase of cases) {
      const missing = new FormData();
      missing.set("organizationSlug", ctx.slug);
      missing.set(testCase.idName, testCase.id);
      const missingResult = await testCase.action(initialState, missing);
      expect(missingResult.status).toBe("error");
      expect(missingResult.message).not.toMatch(/prisma|postgres|P20/i);

      for (const malformed of malformedVersions) {
        const data = new FormData();
        data.set("organizationSlug", ctx.slug);
        data.set(testCase.idName, testCase.id);
        data.set("expectedVersion", malformed);
        const result = await testCase.action(initialState, data);
        expect(result.status).toBe("error");
        expect(result.message).not.toMatch(/prisma|postgres|P20/i);
      }

      const stale = new FormData();
      stale.set("organizationSlug", ctx.slug);
      stale.set(testCase.idName, testCase.id);
      stale.set("expectedVersion", String(testCase.version + 9));
      const staleResult = await testCase.action(initialState, stale);
      expect(staleResult.status).toBe("error");
      expect(staleResult.message).toMatch(/reload/i);
    }

    const foreign = await createOrgWithOwner(prisma, "action-deact-foreign");
    requireVerifiedUserMock.mockResolvedValue(ctx.owner);
    const crossTenantSlug = new FormData();
    crossTenantSlug.set("organizationSlug", foreign.slug);
    crossTenantSlug.set("fieldId", field.field.id);
    crossTenantSlug.set("expectedVersion", String(field.field.version));
    expect(
      await deactivateCustomFieldAction(initialState, crossTenantSlug),
    ).toMatchObject({
      status: "error",
      message: "You do not have access to this organization.",
    });

    const foreignField = await createCustomField({
      actor: foreign.owner,
      organizationId: foreign.organizationId,
      raw: { key: "foreign_field", label: "Foreign field", dataType: "TEXT" },
    });
    expect(foreignField.ok).toBe(true);
    if (!foreignField.ok) return;

    requireVerifiedUserMock.mockResolvedValue(ctx.owner);
    const crossTenantResource = new FormData();
    crossTenantResource.set("organizationSlug", ctx.slug);
    crossTenantResource.set("fieldId", foreignField.field.id);
    crossTenantResource.set(
      "expectedVersion",
      String(foreignField.field.version),
    );
    const crossResourceResult = await deactivateCustomFieldAction(
      initialState,
      crossTenantResource,
    );
    expect(crossResourceResult.status).toBe("error");
    expect(crossResourceResult.message).not.toMatch(/prisma|postgres|P20/i);

    expect(
      await prisma.customFieldDefinition.findUniqueOrThrow({
        where: { id: field.field.id },
      }),
    ).toMatchObject({ isActive: true, version: field.field.version });
    expect(
      await prisma.serviceArea.findUniqueOrThrow({
        where: { id: area.area.id },
      }),
    ).toMatchObject({ isActive: true, version: area.area.version });
    expect(
      await prisma.holidayClosure.findUniqueOrThrow({
        where: { id: closure.closure.id },
      }),
    ).toMatchObject({ isActive: true, version: closure.closure.version });
    expect(
      await prisma.customFieldDefinition.findUniqueOrThrow({
        where: { id: foreignField.field.id },
      }),
    ).toMatchObject({
      isActive: true,
      version: foreignField.field.version,
    });
    expect(await countConfig3bAudits(prisma, ctx.organizationId)).toBe(
      auditsBefore,
    );
    expect(
      await countConfig3bAudits(
        prisma,
        ctx.organizationId,
        "CUSTOM_FIELD_DEACTIVATED",
      ),
    ).toBe(0);
  });
});
