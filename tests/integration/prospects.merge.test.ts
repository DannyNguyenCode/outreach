import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  mergeProspects,
  previewProspectMerge,
} from "@/lib/orgs/prospect-merge";
import {
  createProspect,
  listProspects,
  updateProspect,
} from "@/lib/orgs/prospects";
import {
  createGate,
  createOrgWithOwner,
} from "@/tests/integration/helpers/config-3b";
import { resetApplicationData } from "@/tests/integration/reset";

describe("Phase 5A prospect merge", () => {
  const prisma = new PrismaClient();

  beforeEach(async () => {
    await resetApplicationData(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function seedPair() {
    const ctx = await createOrgWithOwner(prisma, "p-merge");
    const survivor = await createProspect({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: {
        displayName: "ABC Plumbing",
        website: "abcplumbing.ca",
        contacts: [
          {
            firstName: "John",
            lastName: "Smith",
            channels: [{ kind: "PHONE", value: "+14165553001" }],
          },
        ],
      },
    });
    const duplicate = await createProspect({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: {
        displayName: "ABC Plumbing Inc.",
        website: "abcplumbing.com",
        acknowledgeDuplicates: true,
        contacts: [
          {
            firstName: "Jane",
            lastName: "Doe",
            channels: [
              { kind: "PHONE", value: "+14165553001" },
              { kind: "EMAIL", value: "office@abcplumbing.com" },
            ],
          },
        ],
      },
    });
    expect(survivor.ok && duplicate.ok).toBe(true);
    if (!survivor.ok || !duplicate.ok) {
      throw new Error("seed failed");
    }
    return {
      ctx,
      survivorId: survivor.prospectId,
      duplicateId: duplicate.prospectId,
    };
  }

  it("merges with explicit survivor, conflict resolution, and preserved loser", async () => {
    const { ctx, survivorId, duplicateId } = await seedPair();
    const preview = await previewProspectMerge({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      survivorProspectId: survivorId,
      duplicateProspectId: duplicateId,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(
      preview.preview.conflicts.some((item) => item.field === "website"),
    ).toBe(true);

    const merged = await mergeProspects({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      survivorProspectId: survivorId,
      duplicateProspectId: duplicateId,
      expectedSurvivorVersion: 0,
      expectedDuplicateVersion: 0,
      resolutions: { displayName: "survivor", website: "duplicate" },
    });
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;

    const survivor = await prisma.prospect.findUniqueOrThrow({
      where: { id: survivorId },
    });
    const loser = await prisma.prospect.findUniqueOrThrow({
      where: { id: duplicateId },
    });
    expect(survivor.websiteNormalized).toBe("abcplumbing.com");
    expect(loser.lifecycle).toBe("MERGED");
    expect(loser.mergedIntoProspectId).toBe(survivorId);
    expect(
      await prisma.prospectContact.count({
        where: { prospectId: survivorId, organizationId: ctx.organizationId },
      }),
    ).toBe(2);
    expect(
      await prisma.prospectChannel.count({
        where: {
          prospectId: survivorId,
          kind: "PHONE",
          normalizedValue: "+14165553001",
        },
      }),
    ).toBeGreaterThanOrEqual(1);

    const active = await listProspects({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      lifecycle: "ACTIVE",
    });
    expect(active.ok && active.items.map((item) => item.id)).toEqual([
      survivorId,
    ]);

    const audit = await prisma.organizationAuditEvent.findFirst({
      where: { organizationId: ctx.organizationId, action: "PROSPECT_MERGED" },
    });
    expect(audit?.metadata).toMatchObject({
      survivorProspectId: survivorId,
      mergedProspectId: duplicateId,
    });
    expect(JSON.stringify(audit?.metadata)).not.toContain(
      "office@abcplumbing.com",
    );
  });

  it("rejects self-merge, cross-tenant merge, and stale versions", async () => {
    const { ctx, survivorId, duplicateId } = await seedPair();
    const self = await mergeProspects({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      survivorProspectId: survivorId,
      duplicateProspectId: survivorId,
      expectedSurvivorVersion: 0,
      expectedDuplicateVersion: 0,
    });
    expect(self.ok).toBe(false);

    const other = await createOrgWithOwner(prisma, "p-merge-x");
    const foreign = await mergeProspects({
      actor: other.owner,
      organizationId: other.organizationId,
      survivorProspectId: survivorId,
      duplicateProspectId: duplicateId,
      expectedSurvivorVersion: 0,
      expectedDuplicateVersion: 0,
    });
    expect(foreign.ok).toBe(false);

    const stale = await mergeProspects({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      survivorProspectId: survivorId,
      duplicateProspectId: duplicateId,
      expectedSurvivorVersion: 9,
      expectedDuplicateVersion: 0,
      resolutions: { displayName: "survivor", website: "survivor" },
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.reason).toBe("conflict");
  });

  it("serializes concurrent merges and update-vs-merge races", async () => {
    const { ctx, survivorId, duplicateId } = await seedPair();
    const firstHeld = createGate();
    const secondBefore = createGate();
    const first = mergeProspects(
      {
        actor: ctx.owner,
        organizationId: ctx.organizationId,
        survivorProspectId: survivorId,
        duplicateProspectId: duplicateId,
        expectedSurvivorVersion: 0,
        expectedDuplicateVersion: 0,
        resolutions: { displayName: "survivor", website: "survivor" },
      },
      {
        testAfterProspectLock: async () => {
          firstHeld.markReached();
          await firstHeld.waitForRelease();
        },
      },
    );
    await firstHeld.waitUntilReached();
    const second = mergeProspects(
      {
        actor: ctx.owner,
        organizationId: ctx.organizationId,
        survivorProspectId: survivorId,
        duplicateProspectId: duplicateId,
        expectedSurvivorVersion: 0,
        expectedDuplicateVersion: 0,
        resolutions: { displayName: "duplicate", website: "duplicate" },
      },
      {
        testBeforeProspectLock: async () => {
          secondBefore.markReached();
        },
      },
    );
    await secondBefore.waitUntilReached();
    firstHeld.release();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    const outcomes = [firstResult.ok, secondResult.ok];
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    expect(await prisma.prospectMerge.count()).toBe(1);
    expect(
      await prisma.prospect.count({
        where: { organizationId: ctx.organizationId, lifecycle: "MERGED" },
      }),
    ).toBe(1);
  });

  it("rolls back a failed merge and rejects update-vs-merge stale writes", async () => {
    const { ctx, survivorId, duplicateId } = await seedPair();
    const failed = await mergeProspects(
      {
        actor: ctx.owner,
        organizationId: ctx.organizationId,
        survivorProspectId: survivorId,
        duplicateProspectId: duplicateId,
        expectedSurvivorVersion: 0,
        expectedDuplicateVersion: 0,
        resolutions: { displayName: "survivor", website: "survivor" },
      },
      {
        testBeforeCommit: async () => {
          throw new Error("forced failure");
        },
      },
    );
    expect(failed.ok).toBe(false);
    expect(await prisma.prospectMerge.count()).toBe(0);
    expect(
      await prisma.prospect.count({
        where: { id: duplicateId, lifecycle: "ACTIVE" },
      }),
    ).toBe(1);

    const held = createGate();
    const mergePromise = mergeProspects(
      {
        actor: ctx.owner,
        organizationId: ctx.organizationId,
        survivorProspectId: survivorId,
        duplicateProspectId: duplicateId,
        expectedSurvivorVersion: 0,
        expectedDuplicateVersion: 0,
        resolutions: { displayName: "survivor", website: "survivor" },
      },
      {
        testAfterProspectLock: async () => {
          held.markReached();
          await held.waitForRelease();
        },
      },
    );
    await held.waitUntilReached();
    const updatePromise = updateProspect({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      prospectId: survivorId,
      raw: { displayName: "Race update", expectedVersion: 0 },
    });
    held.release();
    const [mergeResult, updateResult] = await Promise.all([
      mergePromise,
      updatePromise,
    ]);
    expect([mergeResult.ok, updateResult.ok].filter(Boolean).length).toBe(1);
  });
});
