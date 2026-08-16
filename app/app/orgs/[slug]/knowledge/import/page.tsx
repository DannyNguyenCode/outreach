import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CsvImportRecentList } from "@/components/orgs/knowledge/csv-import-recent-list";
import { CsvImportWorkflow } from "@/components/orgs/knowledge/csv-import-workflow";
import { KnowledgeNav } from "@/components/orgs/knowledge/knowledge-nav";
import { requireVerifiedUser } from "@/lib/auth/session";
import { setActiveOrganization } from "@/lib/orgs/active-organization";
import {
  OrganizationAuthError,
  requireOrganizationMemberBySlug,
} from "@/lib/orgs/authorization";
import { listRecentCsvImports } from "@/lib/orgs/csv-import";
import { roleHasPermission } from "@/lib/orgs/permissions";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return { title: `CSV import · ${slug}` };
}

export default async function CsvImportPage({ params }: PageProps) {
  const { slug } = await params;
  const user = await requireVerifiedUser({
    returnTo: `/app/orgs/${slug}/knowledge/import`,
  });
  let membership;
  try {
    membership = await requireOrganizationMemberBySlug({ user, slug });
  } catch (error) {
    if (error instanceof OrganizationAuthError) notFound();
    throw error;
  }
  if (!roleHasPermission(membership.role, "org.knowledge.manage")) {
    notFound();
  }
  await setActiveOrganization({
    user,
    organizationId: membership.organizationId,
  });
  const listed = await listRecentCsvImports({
    actor: user,
    organizationId: membership.organizationId,
  });
  const imports = listed.ok ? listed.imports : [];

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
        <h1 className="text-2xl font-semibold tracking-tight">CSV import</h1>
        <p className="text-sm leading-6 text-[var(--muted)]">
          Preview file validates the original bytes without saving them. Stage
          import stores an immutable review snapshot. Confirm and activate
          publishes the reviewed rows. Outreach does not independently verify
          that customer-provided business information is true.
        </p>
      </header>
      <KnowledgeNav organizationSlug={slug} current="import" canCreate />
      <CsvImportWorkflow organizationSlug={slug} />
      <section className="space-y-3" aria-labelledby="recent-imports-heading">
        <h2 id="recent-imports-heading" className="text-lg font-semibold">
          Recent imports
        </h2>
        <CsvImportRecentList organizationSlug={slug} imports={imports} />
      </section>
    </div>
  );
}
