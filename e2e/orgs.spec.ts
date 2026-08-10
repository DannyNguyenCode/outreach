import { createHash, randomBytes, randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";

const prisma = new PrismaClient();

const ownerEmail = "e2e-org-owner@example.com";
const inviteeEmail = "e2e-org-invitee@example.com";
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
  await ensureVerifiedUser(ownerEmail, "E2E Org Owner");
  await ensureVerifiedUser(inviteeEmail, "E2E Org Invitee");
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test.describe("organization workflow", () => {
  test("owner can create, invite, promote, and offboard with immediate access loss", async ({
    browser,
  }) => {
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    const inviteeContext = await browser.newContext();
    const inviteePage = await inviteeContext.newPage();

    const slug = `e2e-org-${randomUUID().slice(0, 8)}`;

    await signIn(ownerPage, ownerEmail);
    await ownerPage.getByRole("link", { name: "Create organization" }).click();
    await expect(
      ownerPage.getByRole("heading", { name: "Create organization" }),
    ).toBeVisible();
    await ownerPage.getByLabel("Organization name").fill("E2E Org");
    await ownerPage.getByLabel(/URL slug/).fill(slug);
    await ownerPage
      .getByRole("button", { name: "Create organization" })
      .click();
    await expect(ownerPage).toHaveURL(new RegExp(`/app/orgs/${slug}`));
    await expect(
      ownerPage.getByRole("heading", { level: 1, name: "E2E Org" }),
    ).toBeVisible();

    await ownerPage
      .getByRole("link", { name: "Members & invitations" })
      .click();
    await ownerPage.getByLabel("Invite email").fill(inviteeEmail);
    await ownerPage.getByLabel("Role").selectOption("MEMBER");
    await ownerPage.getByRole("button", { name: "Send invitation" }).click();
    await expect(ownerPage.getByText(/Invitation sent/i)).toBeVisible();

    const organization = await prisma.organization.findUnique({
      where: { slug },
    });
    expect(organization).not.toBeNull();

    const invitation = await prisma.organizationInvitation.findFirst({
      where: {
        organizationId: organization!.id,
        emailNormalized: inviteeEmail,
        revokedAt: null,
        acceptedAt: null,
      },
      orderBy: { createdAt: "desc" },
    });
    expect(invitation).not.toBeNull();

    // Seed a known raw token for the invitation (hash matches DB) for capture-free e2e.
    // Prefer reading via replacing token with a test-controlled raw value.
    const rawToken = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256")
      .update(rawToken, "utf8")
      .digest("hex");
    await prisma.organizationInvitation.update({
      where: { id: invitation!.id },
      data: { tokenHash },
    });

    // Visiting the invitation URL alone must not accept it.
    await inviteePage.goto(`/invitations/accept?token=${rawToken}`);
    await expect(
      inviteePage.getByRole("heading", { name: "Organization invitation" }),
    ).toBeVisible();
    await expect(
      inviteePage.getByText(/does not accept the invitation/i),
    ).toBeVisible();

    const stillPending = await prisma.organizationInvitation.findUnique({
      where: { id: invitation!.id },
    });
    expect(stillPending?.acceptedAt).toBeNull();

    await signIn(inviteePage, inviteeEmail);
    await inviteePage.goto(`/invitations/accept?token=${rawToken}`);
    await inviteePage
      .getByRole("button", { name: "Accept invitation" })
      .click();
    await expect(inviteePage).toHaveURL(new RegExp(`/app/orgs/${slug}`));

    await inviteePage
      .getByRole("link", { name: "Members & invitations" })
      .click();
    await expect(
      inviteePage.getByText(/Only owners and admins can send invitations/i),
    ).toBeVisible();

    // Promote invitee to admin as owner.
    await ownerPage.goto(`/app/orgs/${slug}/members`);
    const memberRow = ownerPage.locator("li").filter({ hasText: inviteeEmail });
    await memberRow.getByLabel("Change role").selectOption("ADMIN");
    await memberRow.getByRole("button", { name: "Update role" }).click();
    await expect(ownerPage.getByText(/Role updated/i).first()).toBeVisible();

    // Invitee (now admin) can invite.
    await inviteePage.goto(`/app/orgs/${slug}/members`);
    await expect(inviteePage.getByLabel("Invite email")).toBeVisible();

    // Offboard invitee; existing invitee session must lose access immediately.
    const membership = await prisma.membership.findFirst({
      where: {
        organizationId: organization!.id,
        user: { email: inviteeEmail },
      },
    });
    expect(membership).not.toBeNull();

    await ownerPage.goto(`/app/orgs/${slug}/members`);
    const rowAfterPromote = ownerPage
      .locator("li")
      .filter({ hasText: inviteeEmail });
    await rowAfterPromote.getByRole("button", { name: "Offboard" }).click();
    await expect(
      ownerPage
        .locator("li")
        .filter({ hasText: inviteeEmail })
        .getByText(/INACTIVE/i),
    ).toBeVisible();

    await inviteePage.goto(`/app/orgs/${slug}`);
    await expect(
      inviteePage.getByRole("heading", { name: "Page not found" }),
    ).toBeVisible();

    // Unrelated org access for owner remains.
    await ownerPage.goto(`/app/orgs/${slug}`);
    await expect(
      ownerPage.getByRole("heading", { level: 1, name: "E2E Org" }),
    ).toBeVisible();

    // Global account still exists.
    const inviteeUser = await prisma.user.findUnique({
      where: { email: inviteeEmail },
    });
    expect(inviteeUser).not.toBeNull();

    await ownerContext.close();
    await inviteeContext.close();
  });
});
