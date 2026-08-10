import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";

const prisma = new PrismaClient();

const verifiedEmail = "e2e-verified@example.com";
const verifiedPassword = "CorrectHorseBatteryStaple";
const unknownEmail = "e2e-unknown@example.com";

async function ensureVerifiedUser(): Promise<void> {
  const passwordHash = await hash(verifiedPassword, {
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
    outputLen: 32,
    algorithm: 2,
  });

  await prisma.user.upsert({
    where: { email: verifiedEmail },
    create: {
      name: "E2E Verified",
      email: verifiedEmail,
      passwordHash,
      emailVerifiedAt: new Date(),
      sessionVersion: 0,
    },
    update: {
      passwordHash,
      emailVerifiedAt: new Date(),
      sessionVersion: 0,
    },
  });
}

test.beforeAll(async () => {
  await ensureVerifiedUser();
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test.describe("authentication smoke", () => {
  test("registration page loads with an accessible heading", async ({
    page,
  }) => {
    await page.goto("/register");
    await expect(
      page.getByRole("heading", { level: 1, name: "Create an account" }),
    ).toBeVisible();
    await expect(page.getByText(/something went wrong/i)).toHaveCount(0);
  });

  test("invalid registration input displays accessible validation", async ({
    page,
  }) => {
    await page.goto("/register");
    await page.getByLabel("Name").fill("A");
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByLabel("Password", { exact: true }).fill("short");
    await page.getByLabel("Confirm password").fill("different");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("alert").first()).toBeVisible();
    await expect(page.getByText(/something went wrong/i)).toHaveCount(0);
  });

  test("seeded verified user can log in and reach /app", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(verifiedEmail);
    await page.getByLabel("Password").fill(verifiedPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/app/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Application" }),
    ).toBeVisible();
  });

  test("unauthenticated access to /app redirects to login", async ({
    page,
  }) => {
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/);
  });

  test("logout removes access to /app", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(verifiedEmail);
    await page.getByLabel("Password").fill(verifiedPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/app/);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/);
  });

  test("invalid login does not reveal whether the account exists", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(verifiedEmail);
    await page.getByLabel("Password").fill("totally-wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Invalid email or password.")).toBeVisible();

    await page.goto("/login");
    await page.getByLabel("Email").fill(unknownEmail);
    await page.getByLabel("Password").fill("totally-wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Invalid email or password.")).toBeVisible();
  });

  test("forgot-password shows the same generic result for known and unknown emails", async ({
    page,
  }) => {
    const generic =
      /if an account exists for that email, password reset instructions have been sent/i;

    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill(verifiedEmail);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText(generic)).toBeVisible();

    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill(unknownEmail);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText(generic)).toBeVisible();
  });
});
