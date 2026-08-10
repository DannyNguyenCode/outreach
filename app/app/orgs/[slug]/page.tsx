import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireVerifiedUser } from "@/lib/auth/session";
import {
  OrganizationAuthError,
  requireOrganizationMemberBySlug,
} from "@/lib/orgs/authorization";
import { setActiveOrganization } from "@/lib/orgs/active-organization";

type OrgHomePageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({
  params,
}: OrgHomePageProps): Promise<Metadata> {
  const { slug } = await params;
  return { title: slug };
}

export default async function OrganizationHomePage({
  params,
}: OrgHomePageProps) {
  const { slug } = await params;
  const user = await requireVerifiedUser({ returnTo: `/app/orgs/${slug}` });

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

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm text-[var(--muted)]">
          <Link href="/app" className="underline-offset-2 hover:underline">
            ← Organizations
          </Link>
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {membership.organization.name}
        </h1>
        <p className="text-sm leading-6 text-[var(--muted)]">
          Signed in as {user.name}. Your role in this organization is{" "}
          <span className="font-medium text-[var(--foreground)]">
            {membership.role.toLowerCase()}
          </span>
          .
        </p>
      </div>

      <nav aria-label="Organization">
        <ul className="flex flex-wrap gap-3 text-sm">
          <li>
            <Link
              href={`/app/orgs/${slug}/members`}
              className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 hover:bg-[var(--background)]"
            >
              Members & invitations
            </Link>
          </li>
        </ul>
      </nav>
    </div>
  );
}
