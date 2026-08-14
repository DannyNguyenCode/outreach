import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { resetServerEnvCache } from "@/lib/env/server";
import { setMailerForTests, type EmailSender } from "@/lib/email/mailer";
import {
  createHolidayClosure,
  listHolidayClosures,
  replaceHolidayClosures,
  updateHolidayClosure,
} from "@/lib/orgs/holiday-closures";
import {
  countConfig3bAudits,
  createGate,
  seedPhase3aCompletedOrg,
  snapshotPhase3aCore,
} from "@/tests/integration/helpers/config-3b";
import { resetApplicationData } from "@/tests/integration/reset";

const mockMailer: EmailSender = {
  async send() {},
};

describe("Phase 3B holiday closures", () => {
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

  it("creates a single local calendar date closure", async () => {
    const seeded = await seedPhase3aCompletedOrg(prisma, {
      prefix: "hc-single",
    });
    const created = await createHolidayClosure({
      actor: seeded.owner,
      organizationId: seeded.organizationId,
      raw: {
        localDateStart: "2026-12-25",
        isClosedAllDay: true,
        customerNote: "Closed for Christmas",
        internalLabel: "Christmas",
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.closure.localDateStart).toBe("2026-12-25");
    expect(created.closure.localDateEnd).toBeNull();
    expect(created.closure.isClosedAllDay).toBe(true);
  });

  it("creates a bounded inclusive date range", async () => {
    const seeded = await seedPhase3aCompletedOrg(prisma, {
      prefix: "hc-range",
    });
    const created = await createHolidayClosure({
      actor: seeded.owner,
      organizationId: seeded.organizationId,
      raw: {
        localDateStart: "2026-07-01",
        localDateEnd: "2026-07-03",
        isClosedAllDay: true,
        internalLabel: "Canada Day long weekend",
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.closure.localDateStart).toBe("2026-07-01");
    expect(created.closure.localDateEnd).toBe("2026-07-03");
  });

  it("stores America/Toronto DST boundary dates as local calendar strings", async () => {
    const seeded = await seedPhase3aCompletedOrg(prisma, {
      prefix: "hc-dst",
    });
    // 2026 America/Toronto: spring forward Mar 8; fall back Nov 1.
    const spring = await createHolidayClosure({
      actor: seeded.owner,
      organizationId: seeded.organizationId,
      raw: {
        localDateStart: "2026-03-08",
        isClosedAllDay: true,
        internalLabel: "DST spring boundary",
      },
    });
    const fall = await createHolidayClosure({
      actor: seeded.owner,
      organizationId: seeded.organizationId,
      raw: {
        localDateStart: "2026-11-01",
        isClosedAllDay: true,
        internalLabel: "DST fall boundary",
      },
    });
    expect(spring.ok && fall.ok).toBe(true);
    if (!spring.ok || !fall.ok) return;

    const listed = await listHolidayClosures({
      actor: seeded.owner,
      organizationId: seeded.organizationId,
    });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.organizationTimeZone).toBe("America/Toronto");
    expect(listed.closures.map((c) => c.localDateStart)).toEqual([
      "2026-03-08",
      "2026-11-01",
    ]);
    // Dates remain calendar strings — not shifted by UTC conversion.
    expect(spring.closure.localDateStart).toBe("2026-03-08");
    expect(fall.closure.localDateStart).toBe("2026-11-01");
  });

  it("rejects invalid date ranges", async () => {
    const seeded = await seedPhase3aCompletedOrg(prisma, {
      prefix: "hc-inv",
    });
    const reversed = await createHolidayClosure({
      actor: seeded.owner,
      organizationId: seeded.organizationId,
      raw: {
        localDateStart: "2026-05-10",
        localDateEnd: "2026-05-01",
      },
    });
    expect(reversed.ok).toBe(false);
    if (!reversed.ok) expect(reversed.reason).toBe("validation");

    const badDate = await createHolidayClosure({
      actor: seeded.owner,
      organizationId: seeded.organizationId,
      raw: { localDateStart: "2026-02-30" },
    });
    expect(badDate.ok).toBe(false);
    if (!badDate.ok) expect(badDate.reason).toBe("validation");
  });

  it("rejects overlapping active intervals", async () => {
    const seeded = await seedPhase3aCompletedOrg(prisma, {
      prefix: "hc-ov",
    });
    const first = await createHolidayClosure({
      actor: seeded.owner,
      organizationId: seeded.organizationId,
      raw: {
        localDateStart: "2026-08-01",
        localDateEnd: "2026-08-05",
      },
    });
    expect(first.ok).toBe(true);

    const overlap = await createHolidayClosure({
      actor: seeded.owner,
      organizationId: seeded.organizationId,
      raw: {
        localDateStart: "2026-08-05",
        localDateEnd: "2026-08-07",
      },
    });
    expect(overlap.ok).toBe(false);
    if (!overlap.ok) expect(overlap.reason).toBe("conflict");

    const replaceOverlap = await replaceHolidayClosures({
      actor: seeded.owner,
      organizationId: seeded.organizationId,
      raw: {
        closures: [
          { localDateStart: "2026-09-01", localDateEnd: "2026-09-03" },
          { localDateStart: "2026-09-03", localDateEnd: "2026-09-04" },
        ],
      },
    });
    expect(replaceOverlap.ok).toBe(false);
    if (!replaceOverlap.ok) expect(replaceOverlap.reason).toBe("validation");

    expect(
      await prisma.holidayClosure.count({
        where: { organizationId: seeded.organizationId },
      }),
    ).toBe(1);
  });

  it("leaves weekly OperatingHourInterval unchanged after closure mutations", async () => {
    const seeded = await seedPhase3aCompletedOrg(prisma, {
      prefix: "hc-hours",
    });
    const before = await snapshotPhase3aCore(prisma, seeded.organizationId);

    await createHolidayClosure({
      actor: seeded.owner,
      organizationId: seeded.organizationId,
      raw: { localDateStart: "2026-12-26", internalLabel: "Boxing Day" },
    });
    await replaceHolidayClosures({
      actor: seeded.owner,
      organizationId: seeded.organizationId,
      raw: {
        closures: [
          { localDateStart: "2026-12-25" },
          { localDateStart: "2026-12-26" },
        ],
      },
    });

    const after = await snapshotPhase3aCore(prisma, seeded.organizationId);
    expect(after.hours).toEqual(before.hours);
  });

  it("rolls back failed replace so prior closures remain intact", async () => {
    const seeded = await seedPhase3aCompletedOrg(prisma, {
      prefix: "hc-rb",
    });
    const created = await createHolidayClosure({
      actor: seeded.owner,
      organizationId: seeded.organizationId,
      raw: { localDateStart: "2026-01-01", internalLabel: "New Year" },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const failed = await replaceHolidayClosures({
      actor: seeded.owner,
      organizationId: seeded.organizationId,
      raw: {
        closures: [
          {
            localDateStart: "2026-02-01",
            localDateEnd: "2026-01-15",
          },
        ],
      },
    });
    expect(failed.ok).toBe(false);

    const remaining = await prisma.holidayClosure.findMany({
      where: { organizationId: seeded.organizationId },
    });
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe(created.closure.id);
    expect(remaining[0]!.localDateStart).toBe("2026-01-01");
  });

  it("concurrent replace vs update serializes with one consistent winner set", async () => {
    const seeded = await seedPhase3aCompletedOrg(prisma, {
      prefix: "hc-race",
    });
    const created = await createHolidayClosure({
      actor: seeded.owner,
      organizationId: seeded.organizationId,
      raw: {
        localDateStart: "2026-06-01",
        internalLabel: "Original",
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const aHeld = createGate();
    const bStarted = createGate();
    const bGotLock = createGate();

    const replacePromise = replaceHolidayClosures(
      {
        actor: seeded.owner,
        organizationId: seeded.organizationId,
        raw: {
          closures: [
            {
              localDateStart: "2026-06-10",
              internalLabel: "Replaced",
            },
          ],
        },
      },
      {
        testAfterSectionLock: async () => {
          aHeld.markReached();
          await aHeld.waitForRelease();
        },
      },
    );

    await aHeld.waitUntilReached();

    const updatePromise = updateHolidayClosure(
      {
        actor: seeded.owner,
        organizationId: seeded.organizationId,
        closureId: created.closure.id,
        expectedVersion: created.closure.version,
        raw: {
          localDateStart: "2026-06-01",
          internalLabel: "Updated concurrently",
        },
      },
      {
        testBeforeConfig3bLock: async () => {
          bStarted.markReached();
        },
        testAfterSectionLock: async () => {
          bGotLock.markReached();
        },
      },
    );

    await bStarted.waitUntilReached();
    aHeld.release();
    await bGotLock.waitUntilReached();

    const [replaced, updated] = await Promise.all([
      replacePromise,
      updatePromise,
    ]);
    expect(replaced.ok).toBe(true);
    // Update targets a row deleted by replace → not found / auth-style failure,
    // or conflict if it raced differently. Either way no half-applied state.
    expect(updated.ok).toBe(false);

    const rows = await prisma.holidayClosure.findMany({
      where: { organizationId: seeded.organizationId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.localDateStart).toBe("2026-06-10");
    expect(rows[0]!.internalLabel).toBe("Replaced");
    expect(
      await countConfig3bAudits(
        prisma,
        seeded.organizationId,
        "HOLIDAY_CLOSURE_UPDATED",
      ),
    ).toBeGreaterThanOrEqual(1);
  });
});
