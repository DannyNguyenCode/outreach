import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";

const prisma = new PrismaClient();
const email = "e2e-prospects-owner@example.com";
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

async function ensureVerifiedUser(): Promise<void> {
  const passwordHash = await hashPassword(password);
  await prisma.user.upsert({
    where: { email },
    create: {
      name: "Prospect Owner",
      email,
      passwordHash,
      emailVerifiedAt: new Date(),
      sessionVersion: 0,
    },
    update: {
      name: "Prospect Owner",
      passwordHash,
      emailVerifiedAt: new Date(),
      sessionVersion: 0,
      activeOrganizationId: null,
    },
  });
}

async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app/);
}

async function createOrganization(page: Page, slug: string): Promise<void> {
  await page.goto("/app/organizations/new");
  await page.getByLabel("Organization name").fill("Prospect Org");
  await page.getByLabel(/URL slug/).fill(slug);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/orgs/${slug}`));
}

test.describe("Phase 5A prospects", () => {
  test.beforeAll(async () => {
    await ensureVerifiedUser();
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test("creates a prospect with two contacts, searches, edits, archives, and restores", async ({
    page,
  }) => {
    const slug = `pros-${randomUUID().slice(0, 8)}`;
    await signIn(page);
    await createOrganization(page, slug);

    await page.goto(`/app/orgs/${slug}/prospects/new`);
    await page.getByLabel("Prospect name").fill("ABC Plumbing");
    await page.getByLabel("Contact 1 first name").fill("John");
    await page.getByLabel("Contact 1 last name").fill("Smith");
    await page.getByLabel("Contact 1 title").fill("Owner");
    await page.getByLabel(/Contact 1 phone 1/i).fill("+14165554001");
    await page.getByRole("button", { name: "Add contact" }).click();
    await page.getByLabel("Contact 2 first name").fill("Jane");
    await page.getByLabel("Contact 2 last name").fill("Doe");
    await page.getByLabel("Contact 2 title").fill("Office Manager");
    await page.getByRole("button", { name: "Save prospect" }).click();
    await expect(page).toHaveURL(new RegExp(`/app/orgs/${slug}/prospects/.+`));
    await expect(
      page.getByRole("heading", { name: "ABC Plumbing" }),
    ).toBeVisible();
    await expect(page.getByText("John Smith")).toBeVisible();
    await expect(page.getByText("Jane Doe")).toBeVisible();

    await page.goto(`/app/orgs/${slug}/prospects`);
    await page.getByLabel("Search").fill("Jane");
    await page.getByRole("button", { name: "Filter" }).click();
    await page.getByRole("link", { name: "ABC Plumbing" }).click();
    await page.getByRole("link", { name: "Edit prospect" }).click();
    await page.getByLabel("Prospect name").fill("ABC Plumbing Ltd");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(
      page.getByRole("heading", { name: "ABC Plumbing Ltd" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Archive prospect" }).click();
    await expect(page.getByText(/business · archived · source/i)).toBeVisible();
    await page.goto(`/app/orgs/${slug}/prospects?lifecycle=ARCHIVED`);
    await page.getByRole("link", { name: "ABC Plumbing Ltd" }).click();
    await page.getByRole("button", { name: "Restore prospect" }).click();
    await expect(page.getByText(/business · active · source/i)).toBeVisible();
  });

  test("shows duplicate warning and completes an explicit merge", async ({
    page,
  }) => {
    const slug = `merg-${randomUUID().slice(0, 8)}`;
    await signIn(page);
    await createOrganization(page, slug);

    await page.goto(`/app/orgs/${slug}/prospects/new`);
    await page.getByLabel("Prospect name").fill("ABC Plumbing");
    await page.getByLabel("Website").fill("abcplumbing.ca");
    await page.getByLabel("Contact 1 first name").fill("John");
    await page.getByLabel("Contact 1 last name").fill("Smith");
    await page.getByLabel(/Contact 1 phone 1/i).fill("+14165554111");
    await page.getByRole("button", { name: "Save prospect" }).click();
    await expect(
      page.getByRole("heading", { name: "ABC Plumbing" }),
    ).toBeVisible();

    await page.goto(`/app/orgs/${slug}/prospects/new`);
    await page.getByLabel("Prospect name").fill("ABC Plumbing Inc.");
    await page.getByLabel("Website").fill("abcplumbing.com");
    await page.getByLabel("Contact 1 first name").fill("Jane");
    await page.getByLabel("Contact 1 last name").fill("Doe");
    await page.getByLabel(/Contact 1 phone 1/i).fill("+14165554111");
    await page.getByRole("button", { name: "Save prospect" }).click();
    await expect(
      page.getByText(/Possible duplicate prospects were found/i),
    ).toBeVisible();
    await page.getByLabel(/Continue with a distinct prospect/i).check();
    await page.getByRole("button", { name: "Save prospect" }).click();
    await expect(
      page.getByRole("heading", { name: "ABC Plumbing Inc." }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: /Review merge with ABC Plumbing/ })
      .click();
    await expect(
      page.getByRole("heading", { name: "Merge prospects" }),
    ).toBeVisible();
    await page.getByLabel(/Keep ABC Plumbing Inc/).check();
    await page.getByLabel(/I have reviewed the surviving record/).check();
    await page.getByRole("button", { name: "Confirm merge" }).click();
    await expect(
      page.getByRole("heading", { name: /ABC Plumbing/ }),
    ).toBeVisible();
    await expect(page.getByText("Jane Doe")).toBeVisible();
  });
});
