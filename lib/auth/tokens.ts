import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import type { AuthTokenPurpose } from "@prisma/client";

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

/**
 * Issue a one-time token. Invalidates older unconsumed tokens of the same
 * purpose for the user. Returns the raw token for email delivery only.
 */
export async function issueAuthToken(
  db: AuthTokenDb,
  input: {
    userId: string;
    purpose: AuthTokenPurpose;
  },
): Promise<{ rawToken: string; expiresAt: Date }> {
  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + ttlForPurpose(input.purpose));

  await db.authToken.updateMany({
    where: {
      userId: input.userId,
      purpose: input.purpose,
      consumedAt: null,
    },
    data: {
      consumedAt: new Date(),
    },
  });

  await db.authToken.create({
    data: {
      userId: input.userId,
      purpose: input.purpose,
      tokenHash,
      expiresAt,
    },
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
