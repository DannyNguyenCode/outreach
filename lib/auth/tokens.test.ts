import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  findAuthToken,
  generateRawToken,
  hashToken,
  issueAuthToken,
  tokensEqual,
} from "@/lib/auth/tokens";

type TokenRecord = {
  id: string;
  userId: string;
  purpose: "EMAIL_VERIFICATION" | "PASSWORD_RESET";
  tokenHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
};

function createTokenDb() {
  const tokens: TokenRecord[] = [];

  return {
    authToken: {
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: {
            userId?: string;
            purpose?: string;
            consumedAt?: null;
            id?: string;
            expiresAt?: { gt: Date };
          };
          data: { consumedAt: Date };
        }) => {
          let count = 0;
          for (const token of tokens) {
            if (where.userId && token.userId !== where.userId) continue;
            if (where.purpose && token.purpose !== where.purpose) continue;
            if (where.consumedAt === null && token.consumedAt !== null)
              continue;
            if (where.id && token.id !== where.id) continue;
            if (where.expiresAt?.gt && token.expiresAt <= where.expiresAt.gt) {
              continue;
            }
            token.consumedAt = data.consumedAt;
            count += 1;
          }
          return { count };
        },
      ),
      create: vi.fn(
        async ({
          data,
        }: {
          data: Omit<TokenRecord, "id" | "consumedAt"> & {
            consumedAt?: Date | null;
          };
        }) => {
          const record: TokenRecord = {
            id: `tok_${tokens.length + 1}`,
            userId: data.userId,
            purpose: data.purpose,
            tokenHash: data.tokenHash,
            expiresAt: data.expiresAt,
            consumedAt: data.consumedAt ?? null,
          };
          tokens.push(record);
          return record;
        },
      ),
      findUnique: vi.fn(
        async ({
          where,
        }: {
          where: {
            purpose_tokenHash: {
              purpose: TokenRecord["purpose"];
              tokenHash: string;
            };
          };
        }) => {
          return (
            tokens.find(
              (token) =>
                token.purpose === where.purpose_tokenHash.purpose &&
                token.tokenHash === where.purpose_tokenHash.tokenHash,
            ) ?? null
          );
        },
      ),
    },
    _tokens: tokens,
  };
}

describe("token utilities", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("generates high-entropy raw tokens", () => {
    const a = generateRawToken();
    const b = generateRawToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(40);
  });

  it("stores a hash rather than the raw token", async () => {
    const db = createTokenDb();
    const { rawToken } = await issueAuthToken(db, {
      userId: "user_1",
      purpose: "EMAIL_VERIFICATION",
    });
    expect(db._tokens[0]?.tokenHash).toBe(hashToken(rawToken));
    expect(db._tokens[0]?.tokenHash).not.toBe(rawToken);
  });

  it("verifies a correct token and rejects incorrect ones", async () => {
    const db = createTokenDb();
    const { rawToken } = await issueAuthToken(db, {
      userId: "user_1",
      purpose: "EMAIL_VERIFICATION",
    });

    const ok = await findAuthToken(db, {
      rawToken,
      purpose: "EMAIL_VERIFICATION",
    });
    expect(ok.ok).toBe(true);

    const bad = await findAuthToken(db, {
      rawToken: "definitely-not-the-token",
      purpose: "EMAIL_VERIFICATION",
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toBe("invalid");
  });

  it("rejects expired tokens", async () => {
    vi.useFakeTimers();
    const db = createTokenDb();
    const { rawToken } = await issueAuthToken(db, {
      userId: "user_1",
      purpose: "PASSWORD_RESET",
    });
    vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000);

    const result = await findAuthToken(db, {
      rawToken,
      purpose: "PASSWORD_RESET",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("expired");
  });

  it("rejects consumed tokens", async () => {
    const db = createTokenDb();
    const { rawToken } = await issueAuthToken(db, {
      userId: "user_1",
      purpose: "EMAIL_VERIFICATION",
    });
    db._tokens[0]!.consumedAt = new Date();

    const result = await findAuthToken(db, {
      rawToken,
      purpose: "EMAIL_VERIFICATION",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("consumed");
  });

  it("rejects purpose mismatches", async () => {
    const db = createTokenDb();
    const { rawToken } = await issueAuthToken(db, {
      userId: "user_1",
      purpose: "EMAIL_VERIFICATION",
    });

    const result = await findAuthToken(db, {
      rawToken,
      purpose: "PASSWORD_RESET",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid");
  });

  it("compares token hashes safely", () => {
    const hash = hashToken("abc");
    expect(tokensEqual(hash, hash)).toBe(true);
    expect(tokensEqual(hash, hashToken("xyz"))).toBe(false);
  });
});
