import { randomUUID } from "node:crypto";

import { hash } from "@node-rs/argon2";
import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";

const prisma = new PrismaClient();
const email = "e2e-offerings-owner@example.com";
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
      name: "Offerings Owner",
      email,
      passwordHash,
      emailVerifiedAt: new Date(),
      sessionVersion: 0,
    },
    update: {
      name: "Offerings Owner",
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

async function createPlan(
  page: Page,
  slug: string,
  name: string,
  amount: string,
) {
  await page.goto(`/app/orgs/${slug}/knowledge/offerings/new`);
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Price 1 amount").fill(amount);
  await page.getByRole("button", { name: "Add feature" }).click();
  await page.getByLabel("Feature 1 name").fill("Storage");
  await page.getByLabel("Feature 1 value").fill(`${amount} GB`);
  await page.getByRole("button", { name: "Save offering draft" }).click();
  await expect(page).toHaveURL(/\/knowledge\/offerings\/.+\/versions\/.+/);
  await page.getByLabel("I confirm this exact offering version.").check();
  await page.getByRole("button", { name: "Confirm and activate" }).click();
  // Confirm remounts the version page without the action form, so assert durable state.
  await expect(page.getByText(/ · active · /i)).toBeVisible();
  const match = page.url().match(/\/offerings\/([^/]+)\/versions\/([^/]+)/);
  if (!match) throw new Error("Offering URL did not contain stable IDs.");
  return { offeringId: match[1]!, versionId: match[2]! };
}

test.describe("Phase 4C structured offerings", () => {
  test.beforeAll(async () => {
    await ensureVerifiedUser();
  });
  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test("create, confirm, compare, archive, and restore a draft", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const slug = `offers-${randomUUID().slice(0, 8)}`;
    await signIn(page);
    await createOrganization(page, "Offerings Org", slug);

    const first = await createPlan(page, slug, "Starter plan", "25");
    await createPlan(page, slug, "Premium plan", "50");

    await page.goto(`/app/orgs/${slug}/knowledge/offerings/compare`);
    await page.getByLabel(/Starter plan/).check();
    await page.getByLabel(/Premium plan/).check();
    await page.getByRole("button", { name: "Compare selected" }).click();
    await expect(
      page.getByRole("heading", { name: "Comparison" }),
    ).toBeVisible();

    await page.goto(
      `/app/orgs/${slug}/knowledge/offerings/${first.offeringId}`,
    );
    await page.getByRole("button", { name: "Archive offering" }).click();
    await expect(page.getByText(/excluded from retrieval/i)).toBeVisible();
    await page.goto(
      `/app/orgs/${slug}/knowledge/offerings/${first.offeringId}/versions/${first.versionId}`,
    );
    await expect(
      page.getByRole("button", { name: "Restore as new draft" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Restore as new draft" }).click();
    await expect(page).toHaveURL(
      new RegExp(
        `/knowledge/offerings/${first.offeringId}/versions/(?!${first.versionId})`,
      ),
      { timeout: 15_000 },
    );
    await expect(page.getByText(/ · draft · /i)).toBeVisible();
    await page.goto(
      `/app/orgs/${slug}/knowledge/offerings/${first.offeringId}`,
    );
    await expect(page.getByRole("link", { name: "Edit draft" })).toBeVisible();
  });
});
