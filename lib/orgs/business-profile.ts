import "server-only";

import type { BusinessLocation, BusinessProfile } from "@prisma/client";

import type { SafeUser } from "@/lib/auth/users";
import { recordOrganizationAuditEvent } from "@/lib/orgs/audit";
import {
  OrganizationAuthError,
  requireOrganizationPermission,
} from "@/lib/orgs/authorization";
import {
  acquireOrganizationReadinessLock,
  assertCanReadBusinessInfo,
  ConflictError,
  initializeBusinessDefaults,
  mapAuthError,
  refreshConfigurationReadiness,
  requireActiveActorInTx,
  type AuthFailure,
  type ReadinessMutationTestHooks,
} from "@/lib/orgs/business-access";
import {
  businessBasicsSchema,
  contactLocationSchema,
} from "@/lib/orgs/business-validation";
import { prisma } from "@/lib/prisma";

export type BusinessConfiguration = {
  profile: BusinessProfile;
  location: BusinessLocation;
  organizationName: string;
  organizationSlug: string;
};

export type GetBusinessResult =
  | { ok: true; data: BusinessConfiguration }
  | { ok: false; reason: "not_initialized"; message: string }
  | AuthFailure;

/**
 * Read-only business configuration retrieval. Never creates defaults.
 */
export async function getBusinessConfiguration(input: {
  actor: SafeUser;
  organizationId: string;
}): Promise<GetBusinessResult> {
  try {
    await assertCanReadBusinessInfo({ ...input, db: prisma });

    const organization = await prisma.organization.findUnique({
      where: { id: input.organizationId },
      select: { name: true, slug: true },
    });
    if (!organization) {
      throw new OrganizationAuthError("organization_not_found");
    }

    const profile = await prisma.businessProfile.findUnique({
      where: { organizationId: input.organizationId },
    });
    const location = await prisma.businessLocation.findFirst({
      where: { organizationId: input.organizationId, isPrimary: true },
    });

    if (!profile || !location) {
      return {
        ok: false,
        reason: "not_initialized",
        message: "Business configuration has not been initialized.",
      };
    }

    return {
      ok: true,
      data: {
        profile,
        location,
        organizationName: organization.name,
        organizationSlug: organization.slug,
      },
    };
  } catch (error) {
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not load business configuration.",
      }
    );
  }
}

export async function updateBusinessBasics(
  input: {
    actor: SafeUser;
    organizationId: string;
    raw: unknown;
    expectedVersion?: number;
  },
  hooks: ReadinessMutationTestHooks = {},
): Promise<GetBusinessResult> {
  const parsed = businessBasicsSchema.safeParse(input.raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "displayName");
      fieldErrors[key] ??= [];
      fieldErrors[key].push(issue.message);
    }
    return {
      ok: false,
      reason: "validation",
      message: "Please correct the highlighted fields.",
      fieldErrors,
    };
  }

  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.business.update",
    });

    await prisma.$transaction(async (tx) => {
      await acquireOrganizationReadinessLock(tx, input.organizationId, hooks);
      await requireActiveActorInTx(tx, {
        organizationId: input.organizationId,
        userId: input.actor.id,
        permission: "org.business.update",
      });
      await initializeBusinessDefaults(tx, input.organizationId);

      const where =
        input.expectedVersion !== undefined
          ? {
              organizationId: input.organizationId,
              version: input.expectedVersion,
            }
          : { organizationId: input.organizationId };

      const updated = await tx.businessProfile.updateMany({
        where,
        data: {
          legalName: parsed.data.legalName ?? null,
          displayName: parsed.data.displayName,
          description: parsed.data.description ?? null,
          industry: parsed.data.industry,
          businessType: parsed.data.businessType,
          websiteUrl: parsed.data.websiteUrl ?? null,
          logoUrl: parsed.data.logoUrl ?? null,
          version: { increment: 1 },
        },
      });

      if (updated.count !== 1) {
        const exists = await tx.businessProfile.findUnique({
          where: { organizationId: input.organizationId },
        });
        if (!exists) {
          throw new OrganizationAuthError("organization_not_found");
        }
        throw new ConflictError();
      }

      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "BUSINESS_PROFILE_UPDATED",
        metadata: { section: "basics", businessType: parsed.data.businessType },
      });

      await refreshConfigurationReadiness(tx, input.organizationId);
    });

    return getBusinessConfiguration(input);
  } catch (error) {
    if (error instanceof ConflictError) {
      return {
        ok: false,
        reason: "conflict",
        message:
          "Business profile was updated elsewhere. Reload and try again.",
      };
    }
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not update business basics.",
      }
    );
  }
}

export async function updateContactAndLocation(
  input: {
    actor: SafeUser;
    organizationId: string;
    raw: unknown;
    expectedVersion?: number;
  },
  hooks: ReadinessMutationTestHooks = {},
): Promise<GetBusinessResult> {
  const parsed = contactLocationSchema.safeParse(input.raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "primaryEmail");
      fieldErrors[key] ??= [];
      fieldErrors[key].push(issue.message);
    }
    return {
      ok: false,
      reason: "validation",
      message: "Please correct the highlighted fields.",
      fieldErrors,
    };
  }

  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.business.update",
    });

    await prisma.$transaction(async (tx) => {
      await acquireOrganizationReadinessLock(tx, input.organizationId, hooks);
      await requireActiveActorInTx(tx, {
        organizationId: input.organizationId,
        userId: input.actor.id,
        permission: "org.business.update",
      });
      await initializeBusinessDefaults(tx, input.organizationId);

      const where =
        input.expectedVersion !== undefined
          ? {
              organizationId: input.organizationId,
              version: input.expectedVersion,
            }
          : { organizationId: input.organizationId };

      const updated = await tx.businessProfile.updateMany({
        where,
        data: {
          primaryEmail: parsed.data.primaryEmail,
          primaryPhoneE164: parsed.data.primaryPhoneE164 ?? null,
          preferredContactMethod: parsed.data.preferredContactMethod ?? null,
          timeZone: parsed.data.timeZone,
          version: { increment: 1 },
        },
      });

      if (updated.count !== 1) {
        const exists = await tx.businessProfile.findUnique({
          where: { organizationId: input.organizationId },
        });
        if (!exists) {
          throw new OrganizationAuthError("organization_not_found");
        }
        throw new ConflictError();
      }

      await tx.businessLocation.updateMany({
        where: { organizationId: input.organizationId, isPrimary: true },
        data: {
          addressLine1: parsed.data.addressLine1 ?? null,
          addressLine2: parsed.data.addressLine2 ?? null,
          city: parsed.data.city ?? null,
          region: parsed.data.region ?? null,
          postalCode: parsed.data.postalCode ?? null,
          countryCode: parsed.data.countryCode,
        },
      });

      await recordOrganizationAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actor.id,
        action: "BUSINESS_PROFILE_UPDATED",
        metadata: {
          section: "contact_location",
          countryCode: parsed.data.countryCode,
          timeZone: parsed.data.timeZone,
        },
      });

      await refreshConfigurationReadiness(tx, input.organizationId);
    });

    return getBusinessConfiguration(input);
  } catch (error) {
    if (error instanceof ConflictError) {
      return {
        ok: false,
        reason: "conflict",
        message:
          "Business profile was updated elsewhere. Reload and try again.",
      };
    }
    return (
      mapAuthError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not update contact and location.",
      }
    );
  }
}
