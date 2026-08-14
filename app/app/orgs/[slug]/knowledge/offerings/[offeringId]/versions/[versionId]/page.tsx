import Link from "next/link";
import { notFound } from "next/navigation";

import {
  OfferingConfirmForm,
  OfferingRestoreForm,
} from "@/components/orgs/offerings/offering-actions";
import { OfferingPreview } from "@/components/orgs/offerings/offering-preview";
import { requireVerifiedUser } from "@/lib/auth/session";
import {
  OrganizationAuthError,
  requireOrganizationMemberBySlug,
} from "@/lib/orgs/authorization";
import { getOfferingVersion } from "@/lib/orgs/offerings";

export default async function OfferingVersionPage({
  params,
}: {
  params: Promise<{ slug: string; offeringId: string; versionId: string }>;
}) {
  const { slug, offeringId, versionId } = await params;
  const user = await requireVerifiedUser({
    returnTo: `/app/orgs/${slug}/knowledge/offerings/${offeringId}/versions/${versionId}`,
  });
  let membership;
  try {
    membership = await requireOrganizationMemberBySlug({ user, slug });
  } catch (error) {
    if (error instanceof OrganizationAuthError) notFound();
    throw error;
  }
  const result = await getOfferingVersion({
    actor: user,
    organizationId: membership.organizationId,
    offeringId,
    versionId,
  });
  if (!result.ok) notFound();
  return (
    <div className="space-y-6">
      <Link
        href={`/app/orgs/${slug}/knowledge/offerings/${offeringId}`}
        className="text-sm underline-offset-2 hover:underline"
      >
        ← {result.offering.name}
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Offering version
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Review the exact structured values and checksum before confirmation.
        </p>
      </div>
      <OfferingPreview version={result.version} />
      {result.canConfirm && result.version.state === "DRAFT" ? (
        <OfferingConfirmForm
          organizationSlug={slug}
          offeringId={offeringId}
          versionId={versionId}
          draftRevision={result.version.draftRevision}
          checksum={result.version.contentChecksum}
        />
      ) : null}
      {result.canArchive &&
      result.version.confirmedAt &&
      (result.version.state === "SUPERSEDED" ||
        result.version.state === "ARCHIVED") ? (
        <OfferingRestoreForm
          organizationSlug={slug}
          offeringId={offeringId}
          versionId={versionId}
          expectedVersion={result.offering.version}
        />
      ) : null}
    </div>
  );
}
