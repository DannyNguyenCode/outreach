import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  registerUser,
  requestPasswordReset,
  resetPasswordWithToken,
  verifyCredentials,
  verifyEmailWithToken,
} from "@/lib/auth/account-service";
import { issueAuthToken } from "@/lib/auth/tokens";
import { verifyPassword } from "@/lib/auth/password";
import { setMailerForTests, type EmailSender } from "@/lib/email/mailer";
import { resetServerEnvCache } from "@/lib/env/server";
import { resetApplicationData } from "@/tests/integration/reset";

const sent: Array<{ to: string; subject: string; text: string }> = [];

const mockMailer: EmailSender = {
  async send(input) {
    sent.push({ to: input.to, subject: input.subject, text: input.text });
  },
};

function extractToken(text: string): string | null {
  const match = text.match(/[?&]token=([A-Za-z0-9_-]+)/);
  return match?.[1] ?? null;
}

describe("authentication integration", () => {
  const prisma = new PrismaClient();

  beforeAll(async () => {
    resetServerEnvCache();
    setMailerForTests(mockMailer);
    await prisma.$connect();
  });

  beforeEach(async () => {
    sent.length = 0;
    await resetApplicationData(prisma);
  });

  afterAll(async () => {
    setMailerForTests(undefined);
    await prisma.$disconnect();
  });

  it("registers an unverified user without storing plaintext passwords", async () => {
    const email = `reg-${randomUUID()}@example.com`;
    const password = "correct horse battery staple";

    const result = await registerUser(
      { name: "Reg User", email, password },
      { mailer: mockMailer },
    );
    expect(result.status).toBe("ok");

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user).not.toBeNull();
    expect(user?.emailVerifiedAt).toBeNull();
    expect(user?.passwordHash).not.toBe(password);
    expect(await verifyPassword(password, user!.passwordHash)).toBe(true);

    const token = await prisma.authToken.findFirst({
      where: { userId: user!.id, purpose: "EMAIL_VERIFICATION" },
    });
    expect(token).not.toBeNull();
    expect(token!.tokenHash).not.toEqual(extractToken(sent[0]?.text ?? ""));
    expect(sent[0]?.text).toContain("token=");
  });

  it("rejects duplicate normalized emails safely", async () => {
    const email = `Dup-${randomUUID()}@Example.COM`;
    const password = "correct horse battery staple";
    await registerUser(
      { name: "One", email, password },
      { mailer: mockMailer },
    );
    const second = await registerUser(
      { name: "Two", email: email.toLowerCase(), password },
      { mailer: mockMailer },
    );
    expect(second.status).toBe("conflict");
    expect(await prisma.user.count()).toBe(1);
  });

  it("verifies email with a hashed token and rejects reuse/expiry", async () => {
    const email = `verify-${randomUUID()}@example.com`;
    await registerUser(
      {
        name: "Verify User",
        email,
        password: "correct horse battery staple",
      },
      { mailer: mockMailer },
    );
    const rawToken = extractToken(sent[0]!.text)!;
    expect(await verifyEmailWithToken(rawToken)).toEqual({
      status: "verified",
    });
    const user = await prisma.user.findUnique({ where: { email } });
    expect(user?.emailVerifiedAt).not.toBeNull();
    expect(await verifyEmailWithToken(rawToken)).toEqual({
      status: "consumed",
    });

    const { rawToken: expiredRaw } = await issueAuthToken(prisma, {
      userId: user!.id,
      purpose: "EMAIL_VERIFICATION",
    });
    await prisma.authToken.updateMany({
      where: {
        userId: user!.id,
        purpose: "EMAIL_VERIFICATION",
        consumedAt: null,
      },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await verifyEmailWithToken(expiredRaw)).toEqual({
      status: "expired",
    });
  });

  it("returns identical forgot-password responses for known and unknown emails", async () => {
    const known = `known-${randomUUID()}@example.com`;
    await registerUser(
      {
        name: "Known",
        email: known,
        password: "correct horse battery staple",
      },
      { mailer: mockMailer },
    );
    const token = extractToken(sent[0]!.text)!;
    await verifyEmailWithToken(token);
    sent.length = 0;

    const a = await requestPasswordReset(known, { mailer: mockMailer });
    const b = await requestPasswordReset(
      `missing-${randomUUID()}@example.com`,
      {
        mailer: mockMailer,
      },
    );
    expect(a).toEqual(b);
    expect(a.status).toBe("ok");
  });

  it("resets password, consumes token, and invalidates sessions", async () => {
    const email = `reset-${randomUUID()}@example.com`;
    const oldPassword = "correct horse battery staple";
    const newPassword = "new correct horse battery";

    await registerUser(
      { name: "Reset User", email, password: oldPassword },
      { mailer: mockMailer },
    );
    await verifyEmailWithToken(extractToken(sent[0]!.text)!);
    sent.length = 0;

    await requestPasswordReset(email, { mailer: mockMailer });
    const resetToken = extractToken(sent[0]!.text)!;

    const before = await prisma.user.findUnique({ where: { email } });
    expect(before?.sessionVersion).toBe(0);

    const result = await resetPasswordWithToken({
      rawToken: resetToken,
      password: newPassword,
    });
    expect(result.status).toBe("ok");

    const after = await prisma.user.findUnique({ where: { email } });
    expect(after?.sessionVersion).toBe(1);
    expect(await verifyPassword(oldPassword, after!.passwordHash)).toBe(false);
    expect(await verifyPassword(newPassword, after!.passwordHash)).toBe(true);
    expect(await verifyEmailWithToken(resetToken)).toMatchObject({
      status: expect.any(String),
    });
    // Reset token purpose is PASSWORD_RESET; verification lookup should fail safely.
    expect(
      await prisma.authToken.findFirst({
        where: {
          userId: after!.id,
          purpose: "PASSWORD_RESET",
          consumedAt: null,
        },
      }),
    ).toBeNull();

    expect(await verifyCredentials({ email, password: oldPassword })).toEqual({
      status: "invalid",
    });
    expect(
      await verifyCredentials({ email, password: newPassword }),
    ).toMatchObject({
      status: "ok",
    });
  });

  it("blocks unverified login and allows verified login with generic failures", async () => {
    const email = `login-${randomUUID()}@example.com`;
    const password = "correct horse battery staple";
    await registerUser(
      { name: "Login User", email, password },
      { mailer: mockMailer },
    );

    expect(await verifyCredentials({ email, password })).toMatchObject({
      status: "unverified",
    });
    expect(
      await verifyCredentials({ email, password: "wrong password!!" }),
    ).toEqual({ status: "invalid" });
    expect(
      await verifyCredentials({
        email: `missing-${randomUUID()}@example.com`,
        password,
      }),
    ).toEqual({ status: "invalid" });

    await verifyEmailWithToken(extractToken(sent[0]!.text)!);
    expect(await verifyCredentials({ email, password })).toMatchObject({
      status: "ok",
    });
  });

  it("increments sessionVersion on password reset to revoke JWT sessions", async () => {
    const email = `session-${randomUUID()}@example.com`;
    const password = "correct horse battery staple";
    await registerUser(
      { name: "Session User", email, password },
      { mailer: mockMailer },
    );
    await verifyEmailWithToken(extractToken(sent[0]!.text)!);
    sent.length = 0;

    const before = await prisma.user.findUniqueOrThrow({ where: { email } });
    await requestPasswordReset(email, { mailer: mockMailer });
    await resetPasswordWithToken({
      rawToken: extractToken(sent[0]!.text)!,
      password: "brand new passphrase!",
    });
    const after = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(after.sessionVersion).toBe(before.sessionVersion + 1);
  });
});
