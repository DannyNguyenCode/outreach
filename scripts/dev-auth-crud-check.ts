/**
 * Safe Phase 1 auth-model CRUD check against an isolated development database.
 *
 * Usage:
 *   npx tsx scripts/dev-auth-crud-check.ts
 *
 * Requires DATABASE_URL / DIRECT_URL pointing at a disposable local/dev database.
 * Creates only uniquely prefixed temporary rows and deletes them before exit.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";

function sanitizeTarget(url: string | undefined): {
  host: string;
  database: string;
  pooled: boolean;
} {
  if (!url) {
    return { host: "missing", database: "missing", pooled: false };
  }
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      database: parsed.pathname.replace(/^\//, "") || "unknown",
      pooled:
        parsed.port === "6543" ||
        parsed.searchParams.get("pgbouncer") === "true" ||
        parsed.hostname.includes("pooler"),
    };
  } catch {
    return { host: "unparseable", database: "unparseable", pooled: false };
  }
}

function classifyTarget(host: string): "local" | "unknown-remote" {
  if (
    host === "127.0.0.1" ||
    host === "localhost" ||
    host === "::1" ||
    host.endsWith(".local")
  ) {
    return "local";
  }
  return "unknown-remote";
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const directUrl = process.env.DIRECT_URL;
  const dbInfo = sanitizeTarget(databaseUrl);
  const classification = classifyTarget(dbInfo.host);

  console.log(
    JSON.stringify({
      event: "crud_check.target",
      host: dbInfo.host,
      database: dbInfo.database.split("?")[0],
      pooled: dbInfo.pooled,
      directUrlConfigured: Boolean(directUrl),
      classification,
    }),
  );

  if (classification !== "local") {
    console.error(
      JSON.stringify({
        event: "crud_check.aborted",
        reason:
          "Target is not positively identified as a local development database.",
      }),
    );
    process.exit(2);
  }

  const prisma = new PrismaClient();
  const prefix = `crud-${randomUUID()}`;
  const email = `${prefix}@example.com`;
  let userId: string | undefined;
  let tokenId: string | undefined;
  let bucketId: string | undefined;

  try {
    await prisma.$queryRaw`SELECT 1`;

    const passwordHash = await hash("CorrectHorseBatteryStaple", {
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
      outputLen: 32,
      algorithm: 2,
    });

    const user = await prisma.user.create({
      data: {
        name: "CRUD Temp User",
        email,
        passwordHash,
      },
      select: { id: true, email: true, passwordHash: true },
    });
    userId = user.id;
    if (user.passwordHash === "CorrectHorseBatteryStaple") {
      throw new Error("Plaintext password was stored");
    }

    const rawToken = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const token = await prisma.authToken.create({
      data: {
        userId: user.id,
        purpose: "EMAIL_VERIFICATION",
        tokenHash,
        expiresAt: new Date(Date.now() + 60_000),
      },
      select: { id: true, tokenHash: true },
    });
    tokenId = token.id;
    if (token.tokenHash === rawToken) {
      throw new Error("Raw token was stored");
    }

    const bucketKey = `crud-${randomUUID()}`;
    const bucket = await prisma.rateLimitBucket.create({
      data: {
        bucketKey,
        count: 1,
        windowStart: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      },
      select: { id: true, count: true },
    });
    bucketId = bucket.id;

    await prisma.user.update({
      where: { id: user.id },
      data: { name: "CRUD Temp User Updated" },
    });
    await prisma.rateLimitBucket.update({
      where: { id: bucket.id },
      data: { count: 2 },
    });

    const readUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { name: true, email: true },
    });
    if (readUser?.name !== "CRUD Temp User Updated") {
      throw new Error("User update/read failed");
    }

    console.log(
      JSON.stringify({
        event: "crud_check.ok",
        created: { user: true, authToken: true, rateLimitBucket: true },
      }),
    );
  } finally {
    if (tokenId) {
      await prisma.authToken.deleteMany({ where: { id: tokenId } });
    }
    if (bucketId) {
      await prisma.rateLimitBucket.deleteMany({ where: { id: bucketId } });
    }
    if (userId) {
      await prisma.user.deleteMany({ where: { id: userId } });
    } else {
      await prisma.user.deleteMany({ where: { email } });
    }

    const leftover = await prisma.user.count({ where: { email } });
    console.log(
      JSON.stringify({
        event: "crud_check.cleanup",
        leftoverUsersForPrefix: leftover,
      }),
    );
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      event: "crud_check.failed",
      message: error instanceof Error ? error.message : "unknown",
    }),
  );
  process.exit(1);
});
