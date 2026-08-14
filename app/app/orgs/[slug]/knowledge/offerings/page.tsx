import Link from "next/link";
import { notFound } from "next/navigation";

import { KnowledgeNav } from "@/components/orgs/knowledge/knowledge-nav";
import { requireVerifiedUser } from "@/lib/auth/session";
import { setActiveOrganization } from "@/lib/orgs/active-organization";
import {
  OrganizationAuthError,
  requireOrganizationMemberBySlug,
} from "@/lib/orgs/authorization";
import { listOfferings } from "@/lib/orgs/offerings";

export default async function OfferingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const user = await requireVerifiedUser({
    returnTo: `/app/orgs/${slug}/knowledge/offerings`,
  });
  let membership;
  try {
    membership = await requireOrganizationMemberBySlug({ user, slug });
  } catch (error) {
    if (error instanceof OrganizationAuthError) notFound();
    throw error;
  }
  await setActiveOrganization({
    user,
    organizationId: membership.organizationId,
  });
  const result = await listOfferings({
    actor: user,
    organizationId: membership.organizationId,
    query: query.q,
    status: query.status,
    page: query.page,
  });

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
        <h1 className="text-2xl font-semibold tracking-tight">Offerings</h1>
        <p className="text-sm leading-6 text-[var(--muted)]">
          Customer-confirmed products, services, plans, packages, and prices.
          Only currently effective active versions are available to members and
          retrieval.
        </p>
      </div>
      <KnowledgeNav
        organizationSlug={slug}
        current="offerings"
        canCreate={result.ok && result.canManage}
      />
      <form
        method="get"
        role="search"
        className="flex flex-wrap items-end gap-3"
      >
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Search offerings</span>
          <input
            type="search"
            name="q"
            defaultValue={query.q}
            maxLength={200}
            className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
          />
        </label>
        {result.ok && result.canManage ? (
          <label className="space-y-1 text-sm">
            <span className="block font-medium">Status</span>
            <select
              name="status"
              defaultValue={query.status ?? "all"}
              className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="draft">Draft</option>
              <option value="archived">Archived</option>
            </select>
          </label>
        ) : null}
        <button className="rounded-sm border border-[var(--border)] px-3 py-2 text-sm">
          Filter
        </button>
      </form>
      {!result.ok ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {result.message}
        </p>
      ) : result.items.length === 0 ? (
        <div className="space-y-2 rounded-sm border border-dashed border-[var(--border)] p-6">
          <p className="font-medium">No offerings yet</p>
          <p className="text-sm text-[var(--muted)]">
            Create a structured offering draft, then preview and confirm it.
          </p>
          {result.canManage ? (
            <Link
              href={`/app/orgs/${slug}/knowledge/offerings/new`}
              className="inline-flex rounded-sm border border-[var(--border)] px-3 py-2 text-sm"
            >
              Create offering
            </Link>
          ) : null}
        </div>
      ) : (
        <ul className="space-y-2">
          {result.items.map((offering) => (
            <li key={offering.id}>
              <Link
                href={`/app/orgs/${slug}/knowledge/offerings/${offering.id}`}
                className="block rounded-sm border border-[var(--border)] bg-[var(--surface)] p-3 hover:bg-[var(--background)]"
              >
                <span className="font-medium">{offering.name}</span>
                <span className="mt-1 block text-sm text-[var(--muted)]">
                  {offering.offeringType.replaceAll("_", " ")} ·{" "}
                  {offering.archivedAt
                    ? "archived"
                    : (offering.versions[0]?.state.toLowerCase() ??
                      "no version")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {result.ok && result.canManage ? (
        <p className="flex flex-wrap gap-2">
          <Link
            href={`/app/orgs/${slug}/knowledge/offerings/new`}
            className="rounded-sm border border-[var(--border)] px-3 py-2 text-sm"
          >
            New offering
          </Link>
          <Link
            href={`/app/orgs/${slug}/knowledge/offerings/compare`}
            className="rounded-sm border border-[var(--border)] px-3 py-2 text-sm"
          >
            Compare active plans
          </Link>
        </p>
      ) : null}
    </div>
  );
}
