import "server-only";

import type { BusinessLocation, BusinessProfile } from "@prisma/client";

import type { SafeUser } from "@/lib/auth/users";
import { recordOrganizationAuditEvent } from "@/lib/orgs/audit";
import {
  OrganizationAuthError,
  requireOrganizationPermission,
} from "@/lib/orgs/authorization";
import {
  assertCanReadBusinessInfo,
  ensureBusinessDefaults,
  mapAuthError,
  refreshConfigurationReadiness,
  requireActiveActorInTx,
  type AuthFailure,
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
  { ok: true; data: BusinessConfiguration } | AuthFailure;

export async function getBusinessConfiguration(input: {
  actor: SafeUser;
  organizationId: string;
}): Promise<GetBusinessResult> {
  try {
    await assertCanReadBusinessInfo(input);
    await ensureBusinessDefaults(prisma, input.organizationId);

    const organization = await prisma.organization.findUnique({
      where: { id: input.organizationId },
      select: { name: true, slug: true },
    });
    if (!organization) {
      throw new OrganizationAuthError("organization_not_found");
    }

    const profile = await prisma.businessProfile.findUniqueOrThrow({
      where: { organizationId: input.organizationId },
    });
    const location = await prisma.businessLocation.findFirstOrThrow({
      where: { organizationId: input.organizationId, isPrimary: true },
    });

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

export async function updateBusinessBasics(input: {
  actor: SafeUser;
  organizationId: string;
  raw: unknown;
  expectedVersion?: number;
}): Promise<GetBusinessResult> {
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
      await requireActiveActorInTx(tx, {
        organizationId: input.organizationId,
        userId: input.actor.id,
        permission: "org.business.update",
      });
      await ensureBusinessDefaults(tx, input.organizationId);

      const current = await tx.businessProfile.findUnique({
        where: { organizationId: input.organizationId },
      });
      if (!current) {
        throw new OrganizationAuthError("organization_not_found");
      }
      if (
        input.expectedVersion !== undefined &&
        current.version !== input.expectedVersion
      ) {
        throw new ConflictError();
      }

      await tx.businessProfile.update({
        where: { organizationId: input.organizationId },
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

export async function updateContactAndLocation(input: {
  actor: SafeUser;
  organizationId: string;
  raw: unknown;
  expectedVersion?: number;
}): Promise<GetBusinessResult> {
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
      await requireActiveActorInTx(tx, {
        organizationId: input.organizationId,
        userId: input.actor.id,
        permission: "org.business.update",
      });
      await ensureBusinessDefaults(tx, input.organizationId);

      const current = await tx.businessProfile.findUnique({
        where: { organizationId: input.organizationId },
      });
      if (!current) {
        throw new OrganizationAuthError("organization_not_found");
      }
      if (
        input.expectedVersion !== undefined &&
        current.version !== input.expectedVersion
      ) {
        throw new ConflictError();
      }

      await tx.businessProfile.update({
        where: { organizationId: input.organizationId },
        data: {
          primaryEmail: parsed.data.primaryEmail,
          primaryPhoneE164: parsed.data.primaryPhoneE164 ?? null,
          preferredContactMethod: parsed.data.preferredContactMethod ?? null,
          timeZone: parsed.data.timeZone,
          version: { increment: 1 },
        },
      });

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

class ConflictError extends Error {
  constructor() {
    super("conflict");
    this.name = "ConflictError";
  }
}
