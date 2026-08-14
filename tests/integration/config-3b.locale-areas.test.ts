import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { resetServerEnvCache } from "@/lib/env/server";
import { setMailerForTests, type EmailSender } from "@/lib/email/mailer";
import {
  getLocaleSettings,
  updateLocaleSettings,
} from "@/lib/orgs/locale-settings";
import {
  createServiceArea,
  deactivateServiceArea,
  listServiceAreas,
  reorderServiceAreas,
  updateServiceArea,
} from "@/lib/orgs/service-areas";
import { startConfigProgress } from "@/lib/orgs/config-progress";
import {
  addMember,
  createOrgWithOwner,
  seedPhase3aCompletedOrg,
} from "@/tests/integration/helpers/config-3b";
import { resetApplicationData } from "@/tests/integration/reset";

const mockMailer: EmailSender = {
  async send() {},
};

describe("Phase 3B locale and service areas", () => {
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

  it("accepts valid locale and language tags", async () => {
    const seeded = await seedPhase3aCompletedOrg(prisma, {
      prefix: "loc-ok",
      startProgress: true,
    });
    const current = await getLocaleSettings({
      actor: seeded.owner,
      organizationId: seeded.organizationId,
    });
    expect(current.ok).toBe(true);
    if (!current.ok) return;

    const updated = await updateLocaleSettings({
      actor: seeded.owner,
      organizationId: seeded.organizationId,
      expectedVersion: current.settings.version,
      raw: {
        locale: "fr-CA",
        defaultLanguage: "fr",
        dateDisplayPreference: "locale",
        timeDisplayPreference: "24h",
        numberDisplayPreference: "locale",
      },
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.settings.locale).toBe("fr-CA");
    expect(updated.settings.defaultLanguage).toBe("fr");
  });

  it("rejects invalid locale and language identifiers", async () => {
    const seeded = await seedPhase3aCompletedOrg(prisma, {
      prefix: "loc-bad",
      startProgress: true,
    });
    const current = await getLocaleSettings({
      actor: seeded.owner,
      organizationId: seeded.organizationId,
    });
    expect(current.ok).toBe(true);
    if (!current.ok) return;

    for (const raw of [
      {
        locale: "!!!",
        defaultLanguage: "en",
      },
      {
        locale: "en-CA",
        defaultLanguage: "not a tag",
      },
      {
        locale: "",
        defaultLanguage: "en",
      },
    ]) {
      const result = await updateLocaleSettings({
        actor: seeded.owner,
        organizationId: seeded.organizationId,
        expectedVersion: current.settings.version,
        raw: {
          ...raw,
          dateDisplayPreference: "locale",
          timeDisplayPreference: "locale",
          numberDisplayPreference: "locale",
        },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("validation");
    }

    const unchanged = await getLocaleSettings({
      actor: seeded.owner,
      organizationId: seeded.organizationId,
    });
    expect(unchanged.ok).toBe(true);
    if (unchanged.ok) {
      expect(unchanged.settings.version).toBe(current.settings.version);
    }
  });

  it("normalizes country codes and regions on service areas", async () => {
    const { owner, organizationId } = await createOrgWithOwner(
      prisma,
      "sa-norm",
    );
    const created = await createServiceArea({
      actor: owner,
      organizationId,
      raw: {
        label: "GTA",
        countryCode: "ca",
        region: "  ON  ",
        city: " Toronto ",
        postalPrefix: "m5v",
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.area.countryCode).toBe("CA");
    expect(created.area.region).toBe("ON");
    expect(created.area.city).toBe("Toronto");
    expect(created.area.postalPrefix).toBe("M5V");
  });

  it("supports remote service areas", async () => {
    const { owner, organizationId } = await createOrgWithOwner(
      prisma,
      "sa-remote",
    );
    const created = await createServiceArea({
      actor: owner,
      organizationId,
      raw: {
        label: "Nationwide remote",
        isRemote: true,
        countryCode: "US",
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.area.isRemote).toBe(true);
  });

  it("rejects invalid postal patterns", async () => {
    const { owner, organizationId } = await createOrgWithOwner(
      prisma,
      "sa-postal",
    );
    for (const postalPrefix of [
      "M5*",
      "%%%%",
      "A?".repeat(2),
      "-M5V",
      "M5V-",
    ]) {
      const result = await createServiceArea({
        actor: owner,
        organizationId,
        raw: { label: "Bad postal", postalPrefix },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("validation");
    }
    expect(await prisma.serviceArea.count({ where: { organizationId } })).toBe(
      0,
    );
  });

  it("reorders service areas", async () => {
    const { owner, organizationId } = await createOrgWithOwner(
      prisma,
      "sa-ord",
    );
    const a = await createServiceArea({
      actor: owner,
      organizationId,
      raw: { label: "North" },
    });
    const b = await createServiceArea({
      actor: owner,
      organizationId,
      raw: { label: "South" },
    });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    const reordered = await reorderServiceAreas({
      actor: owner,
      organizationId,
      raw: { orderedIds: [b.area.id, a.area.id] },
    });
    expect(reordered.ok).toBe(true);
    if (!reordered.ok) return;
    expect(reordered.areas.map((area) => area.id)).toEqual([
      b.area.id,
      a.area.id,
    ]);
  });

  it("rejects cross-tenant service area IDs", async () => {
    const a = await createOrgWithOwner(prisma, "sa-x-a");
    const b = await createOrgWithOwner(prisma, "sa-x-b");
    const foreign = await createServiceArea({
      actor: b.owner,
      organizationId: b.organizationId,
      raw: { label: "Foreign area" },
    });
    expect(foreign.ok).toBe(true);
    if (!foreign.ok) return;

    const local = await createServiceArea({
      actor: a.owner,
      organizationId: a.organizationId,
      raw: { label: "Local area" },
    });
    expect(local.ok).toBe(true);
    if (!local.ok) return;

    const updateDenied = await updateServiceArea({
      actor: a.owner,
      organizationId: a.organizationId,
      serviceAreaId: foreign.area.id,
      expectedVersion: foreign.area.version,
      raw: { label: "Hijack" },
    });
    expect(updateDenied.ok).toBe(false);

    const reorderDenied = await reorderServiceAreas({
      actor: a.owner,
      organizationId: a.organizationId,
      raw: { orderedIds: [local.area.id, foreign.area.id] },
    });
    expect(reorderDenied.ok).toBe(false);

    const untouched = await prisma.serviceArea.findUniqueOrThrow({
      where: { id: foreign.area.id },
    });
    expect(untouched.label).toBe("Foreign area");
  });

  it("handles empty lists and inactive service areas", async () => {
    const { owner, organizationId } = await createOrgWithOwner(
      prisma,
      "sa-empty",
    );
    const empty = await listServiceAreas({ actor: owner, organizationId });
    expect(empty.ok).toBe(true);
    if (!empty.ok) return;
    expect(empty.areas).toEqual([]);

    const created = await createServiceArea({
      actor: owner,
      organizationId,
      raw: { label: "Temp", isActive: true },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const deactivated = await deactivateServiceArea({
      actor: owner,
      organizationId,
      serviceAreaId: created.area.id,
    });
    expect(deactivated.ok).toBe(true);
    if (!deactivated.ok) return;
    expect(deactivated.area.isActive).toBe(false);

    const listed = await listServiceAreas({ actor: owner, organizationId });
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      expect(listed.areas).toHaveLength(1);
      expect(listed.areas[0]!.isActive).toBe(false);
    }

    const member = await addMember(prisma, organizationId, "sa-member");
    const memberDenied = await createServiceArea({
      actor: member,
      organizationId,
      raw: { label: "Member area" },
    });
    expect(memberDenied.ok).toBe(false);
    if (!memberDenied.ok) expect(memberDenied.reason).toBe("forbidden");
  });

  it("locale reads stay not_initialized until startConfigProgress", async () => {
    const { owner, organizationId } = await createOrgWithOwner(
      prisma,
      "loc-init",
    );
    const before = await getLocaleSettings({ actor: owner, organizationId });
    expect(before.ok).toBe(false);
    if (!before.ok) expect(before.reason).toBe("not_initialized");
    expect(
      await prisma.organizationLocaleSettings.findUnique({
        where: { organizationId },
      }),
    ).toBeNull();

    const started = await startConfigProgress({ actor: owner, organizationId });
    expect(started.ok).toBe(true);
    const after = await getLocaleSettings({ actor: owner, organizationId });
    expect(after.ok).toBe(true);
  });
});
