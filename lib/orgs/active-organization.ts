import "server-only";

import type { SafeUser } from "@/lib/auth/users";
import {
  findActiveMembership,
  type MembershipWithOrganization,
} from "@/lib/orgs/authorization";
import { prisma } from "@/lib/prisma";

/**
 * Active-organization strategy (Phase 2):
 *
 * 1. Prefer organization slug in the route (`/app/orgs/[slug]/…`), validated
 *    against the actor's current ACTIVE membership on every request.
 * 2. Persist `User.activeOrganizationId` as a soft preference for redirects
 *    and the organization selector. Preference is re-validated every time
 *    because membership may have been deactivated since it was stored.
 * 3. Never trust browser-only storage for authorization state.
 */

export async function getValidatedActiveOrganization(
  user: SafeUser,
): Promise<MembershipWithOrganization | null> {
  if (!user.activeOrganizationId) {
    return null;
  }
  const membership = await findActiveMembership({
    userId: user.id,
    organizationId: user.activeOrganizationId,
  });
  if (!membership || membership.status !== "ACTIVE") {
    // Clear stale preference when membership is gone or inactive.
    await prisma.user.update({
      where: { id: user.id },
      data: { activeOrganizationId: null },
    });
    return null;
  }
  return membership;
}

export async function setActiveOrganization(input: {
  user: SafeUser;
  organizationId: string;
}): Promise<
  | { ok: true; membership: MembershipWithOrganization }
  | { ok: false; reason: "not_a_member" | "inactive_membership" }
> {
  const membership = await findActiveMembership({
    userId: input.user.id,
    organizationId: input.organizationId,
  });
  if (!membership) {
    return { ok: false, reason: "not_a_member" };
  }
  if (membership.status !== "ACTIVE") {
    return { ok: false, reason: "inactive_membership" };
  }

  await prisma.user.update({
    where: { id: input.user.id },
    data: { activeOrganizationId: input.organizationId },
  });

  return { ok: true, membership };
}
