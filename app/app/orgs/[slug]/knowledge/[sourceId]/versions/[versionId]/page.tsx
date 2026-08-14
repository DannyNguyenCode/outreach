import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  KnowledgeConfirmForm,
  KnowledgeRestoreForm,
} from "@/components/orgs/knowledge/knowledge-actions";
import { KnowledgeNav } from "@/components/orgs/knowledge/knowledge-nav";
import { KnowledgePreview } from "@/components/orgs/knowledge/knowledge-preview";
import { requireVerifiedUser } from "@/lib/auth/session";
import { setActiveOrganization } from "@/lib/orgs/active-organization";
import {
  OrganizationAuthError,
  requireOrganizationMemberBySlug,
} from "@/lib/orgs/authorization";
import { getKnowledgeVersion } from "@/lib/orgs/knowledge";

type PageProps = {
  params: Promise<{ slug: string; sourceId: string; versionId: string }>;
};

export async function generateMetadata(): Promise<Metadata> {
  return { title: "Knowledge version" };
}

export default async function KnowledgeVersionPage({ params }: PageProps) {
  const { slug, sourceId, versionId } = await params;
  const user = await requireVerifiedUser({
    returnTo: `/app/orgs/${slug}/knowledge/${sourceId}/versions/${versionId}`,
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

  const result = await getKnowledgeVersion({
    actor: user,
    organizationId: membership.organizationId,
    sourceId,
    versionId,
  });
  if (!result.ok) {
    notFound();
  }

  const { source, version, canManage, canConfirm, canArchive } = result;

  return (
    <div className="space-y-6">
      <p className="text-sm text-[var(--muted)]">
        <Link
          href={`/app/orgs/${slug}/knowledge/${sourceId}`}
          className="underline-offset-2 hover:underline"
        >
          ← {source.title}
        </Link>
      </p>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Preview this version
        </h1>
        <p className="text-sm leading-6 text-[var(--muted)]">
          This is the exact content that will be confirmed. Confirmation records
          your user ID, the timestamp, this checksum, and confirmation language
          version knowledge.confirm.v1.
        </p>
      </div>
      <KnowledgeNav
        organizationSlug={slug}
        current="detail"
        canCreate={canManage}
      />
      <KnowledgePreview
        version={version}
        organizationTimeZone={result.organizationTimeZone}
      />

      {canManage && version.state === "DRAFT" ? (
        <p>
          <Link
            href={`/app/orgs/${slug}/knowledge/${sourceId}/edit`}
            className="rounded-sm border border-[var(--border)] px-3 py-2 text-sm"
          >
            Edit draft
          </Link>
        </p>
      ) : null}

      {canConfirm && version.state === "DRAFT" ? (
        <KnowledgeConfirmForm
          organizationSlug={slug}
          sourceId={source.id}
          versionId={version.id}
          expectedDraftRevision={version.draftRevision}
          expectedChecksum={version.contentChecksum}
        />
      ) : null}

      {canArchive &&
      (version.state === "SUPERSEDED" || version.state === "ARCHIVED") &&
      version.confirmedAt ? (
        <KnowledgeRestoreForm
          organizationSlug={slug}
          sourceId={source.id}
          versionId={version.id}
          expectedVersion={source.version}
        />
      ) : null}
    </div>
  );
}
