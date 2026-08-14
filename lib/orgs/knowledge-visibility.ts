import type { Prisma } from "@prisma/client";

export const MEMBER_VISIBLE_INPUT_KINDS = ["MANUAL", "DOCUMENT"] as const;
export const MEMBER_VISIBLE_SOURCE_CATEGORY =
  "CUSTOMER_CONFIRMED_BUSINESS_FACTS" as const;

/**
 * SQL predicate for member-visible sources. Owners/admins may read history;
 * members only see currently effective, customer-confirmed, ACTIVE knowledge.
 */
export function memberVisibleSourceWhere(): Prisma.KnowledgeSourceWhereInput {
  return {
    archivedAt: null,
    inputKind: { in: [...MEMBER_VISIBLE_INPUT_KINDS] },
    category: MEMBER_VISIBLE_SOURCE_CATEGORY,
  };
}

/**
 * SQL predicate for a currently effective ACTIVE version. Confirmation
 * metadata and the effective window are enforced in the database `where`,
 * not after load.
 */
export function memberVisibleVersionWhere(
  now: Date,
): Prisma.KnowledgeVersionWhereInput {
  return {
    state: "ACTIVE",
    confirmedAt: { not: null },
    confirmationLanguageVersion: { not: null },
    AND: [
      { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }] },
      { OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }] },
    ],
  };
}

export function memberVisibleSourceWithVersionWhere(
  organizationId: string,
  now: Date,
): Prisma.KnowledgeSourceWhereInput {
  return {
    organizationId,
    ...memberVisibleSourceWhere(),
    versions: { some: memberVisibleVersionWhere(now) },
  };
}

export function memberVisibleVersionWithSourceWhere(
  organizationId: string,
  now: Date,
): Prisma.KnowledgeVersionWhereInput {
  return {
    organizationId,
    ...memberVisibleVersionWhere(now),
    source: {
      organizationId,
      ...memberVisibleSourceWhere(),
    },
  };
}
