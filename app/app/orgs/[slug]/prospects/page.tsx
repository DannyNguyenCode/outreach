import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ProspectNav } from "@/components/orgs/prospects/prospect-nav";
import { requireVerifiedUser } from "@/lib/auth/session";
import { setActiveOrganization } from "@/lib/orgs/active-organization";
import {
  OrganizationAuthError,
  requireOrganizationMemberBySlug,
} from "@/lib/orgs/authorization";
import { listProspects } from "@/lib/orgs/prospects";
import { roleHasPermission } from "@/lib/orgs/permissions";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string; lifecycle?: string; page?: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Prospects · ${slug}` };
}

export default async function ProspectsPage({
  params,
  searchParams,
}: PageProps) {
  const { slug } = await params;
  const query = await searchParams;
  const user = await requireVerifiedUser({
    returnTo: `/app/orgs/${slug}/prospects`,
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
  const canManage = roleHasPermission(membership.role, "org.prospects.manage");
  const listed = await listProspects({
    actor: user,
    organizationId: membership.organizationId,
    query: query.q,
    lifecycle: query.lifecycle,
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
        <h1 className="text-2xl font-semibold tracking-tight">Prospects</h1>
        <p className="text-sm leading-6 text-[var(--muted)]">
          Organization-scoped CRM records. A stored phone or email is not
          permission to contact anyone.
        </p>
      </div>
      <ProspectNav
        organizationSlug={slug}
        current="list"
        canCreate={canManage}
      />
      <form
        method="get"
        role="search"
        className="flex flex-wrap items-end gap-3"
      >
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Search</span>
          <input
            type="search"
            name="q"
            defaultValue={query.q ?? ""}
            maxLength={200}
            className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Lifecycle</span>
          <select
            name="lifecycle"
            defaultValue={query.lifecycle ?? "ACTIVE"}
            className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
          >
            <option value="ACTIVE">Active</option>
            <option value="ARCHIVED">Archived</option>
          </select>
        </label>
        <button className="rounded-sm border border-[var(--border)] px-3 py-2 text-sm">
          Filter
        </button>
      </form>
      {!listed.ok ? (
        <p className="text-sm text-[var(--danger)]">{listed.message}</p>
      ) : listed.items.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          No prospects match these filters.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <caption className="sr-only">Prospect list</caption>
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="py-2 pr-3 font-medium">Name</th>
                <th className="py-2 pr-3 font-medium">Primary contact</th>
                <th className="py-2 pr-3 font-medium">Phone</th>
                <th className="py-2 pr-3 font-medium">Email</th>
                <th className="py-2 pr-3 font-medium">Source</th>
                <th className="py-2 pr-3 font-medium">Lifecycle</th>
                <th className="py-2 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {listed.items.map((item) => (
                <tr key={item.id} className="border-b border-[var(--border)]">
                  <td className="py-2 pr-3">
                    <Link
                      href={`/app/orgs/${slug}/prospects/${item.id}`}
                      className="underline-offset-2 hover:underline"
                    >
                      {item.displayName}
                    </Link>
                  </td>
                  <td className="py-2 pr-3">
                    {item.primaryContactName ?? "—"}
                  </td>
                  <td className="py-2 pr-3">{item.primaryPhone ?? "—"}</td>
                  <td className="py-2 pr-3">{item.primaryEmail ?? "—"}</td>
                  <td className="py-2 pr-3">{item.sourceKind.toLowerCase()}</td>
                  <td className="py-2 pr-3">{item.lifecycle.toLowerCase()}</td>
                  <td className="py-2">
                    {item.updatedAt.toISOString().slice(0, 10)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {listed.ok && listed.total > listed.pageSize ? (
        <nav aria-label="Pagination" className="flex gap-3 text-sm">
          {listed.page > 1 ? (
            <Link
              href={`/app/orgs/${slug}/prospects?q=${encodeURIComponent(query.q ?? "")}&lifecycle=${query.lifecycle ?? "ACTIVE"}&page=${listed.page - 1}`}
              className="underline-offset-2 hover:underline"
            >
              Previous
            </Link>
          ) : null}
          {listed.page * listed.pageSize < listed.total ? (
            <Link
              href={`/app/orgs/${slug}/prospects?q=${encodeURIComponent(query.q ?? "")}&lifecycle=${query.lifecycle ?? "ACTIVE"}&page=${listed.page + 1}`}
              className="underline-offset-2 hover:underline"
            >
              Next
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
