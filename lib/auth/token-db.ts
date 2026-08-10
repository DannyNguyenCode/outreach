import type { AuthTokenPurpose } from "@prisma/client";

/** Narrow DB surface for token helpers (keeps unit mocks type-safe). */
export type AuthTokenDb = {
  authToken: {
    updateMany: (args: {
      where: {
        userId?: string;
        purpose?: AuthTokenPurpose;
        consumedAt?: null;
        id?: string;
        expiresAt?: { gt: Date };
      };
      data: { consumedAt: Date };
    }) => Promise<{ count: number }>;
    create: (args: {
      data: {
        userId: string;
        purpose: AuthTokenPurpose;
        tokenHash: string;
        expiresAt: Date;
      };
    }) => Promise<unknown>;
    findUnique: (args: {
      where: {
        purpose_tokenHash: {
          purpose: AuthTokenPurpose;
          tokenHash: string;
        };
      };
      select: {
        id: true;
        userId: true;
        purpose: true;
        expiresAt: true;
        consumedAt: true;
        tokenHash: true;
      };
    }) => Promise<{
      id: string;
      userId: string;
      purpose: AuthTokenPurpose;
      expiresAt: Date;
      consumedAt: Date | null;
      tokenHash: string;
    } | null>;
  };
};
