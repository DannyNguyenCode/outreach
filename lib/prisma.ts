import "server-only";

import { PrismaClient } from "@prisma/client";

import { getServerEnv } from "@/lib/env/server";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  // Ensure required database env vars are present before connecting.
  getServerEnv();

  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

/**
 * Shared Prisma client for server-only use.
 * Reuses a single instance during Next.js development hot reloads.
 */
export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
