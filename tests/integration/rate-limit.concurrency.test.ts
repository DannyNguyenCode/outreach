import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  buildRateLimitBucketKey,
  enforceRateLimit,
  ROUTE_LIMITS,
} from "@/lib/auth/rate-limit";
import { resetServerEnvCache } from "@/lib/env/server";

describe("rate limit concurrency (postgres)", () => {
  const prisma = new PrismaClient();

  beforeAll(async () => {
    resetServerEnvCache();
    await prisma.$connect();
  });

  beforeEach(async () => {
    await prisma.rateLimitBucket.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("admits exactly the configured limit under concurrent pressure", async () => {
    const limit = ROUTE_LIMITS.register.limit;
    const bucketKey = buildRateLimitBucketKey({
      route: "register",
      emailNormalized: `concurrent-${randomUUID()}@example.com`,
      ip: { kind: "ip", value: "203.0.113.10" },
    });

    const attempts = limit + 8;
    const results = await Promise.all(
      Array.from({ length: attempts }, () =>
        enforceRateLimit(prisma, { route: "register", bucketKey }),
      ),
    );

    const allowed = results.filter((result) => result.ok);
    const denied = results.filter((result) => !result.ok);
    expect(allowed).toHaveLength(limit);
    expect(denied).toHaveLength(attempts - limit);

    const stored = await prisma.rateLimitBucket.findUniqueOrThrow({
      where: { bucketKey },
    });
    expect(stored.count).toBe(limit);
  });

  it("handles concurrent first inserts for a missing bucket", async () => {
    const limit = ROUTE_LIMITS.login.limit;
    const bucketKey = buildRateLimitBucketKey({
      route: "login",
      emailNormalized: `missing-${randomUUID()}@example.com`,
      ip: { kind: "ip", value: "198.51.100.20" },
    });

    expect(
      await prisma.rateLimitBucket.findUnique({ where: { bucketKey } }),
    ).toBeNull();

    const results = await Promise.all(
      Array.from({ length: limit + 5 }, () =>
        enforceRateLimit(prisma, { route: "login", bucketKey }),
      ),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(limit);
    const stored = await prisma.rateLimitBucket.findUniqueOrThrow({
      where: { bucketKey },
    });
    expect(stored.count).toBe(limit);
  });

  it("keeps different identities in separate buckets", async () => {
    const a = buildRateLimitBucketKey({
      route: "login",
      emailNormalized: `a-${randomUUID()}@example.com`,
      ip: { kind: "ip", value: "203.0.113.1" },
    });
    const b = buildRateLimitBucketKey({
      route: "login",
      emailNormalized: `b-${randomUUID()}@example.com`,
      ip: { kind: "ip", value: "203.0.113.1" },
    });
    expect(a).not.toBe(b);

    await Promise.all([
      enforceRateLimit(prisma, { route: "login", bucketKey: a }),
      enforceRateLimit(prisma, { route: "login", bucketKey: b }),
    ]);

    expect(
      (
        await prisma.rateLimitBucket.findUniqueOrThrow({
          where: { bucketKey: a },
        })
      ).count,
    ).toBe(1);
    expect(
      (
        await prisma.rateLimitBucket.findUniqueOrThrow({
          where: { bucketKey: b },
        })
      ).count,
    ).toBe(1);
  });

  it("does not place missing-IP users into one global fallback bucket", async () => {
    const one = buildRateLimitBucketKey({
      route: "forgot-password",
      emailNormalized: `one-${randomUUID()}@example.com`,
      ip: { kind: "missing" },
      missingIpSalt: "one@example.com",
    });
    const two = buildRateLimitBucketKey({
      route: "forgot-password",
      emailNormalized: `two-${randomUUID()}@example.com`,
      ip: { kind: "missing" },
      missingIpSalt: "two@example.com",
    });
    expect(one).not.toBe(two);
    expect(one).not.toContain("unknown");
    expect(two).not.toContain("unknown");
  });
});
