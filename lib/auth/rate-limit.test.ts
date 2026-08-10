import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env/server", () => ({
  getServerEnv: () => ({
    AUTH_SECRET: "dev-only-auth-secret-replace-me-32chars",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/outreach",
    DIRECT_URL: "postgresql://postgres:postgres@127.0.0.1:5432/outreach",
    RESEND_API_KEY: "re_test",
    AUTH_EMAIL_FROM: "Outreach <auth@mail.example.com>",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    NODE_ENV: "test",
  }),
}));

import {
  buildRateLimitBucketKey,
  enforceRateLimit,
  hashEmailForRateLimit,
  resolveClientIp,
} from "@/lib/auth/rate-limit";

type Bucket = {
  bucketKey: string;
  count: number;
  windowStart: Date;
  expiresAt: Date;
};

function createRateLimitDb() {
  const buckets = new Map<string, Bucket>();

  return {
    rateLimitBucket: {
      deleteMany: vi.fn(
        async ({ where }: { where: { expiresAt: { lt: Date } } }) => {
          for (const [key, bucket] of buckets) {
            if (bucket.expiresAt < where.expiresAt.lt) {
              buckets.delete(key);
            }
          }
          return { count: 0 };
        },
      ),
      findUnique: vi.fn(async ({ where }: { where: { bucketKey: string } }) => {
        return buckets.get(where.bucketKey) ?? null;
      }),
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { bucketKey: string };
          create: Bucket;
          update: Partial<Bucket>;
        }) => {
          const existing = buckets.get(where.bucketKey);
          if (!existing) {
            buckets.set(where.bucketKey, { ...create });
            return buckets.get(where.bucketKey)!;
          }
          const next = { ...existing, ...update };
          buckets.set(where.bucketKey, next);
          return next;
        },
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { bucketKey: string };
          data: { count: { increment: number } };
        }) => {
          const existing = buckets.get(where.bucketKey);
          if (!existing) throw new Error("missing");
          existing.count += data.count.increment;
          return existing;
        },
      ),
    },
    _buckets: buckets,
  };
}

describe("rate limiting", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("allows requests below the limit and rejects above it", async () => {
    const db = createRateLimitDb();
    const bucketKey = buildRateLimitBucketKey({
      route: "login",
      emailNormalized: "user@example.com",
      ip: { kind: "ip", value: "203.0.113.10" },
    });

    for (let i = 0; i < 10; i += 1) {
      const decision = await enforceRateLimit(db, {
        route: "login",
        bucketKey,
      });
      expect(decision.ok).toBe(true);
    }

    const blocked = await enforceRateLimit(db, {
      route: "login",
      bucketKey,
    });
    expect(blocked.ok).toBe(false);
  });

  it("expires windows correctly", async () => {
    vi.useFakeTimers();
    const db = createRateLimitDb();
    const now = new Date("2026-01-01T00:00:00.000Z");
    vi.setSystemTime(now);

    const bucketKey = buildRateLimitBucketKey({
      route: "register",
      emailNormalized: "user@example.com",
      ip: { kind: "ip", value: "203.0.113.10" },
    });

    for (let i = 0; i < 5; i += 1) {
      await enforceRateLimit(db, { route: "register", bucketKey, now });
    }
    expect(
      (await enforceRateLimit(db, { route: "register", bucketKey, now })).ok,
    ).toBe(false);

    const later = new Date(now.getTime() + 16 * 60 * 1000);
    vi.setSystemTime(later);
    expect(
      (await enforceRateLimit(db, { route: "register", bucketKey, now: later }))
        .ok,
    ).toBe(true);
  });

  it("does not put raw email in rate-limit keys", () => {
    const key = buildRateLimitBucketKey({
      route: "login",
      emailNormalized: "sensitive@example.com",
      ip: { kind: "ip", value: "198.51.100.2" },
    });
    expect(key).not.toContain("sensitive@example.com");
    expect(key).not.toContain("198.51.100.2");
    expect(hashEmailForRateLimit("sensitive@example.com")).not.toBe(
      "sensitive@example.com",
    );
  });

  it("does not create a shared unknown IP bucket", () => {
    const a = buildRateLimitBucketKey({
      route: "forgot-password",
      emailNormalized: "one@example.com",
      ip: { kind: "missing" },
      missingIpSalt: "one@example.com",
    });
    const b = buildRateLimitBucketKey({
      route: "forgot-password",
      emailNormalized: "two@example.com",
      ip: { kind: "missing" },
      missingIpSalt: "two@example.com",
    });
    expect(a).not.toBe(b);
  });

  it("keeps different identities in different buckets", () => {
    const a = buildRateLimitBucketKey({
      route: "login",
      emailNormalized: "a@example.com",
      ip: { kind: "ip", value: "203.0.113.1" },
    });
    const b = buildRateLimitBucketKey({
      route: "login",
      emailNormalized: "b@example.com",
      ip: { kind: "ip", value: "203.0.113.1" },
    });
    expect(a).not.toBe(b);
  });

  it("resolves IP from trusted proxy headers only when configured", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.50, 10.0.0.1",
    });
    expect(resolveClientIp(headers, true)).toEqual({
      kind: "ip",
      value: "203.0.113.50",
    });
    expect(resolveClientIp(headers, false)).toEqual({ kind: "missing" });
  });
});
