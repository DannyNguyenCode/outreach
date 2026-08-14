import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { updateKnowledgeDraftAction } from "@/app/actions/knowledge";
import { KnowledgeEditorForm } from "@/components/orgs/knowledge/knowledge-editor-form";
import { KnowledgeNav } from "@/components/orgs/knowledge/knowledge-nav";
import { requireVerifiedUser } from "@/lib/auth/session";
import { setActiveOrganization } from "@/lib/orgs/active-organization";
import {
  OrganizationAuthError,
  requireOrganizationMemberBySlug,
} from "@/lib/orgs/authorization";
import { getKnowledgeSource } from "@/lib/orgs/knowledge";

type PageProps = {
  params: Promise<{ slug: string; sourceId: string }>;
};

export async function generateMetadata(): Promise<Metadata> {
  return { title: "Edit knowledge draft" };
}

export default async function EditKnowledgePage({ params }: PageProps) {
  const { slug, sourceId } = await params;
  const user = await requireVerifiedUser({
    returnTo: `/app/orgs/${slug}/knowledge/${sourceId}/edit`,
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

  const result = await getKnowledgeSource({
    actor: user,
    organizationId: membership.organizationId,
    sourceId,
  });
  if (!result.ok || !result.canManage || !result.source.draft) {
    notFound();
  }

  const draft = result.source.draft;

  return (
    <div className="space-y-6">
      <p className="text-sm text-[var(--muted)]">
        <Link
          href={`/app/orgs/${slug}/knowledge/${sourceId}`}
          className="underline-offset-2 hover:underline"
        >
          ← {result.source.title}
        </Link>
      </p>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Edit draft</h1>
        <p className="text-sm leading-6 text-[var(--muted)]">
          Saving updates this draft only. Confirmed versions stay immutable.
        </p>
      </div>
      <KnowledgeNav organizationSlug={slug} current="detail" canCreate />
      <KnowledgeEditorForm
        organizationSlug={slug}
        action={updateKnowledgeDraftAction}
        submitLabel="Save draft"
        pendingLabel="Saving…"
        sourceId={sourceId}
        versionId={draft.id}
        expectedDraftRevision={draft.draftRevision}
        defaults={{
          title: draft.title,
          effectiveFrom: draft.effectiveFrom,
          effectiveUntil: draft.effectiveUntil,
          sections: draft.sections.map((section) => ({
            citationKey: section.citationKey,
            title: section.title,
            passages: section.passages.map((passage) => ({
              citationKey: passage.citationKey,
              body: passage.body,
            })),
          })),
        }}
      />
    </div>
  );
}
