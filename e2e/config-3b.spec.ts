import { createHash, randomBytes, randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";

const prisma = new PrismaClient();

const ownerEmail = "e2e-config-3b-owner@example.com";
const memberEmail = "e2e-config-3b-member@example.com";
const password = "CorrectHorseBatteryStaple";

const AREA_LABEL = "Downtown Core";
const CLOSURE_LABEL = "Christmas Day";
const CLOSURE_DATE = "2026-12-25";
const CUSTOMIZATION_NOTES = "Confirm engagement type for e2e";

async function hashPassword(value: string): Promise<string> {
  return hash(value, {
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
    outputLen: 32,
    algorithm: 2,
  });
}

async function ensureVerifiedUser(email: string, name: string): Promise<void> {
  const passwordHash = await hashPassword(password);
  await prisma.user.upsert({
    where: { email },
    create: {
      name,
      email,
      passwordHash,
      emailVerifiedAt: new Date(),
      sessionVersion: 0,
    },
    update: {
      name,
      passwordHash,
      emailVerifiedAt: new Date(),
      sessionVersion: 0,
      activeOrganizationId: null,
    },
  });
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app/);
}

async function createOrganization(
  page: Page,
  name: string,
  slug: string,
): Promise<void> {
  await page.goto("/app/organizations/new");
  await page.getByLabel("Organization name").fill(name);
  await page.getByLabel(/URL slug/).fill(slug);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/orgs/${slug}`));
}

async function markOnboardingCompleted(slug: string): Promise<void> {
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { slug },
    include: { onboarding: true },
  });
  expect(organization.onboarding).not.toBeNull();
  await prisma.organizationOnboarding.update({
    where: { organizationId: organization.id },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
      isConfigurationReady: true,
    },
  });
}

async function onboardingStatus(slug: string): Promise<string | undefined> {
  const row = await prisma.organizationOnboarding.findFirst({
    where: { organization: { slug } },
  });
  return row?.status;
}

async function markSectionComplete(
  page: Page,
  buttonName: string,
  resumeAt: string | "completed",
): Promise<void> {
  await page.getByRole("button", { name: buttonName }).click();
  if (resumeAt === "completed") {
    await expect(
      page.getByText("Extended configuration is complete."),
    ).toBeVisible();
    return;
  }
  await expect(
    page.getByText(new RegExp(`Resume at ${resumeAt}`, "i")),
  ).toBeVisible();
}

async function startConfigIfNeeded(page: Page, slug: string): Promise<void> {
  await page.goto(`/app/orgs/${slug}/settings/business-template`);
  await expect(
    page.getByRole("heading", { name: "Business template" }),
  ).toBeVisible();

  const start = page.getByRole("button", { name: "Start configuration" });
  const selectHeading = page.getByRole("heading", { name: "Select template" });
  await expect(start.or(selectHeading)).toBeVisible();

  if (await selectHeading.isVisible()) {
    return;
  }

  await start.click();
  await expect(
    page.getByText("Configuration started.").or(selectHeading),
  ).toBeVisible({ timeout: 15_000 });
  await page.goto(`/app/orgs/${slug}/settings/business-template`);
  await expect(selectHeading).toBeVisible({ timeout: 15_000 });
}

async function inviteAndAcceptMember(
  ownerPage: Page,
  memberPage: Page,
  slug: string,
): Promise<void> {
  await ownerPage.goto(`/app/orgs/${slug}/members`);
  await ownerPage.getByLabel("Invite email").fill(memberEmail);
  await ownerPage.getByLabel("Role").selectOption("MEMBER");
  await ownerPage.getByRole("button", { name: "Send invitation" }).click();
  await expect(ownerPage.getByText(/Invitation sent/i)).toBeVisible();

  const invitation = await prisma.organizationInvitation.findFirst({
    where: {
      organization: { slug },
      emailNormalized: memberEmail,
      revokedAt: null,
      acceptedAt: null,
    },
  });
  expect(invitation).not.toBeNull();

  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  await prisma.organizationInvitation.update({
    where: { id: invitation!.id },
    data: { tokenHash },
  });

  await signIn(memberPage, memberEmail);
  await memberPage.goto(`/invitations/accept?token=${rawToken}`);
  await memberPage.getByRole("button", { name: "Accept invitation" }).click();
  await expect(memberPage).toHaveURL(new RegExp(`/app/orgs/${slug}`));
}

test.beforeAll(async () => {
  await ensureVerifiedUser(ownerEmail, "E2E Config 3B Owner");
  await ensureVerifiedUser(memberEmail, "E2E Config 3B Member");
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test.describe("Phase 3B business templates and settings", () => {
  test.describe.configure({ timeout: 180_000 });

  test("owner configures 3B; member is read-only; Phase 3A stays completed", async ({
    browser,
  }) => {
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();

    const slug = `e2e-3b-${randomUUID().slice(0, 8)}`;

    await signIn(ownerPage, ownerEmail);
    await createOrganization(ownerPage, "E2E Config 3B Org", slug);

    // 11. Phase 3A onboarding still works (start + lightweight basics).
    await ownerPage.getByRole("link", { name: "Business onboarding" }).click();
    await expect(ownerPage).toHaveURL(
      new RegExp(`/app/orgs/${slug}/onboarding`),
    );
    await expect(
      ownerPage.getByRole("heading", { name: "Business onboarding" }),
    ).toBeVisible();
    await ownerPage.getByRole("button", { name: "Start onboarding" }).click();
    await expect(ownerPage).toHaveURL(
      new RegExp(`/app/orgs/${slug}/onboarding/basics`),
    );
    await ownerPage
      .getByLabel("Customer-facing display name")
      .fill("Acme Config 3B");
    await ownerPage.getByLabel("Industry / category").fill("Healthcare");
    await ownerPage.getByLabel("Business type").selectOption("BOTH");
    await ownerPage.getByRole("button", { name: "Save and continue" }).click();
    await expect(ownerPage.getByText(/Business basics saved/i)).toBeVisible();

    await markOnboardingCompleted(slug);
    expect(await onboardingStatus(slug)).toBe("COMPLETED");

    // Start Phase 3B config (required before settings pages render forms).
    await startConfigIfNeeded(ownerPage, slug);
    expect(await onboardingStatus(slug)).toBe("COMPLETED");

    // 1. Owner selects a template.
    await ownerPage
      .getByRole("radio", { name: /Professional services/ })
      .check();
    await ownerPage.getByRole("button", { name: "Select template" }).click();
    await expect(
      ownerPage.getByRole("heading", { name: "Current template" }),
    ).toBeVisible();
    await expect(
      ownerPage.getByText("Professional services").first(),
    ).toBeVisible();

    // 2. Owner customizes a template field (confirmed customization).
    await ownerPage.getByRole("checkbox", { name: /Engagement type/ }).check();
    await ownerPage.getByLabel("Notes").fill(CUSTOMIZATION_NOTES);
    await ownerPage.getByRole("button", { name: "Save customization" }).click();
    await expect(
      ownerPage.getByText("Template customization saved."),
    ).toBeVisible();

    await ownerPage.reload();
    await expect(
      ownerPage.getByRole("checkbox", { name: /Engagement type/ }),
    ).toBeChecked();
    await expect(ownerPage.getByLabel("Notes")).toHaveValue(
      CUSTOMIZATION_NOTES,
    );

    // Progress is server ordered: REVIEW is unavailable and forged destinations
    // are not represented in the UI.
    await ownerPage.goto(`/app/orgs/${slug}/settings/operational-defaults`);
    await expect(
      ownerPage.getByRole("button", { name: "Complete configuration review" }),
    ).toHaveCount(0);
    await expect(
      ownerPage.getByText(/Finish the preceding applicable sections/i),
    ).toBeVisible();
    await ownerPage.goto(`/app/orgs/${slug}/settings/business-template`);
    await markSectionComplete(
      ownerPage,
      "Mark business template complete",
      "locale",
    );
    await ownerPage.reload();
    await expect(ownerPage.getByText(/Resume at locale/i)).toBeVisible();

    // 3. Owner configures a service area.
    await ownerPage.goto(`/app/orgs/${slug}/settings/service-areas`);
    await expect(
      ownerPage.getByRole("heading", { name: "Service areas" }),
    ).toBeVisible();
    const addArea = ownerPage.locator("form").filter({
      has: ownerPage.getByRole("heading", { name: "Add service area" }),
    });
    await addArea.locator("#create-label").fill(AREA_LABEL);
    await addArea.locator("#create-country").fill("CA");
    await addArea.locator("#create-region").fill("ON");
    await addArea.locator("#create-city").fill("Toronto");
    await addArea.getByRole("button", { name: "Create service area" }).click();
    await expect(
      ownerPage
        .getByRole("status")
        .filter({ hasText: "Service area created." }),
    ).toBeVisible();

    // 4. Owner configures a holiday closure.
    await ownerPage.goto(`/app/orgs/${slug}/settings/availability`);
    await expect(
      ownerPage.getByRole("heading", { name: "Availability" }),
    ).toBeVisible();
    const addClosure = ownerPage.locator("form").filter({
      has: ownerPage.getByRole("heading", { name: "Add holiday closure" }),
    });
    await addClosure.locator("#create-start").fill(CLOSURE_DATE);
    await addClosure.locator("#create-label").fill(CLOSURE_LABEL);
    await addClosure.getByRole("button", { name: "Create closure" }).click();
    await expect(
      ownerPage
        .getByRole("status")
        .filter({ hasText: "Holiday closure created." }),
    ).toBeVisible();

    // 5. Owner configures operational defaults (locale, recording off, lead stages).
    await ownerPage.goto(`/app/orgs/${slug}/settings/operational-defaults`);
    await expect(
      ownerPage.getByRole("heading", { name: "Operational defaults" }),
    ).toBeVisible();

    await ownerPage.getByLabel("Locale (BCP 47)").fill("fr-CA");
    await ownerPage.getByLabel("Default language").fill("fr");
    await ownerPage
      .getByRole("button", { name: "Save locale settings" })
      .click();
    await expect(ownerPage.getByText("Locale settings saved.")).toBeVisible();
    await markSectionComplete(
      ownerPage,
      "Mark locale complete",
      "service areas",
    );

    await ownerPage.goto(`/app/orgs/${slug}/settings/service-areas`);
    await markSectionComplete(
      ownerPage,
      "Mark service areas complete",
      "availability",
    );
    await ownerPage.goto(`/app/orgs/${slug}/settings/availability`);
    await markSectionComplete(
      ownerPage,
      "Mark availability complete",
      "lead stages",
    );
    await ownerPage.goto(`/app/orgs/${slug}/settings/operational-defaults`);

    await ownerPage.getByRole("button", { name: "Save lead stages" }).click();
    await expect(ownerPage.getByText("Lead stages saved.")).toBeVisible();
    await markSectionComplete(
      ownerPage,
      "Mark lead stages complete",
      "call dispositions",
    );

    await ownerPage.getByRole("button", { name: "Save dispositions" }).click();
    await expect(ownerPage.getByText("Call dispositions saved.")).toBeVisible();
    await markSectionComplete(
      ownerPage,
      "Mark dispositions complete",
      "callback policy",
    );
    await markSectionComplete(
      ownerPage,
      "Mark callback policy complete",
      "recording consent",
    );

    await expect(
      ownerPage.getByLabel("Enable call recording"),
    ).not.toBeChecked();
    await ownerPage
      .getByRole("button", { name: "Save recording consent policy" })
      .click();
    await expect(
      ownerPage.getByText("Recording consent policy saved."),
    ).toBeVisible();
    await markSectionComplete(
      ownerPage,
      "Mark recording consent complete",
      "notifications",
    );
    await markSectionComplete(
      ownerPage,
      "Mark notifications complete",
      "custom fields",
    );
    await markSectionComplete(
      ownerPage,
      "Mark custom fields complete",
      "review",
    );
    await markSectionComplete(
      ownerPage,
      "Complete configuration review",
      "completed",
    );
    const completedProgress =
      await prisma.organizationConfigProgress.findFirstOrThrow({
        where: { organization: { slug } },
      });
    expect(completedProgress.status).toBe("COMPLETED");
    expect(completedProgress.completedSections).toEqual([
      "BUSINESS_TEMPLATE",
      "LOCALE",
      "SERVICE_AREAS",
      "AVAILABILITY",
      "LEAD_STAGES",
      "CALL_DISPOSITIONS",
      "CALLBACK_POLICY",
      "RECORDING_CONSENT",
      "NOTIFICATIONS",
      "CUSTOM_FIELDS",
      "REVIEW",
    ]);

    await ownerPage.reload();
    await expect(
      ownerPage.getByText("Extended configuration is complete."),
    ).toBeVisible();
    await expect(
      ownerPage.getByRole("button", { name: "Complete configuration review" }),
    ).toHaveCount(0);
    expect(await onboardingStatus(slug)).toBe("COMPLETED");

    // 8. Stale conflict: inject expectedVersion and recover via reload copy.
    // Hidden expectedVersion is React-controlled; useFormStatus re-renders
    // reset input.value, so intercept FormData at submit instead.
    await ownerPage.reload();
    await expect(ownerPage.getByLabel("Locale (BCP 47)")).toHaveValue("fr-CA");
    const localeOrg = await prisma.organization.findUniqueOrThrow({
      where: { slug },
    });
    await prisma.organizationLocaleSettings.update({
      where: { organizationId: localeOrg.id },
      data: { version: { increment: 99 } },
    });
    const localeForm = ownerPage.locator("form").filter({
      has: ownerPage.getByLabel("Locale (BCP 47)"),
    });
    await localeForm.evaluate((form) => {
      const input = form.querySelector('input[name="expectedVersion"]');
      if (input instanceof HTMLInputElement) {
        input.setAttribute("value", "0");
        input.value = "0";
      }
      form.addEventListener(
        "submit",
        () => {
          const current = form.querySelector('input[name="expectedVersion"]');
          if (current instanceof HTMLInputElement) {
            current.setAttribute("value", "0");
            current.value = "0";
          }
        },
        { capture: true, once: true },
      );
      form.addEventListener(
        "formdata",
        (event) => {
          const formDataEvent = event as FormDataEvent;
          formDataEvent.formData.set("expectedVersion", "0");
        },
        { capture: true, once: true },
      );
    });
    await localeForm
      .getByRole("button", { name: "Save locale settings" })
      .click();
    await expect(ownerPage.getByText(/reload/i).first()).toBeVisible({
      timeout: 15_000,
    });

    await ownerPage.reload();
    await expect(ownerPage.getByLabel("Locale (BCP 47)")).toHaveValue("fr-CA");
    await expect(
      ownerPage.getByLabel("Enable call recording"),
    ).not.toBeChecked();

    // 6. Owner previews and confirms a template switch.
    await ownerPage.goto(`/app/orgs/${slug}/settings/business-template`);
    await ownerPage
      .getByLabel("Switch to")
      .selectOption({ label: "Home & trade services" });
    await ownerPage.getByRole("button", { name: "Preview switch" }).click();
    await expect(
      ownerPage.getByRole("heading", {
        name: /Preview: PROFESSIONAL_SERVICES → HOME_TRADE_SERVICES/,
      }),
    ).toBeVisible();
    await ownerPage.getByRole("button", { name: "Confirm switch" }).click();
    await expect(
      ownerPage
        .locator("span.font-medium")
        .filter({ hasText: "Home & trade services" }),
    ).toBeVisible({ timeout: 15_000 });

    // 7. Data survives reload.
    await ownerPage.reload();
    await expect(
      ownerPage.getByText("Home & trade services").first(),
    ).toBeVisible();

    await ownerPage.goto(`/app/orgs/${slug}/settings/service-areas`);
    await expect(ownerPage.getByText(AREA_LABEL).first()).toBeVisible();

    await ownerPage.goto(`/app/orgs/${slug}/settings/availability`);
    await expect(ownerPage.getByLabel("Internal label").first()).toHaveValue(
      CLOSURE_LABEL,
    );
    await expect(ownerPage.getByLabel("Start date").first()).toHaveValue(
      CLOSURE_DATE,
    );

    await ownerPage.goto(`/app/orgs/${slug}/settings/operational-defaults`);
    await expect(ownerPage.getByLabel("Locale (BCP 47)")).toHaveValue("fr-CA");
    await expect(ownerPage.getByLabel("Default language")).toHaveValue("fr");
    await expect(
      ownerPage.getByLabel("Enable call recording"),
    ).not.toBeChecked();
    await expect(
      ownerPage.getByLabel("Enable transcription"),
    ).not.toBeChecked();

    // 12. Completed Phase 3A org remains completed after 3B settings / start.
    expect(await onboardingStatus(slug)).toBe("COMPLETED");
    await ownerPage.goto(`/app/orgs/${slug}/settings`);
    await expect(
      ownerPage.getByRole("button", { name: "Reopen onboarding" }),
    ).toBeVisible();
    await ownerPage.goto(`/app/orgs/${slug}/onboarding/review`);
    await expect(ownerPage.getByText(/Onboarding completed/i)).toBeVisible();

    await inviteAndAcceptMember(ownerPage, memberPage, slug);

    // 9. MEMBER cannot access mutation controls.
    await memberPage.goto(`/app/orgs/${slug}/settings/business-template`);
    await expect(
      memberPage.getByText("Home & trade services").first(),
    ).toBeVisible();
    await expect(
      memberPage.getByRole("button", { name: "Select template" }),
    ).toHaveCount(0);
    await expect(
      memberPage.getByRole("button", { name: "Save customization" }),
    ).toHaveCount(0);
    await expect(
      memberPage.getByRole("button", { name: "Preview switch" }),
    ).toHaveCount(0);
    await expect(
      memberPage.getByRole("button", { name: "Confirm switch" }),
    ).toHaveCount(0);
    await expect(
      memberPage.getByRole("button", {
        name: "Mark business template complete",
      }),
    ).toHaveCount(0);

    await memberPage.goto(`/app/orgs/${slug}/settings/service-areas`);
    await expect(memberPage.getByText(AREA_LABEL).first()).toBeVisible();
    await expect(
      memberPage.getByText(
        /You can view these settings. Only owners and admins can make changes./,
      ),
    ).toBeVisible();
    await expect(
      memberPage.getByRole("button", { name: "Create service area" }),
    ).toHaveCount(0);
    await expect(
      memberPage.getByRole("button", { name: "Save area" }),
    ).toHaveCount(0);

    await memberPage.goto(`/app/orgs/${slug}/settings/availability`);
    await expect(memberPage.getByText(CLOSURE_LABEL).first()).toBeVisible();
    await expect(
      memberPage.getByRole("button", { name: "Create closure" }),
    ).toHaveCount(0);
    await expect(
      memberPage.getByRole("button", { name: "Save closure" }),
    ).toHaveCount(0);

    await memberPage.goto(`/app/orgs/${slug}/settings/operational-defaults`);
    await expect(memberPage.getByText(/Locale: fr-CA/)).toBeVisible();
    await expect(memberPage.getByText(/Recording: Off/)).toBeVisible();
    await expect(
      memberPage.getByRole("button", { name: "Save locale settings" }),
    ).toHaveCount(0);
    await expect(
      memberPage.getByRole("button", { name: "Save lead stages" }),
    ).toHaveCount(0);
    await expect(
      memberPage.getByRole("button", { name: "Save recording consent policy" }),
    ).toHaveCount(0);

    // 10. Cross-tenant URL manipulation fails.
    const otherSlug = `e2e-3b-other-${randomUUID().slice(0, 8)}`;
    await createOrganization(ownerPage, "Other Config Org", otherSlug);
    await ownerPage.goto(`/app/orgs/${otherSlug}/settings/service-areas`);
    await expect(ownerPage.getByText(AREA_LABEL)).toHaveCount(0);
    await expect(
      ownerPage.getByText(/Extended configuration has not been started/i),
    ).toBeVisible();

    await memberPage.goto(`/app/orgs/${otherSlug}/settings/business-template`);
    await expect(
      memberPage.getByRole("heading", { name: "Page not found" }),
    ).toBeVisible();
    await expect(memberPage.getByText("Home & trade services")).toHaveCount(0);
    await expect(memberPage.getByText(AREA_LABEL)).toHaveCount(0);

    await memberPage.goto(`/app/orgs/${slug}/settings/service-areas`);
    await expect(memberPage.getByText(AREA_LABEL).first()).toBeVisible();

    await ownerContext.close();
    await memberContext.close();
  });
});
