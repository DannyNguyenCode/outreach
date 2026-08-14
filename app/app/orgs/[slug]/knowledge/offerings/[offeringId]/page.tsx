import Link from "next/link";
import { notFound } from "next/navigation";

import {
  OfferingArchiveForm,
  OfferingReplacementForm,
} from "@/components/orgs/offerings/offering-actions";
import { OfferingPreview } from "@/components/orgs/offerings/offering-preview";
import { requireVerifiedUser } from "@/lib/auth/session";
import {
  OrganizationAuthError,
  requireOrganizationMemberBySlug,
} from "@/lib/orgs/authorization";
import { getOffering } from "@/lib/orgs/offerings";

export default async function OfferingDetailPage({
  params,
}: {
  params: Promise<{ slug: string; offeringId: string }>;
}) {
  const { slug, offeringId } = await params;
  const user = await requireVerifiedUser({
    returnTo: `/app/orgs/${slug}/knowledge/offerings/${offeringId}`,
  });
  let membership;
  try {
    membership = await requireOrganizationMemberBySlug({ user, slug });
  } catch (error) {
    if (error instanceof OrganizationAuthError) notFound();
    throw error;
  }
  const result = await getOffering({
    actor: user,
    organizationId: membership.organizationId,
    offeringId,
  });
  if (!result.ok) notFound();
  const { offering } = result;
  const current = offering.draft ?? offering.active;
  return (
    <div className="space-y-6">
      <Link
        href={`/app/orgs/${slug}/knowledge/offerings`}
        className="text-sm underline-offset-2 hover:underline"
      >
        ← Offerings
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {offering.name}
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {offering.archivedAt
            ? "Archived and excluded from retrieval."
            : "Confirmed versions are immutable and history is preserved."}
        </p>
      </div>
      {current ? <OfferingPreview version={current} /> : null}
      {result.canManage && offering.draft ? (
        <p className="flex flex-wrap gap-2">
          <Link
            href={`/app/orgs/${slug}/knowledge/offerings/${offering.id}/edit`}
            className="rounded-sm border border-[var(--border)] px-3 py-2 text-sm"
          >
            Edit draft
          </Link>
          <Link
            href={`/app/orgs/${slug}/knowledge/offerings/${offering.id}/versions/${offering.draft.id}`}
            className="rounded-sm border border-[var(--border)] px-3 py-2 text-sm"
          >
            Preview and confirm
          </Link>
        </p>
      ) : null}
      {result.canManage &&
      offering.active &&
      !offering.draft &&
      !offering.archivedAt ? (
        <OfferingReplacementForm
          organizationSlug={slug}
          offeringId={offering.id}
          expectedVersion={offering.version}
        />
      ) : null}
      {result.canArchive && !offering.archivedAt ? (
        <OfferingArchiveForm
          organizationSlug={slug}
          offeringId={offering.id}
          expectedVersion={offering.version}
        />
      ) : null}
      <section className="space-y-2" aria-labelledby="offering-history">
        <h2 id="offering-history" className="text-lg font-medium">
          Version history
        </h2>
        <ul className="space-y-2">
          {offering.versions.map((version) => (
            <li key={version.id}>
              <Link
                href={`/app/orgs/${slug}/knowledge/offerings/${offering.id}/versions/${version.id}`}
                className="block rounded-sm border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--background)]"
              >
                {version.name} · {version.state.toLowerCase()}
                {version.confirmedAt
                  ? ` · confirmed ${version.confirmedAt.toISOString()}`
                  : ""}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
