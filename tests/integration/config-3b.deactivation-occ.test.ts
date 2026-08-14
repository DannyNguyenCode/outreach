import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { setMailerForTests, type EmailSender } from "@/lib/email/mailer";
import { resetServerEnvCache } from "@/lib/env/server";
import {
  createCustomField,
  deactivateCustomField,
} from "@/lib/orgs/custom-fields";
import {
  createHolidayClosure,
  deactivateHolidayClosure,
} from "@/lib/orgs/holiday-closures";
import {
  createServiceArea,
  deactivateServiceArea,
} from "@/lib/orgs/service-areas";
import {
  countConfig3bAudits,
  createOrgWithOwner,
} from "@/tests/integration/helpers/config-3b";
import { resetApplicationData } from "@/tests/integration/reset";

const mockMailer: EmailSender = { async send() {} };
const invalidVersions: unknown[] = [
  undefined,
  "not-a-version",
  Number.MAX_SAFE_INTEGER + 1,
];

describe("Phase 3B deactivation optimistic concurrency validation", () => {
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

  it("protects custom-field deactivation from invalid, stale, and foreign versions", async () => {
    const local = await createOrgWithOwner(prisma, "deact-occ-cf-local");
    const foreign = await createOrgWithOwner(prisma, "deact-occ-cf-foreign");
    const created = await createCustomField({
      actor: local.owner,
      organizationId: local.organizationId,
      raw: { key: "occ_field", label: "OCC field", dataType: "TEXT" },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    for (const expectedVersion of invalidVersions) {
      const result = await deactivateCustomField({
        actor: local.owner,
        organizationId: local.organizationId,
        fieldId: created.field.id,
        expectedVersion: expectedVersion as number,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("validation");
        expect(result.fieldErrors?.expectedVersion).toBeDefined();
      }
    }

    const stale = await deactivateCustomField({
      actor: local.owner,
      organizationId: local.organizationId,
      fieldId: created.field.id,
      expectedVersion: created.field.version + 1,
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.reason).toBe("conflict");
      expect(stale.message).toMatch(/reload/i);
    }

    const crossTenant = await deactivateCustomField({
      actor: foreign.owner,
      organizationId: foreign.organizationId,
      fieldId: created.field.id,
      expectedVersion: created.field.version,
    });
    expect(crossTenant.ok).toBe(false);

    const row = await prisma.customFieldDefinition.findUniqueOrThrow({
      where: { id: created.field.id },
    });
    expect(row).toMatchObject({
      isActive: true,
      version: created.field.version,
    });
    expect(
      await countConfig3bAudits(
        prisma,
        local.organizationId,
        "CUSTOM_FIELD_DEACTIVATED",
      ),
    ).toBe(0);

    await prisma.customFieldDefinition.update({
      where: { id: created.field.id },
      data: { isActive: false },
    });
    const alreadyInactive = await deactivateCustomField({
      actor: local.owner,
      organizationId: local.organizationId,
      fieldId: created.field.id,
      expectedVersion: created.field.version,
    });
    expect(alreadyInactive.ok).toBe(false);
    if (!alreadyInactive.ok) expect(alreadyInactive.reason).toBe("conflict");
    expect(
      await countConfig3bAudits(
        prisma,
        local.organizationId,
        "CUSTOM_FIELD_DEACTIVATED",
      ),
    ).toBe(0);
  });

  it("protects service-area deactivation from invalid, stale, and foreign versions", async () => {
    const local = await createOrgWithOwner(prisma, "deact-occ-sa-local");
    const foreign = await createOrgWithOwner(prisma, "deact-occ-sa-foreign");
    const created = await createServiceArea({
      actor: local.owner,
      organizationId: local.organizationId,
      raw: { label: "OCC area", isActive: true },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    for (const expectedVersion of invalidVersions) {
      const result = await deactivateServiceArea({
        actor: local.owner,
        organizationId: local.organizationId,
        serviceAreaId: created.area.id,
        expectedVersion: expectedVersion as number,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("validation");
        expect(result.fieldErrors?.expectedVersion).toBeDefined();
      }
    }

    const stale = await deactivateServiceArea({
      actor: local.owner,
      organizationId: local.organizationId,
      serviceAreaId: created.area.id,
      expectedVersion: created.area.version + 1,
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.reason).toBe("conflict");
      expect(stale.message).toMatch(/reload/i);
    }

    const crossTenant = await deactivateServiceArea({
      actor: foreign.owner,
      organizationId: foreign.organizationId,
      serviceAreaId: created.area.id,
      expectedVersion: created.area.version,
    });
    expect(crossTenant.ok).toBe(false);

    const row = await prisma.serviceArea.findUniqueOrThrow({
      where: { id: created.area.id },
    });
    expect(row).toMatchObject({
      isActive: true,
      version: created.area.version,
    });
    expect(
      await countConfig3bAudits(
        prisma,
        local.organizationId,
        "SERVICE_AREA_DEACTIVATED",
      ),
    ).toBe(0);

    await prisma.serviceArea.update({
      where: { id: created.area.id },
      data: { isActive: false },
    });
    const alreadyInactive = await deactivateServiceArea({
      actor: local.owner,
      organizationId: local.organizationId,
      serviceAreaId: created.area.id,
      expectedVersion: created.area.version,
    });
    expect(alreadyInactive.ok).toBe(false);
    if (!alreadyInactive.ok) expect(alreadyInactive.reason).toBe("conflict");
    expect(
      await countConfig3bAudits(
        prisma,
        local.organizationId,
        "SERVICE_AREA_DEACTIVATED",
      ),
    ).toBe(0);
  });

  it("protects closure deactivation from invalid, stale, and foreign versions", async () => {
    const local = await createOrgWithOwner(prisma, "deact-occ-hc-local");
    const foreign = await createOrgWithOwner(prisma, "deact-occ-hc-foreign");
    const created = await createHolidayClosure({
      actor: local.owner,
      organizationId: local.organizationId,
      raw: { localDateStart: "2027-01-01", isActive: true },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    for (const expectedVersion of invalidVersions) {
      const result = await deactivateHolidayClosure({
        actor: local.owner,
        organizationId: local.organizationId,
        closureId: created.closure.id,
        expectedVersion: expectedVersion as number,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("validation");
        expect(result.fieldErrors?.expectedVersion).toBeDefined();
      }
    }

    const stale = await deactivateHolidayClosure({
      actor: local.owner,
      organizationId: local.organizationId,
      closureId: created.closure.id,
      expectedVersion: created.closure.version + 1,
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.reason).toBe("conflict");
      expect(stale.message).toMatch(/reload/i);
    }

    const crossTenant = await deactivateHolidayClosure({
      actor: foreign.owner,
      organizationId: foreign.organizationId,
      closureId: created.closure.id,
      expectedVersion: created.closure.version,
    });
    expect(crossTenant.ok).toBe(false);

    const row = await prisma.holidayClosure.findUniqueOrThrow({
      where: { id: created.closure.id },
    });
    expect(row).toMatchObject({
      isActive: true,
      version: created.closure.version,
    });
    expect(
      await countConfig3bAudits(
        prisma,
        local.organizationId,
        "HOLIDAY_CLOSURE_DEACTIVATED",
      ),
    ).toBe(0);

    await prisma.holidayClosure.update({
      where: { id: created.closure.id },
      data: { isActive: false },
    });
    const alreadyInactive = await deactivateHolidayClosure({
      actor: local.owner,
      organizationId: local.organizationId,
      closureId: created.closure.id,
      expectedVersion: created.closure.version,
    });
    expect(alreadyInactive.ok).toBe(false);
    if (!alreadyInactive.ok) expect(alreadyInactive.reason).toBe("conflict");
    expect(
      await countConfig3bAudits(
        prisma,
        local.organizationId,
        "HOLIDAY_CLOSURE_DEACTIVATED",
      ),
    ).toBe(0);
  });
});
