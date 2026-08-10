/**
 * Optional local/test seed helpers for Phase 1 authentication.
 *
 * Prisma seeding is configured via package.json `prisma.seed`.
 * This script only inserts fake development users when explicitly run.
 *
 * Usage (against an isolated local/test database — never production):
 *   npx tsx prisma/seed.ts
 *
 * Environment:
 *   SEED_VERIFIED_EMAIL (default: verified@example.com)
 *   SEED_VERIFIED_PASSWORD (default: CorrectHorseBatteryStaple)
 *   SEED_UNVERIFIED_EMAIL (default: unverified@example.com)
 */

import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";

const prisma = new PrismaClient();

async function hashPassword(password: string): Promise<string> {
  return hash(password, {
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
    outputLen: 32,
    algorithm: 2, // Argon2id
  });
}

async function main(): Promise<void> {
  const verifiedEmail = (
    process.env.SEED_VERIFIED_EMAIL ?? "verified@example.com"
  )
    .trim()
    .toLowerCase();
  const verifiedPassword =
    process.env.SEED_VERIFIED_PASSWORD ?? "CorrectHorseBatteryStaple";
  const unverifiedEmail = (
    process.env.SEED_UNVERIFIED_EMAIL ?? "unverified@example.com"
  )
    .trim()
    .toLowerCase();

  const verifiedHash = await hashPassword(verifiedPassword);
  const unverifiedHash = await hashPassword("UnverifiedUserPass1");

  await prisma.user.upsert({
    where: { email: verifiedEmail },
    create: {
      name: "Verified Dev User",
      email: verifiedEmail,
      passwordHash: verifiedHash,
      emailVerifiedAt: new Date(),
    },
    update: {
      name: "Verified Dev User",
      passwordHash: verifiedHash,
      emailVerifiedAt: new Date(),
      sessionVersion: 0,
    },
  });

  await prisma.user.upsert({
    where: { email: unverifiedEmail },
    create: {
      name: "Unverified Dev User",
      email: unverifiedEmail,
      passwordHash: unverifiedHash,
      emailVerifiedAt: null,
    },
    update: {
      name: "Unverified Dev User",
      passwordHash: unverifiedHash,
      emailVerifiedAt: null,
    },
  });

  console.log(
    `Seeded verified user ${verifiedEmail} and unverified user ${unverifiedEmail}.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
