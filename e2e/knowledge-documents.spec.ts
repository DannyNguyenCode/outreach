import { randomUUID } from "node:crypto";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";

const prisma = new PrismaClient();

const ownerEmail = "e2e-knowledge-document-owner@example.com";
const password = "CorrectHorseBatteryStaple";
const workerToken =
  process.env.KNOWLEDGE_WORKER_TOKEN ??
  "dev-only-knowledge-worker-token-32chars";

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
  await prisma.rateLimitBucket.deleteMany();
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

test.describe("Phase 4B private documents", () => {
  test.beforeAll(async () => {
    await ensureVerifiedUser(ownerEmail, "Document Owner");
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test("owner uploads, processes, confirms, retrieves, and archives a document", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const slug = `doc-${randomUUID().slice(0, 8)}`;
    await signIn(page, ownerEmail);
    await createOrganization(page, "Document Org", slug);

    const dir = await mkdtemp(path.join(tmpdir(), "outreach-doc-e2e-"));
    const filePath = path.join(dir, "refund-policy.txt");
    await writeFile(
      filePath,
      "# Refund policy\n\nCustomers may request a refund within 30 days.\n",
      "utf8",
    );

    await page.goto(`/app/orgs/${slug}/knowledge/upload`);
    await page.getByLabel("Private document").setInputFiles(filePath);
    await page.getByRole("button", { name: "Upload" }).click();
    await expect(
      page.getByText(/Upload complete|Scanning and extraction/i),
    ).toBeVisible({
      timeout: 30_000,
    });
    await expect(page).toHaveURL(
      new RegExp(`/app/orgs/${slug}/knowledge/.+/versions/`),
      { timeout: 30_000 },
    );
    await expect(
      page.getByRole("heading", { name: "Private document status" }),
    ).toBeVisible();

    const processResponse = await request.post(
      "/api/internal/knowledge-documents/process",
      {
        headers: {
          authorization: `Bearer ${workerToken}`,
        },
      },
    );
    const processBody = (await processResponse.json()) as {
      ok?: boolean;
      processed?: number;
      outcomes?: Array<{ jobId: string; outcome: string }>;
      message?: string;
    };
    expect(
      processResponse.ok(),
      `worker HTTP ${processResponse.status()}: ${JSON.stringify(processBody)}`,
    ).toBeTruthy();
    expect(
      processBody,
      `unexpected worker payload: ${JSON.stringify(processBody)}`,
    ).toMatchObject({
      ok: true,
      processed: 1,
      outcomes: [{ outcome: "published" }],
    });

    const versionUrl = page.url();
    const versionMatch = versionUrl.match(
      /\/knowledge\/([^/]+)\/versions\/([^/?#]+)/,
    );
    expect(versionMatch).toBeTruthy();
    const versionId = versionMatch![2]!;
    await expect
      .poll(async () => {
        const version = await prisma.knowledgeVersion.findUnique({
          where: { id: versionId },
        });
        return version?.state ?? null;
      })
      .toBe("DRAFT");

    await page.goto(versionUrl, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "Private document status" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/State:\s*draft/i)).toBeVisible();
    await expect(page.getByText(/^complete/i)).toBeVisible();
    await expect(
      page.getByText("Customers may request a refund within 30 days."),
    ).toBeVisible();
    await expect(page.getByText("Section citation txt_s0001")).toBeVisible();
    await expect(
      page.getByText("Passage citation txt_s0001_p0001"),
    ).toBeVisible();

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
      page.getByText("Customers may request a refund within 30 days."),
    ).toBeVisible();
    await expect(page.getByText(/Citation source/i)).toBeVisible();

    const sourceMatch = versionUrl.match(/\/knowledge\/([^/]+)\/versions\//);
    expect(sourceMatch).toBeTruthy();
    await page.goto(`/app/orgs/${slug}/knowledge/${sourceMatch![1]}`);
    await page.getByRole("button", { name: "Archive knowledge" }).click();
    await expect(
      page.getByText("This source is archived and excluded from retrieval."),
    ).toBeVisible();

    await page.goto(`/app/orgs/${slug}/knowledge`);
    await expect(
      page.getByRole("heading", { name: "Active retrieval" }),
    ).toHaveCount(0);
  });
});
