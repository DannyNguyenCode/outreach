import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ProspectCreateForm } from "@/components/orgs/prospects/prospect-create-form";
import { ProspectNav } from "@/components/orgs/prospects/prospect-nav";
import { requireVerifiedUser } from "@/lib/auth/session";
import { setActiveOrganization } from "@/lib/orgs/active-organization";
import {
  OrganizationAuthError,
  requireOrganizationMemberBySlug,
} from "@/lib/orgs/authorization";
import { listCustomFields } from "@/lib/orgs/custom-fields";
import { roleHasPermission } from "@/lib/orgs/permissions";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return { title: `New prospect · ${slug}` };
}

export default async function NewProspectPage({ params }: PageProps) {
  const { slug } = await params;
  const user = await requireVerifiedUser({
    returnTo: `/app/orgs/${slug}/prospects/new`,
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
  const fields = await listCustomFields({
    actor: user,
    organizationId: membership.organizationId,
  });
  const prospectFields = fields.ok
    ? fields.fields
        .filter((field) => field.scope === "PROSPECT" && field.isActive)
        .map((field) => ({
          key: field.key,
          label: field.label,
          dataType: field.dataType,
          required: field.required,
          scope: "PROSPECT" as const,
        }))
    : [];

  return (
    <div className="space-y-6">
      <p className="text-sm text-[var(--muted)]">
        <Link
          href={`/app/orgs/${slug}/prospects`}
          className="underline-offset-2 hover:underline"
        >
          ← Prospects
        </Link>
      </p>
      <h1 className="text-2xl font-semibold tracking-tight">New prospect</h1>
      <ProspectNav organizationSlug={slug} current="new" canCreate />
      <ProspectCreateForm
        organizationSlug={slug}
        prospectFields={prospectFields}
      />
    </div>
  );
}
