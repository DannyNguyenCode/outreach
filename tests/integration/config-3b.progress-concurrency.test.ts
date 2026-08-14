import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  advanceConfigSection,
  startConfigProgress,
} from "@/lib/orgs/config-progress";
import type { MembershipMutationTestHooks } from "@/lib/orgs/business-access";
import { changeMemberRole, deactivateMember } from "@/lib/orgs/memberships";
import { startOrganizationOnboarding } from "@/lib/orgs/onboarding";
import {
  addMember,
  createGate,
  createOrgWithOwner,
} from "@/tests/integration/helpers/config-3b";
import { resetApplicationData } from "@/tests/integration/reset";

describe("Phase 3B progress concurrency", () => {
  const prisma = new PrismaClient();

  beforeEach(async () => {
    await resetApplicationData(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function setup(prefix: string, includeAdmin = false) {
    const ctx = await createOrgWithOwner(prisma, prefix);
    const onboarding = await startOrganizationOnboarding({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
    });
    if (!onboarding.ok) throw new Error(onboarding.message);
    const started = await startConfigProgress({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
    });
    if (!started.ok) throw new Error(started.message);
    await prisma.organizationTemplateAssignment.create({
      data: {
        organizationId: ctx.organizationId,
        templateKey: "CUSTOM_MIXED",
        templateDefinitionVersion: 1,
        selectedByUserId: ctx.owner.id,
      },
    });
    if (!includeAdmin) {
      return {
        ...ctx,
        progress: started.progress,
        admin: null,
        adminMembership: null,
      };
    }
    const admin = await addMember(
      prisma,
      ctx.organizationId,
      `${prefix}-admin`,
      "ADMIN",
    );
    const adminMembership = await prisma.membership.findFirstOrThrow({
      where: { organizationId: ctx.organizationId, userId: admin.id },
    });
    return { ...ctx, progress: started.progress, admin, adminMembership };
  }

  type SetupContext = Awaited<ReturnType<typeof setup>>;
  type MembershipOperation = "demotion" | "deactivation";

  async function onboardingSnapshot(organizationId: string) {
    return prisma.organizationOnboarding.findUniqueOrThrow({
      where: { organizationId },
    });
  }

  async function progressSnapshot(organizationId: string) {
    return prisma.organizationConfigProgress.findUniqueOrThrow({
      where: { organizationId },
      select: {
        status: true,
        currentSection: true,
        completedSections: true,
        version: true,
        updatedByUserId: true,
      },
    });
  }

  async function progressAuditCount(organizationId: string) {
    return prisma.organizationAuditEvent.count({
      where: {
        organizationId,
        action: "CONFIG_PROGRESS_UPDATED",
        metadata: { path: ["section"], equals: "BUSINESS_TEMPLATE" },
      },
    });
  }

  function advanceAsAdmin(
    ctx: SetupContext,
    hooks: Parameters<typeof advanceConfigSection>[1] = {},
  ) {
    if (!ctx.admin) throw new Error("setup requires an admin");
    return advanceConfigSection(
      {
        actor: ctx.admin,
        organizationId: ctx.organizationId,
        raw: {
          section: "BUSINESS_TEMPLATE",
          expectedVersion: ctx.progress.version,
        },
      },
      hooks,
    );
  }

  function runMembershipOperation(
    operation: MembershipOperation,
    ctx: SetupContext,
    hooks: MembershipMutationTestHooks,
  ) {
    if (!ctx.adminMembership) throw new Error("setup requires an admin");
    return operation === "demotion"
      ? changeMemberRole(
          {
            actor: ctx.owner,
            organizationId: ctx.organizationId,
            membershipId: ctx.adminMembership.id,
            nextRole: "MEMBER",
          },
          hooks,
        )
      : deactivateMember(
          {
            actor: ctx.owner,
            organizationId: ctx.organizationId,
            membershipId: ctx.adminMembership.id,
          },
          hooks,
        );
  }

  async function expectInitialProgress(ctx: SetupContext) {
    expect(await progressSnapshot(ctx.organizationId)).toMatchObject({
      status: "IN_PROGRESS",
      currentSection: "BUSINESS_TEMPLATE",
      completedSections: [],
      version: ctx.progress.version,
    });
    expect(await progressAuditCount(ctx.organizationId)).toBe(0);
  }

  it("allows one deterministic same-version winner and one conflict", async () => {
    const ctx = await setup("progress-concurrent");
    const sentinel = await setup("progress-concurrent-sentinel");
    const onboardingBefore = await onboardingSnapshot(ctx.organizationId);
    const sentinelOnboardingBefore = await onboardingSnapshot(
      sentinel.organizationId,
    );
    const sentinelBefore = await progressSnapshot(sentinel.organizationId);
    const firstHeld = createGate();
    const secondBeforeConfigLock = createGate();
    const secondAfterConfigLock = createGate();
    let secondAcquiredConfigLock = false;

    const first = advanceConfigSection(
      {
        actor: ctx.owner,
        organizationId: ctx.organizationId,
        raw: {
          section: "BUSINESS_TEMPLATE",
          expectedVersion: ctx.progress.version,
        },
      },
      {
        testAfterProgressRequirements: async () => {
          firstHeld.markReached();
          await firstHeld.waitForRelease();
        },
      },
    );
    await firstHeld.waitUntilReached();

    const second = advanceConfigSection(
      {
        actor: ctx.owner,
        organizationId: ctx.organizationId,
        raw: {
          section: "BUSINESS_TEMPLATE",
          expectedVersion: ctx.progress.version,
        },
      },
      {
        testBeforeConfig3bLock: async () => {
          secondBeforeConfigLock.markReached();
        },
        testAfterConfig3bLock: async () => {
          secondAcquiredConfigLock = true;
          secondAfterConfigLock.markReached();
        },
      },
    );

    await secondBeforeConfigLock.waitUntilReached();
    expect(secondAcquiredConfigLock).toBe(false);

    firstHeld.release();
    const firstResult = await first;
    await secondAfterConfigLock.waitUntilReached();
    const secondResult = await second;
    const results = [firstResult, secondResult];

    const successes = results.filter((result) => result.ok);
    const failures = results.filter((result) => !result.ok);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ ok: false, reason: "conflict" });
    if (!successes[0]?.ok) throw new Error("expected one progress winner");

    const finalProgress = await progressSnapshot(ctx.organizationId);
    expect(finalProgress).toMatchObject({
      status: successes[0].progress.status,
      currentSection: successes[0].progress.currentSection,
      completedSections: successes[0].progress.completedSections,
      version: ctx.progress.version + 1,
      updatedByUserId: ctx.owner.id,
    });
    expect(finalProgress.currentSection).toBe("LOCALE");
    expect(new Set(finalProgress.completedSections as string[]).size).toBe(
      (finalProgress.completedSections as string[]).length,
    );
    expect(await progressAuditCount(ctx.organizationId)).toBe(1);
    expect(await onboardingSnapshot(ctx.organizationId)).toEqual(
      onboardingBefore,
    );
    expect(await progressSnapshot(sentinel.organizationId)).toEqual(
      sentinelBefore,
    );
    expect(await onboardingSnapshot(sentinel.organizationId)).toEqual(
      sentinelOnboardingBefore,
    );
    expect(await progressAuditCount(sentinel.organizationId)).toBe(0);
  });

  it.each(["demotion", "deactivation"] as const)(
    "%s-first prevents progress after locking the target membership",
    async (operation) => {
      const ctx = await setup(`progress-${operation}-first`, true);
      const onboardingBefore = await onboardingSnapshot(ctx.organizationId);
      const membershipHeld = createGate();
      const progressBeforeMembershipLock = createGate();

      const membershipMutation = runMembershipOperation(operation, ctx, {
        testAfterTargetMembershipLock: async () => {
          membershipHeld.markReached();
          await membershipHeld.waitForRelease();
        },
      });
      await membershipHeld.waitUntilReached();

      const progressMutation = advanceAsAdmin(ctx, {
        testBeforeMembershipLock: async () => {
          progressBeforeMembershipLock.markReached();
        },
      });
      await progressBeforeMembershipLock.waitUntilReached();

      membershipHeld.release();
      const membershipResult = await membershipMutation;
      expect(membershipResult.ok).toBe(true);
      const progressResult = await progressMutation;
      expect(progressResult.ok).toBe(false);
      if (!progressResult.ok) {
        expect(progressResult.reason).toBe(
          operation === "demotion" ? "forbidden" : "inactive_membership",
        );
      }

      await expectInitialProgress(ctx);
      expect(await onboardingSnapshot(ctx.organizationId)).toEqual(
        onboardingBefore,
      );
    },
  );

  it.each(["demotion", "deactivation"] as const)(
    "progress-first commits once before subsequent %s",
    async (operation) => {
      const ctx = await setup(`progress-first-${operation}`, true);
      const onboardingBefore = await onboardingSnapshot(ctx.organizationId);
      const progressHeld = createGate();
      const membershipBeforeTargetLock = createGate();

      const progressMutation = advanceAsAdmin(ctx, {
        testAfterMembershipLock: async () => {
          progressHeld.markReached();
          await progressHeld.waitForRelease();
        },
      });
      await progressHeld.waitUntilReached();

      const membershipMutation = runMembershipOperation(operation, ctx, {
        testBeforeTargetMembershipLock: async () => {
          membershipBeforeTargetLock.markReached();
        },
      });
      await membershipBeforeTargetLock.waitUntilReached();

      progressHeld.release();
      const progressResult = await progressMutation;
      expect(progressResult.ok).toBe(true);
      const membershipResult = await membershipMutation;
      expect(membershipResult.ok).toBe(true);

      const finalProgress = await progressSnapshot(ctx.organizationId);
      expect(finalProgress).toMatchObject({
        status: "IN_PROGRESS",
        currentSection: "LOCALE",
        completedSections: ["BUSINESS_TEMPLATE"],
        version: ctx.progress.version + 1,
        updatedByUserId: ctx.admin?.id,
      });
      expect(await progressAuditCount(ctx.organizationId)).toBe(1);
      expect(new Set(finalProgress.completedSections as string[]).size).toBe(
        (finalProgress.completedSections as string[]).length,
      );

      if (!ctx.admin) throw new Error("setup requires an admin");
      const later = await advanceConfigSection({
        actor: ctx.admin,
        organizationId: ctx.organizationId,
        raw: {
          section: "LOCALE",
          expectedVersion: finalProgress.version,
        },
      });
      expect(later.ok).toBe(false);
      if (!later.ok) {
        expect(later.reason).toBe(
          operation === "demotion" ? "forbidden" : "inactive_membership",
        );
      }
      expect(await progressSnapshot(ctx.organizationId)).toEqual(finalProgress);
      expect(await progressAuditCount(ctx.organizationId)).toBe(1);
      expect(await onboardingSnapshot(ctx.organizationId)).toEqual(
        onboardingBefore,
      );

      if (!ctx.adminMembership) throw new Error("setup requires an admin");
      const membership = await prisma.membership.findUniqueOrThrow({
        where: { id: ctx.adminMembership.id },
      });
      if (operation === "demotion") {
        expect(membership).toMatchObject({
          role: "MEMBER",
          status: "ACTIVE",
        });
      } else {
        expect(membership.status).toBe("INACTIVE");
      }
    },
  );
});
