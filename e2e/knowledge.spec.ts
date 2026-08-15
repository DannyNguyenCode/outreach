import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";

const prisma = new PrismaClient();

const ownerEmail = "e2e-knowledge-owner@example.com";
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

test.describe("Phase 4A business knowledge", () => {
  test.beforeAll(async () => {
    await ensureVerifiedUser(ownerEmail, "Knowledge Owner");
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test("owner creates, confirms, retrieves, and archives manual knowledge", async ({
    page,
  }) => {
    const slug = `know-${randomUUID().slice(0, 8)}`;
    await signIn(page, ownerEmail);
    await createOrganization(page, "Knowledge Org", slug);

    await page.goto(`/app/orgs/${slug}/knowledge/new`);
    await page.getByLabel("Title", { exact: true }).fill("Return policy");
    await page.getByLabel("Section 1 title").fill("Overview");
    await page
      .getByLabel("Passage 1")
      .fill("Unused items may be returned in 30 days.");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/app/orgs/${slug}/knowledge/.+/versions/`),
    );
    await expect(
      page.getByText("Unused items may be returned in 30 days."),
    ).toBeVisible();
    await expect(
      page.getByText(/I am authorized to provide this information/i),
    ).toBeVisible();

    await page
      .getByLabel("I confirm the statement above for this exact version.")
      .check();
    await page.getByRole("button", { name: "Confirm and activate" }).click();
    await expect(page.getByText(/State: active/i)).toBeVisible();
    await expect(page.getByText(/Confirmed /)).toBeVisible();

    await page.goto(`/app/orgs/${slug}/knowledge`);
    await expect(
      page.getByRole("heading", { name: "Active retrieval" }),
    ).toBeVisible();
    await expect(
      page.getByText("Unused items may be returned in 30 days."),
    ).toBeVisible();
    await expect(page.getByText(/Citation source/i)).toBeVisible();

    await page
      .getByRole("link", { name: /Return policy/ })
      .first()
      .click();
    await page
      .getByRole("button", { name: "Create replacement draft" })
      .click();
    await page.getByRole("link", { name: "Edit draft" }).click();
    await page.getByLabel("Title", { exact: true }).fill("Return policy v2");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/app/orgs/${slug}/knowledge/.+/versions/`),
    );

    await page.goto(`/app/orgs/${slug}/knowledge`);
    await expect(
      page.getByText("Unused items may be returned in 30 days."),
    ).toBeVisible();

    await page
      .getByRole("link", { name: /Return policy/ })
      .first()
      .click();
    await page.getByRole("link", { name: "Preview and confirm" }).click();
    await page
      .getByLabel("I confirm the statement above for this exact version.")
      .check();
    await page.getByRole("button", { name: "Confirm and activate" }).click();
    await expect(page.getByText(/State: active/i)).toBeVisible();

    await page.goto(`/app/orgs/${slug}/knowledge`);
    await expect(
      page.getByRole("heading", { name: "Active retrieval" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Return policy v2/ }),
    ).toBeVisible();

    await page
      .getByRole("link", { name: /Return policy v2/ })
      .first()
      .click();
    await page.getByRole("button", { name: "Archive knowledge" }).click();
    await expect(
      page.getByText("This source is archived and excluded from retrieval."),
    ).toBeVisible();

    await page.goto(`/app/orgs/${slug}/knowledge`);
    await expect(
      page.getByRole("heading", { name: "Active retrieval" }),
    ).toHaveCount(0);
    await expect(
      page.getByText("Unused items may be returned in 30 days."),
    ).toHaveCount(0);

    await page
      .getByRole("link", { name: /Return policy/ })
      .first()
      .click();
    await page.getByRole("link", { name: /superseded/i }).click();
    await page.getByRole("button", { name: "Restore as new draft" }).click();
    await expect(page.getByText(/Restored as a new draft/i)).toBeVisible();

    await page.goto(`/app/orgs/${slug}/knowledge`);
    await expect(
      page.getByRole("heading", { name: "Active retrieval" }),
    ).toHaveCount(0);

    await page
      .getByRole("link", { name: /Return policy/ })
      .first()
      .click();
    await page.getByRole("link", { name: "Preview and confirm" }).click();
    await expect(page.getByText(/State: draft/i)).toBeVisible();
    await page
      .getByLabel("I confirm the statement above for this exact version.")
      .check();
    await page.getByRole("button", { name: "Confirm and activate" }).click();
    await expect(page.getByText(/State: active/i)).toBeVisible();

    await page.goto(`/app/orgs/${slug}/knowledge`);
    await expect(
      page.getByRole("heading", { name: "Active retrieval" }),
    ).toBeVisible();
    await expect(
      page.getByText("Unused items may be returned in 30 days."),
    ).toBeVisible();

    await page.goto(`/app/orgs/${slug}/knowledge/sources`);
    await expect(
      page.getByRole("heading", { name: "Runtime source inspector" }),
    ).toBeVisible();
    await expect(
      page.getByRole("search", { name: "Runtime evidence filters" }),
    ).toBeVisible();
    await page.getByLabel("Evidence query").fill("return");
    await page.getByRole("button", { name: "Inspect evidence" }).click();
    await expect(
      page.getByRole("heading", { name: /Composition state: SUPPORTED/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Runtime evidence" }),
    ).toBeVisible();
    await expect(page.getByText("Return policy — Overview")).toBeVisible();
    await page.keyboard.press("Tab");
  });
});
