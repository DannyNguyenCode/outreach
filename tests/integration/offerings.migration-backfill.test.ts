import { cp, mkdir, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SafeUser } from "@/lib/auth/users";
import { toCanonicalOfferingContent } from "@/lib/orgs/offering-validation";

const PHASE_4B_LAST_MIGRATION = "20260814211500_phase_04b_upload_compensation";
const PHASE_4C_MIGRATION = "20260815000000_phase_04c_structured_offerings";
const PRICE_NOTE_PREFIX = "Phase 3 pricing information: ";

describe("Phase 4C migration backfill", () => {
  const repositoryRoot = process.cwd();
  const baseDatabaseUrl = process.env.DATABASE_URL!;
  const schemaName = `phase4c_backfill_${process.pid}_${Date.now()}`;
  const migrationDatabaseUrl = withSchema(baseDatabaseUrl, schemaName);
  const admin = new PrismaClient({ datasourceUrl: baseDatabaseUrl });
  let migrated: PrismaClient;
  let ownerA: SafeUser;
  let ownerB: SafeUser;
  let organizationA: string;
  let organizationB: string;
  let knowledgeBefore: unknown;
  let tempRoot: string;

  beforeAll(async () => {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
    tempRoot = await mkdtemp(path.join(tmpdir(), "outreach-phase4c-migrate-"));
    await cp(
      path.join(repositoryRoot, "prisma", "schema.prisma"),
      path.join(tempRoot, "schema.prisma"),
    );
    await mkdir(path.join(tempRoot, "migrations"), { recursive: true });
    await cp(
      path.join(repositoryRoot, "prisma", "migrations", "migration_lock.toml"),
      path.join(tempRoot, "migrations", "migration_lock.toml"),
    );

    const migrationNames = (
      await readdir(path.join(repositoryRoot, "prisma", "migrations"), {
        withFileTypes: true,
      })
    )
      .filter(
        (entry) => entry.isDirectory() && entry.name <= PHASE_4B_LAST_MIGRATION,
      )
      .map((entry) => entry.name)
      .sort();
    for (const migrationName of migrationNames) {
      await cp(
        path.join(repositoryRoot, "prisma", "migrations", migrationName),
        path.join(tempRoot, "migrations", migrationName),
        { recursive: true },
      );
    }

    deployMigrations(tempRoot, migrationDatabaseUrl);
    const legacy = new PrismaClient({ datasourceUrl: migrationDatabaseUrl });
    const seededA = await seedLegacyOrganization(legacy, "legacy-a");
    const seededB = await seedLegacyOrganization(legacy, "legacy-b");
    ownerA = seededA.owner;
    ownerB = seededB.owner;
    organizationA = seededA.organizationId;
    organizationB = seededB.organizationId;
    knowledgeBefore = await legacy.knowledgeSource.findMany({
      orderBy: { id: "asc" },
      include: { versions: { orderBy: { id: "asc" } } },
    });
    await legacy.$disconnect();

    await cp(
      path.join(repositoryRoot, "prisma", "migrations", PHASE_4C_MIGRATION),
      path.join(tempRoot, "migrations", PHASE_4C_MIGRATION),
      { recursive: true },
    );
    deployMigrations(tempRoot, migrationDatabaseUrl);

    process.env.DATABASE_URL = migrationDatabaseUrl;
    process.env.DIRECT_URL = migrationDatabaseUrl;
    migrated = new PrismaClient({ datasourceUrl: migrationDatabaseUrl });
  }, 120_000);

  afterAll(async () => {
    const { prisma } = await import("@/lib/prisma");
    await prisma.$disconnect();
    process.env.DATABASE_URL = baseDatabaseUrl;
    process.env.DIRECT_URL = baseDatabaseUrl;
    await migrated?.$disconnect();
    await admin.$executeRawUnsafe(`DROP SCHEMA "${schemaName}" CASCADE`);
    await admin.$disconnect();
  });

  it("backfills a service without pricing as a directly confirmable draft", async () => {
    const offering = await loadLegacyOffering(
      migrated,
      organizationA,
      "legacy-a-service-none",
    );
    expect(offering).toMatchObject({
      organizationId: organizationA,
      offeringType: "SERVICE",
      displayOrder: 3,
    });
    expect(offering.versions).toHaveLength(1);
    const draft = offering.versions[0]!;
    expect(draft).toMatchObject({
      state: "DRAFT",
      name: "Consultation",
      description: "Initial consultation",
      offeringType: "SERVICE",
      pricingModel: "NONE",
      quoteRequired: false,
      displayOrder: 3,
      eligibility: null,
    });
    expect(
      offering.versions.some((version) => version.state === "ACTIVE"),
    ).toBe(false);
    expect(draft.prices).toHaveLength(0);
    expect(canonicalChecksum(draft)).toBe(draft.contentChecksum);

    const confirmed = await confirmMigratedDraft(
      ownerA,
      organizationA,
      offering.id,
      draft.id,
      draft.draftRevision,
      draft.contentChecksum,
    );
    expect(confirmed.ok).toBe(true);
    if (confirmed.ok) expect(confirmed.version.state).toBe("ACTIVE");
  });

  it("preserves free-form service pricing without fabricating a numeric price", async () => {
    const offering = await loadLegacyOffering(
      migrated,
      organizationA,
      "legacy-a-service-quote",
    );
    const draft = offering.versions[0]!;
    expect(draft).toMatchObject({
      state: "DRAFT",
      pricingModel: "QUOTE_REQUIRED",
      quoteRequired: true,
      eligibility: {
        description: `${PRICE_NOTE_PREFIX}From $95 after assessment`,
      },
    });
    expect(draft.prices).toHaveLength(0);
    expect(canonicalChecksum(draft)).toBe(draft.contentChecksum);

    const confirmed = await confirmMigratedDraft(
      ownerA,
      organizationA,
      offering.id,
      draft.id,
      draft.draftRevision,
      draft.contentChecksum,
    );
    expect(confirmed.ok).toBe(true);
  });

  it("backfills a product with canonical preserved pricing and direct confirmation", async () => {
    const offering = await loadLegacyOffering(
      migrated,
      organizationA,
      "legacy-a-product",
    );
    const draft = offering.versions[0]!;
    expect(offering).toMatchObject({
      organizationId: organizationA,
      offeringType: "PRODUCT",
      displayOrder: 7,
    });
    expect(draft).toMatchObject({
      state: "DRAFT",
      name: 'Starter "kit" ✓',
      description: 'Physical "starter"\nkit',
      offeringType: "PRODUCT",
      pricingModel: "QUOTE_REQUIRED",
      quoteRequired: true,
      displayOrder: 7,
      eligibility: {
        description: `${PRICE_NOTE_PREFIX}Contact us for current pricing`,
      },
    });
    expect(draft.prices).toHaveLength(0);
    expect(canonicalChecksum(draft)).toBe(draft.contentChecksum);

    const confirmed = await confirmMigratedDraft(
      ownerA,
      organizationA,
      offering.id,
      draft.id,
      draft.draftRevision,
      draft.contentChecksum,
    );
    expect(confirmed.ok).toBe(true);
  });

  it("keeps backfills tenant-scoped and cross-tenant confirmation isolated", async () => {
    const offeringA = await loadLegacyOffering(
      migrated,
      organizationA,
      "legacy-a-product",
    );
    const offeringB = await loadLegacyOffering(
      migrated,
      organizationB,
      "legacy-b-product",
    );
    expect(offeringA.organizationId).toBe(organizationA);
    expect(offeringB.organizationId).toBe(organizationB);
    expect(offeringA.legacyProductId).not.toBe(offeringB.legacyProductId);
    expect(
      offeringB.versions.every(
        (version) =>
          version.organizationId === organizationB &&
          version.offeringId === offeringB.id,
      ),
    ).toBe(true);

    const crossTenant = await confirmMigratedDraft(
      ownerA,
      organizationA,
      offeringB.id,
      offeringB.versions[0]!.id,
      offeringB.versions[0]!.draftRevision,
      offeringB.versions[0]!.contentChecksum,
    );
    expect(crossTenant.ok).toBe(false);

    const unchanged = await migrated.offeringVersion.findUniqueOrThrow({
      where: { id: offeringB.versions[0]!.id },
    });
    expect(unchanged.state).toBe("DRAFT");
    expect(unchanged.organizationId).toBe(organizationB);

    const ownConfirmation = await confirmMigratedDraft(
      ownerB,
      organizationB,
      offeringB.id,
      unchanged.id,
      unchanged.draftRevision,
      unchanged.contentChecksum,
    );
    expect(ownConfirmation.ok).toBe(true);
  });

  it("is idempotent under normal migrate-deploy rehearsal", async () => {
    const before = await migrated.offering.count();
    deployMigrations(tempRoot, migrationDatabaseUrl);
    expect(await migrated.offering.count()).toBe(before);
    const provenance = await migrated.offering.findMany({
      select: {
        organizationId: true,
        legacyServiceId: true,
        legacyProductId: true,
      },
    });
    const keys = provenance.map(
      (item) =>
        `${item.organizationId}:${
          item.legacyServiceId ?? item.legacyProductId
        }`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("does not modify existing Phase 4A/4B knowledge", async () => {
    const after = await migrated.knowledgeSource.findMany({
      orderBy: { id: "asc" },
      include: { versions: { orderBy: { id: "asc" } } },
    });
    expect(after).toEqual(knowledgeBefore);
  });
});

async function seedLegacyOrganization(prisma: PrismaClient, prefix: string) {
  const owner = await prisma.user.create({
    data: {
      id: `${prefix}-owner`,
      name: `${prefix} Owner`,
      email: `${prefix}@example.com`,
      passwordHash: "not-used-in-migration-test",
      emailVerifiedAt: new Date("2026-08-14T12:00:00.000Z"),
    },
  });
  const organization = await prisma.organization.create({
    data: {
      id: `${prefix}-org`,
      name: `${prefix} Organization`,
      slug: `${prefix}-org`,
      memberships: {
        create: {
          id: `${prefix}-membership`,
          userId: owner.id,
          role: "OWNER",
          status: "ACTIVE",
        },
      },
    },
  });
  await prisma.businessService.createMany({
    data: [
      {
        id: `${prefix}-service-none`,
        organizationId: organization.id,
        name: "Consultation",
        description: "Initial consultation",
        displayOrder: 3,
      },
      {
        id: `${prefix}-service-quote`,
        organizationId: organization.id,
        name: "Installation",
        description: "On-site installation",
        priceDescription: "  From $95 after assessment  ",
        displayOrder: 5,
      },
    ],
  });
  await prisma.businessProduct.create({
    data: {
      id: `${prefix}-product`,
      organizationId: organization.id,
      name: 'Starter "kit" ✓',
      description: 'Physical "starter"\nkit',
      sku: `${prefix.toUpperCase()}-KIT`,
      priceDescription: "Contact us for current pricing",
      displayOrder: 7,
    },
  });
  await prisma.knowledgeSource.create({
    data: {
      id: `${prefix}-knowledge`,
      organizationId: organization.id,
      inputKind: "MANUAL",
      category: "CUSTOMER_CONFIRMED_BUSINESS_FACTS",
      title: "Existing knowledge",
      createdByUserId: owner.id,
    },
  });
  await prisma.knowledgeVersion.create({
    data: {
      id: `${prefix}-knowledge-version`,
      organizationId: organization.id,
      sourceId: `${prefix}-knowledge`,
      state: "DRAFT",
      title: "Existing knowledge",
      contentChecksum: "a".repeat(64),
      createdByUserId: owner.id,
    },
  });
  return {
    owner: {
      id: owner.id,
      name: owner.name,
      email: owner.email,
      emailVerifiedAt: owner.emailVerifiedAt,
      sessionVersion: owner.sessionVersion,
      activeOrganizationId: owner.activeOrganizationId,
      createdAt: owner.createdAt,
      updatedAt: owner.updatedAt,
    },
    organizationId: organization.id,
  };
}

async function loadLegacyOffering(
  prisma: PrismaClient,
  organizationId: string,
  legacyId: string,
) {
  return prisma.offering.findFirstOrThrow({
    where: {
      organizationId,
      OR: [{ legacyServiceId: legacyId }, { legacyProductId: legacyId }],
    },
    include: {
      versions: {
        include: {
          prices: { orderBy: [{ displayOrder: "asc" }, { id: "asc" }] },
          features: { orderBy: [{ displayOrder: "asc" }, { id: "asc" }] },
          variants: {
            orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
            include: { prices: true },
          },
          eligibility: true,
          customValues: {
            orderBy: [{ definitionKey: "asc" }, { id: "asc" }],
          },
        },
      },
    },
  });
}

function canonicalChecksum(
  version: Awaited<ReturnType<typeof loadLegacyOffering>>["versions"][number],
) {
  return toCanonicalOfferingContent({
    name: version.name,
    description: version.description,
    offeringType: version.offeringType,
    pricingModel: version.pricingModel,
    quoteRequired: version.quoteRequired,
    effectiveFrom: version.effectiveFrom,
    effectiveUntil: version.effectiveUntil,
    displayOrder: version.displayOrder,
    prices: [],
    features: [],
    variants: [],
    eligibility: version.eligibility,
    customValues: [],
  }).checksum;
}

async function confirmMigratedDraft(
  actor: SafeUser,
  organizationId: string,
  offeringId: string,
  versionId: string,
  expectedDraftRevision: number,
  expectedChecksum: string,
) {
  const { confirmOfferingVersion } = await import("@/lib/orgs/offerings");
  return confirmOfferingVersion({
    actor,
    organizationId,
    raw: {
      offeringId,
      versionId,
      expectedDraftRevision,
      expectedChecksum,
      confirmAccuracy: "on",
    },
  });
}

function deployMigrations(root: string, databaseUrl: string) {
  const result = spawnSync(
    process.execPath,
    [
      path.join(process.cwd(), "node_modules", "prisma", "build", "index.js"),
      "migrate",
      "deploy",
      "--schema",
      path.join(root, "schema.prisma"),
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        DIRECT_URL: databaseUrl,
      },
      encoding: "utf8",
      timeout: 120_000,
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `Prisma migrate deploy failed: ${String(result.error)}\n${result.stdout}\n${result.stderr}`,
    );
  }
}

function withSchema(databaseUrl: string, schema: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set("schema", schema);
  return url.toString();
}
