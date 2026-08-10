import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  getSessionVersion,
  isSessionVersionCurrent,
  resetPasswordWithToken,
  verifyCredentials,
  verifyEmailWithToken,
} from "@/lib/auth/account-service";
import { hashPassword } from "@/lib/auth/password";
import { issueAuthToken } from "@/lib/auth/tokens";
import { setMailerForTests, type EmailSender } from "@/lib/email/mailer";
import { resetServerEnvCache } from "@/lib/env/server";

const mockMailer: EmailSender = {
  async send() {
    /* no-op */
  },
};

describe("verification token GET safety and session revocation", () => {
  const prisma = new PrismaClient();

  beforeAll(async () => {
    resetServerEnvCache();
    setMailerForTests(mockMailer);
    await prisma.$connect();
  });

  beforeEach(async () => {
    await prisma.authToken.deleteMany();
    await prisma.user.deleteMany({
      where: { email: { startsWith: "harden-" } },
    });
  });

  afterAll(async () => {
    setMailerForTests(undefined);
    await prisma.$disconnect();
  });

  it("repeated lookup-only access does not verify or consume the token", async () => {
    const email = `harden-get-${randomUUID()}@example.com`;
    const user = await prisma.user.create({
      data: {
        name: "Get Safe",
        email,
        passwordHash: await hashPassword("correct horse battery staple"),
      },
    });
    const { rawToken } = await issueAuthToken(prisma, {
      userId: user.id,
      purpose: "EMAIL_VERIFICATION",
    });

    // Simulate scanner GETs that only inspect token shape / presence via lookup.
    for (let i = 0; i < 5; i += 1) {
      const found = await prisma.authToken.findFirst({
        where: {
          userId: user.id,
          purpose: "EMAIL_VERIFICATION",
          consumedAt: null,
        },
      });
      expect(found).not.toBeNull();
    }

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(after.emailVerifiedAt).toBeNull();
    const active = await prisma.authToken.count({
      where: {
        userId: user.id,
        purpose: "EMAIL_VERIFICATION",
        consumedAt: null,
      },
    });
    expect(active).toBe(1);

    // Intentional confirmation still works once.
    expect(await verifyEmailWithToken(rawToken)).toEqual({
      status: "verified",
    });
    expect(await verifyEmailWithToken(rawToken)).toEqual({
      status: "consumed",
    });
  });

  it("password reset increments sessionVersion and rejects stale session versions", async () => {
    const email = `harden-session-${randomUUID()}@example.com`;
    const oldPassword = "correct horse battery staple";
    const newPassword = "brand new passphrase!!";

    const user = await prisma.user.create({
      data: {
        name: "Session User",
        email,
        passwordHash: await hashPassword(oldPassword),
        emailVerifiedAt: new Date(),
        sessionVersion: 0,
      },
    });

    expect(
      await verifyCredentials({ email, password: oldPassword }),
    ).toMatchObject({
      status: "ok",
    });
    expect(await isSessionVersionCurrent(user.id, 0)).toBe(true);
    expect(await getSessionVersion(user.id)).toBe(0);

    const { rawToken } = await issueAuthToken(prisma, {
      userId: user.id,
      purpose: "PASSWORD_RESET",
    });
    expect(
      await resetPasswordWithToken({ rawToken, password: newPassword }),
    ).toEqual({ status: "ok" });

    expect(await getSessionVersion(user.id)).toBe(1);
    // Stale JWT carrying sessionVersion 0 must fail the server-side check.
    expect(await isSessionVersionCurrent(user.id, 0)).toBe(false);
    expect(await isSessionVersionCurrent(user.id, 1)).toBe(true);

    expect(await verifyCredentials({ email, password: oldPassword })).toEqual({
      status: "invalid",
    });
    expect(
      await verifyCredentials({ email, password: newPassword }),
    ).toMatchObject({
      status: "ok",
      user: { sessionVersion: 1 },
    });
  });
});
