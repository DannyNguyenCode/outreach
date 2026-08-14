import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { CONFIG_SECTIONS } from "@/lib/orgs/config-3b-validation";
import {
  advanceConfigSection,
  startConfigProgress,
} from "@/lib/orgs/config-progress";
import { seedPhase3aCompletedOrg } from "@/tests/integration/helpers/config-3b";
import { resetApplicationData } from "@/tests/integration/reset";

describe("Phase 3B server-authoritative progress lifecycle", () => {
  const prisma = new PrismaClient();

  beforeEach(async () => {
    await resetApplicationData(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function seeded(prefix: string) {
    const result = await seedPhase3aCompletedOrg(prisma, { prefix });
    const onboardingBefore =
      await prisma.organizationOnboarding.findUniqueOrThrow({
        where: { organizationId: result.organizationId },
      });
    const started = await startConfigProgress({
      actor: result.owner,
      organizationId: result.organizationId,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) throw new Error(started.message);
    return { ...result, onboardingBefore, progress: started.progress };
  }

  async function addRequirements(organizationId: string, userId: string) {
    await prisma.organizationTemplateAssignment.create({
      data: {
        organizationId,
        templateKey: "CUSTOM_MIXED",
        templateDefinitionVersion: 1,
        selectedByUserId: userId,
      },
    });
    await prisma.leadStageDefault.create({
      data: {
        organizationId,
        key: "new",
        label: "New",
        isActive: true,
        isDefault: true,
      },
    });
    await prisma.callDispositionDefault.create({
      data: {
        organizationId,
        key: "answered",
        label: "Answered",
        isActive: true,
      },
    });
  }

  it("starts at BUSINESS_TEMPLATE without changing completed Phase 3A", async () => {
    const ctx = await seeded("progress-start");
    expect(ctx.progress).toMatchObject({
      status: "IN_PROGRESS",
      currentSection: "BUSINESS_TEMPLATE",
      completedSections: [],
    });
    expect(
      await prisma.organizationOnboarding.findUniqueOrThrow({
        where: { organizationId: ctx.organizationId },
      }),
    ).toMatchObject({
      status: ctx.onboardingBefore.status,
      version: ctx.onboardingBefore.version,
      isConfigurationReady: ctx.onboardingBefore.isConfigurationReady,
    });
  });

  it("rejects REVIEW-first, noncurrent, and missing requirements with zero writes", async () => {
    const ctx = await seeded("progress-reject");
    const auditBefore = await prisma.organizationAuditEvent.count();
    for (const section of ["REVIEW", "LOCALE", "BUSINESS_TEMPLATE"] as const) {
      const result = await advanceConfigSection({
        actor: ctx.owner,
        organizationId: ctx.organizationId,
        raw: { section, expectedVersion: ctx.progress.version },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("validation");
    }
    const row = await prisma.organizationConfigProgress.findUniqueOrThrow({
      where: { organizationId: ctx.organizationId },
    });
    expect(row.version).toBe(ctx.progress.version);
    expect(await prisma.organizationAuditEvent.count()).toBe(auditBefore);
  });

  it("ignores forged destination and completes once in canonical unique order", async () => {
    const ctx = await seeded("progress-sequence");
    await addRequirements(ctx.organizationId, ctx.owner.id);

    let version = ctx.progress.version;
    for (const section of CONFIG_SECTIONS) {
      const result = await advanceConfigSection({
        actor: ctx.owner,
        organizationId: ctx.organizationId,
        raw: {
          section,
          expectedVersion: version,
          nextSection: "REVIEW",
          markCompleted: false,
        },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.message);
      version = result.progress.version;
      if (section === "BUSINESS_TEMPLATE") {
        expect(result.progress.currentSection).toBe("LOCALE");
      }
    }

    const completed = await prisma.organizationConfigProgress.findUniqueOrThrow(
      {
        where: { organizationId: ctx.organizationId },
      },
    );
    expect(completed.status).toBe("COMPLETED");
    expect(completed.currentSection).toBe("REVIEW");
    expect(completed.completedSections).toEqual(CONFIG_SECTIONS);
    expect(new Set(completed.completedSections as string[]).size).toBe(
      CONFIG_SECTIONS.length,
    );

    const stale = await advanceConfigSection({
      actor: ctx.owner,
      organizationId: ctx.organizationId,
      raw: { section: "REVIEW", expectedVersion: version - 1 },
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.reason).toBe("conflict");
  });
});
