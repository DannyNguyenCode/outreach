import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { MembershipMutationTestHooks } from "@/lib/orgs/business-access";
import {
  archiveKnowledgeSource,
  confirmKnowledgeVersion,
} from "@/lib/orgs/knowledge";
import { retrieveActiveKnowledge } from "@/lib/orgs/knowledge-retrieval";
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
    const active = versions.find((version) => version.state === "ACTIVE");
    expect(active?.confirmedAt).toBeTruthy();
    expect(active?.confirmationLanguageVersion).toBe("knowledge.confirm.v1");
    expect(active?.confirmerUserId).toBe(ctx.owner.id);
    expect(
      await countKnowledgeAudits(
        prisma,
        ctx.organizationId,
        "KNOWLEDGE_VERSION_CONFIRMED",
      ),
    ).toBe(1);

    const retrieved = await retrieveActiveKnowledge({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
    });
    expect(retrieved.ok).toBe(true);
    if (retrieved.ok) {
      expect(retrieved.items).toHaveLength(1);
      expect(retrieved.items[0]?.citation.versionId).toBe(created.version.id);
    }

    const sentinelVersion = await prisma.knowledgeVersion.findUniqueOrThrow({
      where: { id: sentinelDraft.version.id },
    });
    expect(sentinelVersion.state).toBe("DRAFT");
  });

  async function raceConfirmFirstAgainstMembership(
    operation: "demotion" | "deactivation",
  ) {
    const ctx = await createOrgWithOwner(prisma, `know-${operation}-first`);
    const admin = await addMember(
      prisma,
      ctx.organizationId,
      `know-${operation}-first-admin`,
      "ADMIN",
    );
    const membership = await prisma.membership.findFirstOrThrow({
      where: { organizationId: ctx.organizationId, userId: admin.id },
    });
    const created = await createSampleDraft(admin, ctx.organizationId);
    const confirmHeld = createGate();
    const membershipBefore = createGate();
    let membershipAcquiredTargetLock = false;

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
      testAfterTargetMembershipLock: async () => {
        membershipAcquiredTargetLock = true;
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
    expect(membershipAcquiredTargetLock).toBe(false);
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

    const later = await confirmKnowledgeVersion({
      actor: admin,
      organizationId: ctx.organizationId,
      raw: {
        sourceId: created.source.id,
        versionId: created.version.id,
        expectedDraftRevision: String(created.version.draftRevision + 1),
        expectedChecksum: created.version.contentChecksum,
        confirmAccuracy: "on",
      },
    });
    expect(later.ok).toBe(false);
    if (!later.ok) {
      expect(["forbidden", "inactive_membership", "conflict"]).toContain(
        later.reason,
      );
    }
  }

  it("linearizes confirmation that already rechecked membership before demotion", async () => {
    await raceConfirmFirstAgainstMembership("demotion");
  });

  it("linearizes confirmation that already rechecked membership before deactivation", async () => {
    await raceConfirmFirstAgainstMembership("deactivation");
  });

  async function raceMembershipFirstAgainstConfirm(
    operation: "demotion" | "deactivation",
  ) {
    const ctx = await createOrgWithOwner(prisma, `know-${operation}-wait`);
    const admin = await addMember(
      prisma,
      ctx.organizationId,
      `know-${operation}-wait-admin`,
      "ADMIN",
    );
    const membership = await prisma.membership.findFirstOrThrow({
      where: { organizationId: ctx.organizationId, userId: admin.id },
    });
    const created = await createSampleDraft(admin, ctx.organizationId);
    const confirmBeforeMembership = createGate();
    const membershipHeld = createGate();
    let confirmAcquiredMembershipLock = false;

    const membershipOp =
      operation === "demotion"
        ? changeMemberRole(
            {
              actor: ctx.owner,
              organizationId: ctx.organizationId,
              membershipId: membership.id,
              nextRole: "MEMBER",
            },
            {
              testAfterTargetMembershipLock: async () => {
                membershipHeld.markReached();
                await membershipHeld.waitForRelease();
              },
            },
          )
        : deactivateMember(
            {
              actor: ctx.owner,
              organizationId: ctx.organizationId,
              membershipId: membership.id,
            },
            {
              testAfterTargetMembershipLock: async () => {
                membershipHeld.markReached();
                await membershipHeld.waitForRelease();
              },
            },
          );
    await membershipHeld.waitUntilReached();

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
        testAfterMembershipLock: async () => {
          confirmAcquiredMembershipLock = true;
        },
      },
    );
    await confirmBeforeMembership.waitUntilReached();
    expect(confirmAcquiredMembershipLock).toBe(false);
    membershipHeld.release();

    const [membershipResult, confirmResult] = await Promise.all([
      membershipOp,
      confirm,
    ]);
    expect(membershipResult.ok).toBe(true);
    expect(confirmResult.ok).toBe(false);
    if (!confirmResult.ok) {
      expect(
        operation === "demotion" ? "forbidden" : "inactive_membership",
      ).toBe(confirmResult.reason);
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
  }

  it("fails confirmation that waits on the membership lock after demotion", async () => {
    await raceMembershipFirstAgainstConfirm("demotion");
  });

  it("fails confirmation that waits on the membership lock after deactivation", async () => {
    await raceMembershipFirstAgainstConfirm("deactivation");
  });

  it("archives after a winning confirmation and excludes the source from retrieval", async () => {
    const ctx = await createOrgWithOwner(prisma, "know-confirm-archive");
    const sentinel = await createOrgWithOwner(
      prisma,
      "know-confirm-archive-sentinel",
    );
    const created = await createSampleDraft(ctx.owner, ctx.organizationId);
    const sentinelDraft = await createSampleDraft(
      sentinel.owner,
      sentinel.organizationId,
    );
    const confirmHeld = createGate();
    const archiveBefore = createGate();
    let archiveAcquiredLock = false;

    const confirm = confirmKnowledgeVersion(
      {
        actor: ctx.owner,
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
        testAfterKnowledgeLock: async () => {
          confirmHeld.markReached();
          await confirmHeld.waitForRelease();
        },
      },
    );
    await confirmHeld.waitUntilReached();

    const archive = archiveKnowledgeSource(
      {
        actor: ctx.owner,
        organizationId: ctx.organizationId,
        raw: {
          sourceId: created.source.id,
          expectedVersion: String(created.source.version + 1),
        },
      },
      {
        testBeforeKnowledgeLock: async () => {
          archiveBefore.markReached();
        },
        testAfterKnowledgeLock: async () => {
          archiveAcquiredLock = true;
        },
      },
    );
    await archiveBefore.waitUntilReached();
    expect(archiveAcquiredLock).toBe(false);
    confirmHeld.release();

    const [confirmResult, archiveResult] = await Promise.all([
      confirm,
      archive,
    ]);
    expect(confirmResult.ok).toBe(true);
    expect(archiveResult.ok).toBe(true);
    expect(
      await countKnowledgeAudits(
        prisma,
        ctx.organizationId,
        "KNOWLEDGE_VERSION_CONFIRMED",
      ),
    ).toBe(1);
    expect(
      await countKnowledgeAudits(
        prisma,
        ctx.organizationId,
        "KNOWLEDGE_SOURCE_ARCHIVED",
      ),
    ).toBe(1);

    const retrieved = await retrieveActiveKnowledge({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
    });
    expect(retrieved.ok).toBe(true);
    if (retrieved.ok) {
      expect(retrieved.items).toEqual([]);
    }
    const sentinelVersion = await prisma.knowledgeVersion.findUniqueOrThrow({
      where: { id: sentinelDraft.version.id },
    });
    expect(sentinelVersion.state).toBe("DRAFT");
  });

  it("rejects confirmation that waits behind an archive", async () => {
    const ctx = await createOrgWithOwner(prisma, "know-archive-confirm");
    const created = await createSampleDraft(ctx.owner, ctx.organizationId);
    const archiveHeld = createGate();
    const confirmBefore = createGate();
    let confirmAcquiredLock = false;

    const archive = archiveKnowledgeSource(
      {
        actor: ctx.owner,
        organizationId: ctx.organizationId,
        raw: {
          sourceId: created.source.id,
          expectedVersion: String(created.source.version),
        },
      },
      {
        testAfterKnowledgeLock: async () => {
          archiveHeld.markReached();
          await archiveHeld.waitForRelease();
        },
      },
    );
    await archiveHeld.waitUntilReached();

    const confirm = confirmKnowledgeVersion(
      {
        actor: ctx.owner,
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
        testBeforeKnowledgeLock: async () => {
          confirmBefore.markReached();
        },
        testAfterKnowledgeLock: async () => {
          confirmAcquiredLock = true;
        },
      },
    );
    await confirmBefore.waitUntilReached();
    expect(confirmAcquiredLock).toBe(false);
    archiveHeld.release();

    const [archiveResult, confirmResult] = await Promise.all([
      archive,
      confirm,
    ]);
    expect(archiveResult.ok).toBe(true);
    expect(confirmResult.ok).toBe(false);
    if (!confirmResult.ok) {
      expect(confirmResult.reason).toBe("already_archived");
    }
    expect(
      await countKnowledgeAudits(
        prisma,
        ctx.organizationId,
        "KNOWLEDGE_VERSION_CONFIRMED",
      ),
    ).toBe(0);
    expect(
      await countKnowledgeAudits(
        prisma,
        ctx.organizationId,
        "KNOWLEDGE_SOURCE_ARCHIVED",
      ),
    ).toBe(1);
  });
});
