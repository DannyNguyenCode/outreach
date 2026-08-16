import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { KnowledgeNav } from "@/components/orgs/knowledge/knowledge-nav";
import { requireVerifiedUser } from "@/lib/auth/session";
import { setActiveOrganization } from "@/lib/orgs/active-organization";
import {
  OrganizationAuthError,
  requireOrganizationMemberBySlug,
} from "@/lib/orgs/authorization";
import { listKnowledgeSources } from "@/lib/orgs/knowledge";
import { retrieveActiveKnowledge } from "@/lib/orgs/knowledge-retrieval";
import { roleHasPermission } from "@/lib/orgs/permissions";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Knowledge · ${slug}` };
}

export default async function KnowledgeListPage({
  params,
  searchParams,
}: PageProps) {
  const { slug } = await params;
  const query = await searchParams;
  const user = await requireVerifiedUser({
    returnTo: `/app/orgs/${slug}/knowledge`,
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

  const canManage = roleHasPermission(membership.role, "org.knowledge.manage");
  const listed = await listKnowledgeSources({
    actor: user,
    organizationId: membership.organizationId,
    query: query.q,
    status: query.status,
    page: query.page,
  });
  const retrieved = await retrieveActiveKnowledge({
    actor: user,
    organizationId: membership.organizationId,
    query: query.q,
    page: query.page,
  });

  return (
    <div className="space-y-6">
      <p className="text-sm text-[var(--muted)]">
        <Link
          href={`/app/orgs/${slug}`}
          className="underline-offset-2 hover:underline"
        >
          ← {membership.organization.name}
        </Link>
      </p>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Business knowledge
        </h1>
        <p className="text-sm leading-6 text-[var(--muted)]">
          Customer-confirmed policies, scripts, FAQs, and other reference
          content. Draft, unconfirmed, superseded, archived, and expired
          versions are excluded from active retrieval.
        </p>
      </div>
      <KnowledgeNav
        organizationSlug={slug}
        current="list"
        canCreate={canManage}
      />

      {canManage ? (
        <p className="text-sm">
          <Link
            href={`/app/orgs/${slug}/knowledge/import`}
            className="underline-offset-2 hover:underline"
          >
            Import knowledge or offerings from CSV
          </Link>
        </p>
      ) : null}
      <p className="text-sm">
        <Link
          href={`/app/orgs/${slug}/knowledge/offerings`}
          className="underline-offset-2 hover:underline"
        >
          Manage structured offerings
        </Link>
      </p>

      <form
        method="get"
        className="flex flex-wrap items-end gap-3"
        role="search"
      >
        <div className="space-y-1">
          <label htmlFor="knowledge-q" className="block text-sm font-medium">
            Search
          </label>
          <input
            id="knowledge-q"
            name="q"
            type="search"
            defaultValue={query.q ?? ""}
            maxLength={200}
            className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
        </div>
        {canManage ? (
          <div className="space-y-1">
            <label
              htmlFor="knowledge-status"
              className="block text-sm font-medium"
            >
              Status
            </label>
            <select
              id="knowledge-status"
              name="status"
              defaultValue={query.status ?? "all"}
              className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="draft">Draft</option>
              <option value="archived">Archived</option>
            </select>
          </div>
        ) : null}
        <button
          type="submit"
          className="rounded-sm border border-[var(--border)] px-3 py-2 text-sm"
        >
          Filter
        </button>
      </form>

      {!listed.ok ? (
        <p className="text-sm text-[var(--danger)]" role="alert">
          {listed.message}
        </p>
      ) : listed.items.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          No knowledge matches this filter.
        </p>
      ) : (
        <ul className="space-y-2">
          {listed.items.map((item) => {
            const active = item.versions.find(
              (version) => version.state === "ACTIVE",
            );
            const draft = item.versions.find(
              (version) => version.state === "DRAFT",
            );
            return (
              <li key={item.id}>
                <Link
                  href={`/app/orgs/${slug}/knowledge/${item.id}`}
                  className="block rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-3 hover:bg-[var(--background)]"
                >
                  <span className="font-medium">{item.title}</span>
                  <span className="mt-1 block text-sm text-[var(--muted)]">
                    {item.archivedAt
                      ? "Archived"
                      : active
                        ? "Active confirmed version"
                        : draft
                          ? "Draft"
                          : (item.versions[0]?.state.toLowerCase() ??
                            "No versions")}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {listed.ok && listed.total > listed.pageSize ? (
        <p className="text-sm text-[var(--muted)]">
          Page {listed.page} of {Math.ceil(listed.total / listed.pageSize)}.
          {listed.page > 1 ? (
            <>
              {" "}
              <Link
                href={`/app/orgs/${slug}/knowledge?q=${encodeURIComponent(query.q ?? "")}&status=${encodeURIComponent(query.status ?? "all")}&page=${listed.page - 1}`}
                className="underline-offset-2 hover:underline"
              >
                Previous
              </Link>
            </>
          ) : null}
          {listed.page * listed.pageSize < listed.total ? (
            <>
              {" "}
              <Link
                href={`/app/orgs/${slug}/knowledge?q=${encodeURIComponent(query.q ?? "")}&status=${encodeURIComponent(query.status ?? "all")}&page=${listed.page + 1}`}
                className="underline-offset-2 hover:underline"
              >
                Next
              </Link>
            </>
          ) : null}
        </p>
      ) : null}

      {retrieved.ok && retrieved.items.length > 0 ? (
        <section
          className="space-y-2"
          aria-labelledby="active-retrieval-heading"
        >
          <h2 id="active-retrieval-heading" className="text-lg font-medium">
            Active retrieval
          </h2>
          <p className="text-sm text-[var(--muted)]">
            Only currently effective confirmed passages. Search is unranked
            substring matching.
          </p>
          <ul className="space-y-2">
            {retrieved.items.map((item) => (
              <li
                key={item.passageId}
                className="rounded-sm border border-[var(--border)] px-3 py-2 text-sm"
              >
                <p className="font-medium">{item.versionTitle}</p>
                <p className="mt-1 whitespace-pre-wrap leading-6">
                  {item.body}
                </p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Citation source {item.citation.sourceId} · version{" "}
                  {item.citation.versionId} · section{" "}
                  {item.citation.sectionCitationKey} · passage{" "}
                  {item.citation.passageCitationKey}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {canManage ? (
        <p className="flex flex-wrap gap-2">
          <Link
            href={`/app/orgs/${slug}/knowledge/new`}
            className="rounded-sm border border-[var(--border)] px-3 py-2 text-sm"
          >
            Create manual knowledge
          </Link>{" "}
          <Link
            href={`/app/orgs/${slug}/knowledge/upload`}
            className="rounded-sm border border-[var(--border)] px-3 py-2 text-sm"
          >
            Upload private document
          </Link>
        </p>
      ) : (
        <p className="text-sm text-[var(--muted)]">
          You can view active confirmed knowledge. Only owners and admins can
          create, confirm, or archive it.
        </p>
      )}
    </div>
  );
}
