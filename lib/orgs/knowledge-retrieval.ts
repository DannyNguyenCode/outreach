import "server-only";

import type { SafeUser } from "@/lib/auth/users";
import {
  OrganizationAuthError,
  requireOrganizationPermission,
} from "@/lib/orgs/authorization";
import {
  mapKnowledgeError,
  type AuthFailure,
} from "@/lib/orgs/knowledge-access";
import {
  parsePage,
  parsePageSize,
  sanitizeSearchQuery,
} from "@/lib/orgs/knowledge-validation";
import { prisma } from "@/lib/prisma";

export type KnowledgeCitation = {
  sourceId: string;
  versionId: string;
  sectionId: string;
  passageId: string;
  sectionCitationKey: string;
  passageCitationKey: string;
};

export type RetrievedKnowledgePassage = {
  sourceId: string;
  sourceTitle: string;
  versionId: string;
  versionTitle: string;
  sectionId: string;
  sectionTitle: string;
  passageId: string;
  body: string;
  citation: KnowledgeCitation;
  confirmedAt: Date;
  effectiveFrom: Date | null;
  effectiveUntil: Date | null;
  contentChecksum: string;
  confirmationLanguageVersion: string;
};

export type RetrieveActiveKnowledgeResult =
  | {
      ok: true;
      items: RetrievedKnowledgePassage[];
      page: number;
      pageSize: number;
      total: number;
    }
  | AuthFailure;

/**
 * Server-only retrieval of currently effective, customer-confirmed, ACTIVE
 * knowledge. Draft, processing, needs-attention, failed, superseded, archived,
 * unconfirmed, future-dated, expired, and other source classes are excluded
 * in SQL before pagination.
 *
 * Search is case-insensitive substring matching on version title, section
 * title, and passage body. `%`, `_`, and `\` in the query are stripped; this
 * is not ranked full-text search.
 */
export async function retrieveActiveKnowledge(input: {
  actor: SafeUser;
  organizationId: string;
  query?: unknown;
  page?: unknown;
  pageSize?: unknown;
}): Promise<RetrieveActiveKnowledgeResult> {
  const query = sanitizeSearchQuery(input.query);
  const page = parsePage(input.page);
  const pageSize = parsePageSize(input.pageSize);
  const now = new Date();

  try {
    await requireOrganizationPermission({
      user: input.actor,
      organizationId: input.organizationId,
      permission: "org.knowledge.read",
    });

    const where = activePassageWhere(input.organizationId, now, query);
    const total = await prisma.knowledgePassage.count({ where });
    const rows = await prisma.knowledgePassage.findMany({
      where,
      include: {
        source: { select: { id: true, title: true, organizationId: true } },
        version: {
          select: {
            id: true,
            title: true,
            confirmedAt: true,
            confirmationLanguageVersion: true,
            contentChecksum: true,
            effectiveFrom: true,
            effectiveUntil: true,
            organizationId: true,
          },
        },
        section: {
          select: {
            id: true,
            title: true,
            citationKey: true,
            displayOrder: true,
            organizationId: true,
          },
        },
      },
      orderBy: [
        { version: { title: "asc" } },
        { versionId: "asc" },
        { section: { displayOrder: "asc" } },
        { displayOrder: "asc" },
        { id: "asc" },
      ],
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    const items: RetrievedKnowledgePassage[] = [];
    for (const row of rows) {
      if (
        row.organizationId !== input.organizationId ||
        row.source.organizationId !== input.organizationId ||
        row.version.organizationId !== input.organizationId ||
        row.section.organizationId !== input.organizationId
      ) {
        continue;
      }
      if (
        !row.version.confirmedAt ||
        !row.version.confirmationLanguageVersion
      ) {
        continue;
      }
      items.push(mapRetrievedPassage(row));
    }

    return { ok: true, items, page, pageSize, total };
  } catch (error) {
    return (
      mapKnowledgeError(error) ?? {
        ok: false,
        reason: "failed",
        message: "Could not retrieve knowledge.",
      }
    );
  }
}

export function activePassageWhere(
  organizationId: string,
  now: Date,
  query: string,
) {
  return {
    organizationId,
    version: {
      organizationId,
      state: "ACTIVE" as const,
      confirmedAt: { not: null },
      confirmationLanguageVersion: { not: null },
      AND: [
        { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }] },
        { OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }] },
      ],
      source: {
        organizationId,
        archivedAt: null,
        category: "CUSTOMER_CONFIRMED_BUSINESS_FACTS" as const,
        inputKind: "MANUAL" as const,
      },
    },
    ...(query
      ? {
          OR: [
            { body: { contains: query, mode: "insensitive" as const } },
            {
              section: {
                title: { contains: query, mode: "insensitive" as const },
              },
            },
            {
              version: {
                title: { contains: query, mode: "insensitive" as const },
              },
            },
          ],
        }
      : {}),
  };
}

function mapRetrievedPassage(row: {
  id: string;
  sourceId: string;
  versionId: string;
  sectionId: string;
  citationKey: string;
  body: string;
  source: { id: string; title: string };
  version: {
    id: string;
    title: string;
    confirmedAt: Date | null;
    confirmationLanguageVersion: string | null;
    contentChecksum: string;
    effectiveFrom: Date | null;
    effectiveUntil: Date | null;
  };
  section: { id: string; title: string; citationKey: string };
}): RetrievedKnowledgePassage {
  if (!row.version.confirmedAt || !row.version.confirmationLanguageVersion) {
    throw new OrganizationAuthError("forbidden");
  }
  return {
    sourceId: row.sourceId,
    sourceTitle: row.source.title,
    versionId: row.versionId,
    versionTitle: row.version.title,
    sectionId: row.sectionId,
    sectionTitle: row.section.title,
    passageId: row.id,
    body: row.body,
    citation: {
      sourceId: row.sourceId,
      versionId: row.versionId,
      sectionId: row.sectionId,
      passageId: row.id,
      sectionCitationKey: row.section.citationKey,
      passageCitationKey: row.citationKey,
    },
    confirmedAt: row.version.confirmedAt,
    effectiveFrom: row.version.effectiveFrom,
    effectiveUntil: row.version.effectiveUntil,
    contentChecksum: row.version.contentChecksum,
    confirmationLanguageVersion: row.version.confirmationLanguageVersion,
  };
}
