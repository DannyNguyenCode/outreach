import { randomUUID } from "node:crypto";

import { hash } from "@node-rs/argon2";
import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";

const prisma = new PrismaClient();
const email = "e2e-csv-import-owner@example.com";
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
      name: "CSV Import Owner",
      email,
      passwordHash,
      emailVerifiedAt: new Date(),
      sessionVersion: 0,
    },
    update: {
      name: "CSV Import Owner",
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

test.describe("Phase 4D CSV customer workflow", () => {
  test.beforeAll(async () => {
    await ensureVerifiedUser();
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test("owner previews, maps, stages, resumes, acknowledges, and activates knowledge", async ({
    page,
  }) => {
    const slug = `csv-${randomUUID().slice(0, 8)}`;
    await signIn(page);
    await createOrganization(page, "CSV Import Org", slug);

    await page.goto(`/app/orgs/${slug}/knowledge/import`);
    await expect(
      page.getByRole("heading", { name: "CSV import" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", {
        name: /Download the official knowledge CSV template/i,
      }),
    ).toHaveAttribute(
      "href",
      "/templates/outreach-knowledge-import-template.csv",
    );

    const csv =
      "Title,Section,Body\nVisitor parking,Hours,Visitor parking is available on weekdays.\n";
    await page.getByLabel("CSV file").setInputFiles({
      name: "knowledge.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
    await page.getByRole("button", { name: "Preview file" }).click();
    await expect(page.getByRole("heading", { name: "Preview" })).toBeVisible();
    await expect(
      page.getByText(/has not saved or activated this file/i),
    ).toBeVisible();
    await expect(page.getByLabel(/Column 1/)).toHaveValue("");

    await page.getByLabel(/Column 1/).selectOption("knowledge.title");
    await page.getByLabel(/Column 2/).selectOption("knowledge.sectionTitle");
    await page.getByLabel(/Column 3/).selectOption("knowledge.passageBody");
    await page.getByRole("button", { name: "Validate mapped file" }).click();
    await expect(
      page.getByRole("heading", { name: "Complete-file validation" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Stage import" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/app/orgs/${slug}/knowledge/import/.+`),
    );
    await expect(
      page.getByRole("heading", { name: "Review CSV import" }),
    ).toBeVisible();
    await expect(
      page.getByText("Visitor parking is available on weekdays."),
    ).toBeVisible();

    await page.goto(`/app/orgs/${slug}/knowledge/import`);
    await page.getByRole("link", { name: "Continue reviewing" }).click();
    await expect(
      page.getByRole("heading", { name: "Review CSV import" }),
    ).toBeVisible();

    const acknowledgment = page.getByLabel(
      /I confirm that I am authorized to provide this information/i,
    );
    await expect(acknowledgment).not.toBeChecked();
    await acknowledgment.check();
    await page.getByRole("button", { name: "Confirm and activate" }).click();
    await expect(page.getByText(/Confirmation receipt/i)).toBeVisible();
    await page.getByRole("link", { name: /Knowledge version/ }).click();
    await expect(page.getByText(/State: active/i)).toBeVisible();

    await page.goto(`/app/orgs/${slug}/knowledge`);
    await expect(
      page.getByRole("heading", { name: "Active retrieval" }),
    ).toBeVisible();
    await expect(
      page.getByText("Visitor parking is available on weekdays."),
    ).toBeVisible();
  });
});
