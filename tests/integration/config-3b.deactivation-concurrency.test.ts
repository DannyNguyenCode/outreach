import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { setMailerForTests, type EmailSender } from "@/lib/email/mailer";
import { resetServerEnvCache } from "@/lib/env/server";
import type { Config3bMutationTestHooks } from "@/lib/orgs/config-3b-access";
import {
  createCustomField,
  deactivateCustomField,
  updateCustomField,
} from "@/lib/orgs/custom-fields";
import {
  createHolidayClosure,
  deactivateHolidayClosure,
  updateHolidayClosure,
} from "@/lib/orgs/holiday-closures";
import {
  createServiceArea,
  deactivateServiceArea,
  updateServiceArea,
} from "@/lib/orgs/service-areas";
import {
  countConfig3bAudits,
  createGate,
  createOrgWithOwner,
} from "@/tests/integration/helpers/config-3b";
import { resetApplicationData } from "@/tests/integration/reset";

const mockMailer: EmailSender = { async send() {} };

type MutationResult = { ok: boolean; reason?: string };
type Winner = "update" | "deactivate";
type RaceResource = {
  initialVersion: number;
  update: (hooks: Config3bMutationTestHooks) => Promise<MutationResult>;
  deactivate: (hooks: Config3bMutationTestHooks) => Promise<MutationResult>;
  read: () => Promise<{ isActive: boolean; version: number }>;
  countUpdateAudits: () => Promise<number>;
  countDeactivateAudits: () => Promise<number>;
};

async function runDeterministicRace(
  resource: RaceResource,
  winner: Winner,
): Promise<void> {
  const firstHeld = createGate();
  const secondStarted = createGate();
  const secondAcquired = createGate();
  const loser: Winner = winner === "update" ? "deactivate" : "update";

  const firstPromise = resource[winner]({
    testAfterConfig3bLock: async () => {
      firstHeld.markReached();
      await firstHeld.waitForRelease();
    },
  });

  await firstHeld.waitUntilReached();

  const secondPromise = resource[loser]({
    testBeforeConfig3bLock: async () => {
      secondStarted.markReached();
    },
    testAfterConfig3bLock: async () => {
      secondAcquired.markReached();
    },
  });

  // This reached signal proves the second transaction was scheduled before the
  // first lock holder was released; no sleeps or timing assumptions are used.
  await secondStarted.waitUntilReached();
  firstHeld.release();
  await secondAcquired.waitUntilReached();

  const [first, second] = await Promise.all([firstPromise, secondPromise]);
  expect(first.ok).toBe(true);
  expect(second.ok).toBe(false);
  expect(second.reason).toBe("conflict");

  const row = await resource.read();
  expect(row.version).toBe(resource.initialVersion + 1);
  expect(row.isActive).toBe(winner === "update");
  expect(await resource.countUpdateAudits()).toBe(winner === "update" ? 1 : 0);
  expect(await resource.countDeactivateAudits()).toBe(
    winner === "deactivate" ? 1 : 0,
  );
}

describe("Phase 3B deactivation concurrency", () => {
  const prisma = new PrismaClient();

  beforeAll(() => {
    resetServerEnvCache();
    setMailerForTests(mockMailer);
  });

  beforeEach(async () => {
    await resetApplicationData(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it.each(["update", "deactivate"] as const)(
    "serializes custom-field %s first against a stale peer",
    async (winner) => {
      const org = await createOrgWithOwner(prisma, `deact-race-cf-${winner}`);
      const created = await createCustomField({
        actor: org.owner,
        organizationId: org.organizationId,
        raw: { key: "race_field", label: "Original", dataType: "TEXT" },
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await runDeterministicRace(
        {
          initialVersion: created.field.version,
          update: (hooks) =>
            updateCustomField(
              {
                actor: org.owner,
                organizationId: org.organizationId,
                fieldId: created.field.id,
                expectedVersion: created.field.version,
                raw: { label: "Updated" },
              },
              hooks,
            ),
          deactivate: (hooks) =>
            deactivateCustomField(
              {
                actor: org.owner,
                organizationId: org.organizationId,
                fieldId: created.field.id,
                expectedVersion: created.field.version,
              },
              hooks,
            ),
          read: () =>
            prisma.customFieldDefinition.findUniqueOrThrow({
              where: { id: created.field.id },
              select: { isActive: true, version: true },
            }),
          countUpdateAudits: () =>
            countConfig3bAudits(
              prisma,
              org.organizationId,
              "CUSTOM_FIELD_UPDATED",
            ),
          countDeactivateAudits: () =>
            countConfig3bAudits(
              prisma,
              org.organizationId,
              "CUSTOM_FIELD_DEACTIVATED",
            ),
        },
        winner,
      );
    },
  );

  it.each(["update", "deactivate"] as const)(
    "serializes service-area %s first against a stale peer",
    async (winner) => {
      const org = await createOrgWithOwner(prisma, `deact-race-sa-${winner}`);
      const created = await createServiceArea({
        actor: org.owner,
        organizationId: org.organizationId,
        raw: { label: "Original", isActive: true },
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await runDeterministicRace(
        {
          initialVersion: created.area.version,
          update: (hooks) =>
            updateServiceArea(
              {
                actor: org.owner,
                organizationId: org.organizationId,
                serviceAreaId: created.area.id,
                expectedVersion: created.area.version,
                raw: { label: "Updated", isActive: true },
              },
              hooks,
            ),
          deactivate: (hooks) =>
            deactivateServiceArea(
              {
                actor: org.owner,
                organizationId: org.organizationId,
                serviceAreaId: created.area.id,
                expectedVersion: created.area.version,
              },
              hooks,
            ),
          read: () =>
            prisma.serviceArea.findUniqueOrThrow({
              where: { id: created.area.id },
              select: { isActive: true, version: true },
            }),
          countUpdateAudits: () =>
            countConfig3bAudits(
              prisma,
              org.organizationId,
              "SERVICE_AREA_UPDATED",
            ),
          countDeactivateAudits: () =>
            countConfig3bAudits(
              prisma,
              org.organizationId,
              "SERVICE_AREA_DEACTIVATED",
            ),
        },
        winner,
      );
    },
  );

  it.each(["update", "deactivate"] as const)(
    "serializes holiday-closure %s first against a stale peer",
    async (winner) => {
      const org = await createOrgWithOwner(prisma, `deact-race-hc-${winner}`);
      const created = await createHolidayClosure({
        actor: org.owner,
        organizationId: org.organizationId,
        raw: {
          localDateStart: "2027-02-01",
          internalLabel: "Original",
          isActive: true,
        },
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await runDeterministicRace(
        {
          initialVersion: created.closure.version,
          update: (hooks) =>
            updateHolidayClosure(
              {
                actor: org.owner,
                organizationId: org.organizationId,
                closureId: created.closure.id,
                expectedVersion: created.closure.version,
                raw: {
                  localDateStart: "2027-02-01",
                  internalLabel: "Updated",
                  isActive: true,
                },
              },
              hooks,
            ),
          deactivate: (hooks) =>
            deactivateHolidayClosure(
              {
                actor: org.owner,
                organizationId: org.organizationId,
                closureId: created.closure.id,
                expectedVersion: created.closure.version,
              },
              hooks,
            ),
          read: () =>
            prisma.holidayClosure.findUniqueOrThrow({
              where: { id: created.closure.id },
              select: { isActive: true, version: true },
            }),
          countUpdateAudits: () =>
            countConfig3bAudits(
              prisma,
              org.organizationId,
              "HOLIDAY_CLOSURE_UPDATED",
            ),
          countDeactivateAudits: () =>
            countConfig3bAudits(
              prisma,
              org.organizationId,
              "HOLIDAY_CLOSURE_DEACTIVATED",
            ),
        },
        winner,
      );
    },
  );
});
