import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ProspectMergeForm } from "@/components/orgs/prospects/prospect-merge-form";
import { ProspectNav } from "@/components/orgs/prospects/prospect-nav";
import { requireVerifiedUser } from "@/lib/auth/session";
import { setActiveOrganization } from "@/lib/orgs/active-organization";
import {
  OrganizationAuthError,
  requireOrganizationMemberBySlug,
} from "@/lib/orgs/authorization";
import { previewProspectMerge } from "@/lib/orgs/prospect-merge";
import { roleHasPermission } from "@/lib/orgs/permissions";

type PageProps = {
  params: Promise<{ slug: string; prospectId: string }>;
  searchParams: Promise<{ with?: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Merge prospects · ${slug}` };
}

export default async function MergeProspectPage({
  params,
  searchParams,
}: PageProps) {
  const { slug, prospectId } = await params;
  const query = await searchParams;
  const user = await requireVerifiedUser({
    returnTo: `/app/orgs/${slug}/prospects/${prospectId}/merge`,
  });
  let membership;
  try {
    membership = await requireOrganizationMemberBySlug({ user, slug });
  } catch (error) {
    if (error instanceof OrganizationAuthError) notFound();
    throw error;
  }
  if (!roleHasPermission(membership.role, "org.prospects.manage")) {
    notFound();
  }
  await setActiveOrganization({
    user,
    organizationId: membership.organizationId,
  });
  const otherId = query.with ?? "";
  if (!otherId) {
    notFound();
  }
  const preview = await previewProspectMerge({
    actor: user,
    organizationId: membership.organizationId,
    survivorProspectId: prospectId,
    duplicateProspectId: otherId,
  });
  if (!preview.ok) notFound();

  return (
    <div className="space-y-6">
      <p className="text-sm text-[var(--muted)]">
        <Link
          href={`/app/orgs/${slug}/prospects/${prospectId}`}
          className="underline-offset-2 hover:underline"
        >
          ← Cancel merge
        </Link>
      </p>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Merge prospects
        </h1>
        <p className="text-sm leading-6 text-[var(--muted)]">
          Choose the surviving record and resolve conflicts. The other prospect
          is preserved as merged history and is not deleted.
        </p>
      </div>
      <ProspectNav organizationSlug={slug} current="merge" canCreate />
      <ProspectMergeForm organizationSlug={slug} preview={preview.preview} />
    </div>
  );
}
