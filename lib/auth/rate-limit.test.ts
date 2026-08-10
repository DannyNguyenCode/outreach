import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env/server", () => ({
  getServerEnv: () => ({
    AUTH_SECRET: "dev-only-auth-secret-replace-me-32chars",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/outreach",
    DIRECT_URL: "postgresql://postgres:postgres@127.0.0.1:5432/outreach",
    RESEND_API_KEY: "re_test_fake_key",
    AUTH_EMAIL_FROM: "Outreach <auth@mail.example.com>",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    AUTH_EMAIL_DELIVERY: "resend",
    EMAIL_PROVIDER_TIMEOUT_MS: 10_000,
    NODE_ENV: "test",
  }),
}));

import {
  buildRateLimitBucketKey,
  hashEmailForRateLimit,
  resolveClientIp,
} from "@/lib/auth/rate-limit";

describe("rate limiting key helpers", () => {
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
