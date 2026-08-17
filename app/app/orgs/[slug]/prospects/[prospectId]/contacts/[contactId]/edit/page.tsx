import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ProspectContactEditForm } from "@/components/orgs/prospects/prospect-contact-edit-form";
import { ProspectNav } from "@/components/orgs/prospects/prospect-nav";
import { requireVerifiedUser } from "@/lib/auth/session";
import { setActiveOrganization } from "@/lib/orgs/active-organization";
import {
  OrganizationAuthError,
  requireOrganizationMemberBySlug,
} from "@/lib/orgs/authorization";
import { getProspect } from "@/lib/orgs/prospects";

type PageProps = {
  params: Promise<{ slug: string; prospectId: string; contactId: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Edit contact · ${slug}` };
}

export default async function EditProspectContactPage({ params }: PageProps) {
  const { slug, prospectId, contactId } = await params;
  const user = await requireVerifiedUser({
    returnTo: `/app/orgs/${slug}/prospects/${prospectId}/contacts/${contactId}/edit`,
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
  const result = await getProspect({
    actor: user,
    organizationId: membership.organizationId,
    prospectId,
  });
  if (!result.ok || !result.prospect.canManage) notFound();
  if (result.prospect.lifecycle !== "ACTIVE") notFound();
  const contact = result.prospect.contacts.find(
    (item) => item.id === contactId,
  );
  if (!contact) notFound();
  if (contact.lifecycle !== "ACTIVE") notFound();

  return (
    <div className="space-y-6">
      <p className="text-sm text-[var(--muted)]">
        <Link
          href={`/app/orgs/${slug}/prospects/${prospectId}`}
          className="underline-offset-2 hover:underline"
        >
          ← {result.prospect.displayName}
        </Link>
      </p>
      <h1 className="text-2xl font-semibold tracking-tight">Edit contact</h1>
      <ProspectNav organizationSlug={slug} current="edit" canCreate />
      <ProspectContactEditForm
        organizationSlug={slug}
        prospectId={prospectId}
        contactId={contact.id}
        expectedVersion={contact.version}
        customFields={contact.customFieldControls}
        initial={{
          firstName: contact.firstName,
          lastName: contact.lastName,
          displayName: contact.displayName,
          title: contact.title,
          preferredLanguage: contact.preferredLanguage,
          isPrimary: contact.isPrimary,
        }}
      />
    </div>
  );
}
