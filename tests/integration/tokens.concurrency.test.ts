import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { hashPassword } from "@/lib/auth/password";
import { findAuthToken, hashToken, issueAuthToken } from "@/lib/auth/tokens";
import { resetServerEnvCache } from "@/lib/env/server";

describe("token issuance concurrency (postgres)", () => {
  const prisma = new PrismaClient();

  beforeAll(async () => {
    resetServerEnvCache();
    await prisma.$connect();
  });

  beforeEach(async () => {
    await prisma.authToken.deleteMany();
    await prisma.user.deleteMany({
      where: { email: { startsWith: "token-conc-" } },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createUser(prefix: string) {
    return prisma.user.create({
      data: {
        name: "Token User",
        email: `${prefix}-${randomUUID()}@example.com`,
        passwordHash: await hashPassword("correct horse battery staple"),
      },
    });
  }

  it("successful replacement invalidates the previous token", async () => {
    const user = await createUser("token-conc");
    const first = await issueAuthToken(prisma, {
      userId: user.id,
      purpose: "EMAIL_VERIFICATION",
    });
    const second = await issueAuthToken(prisma, {
      userId: user.id,
      purpose: "EMAIL_VERIFICATION",
    });

    expect(
      (
        await findAuthToken(prisma, {
          rawToken: first.rawToken,
          purpose: "EMAIL_VERIFICATION",
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await findAuthToken(prisma, {
          rawToken: second.rawToken,
          purpose: "EMAIL_VERIFICATION",
        })
      ).ok,
    ).toBe(true);

    const active = await prisma.authToken.count({
      where: {
        userId: user.id,
        purpose: "EMAIL_VERIFICATION",
        consumedAt: null,
      },
    });
    expect(active).toBe(1);
    expect(
      await prisma.authToken.findFirst({
        where: { tokenHash: hashToken(second.rawToken) },
      }),
    ).not.toBeNull();
    expect(
      await prisma.authToken.findFirst({
        where: { tokenHash: second.rawToken },
      }),
    ).toBeNull();
  });

  it("rolls back invalidation when replacement creation fails", async () => {
    const user = await createUser("token-conc");
    const first = await issueAuthToken(prisma, {
      userId: user.id,
      purpose: "PASSWORD_RESET",
    });

    await expect(
      issueAuthToken(
        prisma,
        { userId: user.id, purpose: "PASSWORD_RESET" },
        {
          testBeforeCreate: async () => {
            throw new Error("forced create failure");
          },
        },
      ),
    ).rejects.toThrow(/forced create failure/);

    expect(
      (
        await findAuthToken(prisma, {
          rawToken: first.rawToken,
          purpose: "PASSWORD_RESET",
        })
      ).ok,
    ).toBe(true);

    const active = await prisma.authToken.count({
      where: { userId: user.id, purpose: "PASSWORD_RESET", consumedAt: null },
    });
    expect(active).toBe(1);
  });

  it("concurrent issuance leaves at most one usable active token", async () => {
    const user = await createUser("token-conc");
    const issued = await Promise.all(
      Array.from({ length: 12 }, () =>
        issueAuthToken(prisma, {
          userId: user.id,
          purpose: "EMAIL_VERIFICATION",
        }),
      ),
    );

    const active = await prisma.authToken.findMany({
      where: {
        userId: user.id,
        purpose: "EMAIL_VERIFICATION",
        consumedAt: null,
      },
    });
    expect(active).toHaveLength(1);

    const usable = [];
    for (const token of issued) {
      const found = await findAuthToken(prisma, {
        rawToken: token.rawToken,
        purpose: "EMAIL_VERIFICATION",
      });
      if (found.ok) usable.push(token.rawToken);
    }
    expect(usable).toHaveLength(1);
    expect(hashToken(usable[0]!)).toBe(active[0]!.tokenHash);
  });

  it("different purposes and users do not interfere", async () => {
    const userA = await createUser("token-conc");
    const userB = await createUser("token-conc");

    const verify = await issueAuthToken(prisma, {
      userId: userA.id,
      purpose: "EMAIL_VERIFICATION",
    });
    const reset = await issueAuthToken(prisma, {
      userId: userA.id,
      purpose: "PASSWORD_RESET",
    });
    const other = await issueAuthToken(prisma, {
      userId: userB.id,
      purpose: "EMAIL_VERIFICATION",
    });

    await issueAuthToken(prisma, {
      userId: userA.id,
      purpose: "EMAIL_VERIFICATION",
    });

    expect(
      (
        await findAuthToken(prisma, {
          rawToken: verify.rawToken,
          purpose: "EMAIL_VERIFICATION",
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await findAuthToken(prisma, {
          rawToken: reset.rawToken,
          purpose: "PASSWORD_RESET",
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await findAuthToken(prisma, {
          rawToken: other.rawToken,
          purpose: "EMAIL_VERIFICATION",
        })
      ).ok,
    ).toBe(true);
  });
});
