import type { Prisma, PrismaClient, ProspectLifecycle } from "@prisma/client";

import {
  locationMatchKey,
  namesAreStrongMatch,
  PROSPECT_DUPLICATE_CANDIDATE_MAX,
} from "@/lib/orgs/prospect-validation";

export type DuplicateReason =
  "phone" | "email" | "website_name" | "name_location";

export type DuplicateCandidate = {
  prospectId: string;
  displayName: string;
  lifecycle: "ACTIVE" | "ARCHIVED";
  reasons: DuplicateReason[];
};

type ChannelSeed = {
  kind: "PHONE" | "EMAIL";
  normalizedValue: string;
};

type ProspectSeed = {
  displayName: string;
  searchName: string;
  websiteNormalized: string | null;
  locationLabel?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  countryCode?: string | null;
};

function addReason(
  map: Map<string, DuplicateCandidate>,
  row: { id: string; displayName: string; lifecycle: ProspectLifecycle },
  reason: DuplicateReason,
) {
  if (row.lifecycle === "MERGED") {
    return;
  }
  const existing = map.get(row.id);
  if (existing) {
    if (!existing.reasons.includes(reason)) {
      existing.reasons.push(reason);
    }
    return;
  }
  map.set(row.id, {
    prospectId: row.id,
    displayName: row.displayName,
    lifecycle: row.lifecycle,
    reasons: [reason],
  });
}

export async function findDuplicateCandidates(
  tx: Prisma.TransactionClient | PrismaClient,
  input: {
    organizationId: string;
    excludeProspectId?: string;
    prospect: ProspectSeed;
    channels: ChannelSeed[];
  },
): Promise<DuplicateCandidate[]> {
  const map = new Map<string, DuplicateCandidate>();
  const phones = [
    ...new Set(
      input.channels
        .filter((channel) => channel.kind === "PHONE")
        .map((channel) => channel.normalizedValue),
    ),
  ];
  const emails = [
    ...new Set(
      input.channels
        .filter((channel) => channel.kind === "EMAIL")
        .map((channel) => channel.normalizedValue),
    ),
  ];

  const lifecycleFilter: Prisma.ProspectWhereInput = {
    organizationId: input.organizationId,
    lifecycle: { in: ["ACTIVE", "ARCHIVED"] },
    ...(input.excludeProspectId
      ? { id: { not: input.excludeProspectId } }
      : {}),
  };

  if (phones.length > 0) {
    const matches = await tx.prospect.findMany({
      where: {
        ...lifecycleFilter,
        channels: {
          some: {
            organizationId: input.organizationId,
            kind: "PHONE",
            lifecycle: "ACTIVE",
            normalizedValue: { in: phones },
          },
        },
      },
      select: { id: true, displayName: true, lifecycle: true },
      take: PROSPECT_DUPLICATE_CANDIDATE_MAX,
    });
    for (const row of matches) {
      if (row.lifecycle === "MERGED") continue;
      addReason(map, row, "phone");
    }
  }

  if (emails.length > 0) {
    const matches = await tx.prospect.findMany({
      where: {
        ...lifecycleFilter,
        channels: {
          some: {
            organizationId: input.organizationId,
            kind: "EMAIL",
            lifecycle: "ACTIVE",
            normalizedValue: { in: emails },
          },
        },
      },
      select: { id: true, displayName: true, lifecycle: true },
      take: PROSPECT_DUPLICATE_CANDIDATE_MAX,
    });
    for (const row of matches) {
      if (row.lifecycle === "MERGED") continue;
      addReason(map, row, "email");
    }
  }

  if (
    input.prospect.websiteNormalized &&
    input.prospect.searchName.length > 0
  ) {
    const matches = await tx.prospect.findMany({
      where: {
        ...lifecycleFilter,
        websiteNormalized: input.prospect.websiteNormalized,
      },
      select: {
        id: true,
        displayName: true,
        lifecycle: true,
        searchName: true,
      },
      take: 25,
    });
    for (const row of matches) {
      if (row.lifecycle === "MERGED") continue;
      if (namesAreStrongMatch(input.prospect.displayName, row.displayName)) {
        addReason(map, row, "website_name");
      }
    }
  }

  const locationKey = locationMatchKey(input.prospect);
  if (locationKey.length > 0 && input.prospect.searchName.length > 0) {
    const matches = await tx.prospect.findMany({
      where: {
        ...lifecycleFilter,
        searchName: input.prospect.searchName,
      },
      select: {
        id: true,
        displayName: true,
        lifecycle: true,
        locationLabel: true,
        city: true,
        region: true,
        postalCode: true,
        countryCode: true,
      },
      take: 25,
    });
    for (const row of matches) {
      if (row.lifecycle === "MERGED") continue;
      if (locationMatchKey(row) === locationKey) {
        addReason(map, row, "name_location");
      }
    }
  }

  return [...map.values()]
    .sort((a, b) => a.prospectId.localeCompare(b.prospectId))
    .slice(0, PROSPECT_DUPLICATE_CANDIDATE_MAX);
}
