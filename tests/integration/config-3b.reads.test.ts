import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { resetServerEnvCache } from "@/lib/env/server";
import { setMailerForTests, type EmailSender } from "@/lib/email/mailer";
import {
  getTemplateAssignment,
  listAvailableTemplates,
  previewTemplateSwitch,
} from "@/lib/orgs/business-templates";
import {
  getConfigProgress,
  startConfigProgress,
} from "@/lib/orgs/config-progress";
import { listCustomFields } from "@/lib/orgs/custom-fields";
import { listHolidayClosures } from "@/lib/orgs/holiday-closures";
import { getLocaleSettings } from "@/lib/orgs/locale-settings";
import {
  getCallbackPolicy,
  getNotificationDefaults,
  getRecordingConsentPolicy,
  listCallDispositions,
  listLeadStages,
} from "@/lib/orgs/operational-defaults";
import { listServiceAreas } from "@/lib/orgs/service-areas";
import {
  countConfig3bAudits,
  createOrgWithOwner,
  seedPhase3aCompletedOrg,
  snapshotPhase3aCore,
} from "@/tests/integration/helpers/config-3b";
import { resetApplicationData } from "@/tests/integration/reset";

const mockMailer: EmailSender = {
  async send() {},
};

async function countPhase3bRows(prisma: PrismaClient, organizationId: string) {
  const [
    progress,
    locale,
    template,
    fields,
    areas,
    closures,
    stages,
    dispositions,
    callback,
    recording,
    notifications,
  ] = await Promise.all([
    prisma.organizationConfigProgress.count({ where: { organizationId } }),
    prisma.organizationLocaleSettings.count({ where: { organizationId } }),
    prisma.organizationTemplateAssignment.count({ where: { organizationId } }),
    prisma.customFieldDefinition.count({ where: { organizationId } }),
    prisma.serviceArea.count({ where: { organizationId } }),
    prisma.holidayClosure.count({ where: { organizationId } }),
    prisma.leadStageDefault.count({ where: { organizationId } }),
    prisma.callDispositionDefault.count({ where: { organizationId } }),
    prisma.organizationCallbackPolicy.count({ where: { organizationId } }),
    prisma.organizationRecordingConsentPolicy.count({
      where: { organizationId },
    }),
    prisma.organizationNotificationDefaults.count({
      where: { organizationId },
    }),
  ]);
  return {
    progress,
    locale,
    template,
    fields,
    areas,
    closures,
    stages,
    dispositions,
    callback,
    recording,
    notifications,
  };
}

describe("Phase 3B reads are side-effect free", () => {
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

  it("GET/read helpers do not initialize, version-bump, audit, or create examples", async () => {
    const seeded = await seedPhase3aCompletedOrg(prisma, {
      prefix: "rd-side",
    });
    const beforeCore = await snapshotPhase3aCore(prisma, seeded.organizationId);
    const beforeRows = await countPhase3bRows(prisma, seeded.organizationId);
    const beforeAudits = await countConfig3bAudits(
      prisma,
      seeded.organizationId,
    );
    expect(beforeRows).toEqual({
      progress: 0,
      locale: 0,
      template: 0,
      fields: 0,
      areas: 0,
      closures: 0,
      stages: 0,
      dispositions: 0,
      callback: 0,
      recording: 0,
      notifications: 0,
    });

    const reads = await Promise.all([
      getTemplateAssignment({
        actor: seeded.owner,
        organizationId: seeded.organizationId,
      }),
      listAvailableTemplates({
        actor: seeded.owner,
        organizationId: seeded.organizationId,
      }),
      previewTemplateSwitch({
        actor: seeded.owner,
        organizationId: seeded.organizationId,
        templateKey: "PROFESSIONAL_SERVICES",
      }),
      getConfigProgress({
        actor: seeded.owner,
        organizationId: seeded.organizationId,
      }),
      getLocaleSettings({
        actor: seeded.owner,
        organizationId: seeded.organizationId,
      }),
      listCustomFields({
        actor: seeded.owner,
        organizationId: seeded.organizationId,
      }),
      listServiceAreas({
        actor: seeded.owner,
        organizationId: seeded.organizationId,
      }),
      listHolidayClosures({
        actor: seeded.owner,
        organizationId: seeded.organizationId,
      }),
      listLeadStages({
        actor: seeded.owner,
        organizationId: seeded.organizationId,
      }),
      listCallDispositions({
        actor: seeded.owner,
        organizationId: seeded.organizationId,
      }),
      getCallbackPolicy({
        actor: seeded.owner,
        organizationId: seeded.organizationId,
      }),
      getRecordingConsentPolicy({
        actor: seeded.owner,
        organizationId: seeded.organizationId,
      }),
      getNotificationDefaults({
        actor: seeded.owner,
        organizationId: seeded.organizationId,
      }),
    ]);

    expect(reads[0]).toMatchObject({ ok: false, reason: "not_selected" });
    expect(reads[1]?.ok).toBe(true);
    expect(reads[2]?.ok).toBe(true);
    expect(reads[3]).toMatchObject({ ok: false, reason: "not_started" });
    expect(reads[4]).toMatchObject({ ok: false, reason: "not_initialized" });
    expect(reads[10]).toMatchObject({ ok: false, reason: "not_initialized" });
    expect(reads[11]).toMatchObject({ ok: false, reason: "not_initialized" });
    expect(reads[12]).toMatchObject({ ok: false, reason: "not_initialized" });

    expect(await countPhase3bRows(prisma, seeded.organizationId)).toEqual(
      beforeRows,
    );
    expect(await countConfig3bAudits(prisma, seeded.organizationId)).toBe(
      beforeAudits,
    );
    expect(await snapshotPhase3aCore(prisma, seeded.organizationId)).toEqual(
      beforeCore,
    );
    expect(beforeCore.onboarding?.status).toBe("COMPLETED");
    expect(beforeCore.onboarding?.isConfigurationReady).toBe(true);
  });

  it("completed Phase 3A org stays completed after Phase 3B startConfigProgress", async () => {
    const seeded = await seedPhase3aCompletedOrg(prisma, {
      prefix: "rd-compat",
    });
    const before = await snapshotPhase3aCore(prisma, seeded.organizationId);
    expect(before.onboarding?.status).toBe("COMPLETED");
    expect(before.onboarding?.isConfigurationReady).toBe(true);

    const started = await startConfigProgress({
      actor: seeded.owner,
      organizationId: seeded.organizationId,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.progress.status).toBe("IN_PROGRESS");

    const after = await snapshotPhase3aCore(prisma, seeded.organizationId);
    expect(after.onboarding).toEqual(before.onboarding);
    expect(after.profileVersion).toBe(before.profileVersion);
    expect(after.settingsVersion).toBe(before.settingsVersion);
    expect(after.hours).toEqual(before.hours);
    expect(after.serviceIds).toEqual(before.serviceIds);
    expect(after.productIds).toEqual(before.productIds);

    // Reads still do not recompute/persist onboarding readiness.
    const progressRead = await getConfigProgress({
      actor: seeded.owner,
      organizationId: seeded.organizationId,
    });
    expect(progressRead.ok).toBe(true);
    const still = await snapshotPhase3aCore(prisma, seeded.organizationId);
    expect(still.onboarding).toEqual(before.onboarding);
  });

  it("reads after init still do not bump versions or re-persist state", async () => {
    const { owner, organizationId } = await createOrgWithOwner(
      prisma,
      "rd-init",
    );
    await startConfigProgress({ actor: owner, organizationId });

    const beforeLocale =
      await prisma.organizationLocaleSettings.findUniqueOrThrow({
        where: { organizationId },
      });
    const beforeProgress =
      await prisma.organizationConfigProgress.findUniqueOrThrow({
        where: { organizationId },
      });
    const beforeAudits = await countConfig3bAudits(prisma, organizationId);

    await getLocaleSettings({ actor: owner, organizationId });
    await getConfigProgress({ actor: owner, organizationId });
    await getCallbackPolicy({ actor: owner, organizationId });
    await getRecordingConsentPolicy({ actor: owner, organizationId });
    await getNotificationDefaults({ actor: owner, organizationId });

    const afterLocale =
      await prisma.organizationLocaleSettings.findUniqueOrThrow({
        where: { organizationId },
      });
    const afterProgress =
      await prisma.organizationConfigProgress.findUniqueOrThrow({
        where: { organizationId },
      });
    expect(afterLocale.version).toBe(beforeLocale.version);
    expect(afterLocale.updatedAt.toISOString()).toBe(
      beforeLocale.updatedAt.toISOString(),
    );
    expect(afterProgress.version).toBe(beforeProgress.version);
    expect(await countConfig3bAudits(prisma, organizationId)).toBe(
      beforeAudits,
    );
  });
});
