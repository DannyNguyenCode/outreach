import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";

const prisma = new PrismaClient();

const ownerEmail = "e2e-onboarding-owner@example.com";
const memberEmail = "e2e-onboarding-member@example.com";
const password = "CorrectHorseBatteryStaple";

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

test.beforeAll(async () => {
  await ensureVerifiedUser(ownerEmail, "E2E Onboarding Owner");
  await ensureVerifiedUser(memberEmail, "E2E Onboarding Member");
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test.describe("Phase 3A business onboarding", () => {
  test("owner completes onboarding; member reads only; offboarding denies access", async ({
    browser,
  }) => {
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();

    const slug = `e2e-ob-${randomUUID().slice(0, 8)}`;

    await signIn(ownerPage, ownerEmail);
    await ownerPage.getByRole("link", { name: "Create organization" }).click();
    await ownerPage.getByLabel("Organization name").fill("E2E Onboard Org");
    await ownerPage.getByLabel(/URL slug/).fill(slug);
    await ownerPage
      .getByRole("button", { name: "Create organization" })
      .click();
    await expect(ownerPage).toHaveURL(new RegExp(`/app/orgs/${slug}`));

    await ownerPage.getByRole("link", { name: "Business onboarding" }).click();
    await expect(ownerPage).toHaveURL(
      new RegExp(`/app/orgs/${slug}/onboarding`),
    );

    // Intentional start (GET must not initialize)
    await expect(
      ownerPage.getByRole("heading", { name: "Business onboarding" }),
    ).toBeVisible();
    await ownerPage.getByRole("button", { name: "Start onboarding" }).click();
    await expect(ownerPage).toHaveURL(
      new RegExp(`/app/orgs/${slug}/onboarding/basics`),
    );

    // Basics
    await ownerPage
      .getByLabel("Customer-facing display name")
      .fill("Acme Care");
    await ownerPage.getByLabel("Industry / category").fill("Healthcare");
    await ownerPage.getByLabel("Business type").selectOption("BOTH");
    await ownerPage.getByRole("button", { name: "Save and continue" }).click();
    await expect(ownerPage.getByText(/Business basics saved/i)).toBeVisible();

    // Contact
    await ownerPage.goto(`/app/orgs/${slug}/onboarding/contact`);
    await ownerPage
      .getByLabel("Primary business email")
      .fill("care@acme.example");
    await ownerPage.getByLabel("Country").fill("CA");
    await ownerPage.getByLabel("Primary business phone").fill("4165551212");
    await ownerPage.getByLabel("Time zone (IANA)").fill("America/Toronto");
    await ownerPage.getByLabel("City").fill("Toronto");
    await ownerPage.getByRole("button", { name: "Save and continue" }).click();
    await expect(
      ownerPage.getByText(/Contact and location saved/i),
    ).toBeVisible();

    // Hours
    await ownerPage.goto(`/app/orgs/${slug}/onboarding/hours`);
    // Default form starts closed; open weekdays.
    const closedBoxes = ownerPage.locator('input[type="checkbox"]');
    const count = await closedBoxes.count();
    for (let i = 0; i < Math.min(count, 5); i += 1) {
      const box = closedBoxes.nth(i);
      if (await box.isChecked()) {
        await box.uncheck();
      }
    }
    await ownerPage.getByRole("button", { name: "Save weekly hours" }).click();
    await expect(ownerPage.getByText(/Operating hours saved/i)).toBeVisible();

    // Catalogue
    await ownerPage.goto(`/app/orgs/${slug}/onboarding/catalogue`);
    await ownerPage.getByLabel("Service name").fill("Consultation");
    await ownerPage.getByRole("button", { name: "Add service" }).click();
    await expect(ownerPage.getByText(/Service created/i)).toBeVisible();
    await ownerPage.getByLabel("Product name").fill("Care Kit");
    await ownerPage.getByRole("button", { name: "Add product" }).click();
    await expect(ownerPage.getByText(/Product created/i)).toBeVisible();
    await ownerPage
      .getByRole("button", { name: "Continue to employee defaults" })
      .click();
    await expect(ownerPage.getByText(/Catalogue step saved/i)).toBeVisible();

    // Defaults
    await ownerPage.goto(`/app/orgs/${slug}/onboarding/defaults`);
    await ownerPage.getByRole("button", { name: "Save defaults" }).click();
    await expect(ownerPage.getByText(/Employee defaults saved/i)).toBeVisible();

    // Review — GET must not complete
    await ownerPage.goto(`/app/orgs/${slug}/onboarding/review`);
    await expect(
      ownerPage.getByRole("button", { name: "Complete onboarding" }),
    ).toBeVisible();
    const before = await prisma.organizationOnboarding.findFirst({
      where: { organization: { slug } },
    });
    expect(before?.status).not.toBe("COMPLETED");

    await ownerPage
      .getByRole("button", { name: "Complete onboarding" })
      .click();
    await expect(ownerPage.getByText(/Onboarding completed/i)).toBeVisible();

    await ownerPage.reload();
    await expect(ownerPage.getByText(/Onboarding completed/i)).toBeVisible();

    // Edit after completion via settings
    await ownerPage.goto(`/app/orgs/${slug}/settings`);
    await ownerPage
      .getByLabel("Customer-facing display name")
      .fill("Acme Care Updated");
    await ownerPage
      .getByRole("button", { name: "Save and continue" })
      .first()
      .click();
    await expect(ownerPage.getByText(/Business basics saved/i)).toBeVisible();

    // Invite member
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

    // Seed accept via known token injection like Phase 2 e2e
    const { createHash, randomBytes } = await import("node:crypto");
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

    await memberPage.goto(`/app/orgs/${slug}/settings`);
    await expect(memberPage.getByText(/Acme Care Updated/i)).toBeVisible();
    await expect(
      memberPage.getByRole("button", { name: "Add service" }),
    ).toHaveCount(0);

    await memberPage.goto(`/app/orgs/${slug}/onboarding/review`);
    await expect(
      memberPage.getByRole("heading", { name: "Onboarding unavailable" }),
    ).toBeVisible();

    // Promote member to admin
    await ownerPage.goto(`/app/orgs/${slug}/members`);
    const memberRow = ownerPage.locator("li").filter({ hasText: memberEmail });
    await memberRow.getByLabel("Change role").selectOption("ADMIN");
    await memberRow.getByRole("button", { name: "Update role" }).click();
    await expect(ownerPage.getByText(/Role updated/i).first()).toBeVisible();

    await memberPage.goto(`/app/orgs/${slug}/settings`);
    await expect(
      memberPage.getByRole("button", { name: "Add service" }),
    ).toBeVisible();

    // Offboard admin and confirm same session loses access
    await ownerPage.goto(`/app/orgs/${slug}/members`);
    const rowAfterPromote = ownerPage
      .locator("li")
      .filter({ hasText: memberEmail });
    await rowAfterPromote.getByRole("button", { name: "Offboard" }).click();
    await expect(
      ownerPage
        .locator("li")
        .filter({ hasText: memberEmail })
        .getByText(/INACTIVE/i),
    ).toBeVisible();

    await memberPage.goto(`/app/orgs/${slug}/settings`);
    await expect(
      memberPage.getByRole("heading", { name: "Page not found" }),
    ).toBeVisible();

    // Isolation: another org remains separate
    const otherSlug = `e2e-ob-other-${randomUUID().slice(0, 8)}`;
    await ownerPage.goto("/app/organizations/new");
    await ownerPage.getByLabel("Organization name").fill("Other Org");
    await ownerPage.getByLabel(/URL slug/).fill(otherSlug);
    await ownerPage
      .getByRole("button", { name: "Create organization" })
      .click();
    await expect(ownerPage).toHaveURL(new RegExp(`/app/orgs/${otherSlug}`));
    await ownerPage.goto(`/app/orgs/${slug}/settings`);
    await expect(
      ownerPage.getByLabel("Customer-facing display name"),
    ).toHaveValue("Acme Care Updated");
    await ownerPage.goto(`/app/orgs/${otherSlug}/settings`);
    await expect(
      ownerPage.getByText(/Business configuration has not been started/i),
    ).toBeVisible();
    await expect(ownerPage.getByText(/Acme Care Updated/i)).toHaveCount(0);

    await ownerContext.close();
    await memberContext.close();
  });
});
