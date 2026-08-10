import type { Metadata } from "next";
import Link from "next/link";

import { logoutAction } from "@/app/actions/auth";
import { selectOrganizationAction } from "@/app/actions/orgs";
import { requireVerifiedUser } from "@/lib/auth/session";
import { getValidatedActiveOrganization } from "@/lib/orgs/active-organization";
import { listOrganizationsForUser } from "@/lib/orgs/organizations";

export const metadata: Metadata = {
  title: "App",
};

export default async function AppHomePage() {
  const user = await requireVerifiedUser({ returnTo: "/app" });
  const organizations = await listOrganizationsForUser(user.id);
  const active = await getValidatedActiveOrganization(user);

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Organizations</h1>
        <p className="text-sm leading-6 text-[var(--muted)]">
          Signed in as {user.name} ({user.email}). Choose an organization or
          create a new one.
        </p>
      </div>

      {active ? (
        <p className="text-sm text-[var(--muted)]">
          Last selected:{" "}
          <Link
            href={`/app/orgs/${active.organization.slug}`}
            className="font-medium text-[var(--foreground)] underline-offset-2 hover:underline"
          >
            {active.organization.name}
          </Link>
        </p>
      ) : null}

      <section className="space-y-3" aria-labelledby="org-list-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="org-list-heading" className="text-lg font-medium">
            Your organizations
          </h2>
          <Link
            href="/app/organizations/new"
            className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm hover:bg-[var(--background)]"
          >
            Create organization
          </Link>
        </div>

        {organizations.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            You are not a member of any organization yet.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border)] border border-[var(--border)] bg-[var(--surface)]">
            {organizations.map((entry) => (
              <li
                key={entry.membershipId}
                className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="text-sm font-medium">
                    {entry.organization.name}
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    {entry.organization.slug} · {entry.role}
                  </p>
                </div>
                <form action={selectOrganizationAction}>
                  <input
                    type="hidden"
                    name="organizationId"
                    value={entry.organization.id}
                  />
                  <button
                    type="submit"
                    className="rounded-sm border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--background)]"
                  >
                    Open
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <form action={logoutAction}>
        <button
          type="submit"
          className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium hover:bg-[var(--background)]"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
