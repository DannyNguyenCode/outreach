import "server-only";

import { createHmac, randomBytes } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { getServerEnv } from "@/lib/env/server";

/**
 * Database-backed rate limiter for serverless runtimes.
 *
 * Concurrency safety:
 * Each bucket key is serialized with `pg_advisory_xact_lock(hashtext(bucketKey))`
 * inside a Prisma interactive transaction. Concurrent requests for the same key
 * queue; only one read-modify-write runs at a time. The permit decision uses the
 * count observed under that lock, so stale pre-update reads cannot over-admit.
 * Different bucket keys hash to different locks and do not block each other.
 *
 * Backend-unavailable policy: fail closed (deny the request).
 *
 * Limitations:
 * - Expired rows are cleaned opportunistically on write, not by a background job.
 * - Advisory locks are per-database session/transaction (correct for Postgres).
 *
 * Keys never contain raw email or IP. Sensitive identifiers are HMAC'd with AUTH_SECRET.
 */

export type RateLimitRoute =
  | "register"
  | "login"
  | "resend-verification"
  | "forgot-password"
  | "reset-password"
  | "invite-member"
  | "accept-invitation"
  | "create-organization"
  | "business-profile-update"
  | "onboarding-complete"
  | "catalogue-create";

export type RateLimitDecision =
  | { ok: true; remaining: number; resetAt: Date }
  | { ok: false; retryAfterSeconds: number; resetAt: Date };

export type ClientIpResult =
  { kind: "ip"; value: string } | { kind: "missing" };

type RateLimitConfig = {
  limit: number;
  windowMs: number;
};

export const ROUTE_LIMITS: Record<RateLimitRoute, RateLimitConfig> = {
  register: { limit: 5, windowMs: 15 * 60 * 1000 },
  login: { limit: 10, windowMs: 15 * 60 * 1000 },
  "resend-verification": { limit: 5, windowMs: 15 * 60 * 1000 },
  "forgot-password": { limit: 5, windowMs: 15 * 60 * 1000 },
  "reset-password": { limit: 10, windowMs: 15 * 60 * 1000 },
  "invite-member": { limit: 20, windowMs: 15 * 60 * 1000 },
  "accept-invitation": { limit: 10, windowMs: 15 * 60 * 1000 },
  "create-organization": { limit: 10, windowMs: 15 * 60 * 1000 },
  "business-profile-update": { limit: 40, windowMs: 15 * 60 * 1000 },
  "onboarding-complete": { limit: 20, windowMs: 15 * 60 * 1000 },
  "catalogue-create": { limit: 60, windowMs: 15 * 60 * 1000 },
};

function hmacIdentifier(value: string): string {
  const { AUTH_SECRET } = getServerEnv();
  return createHmac("sha256", AUTH_SECRET).update(value).digest("hex");
}

/**
 * Resolve a client IP without collapsing missing headers into one shared bucket.
 * Prefer platform-provided values only when the deployment trusts the proxy
 * (production / AUTH_TRUST_HOST), matching Vercel-style forwarded headers.
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

  return { kind: "missing" };
}

export function buildRateLimitBucketKey(input: {
  route: RateLimitRoute;
  emailNormalized?: string | null;
  ip: ClientIpResult;
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

function newBucketId(): string {
  return `rl_${randomBytes(12).toString("hex")}`;
}

export async function enforceRateLimit(
  db: PrismaClient,
  input: {
    route: RateLimitRoute;
    bucketKey: string;
    now?: Date;
  },
): Promise<RateLimitDecision> {
  const config = ROUTE_LIMITS[input.route];
  const now = input.now ?? new Date();

  try {
    // Best-effort cleanup outside the per-bucket lock.
    await db.rateLimitBucket.deleteMany({
      where: { expiresAt: { lt: now } },
    });

    return await db.$transaction(async (tx) => {
      // Serialize all mutations for this bucket key for the duration of the tx.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.bucketKey}))`;

      const existing = await tx.rateLimitBucket.findUnique({
        where: { bucketKey: input.bucketKey },
      });

      if (!existing || existing.expiresAt.getTime() <= now.getTime()) {
        const expiresAt = new Date(now.getTime() + config.windowMs);
        if (!existing) {
          await tx.rateLimitBucket.create({
            data: {
              id: newBucketId(),
              bucketKey: input.bucketKey,
              count: 1,
              windowStart: now,
              expiresAt,
            },
          });
        } else {
          await tx.rateLimitBucket.update({
            where: { bucketKey: input.bucketKey },
            data: {
              count: 1,
              windowStart: now,
              expiresAt,
            },
          });
        }
        return {
          ok: true as const,
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
          ok: false as const,
          retryAfterSeconds,
          resetAt: existing.expiresAt,
        };
      }

      const updated = await tx.rateLimitBucket.update({
        where: { bucketKey: input.bucketKey },
        data: { count: { increment: 1 } },
      });

      return {
        ok: true as const,
        remaining: Math.max(0, config.limit - updated.count),
        resetAt: updated.expiresAt,
      };
    });
  } catch (error) {
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
