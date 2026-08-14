import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { resetServerEnvCache } from "@/lib/env/server";
import { setMailerForTests, type EmailSender } from "@/lib/email/mailer";
import { getTemplateAssignment } from "@/lib/orgs/business-templates";
import {
  getConfigProgress,
  startConfigProgress,
} from "@/lib/orgs/config-progress";
import { getLocaleSettings } from "@/lib/orgs/locale-settings";
import {
  getCallbackPolicy,
  getRecordingConsentPolicy,
} from "@/lib/orgs/operational-defaults";
import {
  seedPhase3aCompletedOrg,
  snapshotPhase3aCore,
} from "@/tests/integration/helpers/config-3b";
import { resetApplicationData } from "@/tests/integration/reset";

const mockMailer: EmailSender = {
  async send() {},
};

describe("Phase 3B migration compatibility with Phase 3A", () => {
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

  it("Phase 3A-only org reads as not_selected / not_initialized until startConfigProgress", async () => {
    const seeded = await seedPhase3aCompletedOrg(prisma, {
      prefix: "mig-3a",
      name: "Legacy Completed Org",
      businessType: "BOTH",
    });

    // Prove only Phase 3A data exists.
    expect(
      await prisma.organizationOnboarding.findUnique({
        where: { organizationId: seeded.organizationId },
      }),
    ).toMatchObject({
      status: "COMPLETED",
      isConfigurationReady: true,
    });
    expect(
      await prisma.businessProfile.findUnique({
        where: { organizationId: seeded.organizationId },
      }),
    ).not.toBeNull();
    expect(
      await prisma.organizationConfigProgress.findUnique({
        where: { organizationId: seeded.organizationId },
      }),
    ).toBeNull();
    expect(
      await prisma.organizationLocaleSettings.findUnique({
        where: { organizationId: seeded.organizationId },
      }),
    ).toBeNull();
    expect(
      await prisma.organizationTemplateAssignment.findUnique({
        where: { organizationId: seeded.organizationId },
      }),
    ).toBeNull();

    const template = await getTemplateAssignment({
      actor: seeded.owner,
      organizationId: seeded.organizationId,
    });
    expect(template.ok).toBe(false);
    if (!template.ok) expect(template.reason).toBe("not_selected");

    const progress = await getConfigProgress({
      actor: seeded.owner,
      organizationId: seeded.organizationId,
    });
    expect(progress.ok).toBe(false);
    if (!progress.ok) expect(progress.reason).toBe("not_started");

    const locale = await getLocaleSettings({
      actor: seeded.owner,
      organizationId: seeded.organizationId,
    });
    expect(locale.ok).toBe(false);
    if (!locale.ok) expect(locale.reason).toBe("not_initialized");

    const callback = await getCallbackPolicy({
      actor: seeded.owner,
      organizationId: seeded.organizationId,
    });
    expect(callback.ok).toBe(false);
    if (!callback.ok) expect(callback.reason).toBe("not_initialized");

    const recording = await getRecordingConsentPolicy({
      actor: seeded.owner,
      organizationId: seeded.organizationId,
    });
    expect(recording.ok).toBe(false);
    if (!recording.ok) expect(recording.reason).toBe("not_initialized");

    // Still no Phase 3B rows after reads.
    expect(
      await prisma.organizationConfigProgress.count({
        where: { organizationId: seeded.organizationId },
      }),
    ).toBe(0);

    const before = await snapshotPhase3aCore(prisma, seeded.organizationId);

    const started = await startConfigProgress({
      actor: seeded.owner,
      organizationId: seeded.organizationId,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.progress.status).toBe("IN_PROGRESS");

    const after = await snapshotPhase3aCore(prisma, seeded.organizationId);
    expect(after.onboarding?.status).toBe("COMPLETED");
    expect(after.onboarding?.isConfigurationReady).toBe(true);
    expect(after.onboarding).toEqual(before.onboarding);
    expect(after.profileVersion).toBe(before.profileVersion);
    expect(after.settingsVersion).toBe(before.settingsVersion);
    expect(after.hours).toEqual(before.hours);
    expect(after.serviceIds).toEqual(before.serviceIds);
    expect(after.productIds).toEqual(before.productIds);

    // Phase 3A tables remain intact and queryable.
    expect(
      await prisma.businessProfile.count({
        where: { organizationId: seeded.organizationId },
      }),
    ).toBe(1);
    expect(
      await prisma.operatingHourInterval.count({
        where: { organizationId: seeded.organizationId },
      }),
    ).toBe(7);
    expect(
      await prisma.businessService.count({
        where: { organizationId: seeded.organizationId },
      }),
    ).toBeGreaterThan(0);
    expect(
      await prisma.businessProduct.count({
        where: { organizationId: seeded.organizationId },
      }),
    ).toBeGreaterThan(0);
    expect(
      await prisma.organizationSettings.count({
        where: { organizationId: seeded.organizationId },
      }),
    ).toBe(1);

    // Phase 3B defaults now exist with safe recording defaults.
    const recordingAfter = await getRecordingConsentPolicy({
      actor: seeded.owner,
      organizationId: seeded.organizationId,
    });
    expect(recordingAfter.ok).toBe(true);
    if (recordingAfter.ok) {
      expect(recordingAfter.policy.recordingEnabled).toBe(false);
      expect(recordingAfter.policy.transcriptionEnabled).toBe(false);
      expect(recordingAfter.policy.consentCaptureRequired).toBe(true);
    }
  });
});
