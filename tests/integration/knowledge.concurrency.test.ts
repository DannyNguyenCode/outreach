import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { MembershipMutationTestHooks } from "@/lib/orgs/business-access";
import { confirmKnowledgeVersion } from "@/lib/orgs/knowledge";
import { changeMemberRole, deactivateMember } from "@/lib/orgs/memberships";
import {
  addMember,
  countKnowledgeAudits,
  createGate,
  createOrgWithOwner,
  createSampleDraft,
} from "@/tests/integration/helpers/knowledge";
import { resetApplicationData } from "@/tests/integration/reset";

describe("Phase 4A knowledge concurrency", () => {
  const prisma = new PrismaClient();

  beforeEach(async () => {
    await resetApplicationData(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("allows one same-version confirmation winner and one conflict", async () => {
    const ctx = await createOrgWithOwner(prisma, "know-race");
    const sentinel = await createOrgWithOwner(prisma, "know-race-sentinel");
    const created = await createSampleDraft(ctx.owner, ctx.organizationId);
    const sentinelDraft = await createSampleDraft(
      sentinel.owner,
      sentinel.organizationId,
    );
    const firstHeld = createGate();
    const secondBeforeLock = createGate();
    const secondAfterLock = createGate();
    let secondAcquiredLock = false;

    const payload = {
      sourceId: created.source.id,
      versionId: created.version.id,
      expectedDraftRevision: String(created.version.draftRevision),
      expectedChecksum: created.version.contentChecksum,
      confirmAccuracy: "on",
    };

    const first = confirmKnowledgeVersion(
      {
        actor: ctx.owner,
        organizationId: ctx.organizationId,
        raw: payload,
      },
      {
        testAfterKnowledgeLock: async () => {
          firstHeld.markReached();
          await firstHeld.waitForRelease();
        },
      },
    );
    await firstHeld.waitUntilReached();

    const second = confirmKnowledgeVersion(
      {
        actor: ctx.owner,
        organizationId: ctx.organizationId,
        raw: payload,
      },
      {
        testBeforeKnowledgeLock: async () => {
          secondBeforeLock.markReached();
        },
        testAfterKnowledgeLock: async () => {
          secondAcquiredLock = true;
          secondAfterLock.markReached();
        },
      },
    );
    await secondBeforeLock.waitUntilReached();
    expect(secondAcquiredLock).toBe(false);

    firstHeld.release();
    const firstResult = await first;
    const secondResult = await second;
    await secondAfterLock.waitUntilReached();
    expect(secondAcquiredLock).toBe(true);

    const outcomes = [firstResult, secondResult];
    expect(outcomes.filter((result) => result.ok)).toHaveLength(1);
    expect(outcomes.filter((result) => !result.ok)).toHaveLength(1);
    const failure = outcomes.find((result) => !result.ok);
    if (!failure || failure.ok) throw new Error("expected a conflict");
    expect(failure.reason).toBe("conflict");

    const versions = await prisma.knowledgeVersion.findMany({
      where: { sourceId: created.source.id },
    });
    expect(
      versions.filter((version) => version.state === "ACTIVE"),
    ).toHaveLength(1);
    expect(
      await countKnowledgeAudits(
        prisma,
        ctx.organizationId,
        "KNOWLEDGE_VERSION_CONFIRMED",
      ),
    ).toBe(1);

    const sentinelVersion = await prisma.knowledgeVersion.findUniqueOrThrow({
      where: { id: sentinelDraft.version.id },
    });
    expect(sentinelVersion.state).toBe("DRAFT");
  });

  async function raceConfirmAgainstMembership(
    operation: "demotion" | "deactivation",
  ) {
    const ctx = await createOrgWithOwner(prisma, `know-${operation}`);
    const admin = await addMember(
      prisma,
      ctx.organizationId,
      `know-${operation}-admin`,
      "ADMIN",
    );
    const membership = await prisma.membership.findFirstOrThrow({
      where: { organizationId: ctx.organizationId, userId: admin.id },
    });
    const created = await createSampleDraft(admin, ctx.organizationId);
    const confirmHeld = createGate();
    const membershipBefore = createGate();

    const confirm = confirmKnowledgeVersion(
      {
        actor: admin,
        organizationId: ctx.organizationId,
        raw: {
          sourceId: created.source.id,
          versionId: created.version.id,
          expectedDraftRevision: String(created.version.draftRevision),
          expectedChecksum: created.version.contentChecksum,
          confirmAccuracy: "on",
        },
      },
      {
        testAfterMembershipLock: async () => {
          confirmHeld.markReached();
          await confirmHeld.waitForRelease();
        },
      },
    );
    await confirmHeld.waitUntilReached();

    const membershipHooks: MembershipMutationTestHooks = {
      testBeforeTargetMembershipLock: async () => {
        membershipBefore.markReached();
      },
    };
    const membershipOp =
      operation === "demotion"
        ? changeMemberRole(
            {
              actor: ctx.owner,
              organizationId: ctx.organizationId,
              membershipId: membership.id,
              nextRole: "MEMBER",
            },
            membershipHooks,
          )
        : deactivateMember(
            {
              actor: ctx.owner,
              organizationId: ctx.organizationId,
              membershipId: membership.id,
            },
            membershipHooks,
          );

    await membershipBefore.waitUntilReached();
    confirmHeld.release();
    const [confirmResult, membershipResult] = await Promise.all([
      confirm,
      membershipOp,
    ]);

    expect(membershipResult.ok).toBe(true);
    expect(confirmResult.ok).toBe(true);
    if (!confirmResult.ok) throw new Error(confirmResult.message);
    expect(confirmResult.version.state).toBe("ACTIVE");
    expect(
      await countKnowledgeAudits(
        prisma,
        ctx.organizationId,
        "KNOWLEDGE_VERSION_CONFIRMED",
      ),
    ).toBe(1);
  }

  it("linearizes confirmation that already rechecked membership before demotion", async () => {
    await raceConfirmAgainstMembership("demotion");
  });

  it("linearizes confirmation that already rechecked membership before deactivation", async () => {
    await raceConfirmAgainstMembership("deactivation");
  });

  it("fails confirmation that waits on the membership lock after demotion", async () => {
    const ctx = await createOrgWithOwner(prisma, "know-demote-wait");
    const admin = await addMember(
      prisma,
      ctx.organizationId,
      "know-demote-wait-admin",
      "ADMIN",
    );
    const membership = await prisma.membership.findFirstOrThrow({
      where: { organizationId: ctx.organizationId, userId: admin.id },
    });
    const created = await createSampleDraft(admin, ctx.organizationId);
    const confirmBeforeMembership = createGate();
    const demoteHeld = createGate();

    const demote = changeMemberRole(
      {
        actor: ctx.owner,
        organizationId: ctx.organizationId,
        membershipId: membership.id,
        nextRole: "MEMBER",
      },
      {
        testAfterTargetMembershipLock: async () => {
          demoteHeld.markReached();
          await demoteHeld.waitForRelease();
        },
      },
    );
    await demoteHeld.waitUntilReached();

    const confirm = confirmKnowledgeVersion(
      {
        actor: admin,
        organizationId: ctx.organizationId,
        raw: {
          sourceId: created.source.id,
          versionId: created.version.id,
          expectedDraftRevision: String(created.version.draftRevision),
          expectedChecksum: created.version.contentChecksum,
          confirmAccuracy: "on",
        },
      },
      {
        testBeforeMembershipLock: async () => {
          confirmBeforeMembership.markReached();
        },
      },
    );
    await confirmBeforeMembership.waitUntilReached();
    demoteHeld.release();

    const [demoteResult, confirmResult] = await Promise.all([demote, confirm]);
    expect(demoteResult.ok).toBe(true);
    expect(confirmResult.ok).toBe(false);
    if (!confirmResult.ok) {
      expect(confirmResult.reason).toBe("forbidden");
    }
    expect(
      await countKnowledgeAudits(
        prisma,
        ctx.organizationId,
        "KNOWLEDGE_VERSION_CONFIRMED",
      ),
    ).toBe(0);
    const version = await prisma.knowledgeVersion.findUniqueOrThrow({
      where: { id: created.version.id },
    });
    expect(version.state).toBe("DRAFT");
  });
});
