import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  advanceConfigSection,
  startConfigProgress,
} from "@/lib/orgs/config-progress";
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

  async function setup(prefix: string) {
    const ctx = await createOrgWithOwner(prisma, prefix);
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
    return { ...ctx, progress: started.progress };
  }

  it("allows one deterministic same-version winner and one conflict", async () => {
    const ctx = await setup("progress-concurrent");
    const gate = createGate();
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
          gate.markReached();
          await gate.waitForRelease();
        },
      },
    );
    await gate.waitUntilReached();

    const second = advanceConfigSection({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: {
        section: "BUSINESS_TEMPLATE",
        expectedVersion: ctx.progress.version,
      },
    });
    gate.release();
    const results = await Promise.all([first, second]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const failure = results.find((result) => !result.ok);
    expect(failure?.ok).toBe(false);
    if (failure && !failure.ok) expect(failure.reason).toBe("conflict");
    expect(
      await prisma.organizationAuditEvent.count({
        where: {
          organizationId: ctx.organizationId,
          action: "CONFIG_PROGRESS_UPDATED",
          metadata: { path: ["section"], equals: "BUSINESS_TEMPLATE" },
        },
      }),
    ).toBe(1);
  });

  it.each(["MEMBER", "INACTIVE"] as const)(
    "loses to a deterministic membership %s race before the membership lock",
    async (membershipState) => {
      const ctx = await setup(`progress-${membershipState.toLowerCase()}`);
      const admin = await addMember(
        prisma,
        ctx.organizationId,
        `progress-admin-${membershipState.toLowerCase()}`,
        "ADMIN",
      );
      const gate = createGate();
      const advancing = advanceConfigSection(
        {
          actor: admin,
          organizationId: ctx.organizationId,
          raw: {
            section: "BUSINESS_TEMPLATE",
            expectedVersion: ctx.progress.version,
          },
        },
        {
          testAfterConfig3bLock: async () => {
            gate.markReached();
            await gate.waitForRelease();
          },
        },
      );
      await gate.waitUntilReached();
      await prisma.membership.update({
        where: {
          organizationId_userId: {
            organizationId: ctx.organizationId,
            userId: admin.id,
          },
        },
        data:
          membershipState === "MEMBER"
            ? { role: "MEMBER" }
            : { status: "INACTIVE" },
      });
      gate.release();

      const result = await advancing;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe(
          membershipState === "MEMBER" ? "forbidden" : "inactive_membership",
        );
      }
      expect(
        await prisma.organizationConfigProgress.findUniqueOrThrow({
          where: { organizationId: ctx.organizationId },
        }),
      ).toMatchObject({
        currentSection: "BUSINESS_TEMPLATE",
        version: ctx.progress.version,
      });
    },
  );
});
