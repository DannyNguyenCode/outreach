import "server-only";

import { createHmac } from "node:crypto";

import type { RateLimitDb } from "@/lib/auth/rate-limit-db";
import { getServerEnv } from "@/lib/env/server";

/**
 * Database-backed rate limiter for serverless runtimes.
 *
 * Limitations (Phase 1):
 * - Uses Postgres row upserts; under extreme concurrency a window may allow a
 *   few extra requests past the limit (acceptable for auth abuse mitigation).
 * - Expired rows are cleaned opportunistically on write, not by a background job.
 * - If the database is unavailable, requests fail closed (denied).
 *
 * Keys never contain raw email or IP. Sensitive identifiers are HMAC'd with AUTH_SECRET.
 */

export type RateLimitRoute =
  | "register"
  | "login"
  | "resend-verification"
  | "forgot-password"
  | "reset-password";

export type RateLimitDecision =
  | { ok: true; remaining: number; resetAt: Date }
  | { ok: false; retryAfterSeconds: number; resetAt: Date };

export type ClientIpResult =
  { kind: "ip"; value: string } | { kind: "missing" };

type RateLimitConfig = {
  limit: number;
  windowMs: number;
};

const ROUTE_LIMITS: Record<RateLimitRoute, RateLimitConfig> = {
  register: { limit: 5, windowMs: 15 * 60 * 1000 },
  login: { limit: 10, windowMs: 15 * 60 * 1000 },
  "resend-verification": { limit: 5, windowMs: 15 * 60 * 1000 },
  "forgot-password": { limit: 5, windowMs: 15 * 60 * 1000 },
  "reset-password": { limit: 10, windowMs: 15 * 60 * 1000 },
};

function hmacIdentifier(value: string): string {
  const { AUTH_SECRET } = getServerEnv();
  return createHmac("sha256", AUTH_SECRET).update(value).digest("hex");
}

/**
 * Resolve a client IP without collapsing missing headers into one shared bucket.
 * Prefer the platform-provided value when present; otherwise isolate by a
 * per-request ephemeral identity derived from route + timestamp entropy is
 * NOT used — instead we require an explicit fallbackIdentity (e.g. email hash).
 */
export function resolveClientIp(
  headers: Headers,
  trustedProxy: boolean,
): ClientIpResult {
  if (trustedProxy) {
    const forwarded = headers.get("x-forwarded-for");
    if (forwarded) {
      const first = forwarded.split(",")[0]?.trim();
      if (first) {
        return { kind: "ip", value: first };
      }
    }
    const realIp = headers.get("x-real-ip")?.trim();
    if (realIp) {
      return { kind: "ip", value: realIp };
    }
  }

  // Next.js may expose connection remote address in some runtimes via headers
  // that are not spoofable the same way; without a trusted proxy we do not
  // invent a shared "unknown" bucket.
  return { kind: "missing" };
}

export function buildRateLimitBucketKey(input: {
  route: RateLimitRoute;
  emailNormalized?: string | null;
  ip: ClientIpResult;
  /**
   * When IP is missing, a secondary signal is required so requests do not share
   * a global bucket. Prefer a normalized-email HMAC. If neither IP nor email is
   * available, callers must fail closed before calling enforceRateLimit.
   */
  missingIpSalt?: string;
}): string {
  const parts: string[] = [`route:${input.route}`];

  if (input.emailNormalized) {
    parts.push(`email:${hmacIdentifier(input.emailNormalized)}`);
  }

  if (input.ip.kind === "ip") {
    parts.push(`ip:${hmacIdentifier(input.ip.value)}`);
  } else {
    if (!input.missingIpSalt) {
      throw new Error(
        "Rate limit requires email or missingIpSalt when IP is unavailable.",
      );
    }
    parts.push(`noip:${hmacIdentifier(input.missingIpSalt)}`);
  }

  return createHmac("sha256", getServerEnv().AUTH_SECRET)
    .update(parts.join("|"))
    .digest("hex");
}

export async function enforceRateLimit(
  db: RateLimitDb,
  input: {
    route: RateLimitRoute;
    bucketKey: string;
    now?: Date;
  },
): Promise<RateLimitDecision> {
  const config = ROUTE_LIMITS[input.route];
  const now = input.now ?? new Date();

  try {
    // Opportunistic cleanup of expired buckets (best-effort).
    await db.rateLimitBucket.deleteMany({
      where: { expiresAt: { lt: now } },
    });

    const existing = await db.rateLimitBucket.findUnique({
      where: { bucketKey: input.bucketKey },
    });

    if (!existing || existing.expiresAt.getTime() <= now.getTime()) {
      const expiresAt = new Date(now.getTime() + config.windowMs);
      await db.rateLimitBucket.upsert({
        where: { bucketKey: input.bucketKey },
        create: {
          bucketKey: input.bucketKey,
          count: 1,
          windowStart: now,
          expiresAt,
        },
        update: {
          count: 1,
          windowStart: now,
          expiresAt,
        },
      });
      return {
        ok: true,
        remaining: config.limit - 1,
        resetAt: expiresAt,
      };
    }

    if (existing.count >= config.limit) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((existing.expiresAt.getTime() - now.getTime()) / 1000),
      );
      return {
        ok: false,
        retryAfterSeconds,
        resetAt: existing.expiresAt,
      };
    }

    const updated = await db.rateLimitBucket.update({
      where: { bucketKey: input.bucketKey },
      data: { count: { increment: 1 } },
    });

    return {
      ok: true,
      remaining: Math.max(0, config.limit - updated.count),
      resetAt: updated.expiresAt,
    };
  } catch (error) {
    // Fail closed when the rate-limit backend is unavailable.
    console.error(
      JSON.stringify({
        event: "rate_limit.backend_unavailable",
        route: input.route,
        message: error instanceof Error ? error.message : "unknown",
      }),
    );
    return {
      ok: false,
      retryAfterSeconds: 60,
      resetAt: new Date(now.getTime() + 60_000),
    };
  }
}

/** Test helper: expose HMAC without raw email for assertions. */
export function hashEmailForRateLimit(emailNormalized: string): string {
  return hmacIdentifier(emailNormalized);
}
