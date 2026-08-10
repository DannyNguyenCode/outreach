import "server-only";

import { Prisma } from "@prisma/client";

import type { SafeUser } from "@/lib/auth/users";
import { recordOrganizationAuditEvent } from "@/lib/orgs/audit";
import {
  createOrganizationSchema,
  slugFromOrganizationName,
  organizationSlugSchema,
  type CreateOrganizationInput,
} from "@/lib/orgs/slug";
import { prisma } from "@/lib/prisma";

export type CreateOrganizationResult =
  | {
      ok: true;
      organization: { id: string; name: string; slug: string };
      membershipId: string;
    }
  | {
      ok: false;
      reason: "validation" | "slug_taken" | "unverified" | "failed";
      fieldErrors?: Record<string, string[]>;
      message: string;
    };

/**
 * Create an organization and OWNER membership atomically.
 * The creator becomes the sole initial owner. On any failure the transaction
 * rolls back so no ownerless organization is left behind.
 */
export async function createOrganization(
  actor: SafeUser,
  rawInput: CreateOrganizationInput,
): Promise<CreateOrganizationResult> {
  if (!actor.emailVerifiedAt) {
    return {
      ok: false,
      reason: "unverified",
      message: "Verify your email before creating an organization.",
    };
  }

  const parsed = createOrganizationSchema.safeParse(rawInput);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "name");
      fieldErrors[key] ??= [];
      fieldErrors[key].push(issue.message);
    }
    return {
      ok: false,
      reason: "validation",
      fieldErrors,
      message: "Please correct the highlighted fields.",
    };
  }

  const name = parsed.data.name;
  let slug = parsed.data.slug;
  if (!slug) {
    const derived = organizationSlugSchema.safeParse(
      slugFromOrganizationName(name),
    );
    if (!derived.success) {
      return {
        ok: false,
        reason: "validation",
        fieldErrors: {
          slug: [
            "Could not derive a valid slug from the name. Provide one explicitly.",
          ],
        },
        message: "Please correct the highlighted fields.",
      };
    }
    slug = derived.data;
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: { name, slug },
        select: { id: true, name: true, slug: true },
      });

      const membership = await tx.membership.create({
        data: {
          organizationId: organization.id,
          userId: actor.id,
          role: "OWNER",
          status: "ACTIVE",
        },
        select: { id: true },
      });

      await recordOrganizationAuditEvent(tx, {
        organizationId: organization.id,
        actorUserId: actor.id,
        action: "ORGANIZATION_CREATED",
        metadata: { slug: organization.slug },
      });

      await tx.user.update({
        where: { id: actor.id },
        data: { activeOrganizationId: organization.id },
      });

      return { organization, membershipId: membership.id };
    });

    return {
      ok: true,
      organization: result.organization,
      membershipId: result.membershipId,
    };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return {
        ok: false,
        reason: "slug_taken",
        fieldErrors: {
          slug: ["That slug is already taken. Choose a different one."],
        },
        message: "Please correct the highlighted fields.",
      };
    }
    console.error(
      JSON.stringify({
        event: "org.create_failed",
        code:
          error instanceof Prisma.PrismaClientKnownRequestError
            ? error.code
            : "unknown",
      }),
    );
    return {
      ok: false,
      reason: "failed",
      message: "Unable to create the organization. Please try again.",
    };
  }
}

export async function listOrganizationsForUser(userId: string) {
  const memberships = await prisma.membership.findMany({
    where: {
      userId,
      status: "ACTIVE",
    },
    select: {
      id: true,
      role: true,
      organization: {
        select: {
          id: true,
          name: true,
          slug: true,
          createdAt: true,
        },
      },
    },
    orderBy: {
      organization: { name: "asc" },
    },
  });

  return memberships.map((m) => ({
    membershipId: m.id,
    role: m.role,
    organization: m.organization,
  }));
}
