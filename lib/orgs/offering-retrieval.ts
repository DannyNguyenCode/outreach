import "server-only";

import type { Prisma } from "@prisma/client";

import type { SafeUser } from "@/lib/auth/users";
import { requireOrganizationPermission } from "@/lib/orgs/authorization";
import {
  mapOfferingError,
  OfferingLifecycleError,
  type AuthFailure,
} from "@/lib/orgs/offering-access";
import { OFFERING_SOURCE_CLASS } from "@/lib/orgs/offering-confirmation";
import {
  parsePage,
  parsePageSize,
  sanitizeSearchQuery,
  selectCurrentPrices,
} from "@/lib/orgs/offering-validation";
import { prisma } from "@/lib/prisma";

const retrievalInclude = {
  prices: {
    orderBy: [{ displayOrder: "asc" as const }, { id: "asc" as const }],
  },
  features: {
    orderBy: [{ displayOrder: "asc" as const }, { id: "asc" as const }],
  },
  variants: {
    where: { isActive: true },
    orderBy: [{ displayOrder: "asc" as const }, { id: "asc" as const }],
    include: { prices: true },
  },
  eligibility: true,
  customValues: {
    orderBy: [{ definitionKey: "asc" as const }, { id: "asc" as const }],
  },
  offering: { select: { id: true, name: true, organizationId: true } },
} satisfies Prisma.OfferingVersionInclude;

type RetrievalGraph = Prisma.OfferingVersionGetPayload<{
  include: typeof retrievalInclude;
}>;

export type RetrievedActiveOffering = {
  sourceClass: typeof OFFERING_SOURCE_CLASS;
  offeringId: string;
  versionId: string;
  name: string;
  description: string | null;
  offeringType: RetrievalGraph["offeringType"];
  pricingModel: RetrievalGraph["pricingModel"];
  quoteRequired: boolean;
  currentPriceIds: string[];
  prices: RetrievalGraph["prices"];
  features: RetrievalGraph["features"];
  variants: RetrievalGraph["variants"];
  eligibility: RetrievalGraph["eligibility"];
  customValues: RetrievalGraph["customValues"];
  confirmedAt: Date;
  confirmationLanguageVersion: string;
  contentChecksum: string;
  effectiveFrom: Date | null;
  effectiveUntil: Date | null;
};

export async function retrieveActiveOfferings(input: {
  actor: SafeUser;
  organizationId: string;
  query?: unknown;
  offeringIds?: string[];
  page?: unknown;
  pageSize?: unknown;
}): Promise<
  | {
      ok: true;
      items: RetrievedActiveOffering[];
      page: number;
      pageSize: number;
      total: number;
    }
  | AuthFailure
> {
  const query = sanitizeSearchQuery(input.query);
  const page = parsePage(input.page);
  const pageSize = input.offeringIds?.length
    ? Math.max(input.offeringIds.length, 1)
    : parsePageSize(input.pageSize);
  const now = new Date();
  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.knowledge.read",
    });
    const where = activeOfferingVersionWhere(
      input.organizationId,
      now,
      query,
      input.offeringIds,
    );
    const [total, rows] = await Promise.all([
      prisma.offeringVersion.count({ where }),
      prisma.offeringVersion.findMany({
        where,
        include: retrievalInclude,
        orderBy: [
          { displayOrder: "asc" },
          { name: "asc" },
          { offeringId: "asc" },
          { id: "asc" },
        ],
        skip: input.offeringIds ? 0 : (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const items = rows.map((row) =>
      mapRetrievedOffering(row, input.organizationId, now),
    );
    return { ok: true, items, page, pageSize, total };
  } catch (error) {
    return (
      mapOfferingError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not retrieve active offerings.",
      }
    );
  }
}

export function activeOfferingVersionWhere(
  organizationId: string,
  now: Date,
  query = "",
  offeringIds?: string[],
): Prisma.OfferingVersionWhereInput {
  return {
    organizationId,
    state: "ACTIVE",
    confirmedAt: { not: null },
    confirmationLanguageVersion: { not: null },
    offeringId: offeringIds ? { in: [...new Set(offeringIds)] } : undefined,
    offering: { organizationId, archivedAt: null },
    AND: [
      { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }] },
      { OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }] },
    ],
    ...(query
      ? {
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { description: { contains: query, mode: "insensitive" } },
            {
              features: {
                some: {
                  OR: [
                    { name: { contains: query, mode: "insensitive" } },
                    { value: { contains: query, mode: "insensitive" } },
                  ],
                },
              },
            },
          ],
        }
      : {}),
  };
}

function mapRetrievedOffering(
  row: RetrievalGraph,
  organizationId: string,
  now: Date,
): RetrievedActiveOffering {
  if (
    row.organizationId !== organizationId ||
    row.offering.organizationId !== organizationId ||
    !row.confirmedAt ||
    !row.confirmationLanguageVersion
  ) {
    throw new OfferingLifecycleError(
      "not_confirmable",
      "Offering provenance is invalid.",
    );
  }
  const variantPriceIds = new Set(
    row.variants.flatMap((variant) =>
      variant.prices.map((link) => link.priceId),
    ),
  );
  const basePrices = row.prices.filter(
    (price) => !variantPriceIds.has(price.id),
  );
  const base = selectCurrentPrices(basePrices, now);
  if (
    (row.pricingModel === "FIXED_ONE_TIME" ||
      row.pricingModel === "RECURRING") &&
    base.conflict
  ) {
    throw new OfferingLifecycleError(
      "conflicting_prices",
      "An active offering has ambiguous current base prices.",
    );
  }
  const currentPriceIds = base.current.map((price) => price.id);
  for (const variant of row.variants) {
    const ids = new Set(variant.prices.map((link) => link.priceId));
    const current = selectCurrentPrices(row.prices, now, ids);
    if (current.conflict) {
      throw new OfferingLifecycleError(
        "conflicting_prices",
        "An active offering variant has ambiguous current prices.",
      );
    }
    currentPriceIds.push(...current.current.map((price) => price.id));
  }
  return {
    sourceClass: OFFERING_SOURCE_CLASS,
    offeringId: row.offeringId,
    versionId: row.id,
    name: row.name,
    description: row.description,
    offeringType: row.offeringType,
    pricingModel: row.pricingModel,
    quoteRequired: row.quoteRequired,
    currentPriceIds: [...new Set(currentPriceIds)].sort(),
    prices: row.prices,
    features: row.features,
    variants: row.variants,
    eligibility: row.eligibility,
    customValues: row.customValues,
    confirmedAt: row.confirmedAt,
    confirmationLanguageVersion: row.confirmationLanguageVersion,
    contentChecksum: row.contentChecksum,
    effectiveFrom: row.effectiveFrom,
    effectiveUntil: row.effectiveUntil,
  };
}
