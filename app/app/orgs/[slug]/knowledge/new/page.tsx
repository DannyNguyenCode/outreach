import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { createManualKnowledgeAction } from "@/app/actions/knowledge";
import { KnowledgeEditorForm } from "@/components/orgs/knowledge/knowledge-editor-form";
import { KnowledgeNav } from "@/components/orgs/knowledge/knowledge-nav";
import { requireVerifiedUser } from "@/lib/auth/session";
import { setActiveOrganization } from "@/lib/orgs/active-organization";
import {
  OrganizationAuthError,
  requireOrganizationMemberBySlug,
} from "@/lib/orgs/authorization";
import { roleHasPermission } from "@/lib/orgs/permissions";
import { prisma } from "@/lib/prisma";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata(): Promise<Metadata> {
  return { title: "New knowledge" };
}

export default async function NewKnowledgePage({ params }: PageProps) {
  const { slug } = await params;
  const user = await requireVerifiedUser({
    returnTo: `/app/orgs/${slug}/knowledge/new`,
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

  if (!roleHasPermission(membership.role, "org.knowledge.manage")) {
    notFound();
  }

  const profile = await prisma.businessProfile.findUnique({
    where: { organizationId: membership.organizationId },
    select: { timeZone: true },
  });
  const organizationTimeZone = profile?.timeZone?.trim() || null;
  const settingsHref = `/app/orgs/${slug}/settings`;

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
          New knowledge draft
        </h1>
        <p className="text-sm leading-6 text-[var(--muted)]">
          Manual drafts stay inactive until you preview the exact version and
          confirm it. Outreach does not verify truth or legal validity.
        </p>
      </div>
      <KnowledgeNav organizationSlug={slug} current="new" canCreate />
      <KnowledgeEditorForm
        organizationSlug={slug}
        action={createManualKnowledgeAction}
        submitLabel="Save draft"
        pendingLabel="Saving…"
        organizationTimeZone={organizationTimeZone}
        settingsHref={settingsHref}
        defaults={{
          title: "",
          effectiveFrom: "",
          effectiveUntil: "",
          sections: [{ title: "", passages: [{ body: "" }] }],
        }}
      />
    </div>
  );
}
