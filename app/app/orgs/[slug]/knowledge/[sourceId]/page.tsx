import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  KnowledgeArchiveForm,
  KnowledgeReplacementForm,
} from "@/components/orgs/knowledge/knowledge-actions";
import { KnowledgeNav } from "@/components/orgs/knowledge/knowledge-nav";
import { KnowledgePreview } from "@/components/orgs/knowledge/knowledge-preview";
import { requireVerifiedUser } from "@/lib/auth/session";
import { setActiveOrganization } from "@/lib/orgs/active-organization";
import {
  OrganizationAuthError,
  requireOrganizationMemberBySlug,
} from "@/lib/orgs/authorization";
import { getKnowledgeSource } from "@/lib/orgs/knowledge";

type PageProps = {
  params: Promise<{ slug: string; sourceId: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Knowledge · ${slug}` };
}

export default async function KnowledgeSourcePage({ params }: PageProps) {
  const { slug, sourceId } = await params;
  const user = await requireVerifiedUser({
    returnTo: `/app/orgs/${slug}/knowledge/${sourceId}`,
  });

  let membership;
  try {
    membership = await requireOrganizationMemberBySlug({ user, slug });
  } catch (error) {
    if (error instanceof OrganizationAuthError) {
      notFound();
    }
    throw error;
  }

  await setActiveOrganization({
    user,
    organizationId: membership.organizationId,
  });

  const result = await getKnowledgeSource({
    actor: user,
    organizationId: membership.organizationId,
    sourceId,
  });
  if (!result.ok) {
    notFound();
  }

  const { source, canManage, canArchive } = result;
  const current = source.active ?? source.draft;

  return (
    <div className="space-y-6">
      <p className="text-sm text-[var(--muted)]">
        <Link
          href={`/app/orgs/${slug}/knowledge`}
          className="underline-offset-2 hover:underline"
        >
          ← Business knowledge
        </Link>
      </p>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {source.title}
        </h1>
        <p className="text-sm leading-6 text-[var(--muted)]">
          {source.archivedAt
            ? "This source is archived and excluded from retrieval."
            : "Active confirmed versions are available for retrieval. History is immutable."}
        </p>
      </div>
      <KnowledgeNav
        organizationSlug={slug}
        current="detail"
        canCreate={canManage}
      />

      {current ? <KnowledgePreview version={current} /> : null}

      {canManage && source.draft ? (
        <p>
          <Link
            href={`/app/orgs/${slug}/knowledge/${source.id}/edit`}
            className="rounded-sm border border-[var(--border)] px-3 py-2 text-sm"
          >
            Edit draft
          </Link>{" "}
          <Link
            href={`/app/orgs/${slug}/knowledge/${source.id}/versions/${source.draft.id}`}
            className="rounded-sm border border-[var(--border)] px-3 py-2 text-sm"
          >
            Preview and confirm
          </Link>
        </p>
      ) : null}

      {canManage && source.active && !source.draft && !source.archivedAt ? (
        <KnowledgeReplacementForm
          organizationSlug={slug}
          sourceId={source.id}
          expectedVersion={source.version}
        />
      ) : null}

      {canArchive && !source.archivedAt ? (
        <KnowledgeArchiveForm
          organizationSlug={slug}
          sourceId={source.id}
          expectedVersion={source.version}
        />
      ) : null}

      <section className="space-y-2" aria-labelledby="version-history-heading">
        <h2 id="version-history-heading" className="text-lg font-medium">
          Version history
        </h2>
        <ul className="space-y-2">
          {source.versions.map((version) => (
            <li key={version.id}>
              <Link
                href={`/app/orgs/${slug}/knowledge/${source.id}/versions/${version.id}`}
                className="block rounded-sm border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--background)]"
              >
                {version.title} · {version.state.toLowerCase()}
                {version.confirmedAt
                  ? ` · confirmed ${version.confirmedAt.toISOString()}`
                  : ""}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
