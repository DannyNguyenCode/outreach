import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DocumentUploadForm } from "@/components/orgs/knowledge/document-upload-form";
import { KnowledgeNav } from "@/components/orgs/knowledge/knowledge-nav";
import { requireVerifiedUser } from "@/lib/auth/session";
import { setActiveOrganization } from "@/lib/orgs/active-organization";
import {
  OrganizationAuthError,
  requireOrganizationMemberBySlug,
} from "@/lib/orgs/authorization";
import { roleHasPermission } from "@/lib/orgs/permissions";

export const metadata: Metadata = { title: "Upload private document" };

export default async function UploadKnowledgeDocumentPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await requireVerifiedUser({
    returnTo: `/app/orgs/${slug}/knowledge/upload`,
  });
  let membership;
  try {
    membership = await requireOrganizationMemberBySlug({ user, slug });
  } catch (error) {
    if (error instanceof OrganizationAuthError) notFound();
    throw error;
  }
  if (!roleHasPermission(membership.role, "org.knowledge.manage")) notFound();
  await setActiveOrganization({
    user,
    organizationId: membership.organizationId,
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
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Upload a private document
        </h1>
        <p className="text-sm leading-6 text-[var(--muted)]">
          The original stays in private storage. Outreach validates its format,
          scans the exact bytes, extracts plain text, and requires your review
          and explicit confirmation before members can retrieve it.
        </p>
      </header>
      <KnowledgeNav organizationSlug={slug} current="new" canCreate={true} />
      <DocumentUploadForm organizationSlug={slug} />
    </div>
  );
}
