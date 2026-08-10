import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import type { AuthTokenPurpose, PrismaClient } from "@prisma/client";

import type { AuthTokenDb } from "@/lib/auth/token-db";

/** Email verification links expire after 24 hours. */
export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
/** Password reset links expire after 1 hour. */
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

const TOKEN_BYTES = 32;

export function generateRawToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

export function tokensEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

export function ttlForPurpose(purpose: AuthTokenPurpose): number {
  return purpose === "EMAIL_VERIFICATION"
    ? EMAIL_VERIFICATION_TTL_MS
    : PASSWORD_RESET_TTL_MS;
}

function advisoryLockKey(userId: string, purpose: AuthTokenPurpose): string {
  return `auth-token:${userId}:${purpose}`;
}

export type IssueAuthTokenOptions = {
  /**
   * Test-only hook invoked after active tokens are invalidated and before the
   * replacement row is created. Throwing here must roll back invalidation.
   */
  testBeforeCreate?: () => Promise<void>;
};

/**
 * Issue a one-time token atomically for a user+purpose.
 *
 * Concurrency strategy:
 * - `pg_advisory_xact_lock(hashtext(userId:purpose))` serializes issuers for
 *   the same user and purpose inside a single transaction.
 * - Within that lock, active tokens are invalidated and the replacement is
 *   created. If creation fails, the transaction rolls back so prior tokens
 *   remain usable.
 * - A partial unique index (`AuthToken_userId_purpose_active_key`) enforces at
 *   most one unconsumed token per user+purpose as defense in depth.
 *
 * Returns the raw token for email delivery only — never stored or logged.
 */
export async function issueAuthToken(
  db: PrismaClient,
  input: {
    userId: string;
    purpose: AuthTokenPurpose;
  },
  options: IssueAuthTokenOptions = {},
): Promise<{ rawToken: string; expiresAt: Date }> {
  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + ttlForPurpose(input.purpose));
  const lockKey = advisoryLockKey(input.userId, input.purpose);

  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

    await tx.authToken.updateMany({
      where: {
        userId: input.userId,
        purpose: input.purpose,
        consumedAt: null,
      },
      data: {
        consumedAt: new Date(),
      },
    });

    if (options.testBeforeCreate) {
      await options.testBeforeCreate();
    }

    await tx.authToken.create({
      data: {
        userId: input.userId,
        purpose: input.purpose,
        tokenHash,
        expiresAt,
      },
    });
  });

  return { rawToken, expiresAt };
}

export type ConsumeTokenResult =
  | { ok: true; userId: string; tokenId: string }
  | {
      ok: false;
      reason: "invalid" | "expired" | "consumed" | "purpose_mismatch";
    };

/**
 * Look up a token by raw value. Does not consume it.
 */
export async function findAuthToken(
  db: AuthTokenDb,
  input: {
    rawToken: string;
    purpose: AuthTokenPurpose;
  },
): Promise<ConsumeTokenResult & { expiresAt?: Date }> {
  if (!input.rawToken || input.rawToken.length > 256) {
    return { ok: false, reason: "invalid" };
  }

  const tokenHash = hashToken(input.rawToken);
  const record = await db.authToken.findUnique({
    where: {
      purpose_tokenHash: {
        purpose: input.purpose,
        tokenHash,
      },
    },
    select: {
      id: true,
      userId: true,
      purpose: true,
      expiresAt: true,
      consumedAt: true,
      tokenHash: true,
    },
  });

  if (!record || !tokensEqual(record.tokenHash, tokenHash)) {
    return { ok: false, reason: "invalid" };
  }
  if (record.purpose !== input.purpose) {
    return { ok: false, reason: "purpose_mismatch" };
  }
  if (record.consumedAt) {
    return { ok: false, reason: "consumed" };
  }
  if (record.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: "expired" };
  }

  return {
    ok: true,
    userId: record.userId,
    tokenId: record.id,
    expiresAt: record.expiresAt,
  };
}
