import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CsvImportReviewForm } from "@/components/orgs/knowledge/csv-import-review-form";
import { KnowledgeNav } from "@/components/orgs/knowledge/knowledge-nav";
import { requireVerifiedUser } from "@/lib/auth/session";
import { setActiveOrganization } from "@/lib/orgs/active-organization";
import {
  OrganizationAuthError,
  requireOrganizationMemberBySlug,
} from "@/lib/orgs/authorization";
import { getCsvImport } from "@/lib/orgs/csv-import";
import { getCsvImportConfirmation } from "@/lib/orgs/csv-import-activation";
import { CSV_IMPORT_ACTIVATION_MAX_ROWS } from "@/lib/orgs/csv-import-confirmation";
import { roleHasPermission } from "@/lib/orgs/permissions";

type PageProps = {
  params: Promise<{ slug: string; importId: string }>;
};

export async function generateMetadata(): Promise<Metadata> {
  return { title: "CSV import review" };
}

export default async function CsvImportDetailPage({ params }: PageProps) {
  const { slug, importId } = await params;
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

  const loaded = await getCsvImport({
    actor: user,
    organizationId: membership.organizationId,
    importId,
  });
  if (!loaded.ok) {
    notFound();
  }
  const confirmation = await getCsvImportConfirmation({
    actor: user,
    organizationId: membership.organizationId,
    importId,
  });
  const receipt = confirmation.ok ? confirmation.confirmation : null;
  const staged = loaded.import;
  const overCap = staged.validRowCount > CSV_IMPORT_ACTIVATION_MAX_ROWS;
  const needsAttention = staged.status === "NEEDS_ATTENTION";
  const canConfirm =
    !receipt && staged.status === "READY_TO_CONFIRM" && !overCap;

  return (
    <div className="space-y-6">
      <p className="text-sm text-[var(--muted)]">
        <Link
          href={`/app/orgs/${slug}/knowledge/import`}
          className="underline-offset-2 hover:underline"
        >
          ← CSV imports
        </Link>
      </p>
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Review CSV import
        </h1>
        <p className="text-sm leading-6 text-[var(--muted)]">
          This page shows the exact persisted snapshot. You can leave and return
          later. Raw file bytes are not stored. Outreach does not independently
          verify that these values are factually true.
        </p>
      </header>
      <KnowledgeNav organizationSlug={slug} current="import" canCreate />

      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="font-medium">Filename</dt>
          <dd>{staged.filename}</dd>
        </div>
        <div>
          <dt className="font-medium">Target</dt>
          <dd>{staged.family}</dd>
        </div>
        <div>
          <dt className="font-medium">Status</dt>
          <dd>
            {receipt
              ? "Confirmed"
              : needsAttention
                ? "Needs attention"
                : "Ready to confirm"}
          </dd>
        </div>
        <div>
          <dt className="font-medium">Created</dt>
          <dd>{staged.createdAt.toISOString()}</dd>
        </div>
        <div>
          <dt className="font-medium">Rows</dt>
          <dd>
            {staged.validRowCount} valid / {staged.totalRowCount} total
          </dd>
        </div>
        <div>
          <dt className="font-medium">Issues</dt>
          <dd>{staged.issueCount}</dd>
        </div>
      </dl>

      <section className="space-y-2" aria-labelledby="mapping-heading">
        <h2 id="mapping-heading" className="text-lg font-semibold">
          Persisted mapping
        </h2>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {staged.mapping.columns.map((column) => (
            <li key={column.sourceColumn}>
              Column {column.sourceColumn} → {column.target}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2" aria-labelledby="rows-heading">
        <h2 id="rows-heading" className="text-lg font-semibold">
          Persisted rows
        </h2>
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <caption className="sr-only">Staged CSV rows</caption>
            <thead>
              <tr>
                <th scope="col" className="border px-2 py-1 text-left">
                  Source row
                </th>
                <th scope="col" className="border px-2 py-1 text-left">
                  Mapped fields
                </th>
                <th scope="col" className="border px-2 py-1 text-left">
                  Issues
                </th>
              </tr>
            </thead>
            <tbody>
              {staged.rows.map((row) => (
                <tr key={row.id}>
                  <td className="border px-2 py-1">{row.sourceRowNumber}</td>
                  <td className="border px-2 py-1">
                    {Object.entries(row.values)
                      .map(
                        ([field, value]) => `${field}=${String(value.value)}`,
                      )
                      .join("; ")}
                  </td>
                  <td className="border px-2 py-1">
                    {row.issues.map((issue) => issue.code).join(", ") || "None"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {needsAttention ? (
        <p className="text-sm">
          This snapshot needs attention and cannot be activated. Because staged
          imports are immutable, upload a corrected CSV to create a new review
          snapshot. The history of this import is preserved.
        </p>
      ) : null}

      {overCap && !receipt ? (
        <p className="text-sm">
          This import has {staged.validRowCount} rows. Outreach can activate at
          most {CSV_IMPORT_ACTIVATION_MAX_ROWS} rows in one confirmation. Stage
          a smaller file to continue. This snapshot is unchanged.
        </p>
      ) : null}

      {receipt ? (
        <section className="space-y-3" aria-labelledby="activated-heading">
          <h2 id="activated-heading" className="text-lg font-semibold">
            Confirmation receipt
          </h2>
          <p className="text-sm">
            Confirmed {receipt.confirmedAt.toISOString()} · language{" "}
            {receipt.confirmationLanguageVersion} · {receipt.createdRowCount}{" "}
            created records
          </p>
          {receipt.knowledgeActivations.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {receipt.knowledgeActivations.map((item) => (
                <li key={item.importRowId}>
                  <Link
                    href={`/app/orgs/${slug}/knowledge/${item.knowledgeSourceId}/versions/${item.knowledgeVersionId}`}
                    className="underline-offset-2 hover:underline"
                  >
                    Knowledge version {item.knowledgeVersionId}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          {receipt.offeringActivations.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {receipt.offeringActivations.map((item) => (
                <li key={item.importRowId}>
                  <Link
                    href={`/app/orgs/${slug}/knowledge/offerings/${item.offeringId}/versions/${item.offeringVersionId}`}
                    className="underline-offset-2 hover:underline"
                  >
                    Offering version {item.offeringVersionId}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {canConfirm ? (
        <CsvImportReviewForm
          organizationSlug={slug}
          importId={staged.id}
          expectedImportIdentity={staged.importIdentity}
        />
      ) : null}
    </div>
  );
}
