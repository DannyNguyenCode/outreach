/** Narrow DB surface for rate-limit helpers (keeps unit mocks type-safe). */
export type RateLimitDb = {
  rateLimitBucket: {
    deleteMany: (args: {
      where: { expiresAt: { lt: Date } };
    }) => Promise<{ count: number }>;
    findUnique: (args: { where: { bucketKey: string } }) => Promise<{
      bucketKey: string;
      count: number;
      windowStart: Date;
      expiresAt: Date;
    } | null>;
    upsert: (args: {
      where: { bucketKey: string };
      create: {
        bucketKey: string;
        count: number;
        windowStart: Date;
        expiresAt: Date;
      };
      update: {
        count: number;
        windowStart: Date;
        expiresAt: Date;
      };
    }) => Promise<{
      bucketKey: string;
      count: number;
      windowStart: Date;
      expiresAt: Date;
    }>;
    update: (args: {
      where: { bucketKey: string };
      data: { count: { increment: number } };
    }) => Promise<{
      bucketKey: string;
      count: number;
      windowStart: Date;
      expiresAt: Date;
    }>;
  };
};
