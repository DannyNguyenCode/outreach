import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { resetServerEnvCache } from "@/lib/env/server";
import { setMailerForTests, type EmailSender } from "@/lib/email/mailer";
import {
  getCallbackPolicy,
  getRecordingConsentPolicy,
  listCallDispositions,
  listLeadStages,
  replaceCallDispositions,
  replaceLeadStages,
  updateCallbackPolicy,
  updateRecordingConsentPolicy,
} from "@/lib/orgs/operational-defaults";
import {
  addMember,
  createGate,
  createOrgWithOwner,
  seedPhase3aCompletedOrg,
} from "@/tests/integration/helpers/config-3b";
import { resetApplicationData } from "@/tests/integration/reset";

const mockMailer: EmailSender = {
  async send() {},
};

const validStages = {
  stages: [
    {
      key: "new",
      label: "New",
      classification: "INITIAL",
      isDefault: true,
      isActive: true,
    },
    {
      key: "qualified",
      label: "Qualified",
      classification: "NONE",
      isDefault: false,
      isActive: true,
    },
    {
      key: "won",
      label: "Won",
      classification: "WON",
      isDefault: false,
      isActive: true,
    },
  ],
};

describe("Phase 3B operational defaults", () => {
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

  it("enforces lead-stage constraints and exactly one default", async () => {
    const { owner, organizationId } = await createOrgWithOwner(
      prisma,
      "op-stages",
    );

    const ok = await replaceLeadStages({
      actor: owner,
      organizationId,
      raw: validStages,
    });
    expect(ok.ok).toBe(true);

    const noDefault = await replaceLeadStages({
      actor: owner,
      organizationId,
      raw: {
        stages: [
          { key: "a", label: "A", isDefault: false },
          { key: "b", label: "B", isDefault: false },
        ],
      },
    });
    expect(noDefault.ok).toBe(false);
    if (!noDefault.ok) expect(noDefault.reason).toBe("validation");

    const twoDefaults = await replaceLeadStages({
      actor: owner,
      organizationId,
      raw: {
        stages: [
          { key: "a", label: "A", isDefault: true },
          { key: "b", label: "B", isDefault: true },
        ],
      },
    });
    expect(twoDefaults.ok).toBe(false);
    if (!twoDefaults.ok) expect(twoDefaults.reason).toBe("validation");

    const dupKeys = await replaceLeadStages({
      actor: owner,
      organizationId,
      raw: {
        stages: [
          { key: "a", label: "A", isDefault: true },
          { key: "a", label: "A2", isDefault: false },
        ],
      },
    });
    expect(dupKeys.ok).toBe(false);
    if (!dupKeys.ok) expect(dupKeys.reason).toBe("validation");

    const listed = await listLeadStages({ actor: owner, organizationId });
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      expect(listed.stages.filter((s) => s.isDefault)).toHaveLength(1);
    }
  });

  it("validates call dispositions", async () => {
    const { owner, organizationId } = await createOrgWithOwner(
      prisma,
      "op-disp",
    );
    const ok = await replaceCallDispositions({
      actor: owner,
      organizationId,
      raw: {
        dispositions: [
          {
            key: "connected",
            label: "Connected",
            expectsFollowUp: true,
            isTerminal: false,
          },
          {
            key: "not_interested",
            label: "Not interested",
            expectsFollowUp: false,
            isTerminal: true,
          },
        ],
      },
    });
    expect(ok.ok).toBe(true);

    const dup = await replaceCallDispositions({
      actor: owner,
      organizationId,
      raw: {
        dispositions: [
          { key: "a", label: "A" },
          { key: "a", label: "A2" },
        ],
      },
    });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.reason).toBe("validation");

    const listed = await listCallDispositions({ actor: owner, organizationId });
    expect(listed.ok).toBe(true);
    if (listed.ok) expect(listed.dispositions).toHaveLength(2);
  });

  it("enforces callback policy bounds", async () => {
    const seeded = await seedPhase3aCompletedOrg(prisma, {
      prefix: "op-cb",
      startProgress: true,
    });
    const current = await getCallbackPolicy({
      actor: seeded.owner,
      organizationId: seeded.organizationId,
    });
    expect(current.ok).toBe(true);
    if (!current.ok) return;

    const ok = await updateCallbackPolicy({
      actor: seeded.owner,
      organizationId: seeded.organizationId,
      expectedVersion: current.policy.version,
      raw: {
        defaultWindowMinutes: 30,
        maxSuggestedAttempts: 5,
        minSpacingMinutes: 60,
        businessHoursOnly: true,
        defaultAssignmentBehavior: "CREATOR",
      },
    });
    expect(ok.ok).toBe(true);

    const tooLow = await updateCallbackPolicy({
      actor: seeded.owner,
      organizationId: seeded.organizationId,
      expectedVersion: ok.ok ? ok.policy.version : current.policy.version,
      raw: {
        defaultWindowMinutes: 5,
        maxSuggestedAttempts: 5,
        minSpacingMinutes: 60,
        businessHoursOnly: true,
        defaultAssignmentBehavior: "UNASSIGNED",
      },
    });
    expect(tooLow.ok).toBe(false);
    if (!tooLow.ok) expect(tooLow.reason).toBe("validation");

    const tooHigh = await updateCallbackPolicy({
      actor: seeded.owner,
      organizationId: seeded.organizationId,
      expectedVersion: ok.ok ? ok.policy.version : current.policy.version,
      raw: {
        defaultWindowMinutes: 60,
        maxSuggestedAttempts: 99,
        minSpacingMinutes: 60,
        businessHoursOnly: true,
        defaultAssignmentBehavior: "UNASSIGNED",
      },
    });
    expect(tooHigh.ok).toBe(false);
    if (!tooHigh.ok) expect(tooHigh.reason).toBe("validation");
  });

  it("keeps safe recording/transcription defaults and refuses forged consent off", async () => {
    const seeded = await seedPhase3aCompletedOrg(prisma, {
      prefix: "op-rec",
      startProgress: true,
    });
    const current = await getRecordingConsentPolicy({
      actor: seeded.owner,
      organizationId: seeded.organizationId,
    });
    expect(current.ok).toBe(true);
    if (!current.ok) return;
    expect(current.policy.recordingEnabled).toBe(false);
    expect(current.policy.transcriptionEnabled).toBe(false);
    expect(current.policy.consentCaptureRequired).toBe(true);

    // Missing consentCaptureRequired must stay true via schema default —
    // cannot be forged off by omitting a hidden client field.
    const omittedConsent = await updateRecordingConsentPolicy({
      actor: seeded.owner,
      organizationId: seeded.organizationId,
      expectedVersion: current.policy.version,
      raw: {
        recordingEnabled: false,
        transcriptionEnabled: false,
        retentionDays: 30,
        accessDefault: "ADMINS_ONLY",
        reviewRequired: true,
      },
    });
    expect(omittedConsent.ok).toBe(true);
    if (!omittedConsent.ok) return;
    expect(omittedConsent.policy.consentCaptureRequired).toBe(true);
    expect(omittedConsent.policy.recordingEnabled).toBe(false);
    expect(omittedConsent.policy.transcriptionEnabled).toBe(false);

    const transcriptionWithoutRecording = await updateRecordingConsentPolicy({
      actor: seeded.owner,
      organizationId: seeded.organizationId,
      expectedVersion: omittedConsent.policy.version,
      raw: {
        recordingEnabled: false,
        transcriptionEnabled: true,
        consentCaptureRequired: true,
      },
    });
    expect(transcriptionWithoutRecording.ok).toBe(false);
    if (!transcriptionWithoutRecording.ok) {
      expect(transcriptionWithoutRecording.reason).toBe("validation");
    }
  });

  it("enforces retention bounds", async () => {
    const seeded = await seedPhase3aCompletedOrg(prisma, {
      prefix: "op-ret",
      startProgress: true,
    });
    const current = await getRecordingConsentPolicy({
      actor: seeded.owner,
      organizationId: seeded.organizationId,
    });
    expect(current.ok).toBe(true);
    if (!current.ok) return;

    for (const retentionDays of [0, 3651, -1]) {
      const result = await updateRecordingConsentPolicy({
        actor: seeded.owner,
        organizationId: seeded.organizationId,
        expectedVersion: current.policy.version,
        raw: {
          recordingEnabled: false,
          transcriptionEnabled: false,
          consentCaptureRequired: true,
          retentionDays,
        },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("validation");
    }

    const ok = await updateRecordingConsentPolicy({
      actor: seeded.owner,
      organizationId: seeded.organizationId,
      expectedVersion: current.policy.version,
      raw: {
        recordingEnabled: false,
        transcriptionEnabled: false,
        consentCaptureRequired: true,
        retentionDays: 90,
      },
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.policy.retentionDays).toBe(90);
  });

  it("denies unauthorized MEMBER changes", async () => {
    const seeded = await seedPhase3aCompletedOrg(prisma, {
      prefix: "op-auth",
      startProgress: true,
    });
    const member = await addMember(prisma, seeded.organizationId, "op-member");
    const current = await getCallbackPolicy({
      actor: seeded.owner,
      organizationId: seeded.organizationId,
    });
    expect(current.ok).toBe(true);
    if (!current.ok) return;

    const denied = await updateCallbackPolicy({
      actor: member,
      organizationId: seeded.organizationId,
      expectedVersion: current.policy.version,
      raw: {
        defaultWindowMinutes: 45,
        maxSuggestedAttempts: 3,
        minSpacingMinutes: 120,
        businessHoursOnly: true,
        defaultAssignmentBehavior: "UNASSIGNED",
      },
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.reason).toBe("forbidden");

    const stagesDenied = await replaceLeadStages({
      actor: member,
      organizationId: seeded.organizationId,
      raw: validStages,
    });
    expect(stagesDenied.ok).toBe(false);
    if (!stagesDenied.ok) expect(stagesDenied.reason).toBe("forbidden");
  });

  it("enforces tenant isolation for operational defaults", async () => {
    const a = await seedPhase3aCompletedOrg(prisma, {
      prefix: "op-iso-a",
      startProgress: true,
    });
    const b = await seedPhase3aCompletedOrg(prisma, {
      prefix: "op-iso-b",
      startProgress: true,
    });

    await replaceLeadStages({
      actor: a.owner,
      organizationId: a.organizationId,
      raw: validStages,
    });

    const bStages = await listLeadStages({
      actor: b.owner,
      organizationId: b.organizationId,
    });
    expect(bStages.ok).toBe(true);
    if (bStages.ok) expect(bStages.stages).toHaveLength(0);

    const cross = await replaceLeadStages({
      actor: a.owner,
      organizationId: b.organizationId,
      raw: validStages,
    });
    expect(cross.ok).toBe(false);
  });

  it("surfaces optimistic conflicts on callback policy", async () => {
    const seeded = await seedPhase3aCompletedOrg(prisma, {
      prefix: "op-conf",
      startProgress: true,
    });
    const current = await getCallbackPolicy({
      actor: seeded.owner,
      organizationId: seeded.organizationId,
    });
    expect(current.ok).toBe(true);
    if (!current.ok) return;

    const aHeld = createGate();
    const bStarted = createGate();
    const bGotLock = createGate();

    const payload = {
      defaultWindowMinutes: 90,
      maxSuggestedAttempts: 4,
      minSpacingMinutes: 180,
      businessHoursOnly: false,
      defaultAssignmentBehavior: "ROUND_ROBIN_PLACEHOLDER" as const,
    };

    const firstPromise = updateCallbackPolicy(
      {
        actor: seeded.owner,
        organizationId: seeded.organizationId,
        expectedVersion: current.policy.version,
        raw: payload,
      },
      {
        testAfterConfig3bLock: async () => {
          aHeld.markReached();
          await aHeld.waitForRelease();
        },
      },
    );

    await aHeld.waitUntilReached();

    const secondPromise = updateCallbackPolicy(
      {
        actor: seeded.owner,
        organizationId: seeded.organizationId,
        expectedVersion: current.policy.version,
        raw: {
          ...payload,
          defaultWindowMinutes: 120,
        },
      },
      {
        testBeforeConfig3bLock: async () => {
          bStarted.markReached();
        },
        testAfterConfig3bLock: async () => {
          bGotLock.markReached();
        },
      },
    );

    await bStarted.waitUntilReached();
    aHeld.release();
    await bGotLock.waitUntilReached();

    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    expect([first, second].filter((r) => r.ok).length).toBe(1);
    expect(
      [first, second].filter((r) => !r.ok && r.reason === "conflict").length,
    ).toBe(1);

    const row = await prisma.organizationCallbackPolicy.findUniqueOrThrow({
      where: { organizationId: seeded.organizationId },
    });
    expect(row.version).toBe(current.policy.version + 1);
    expect([90, 120]).toContain(row.defaultWindowMinutes);
  });
});
