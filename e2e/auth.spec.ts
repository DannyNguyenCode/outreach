import { createHash, randomBytes } from "node:crypto";

import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";

const prisma = new PrismaClient();

function makeRawToken(): string {
  return randomBytes(32).toString("base64url");
}

function makeTokenHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

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

  test("visiting a verification link does not verify until confirmation POST", async ({
    page,
  }) => {
    const email = `e2e-verify-${Date.now()}@example.com`;
    const passwordHash = await hash("CorrectHorseBatteryStaple", {
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
      outputLen: 32,
      algorithm: 2,
    });
    const user = await prisma.user.create({
      data: {
        name: "E2E Verify",
        email,
        passwordHash,
      },
    });

    const token = makeRawToken();
    await prisma.authToken.create({
      data: {
        userId: user.id,
        purpose: "EMAIL_VERIFICATION",
        tokenHash: makeTokenHash(token),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    await page.goto(`/verify-email?token=${encodeURIComponent(token)}`);
    await expect(
      page.getByRole("heading", { name: "Confirm email verification" }),
    ).toBeVisible();

    const stillUnverified = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(stillUnverified.emailVerifiedAt).toBeNull();
    expect(
      await prisma.authToken.count({
        where: { userId: user.id, consumedAt: null },
      }),
    ).toBe(1);

    await page.getByRole("button", { name: "Verify email" }).click();
    await expect(
      page.getByRole("heading", { name: "Email verified" }),
    ).toBeVisible();

    const verified = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(verified.emailVerifiedAt).not.toBeNull();
  });

  test("password reset invalidates an existing browser session for /app", async ({
    page,
    context,
  }) => {
    const email = `e2e-revoke-${Date.now()}@example.com`;
    const oldPassword = "CorrectHorseBatteryStaple";
    const newPassword = "TotallyNewPassphrase1";
    const passwordHash = await hash(oldPassword, {
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
      outputLen: 32,
      algorithm: 2,
    });
    const user = await prisma.user.create({
      data: {
        name: "E2E Revoke",
        email,
        passwordHash,
        emailVerifiedAt: new Date(),
        sessionVersion: 0,
      },
    });

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(oldPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/app/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Application" }),
    ).toBeVisible();

    const token = makeRawToken();
    await prisma.authToken.create({
      data: {
        userId: user.id,
        purpose: "PASSWORD_RESET",
        tokenHash: makeTokenHash(token),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    const newHash = await hash(newPassword, {
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
      outputLen: 32,
      algorithm: 2,
    });
    await prisma.$transaction([
      prisma.authToken.updateMany({
        where: { userId: user.id, purpose: "PASSWORD_RESET", consumedAt: null },
        data: { consumedAt: new Date() },
      }),
      prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: newHash, sessionVersion: { increment: 1 } },
      }),
    ]);

    // Reuse the same browser session cookies without signing in again.
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/);

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(oldPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Invalid email or password.")).toBeVisible();

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(newPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/app/);

    expect(context.pages().length).toBeGreaterThan(0);
  });
});
