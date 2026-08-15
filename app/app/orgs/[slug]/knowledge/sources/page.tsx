import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { KnowledgeNav } from "@/components/orgs/knowledge/knowledge-nav";
import { requireVerifiedUser } from "@/lib/auth/session";
import { setActiveOrganization } from "@/lib/orgs/active-organization";
import {
  OrganizationAuthError,
  requireOrganizationMemberBySlug,
} from "@/lib/orgs/authorization";
import { composeRuntimeContext } from "@/lib/orgs/runtime-composition";
import {
  RUNTIME_SOURCE_REGISTRY,
  type RuntimeEvidenceItem,
  type RuntimeEvidenceProvenance,
} from "@/lib/orgs/runtime-evidence";
import { roleHasPermission } from "@/lib/orgs/permissions";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    q?: string;
    classes?: string | string[];
    limit?: string;
  }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Runtime sources · ${slug}` };
}

export default async function RuntimeSourcesPage({
  params,
  searchParams,
}: PageProps) {
  const { slug } = await params;
  const query = await searchParams;
  const user = await requireVerifiedUser({
    returnTo: `/app/orgs/${slug}/knowledge/sources`,
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

  const requested = normalizeClasses(query.classes);
  const result = await composeRuntimeContext({
    actor: user,
    organizationId: membership.organizationId,
    query: query.q,
    requestedSourceClasses: requested.length > 0 ? requested : undefined,
    limit: query.limit,
  });
  const canCreate = roleHasPermission(membership.role, "org.knowledge.manage");

  return (
    <div className="space-y-6">
      <p className="text-sm text-[var(--muted)]">
        <Link
          href={`/app/orgs/${slug}/knowledge`}
          className="underline-offset-2 hover:underline"
        >
          ← {membership.organization.name}
        </Link>
      </p>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Runtime source inspector
        </h1>
        <p className="max-w-3xl text-sm leading-6 text-[var(--muted)]">
          Deterministically inspect current authorized evidence and exact
          provenance. This preview does not generate an answer and does not use
          AI.
        </p>
      </div>
      <KnowledgeNav
        organizationSlug={slug}
        current="sources"
        canCreate={canCreate}
      />

      <form
        method="get"
        role="search"
        className="space-y-3 rounded-sm border border-[var(--border)] bg-[var(--surface)] p-4"
      >
        <label className="block space-y-1 text-sm">
          <span className="block font-medium">Evidence query</span>
          <input
            name="q"
            type="search"
            defaultValue={query.q ?? ""}
            maxLength={200}
            placeholder="Premium plan price"
            className="w-full max-w-xl rounded-sm border border-[var(--border)] bg-[var(--background)] px-3 py-2"
          />
        </label>
        <fieldset className="space-y-1 text-sm">
          <legend className="font-medium">Current source classes</legend>
          <label className="mr-4 inline-flex items-center gap-2">
            <input
              type="checkbox"
              name="classes"
              value="CUSTOMER_CONFIRMED_KNOWLEDGE"
              defaultChecked={
                requested.length === 0 ||
                requested.includes("CUSTOMER_CONFIRMED_KNOWLEDGE")
              }
            />
            Customer-confirmed knowledge
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              name="classes"
              value="STRUCTURED_OFFERING"
              defaultChecked={
                requested.length === 0 ||
                requested.includes("STRUCTURED_OFFERING")
              }
            />
            Structured offerings
          </label>
        </fieldset>
        <label className="block space-y-1 text-sm">
          <span className="block font-medium">Result limit</span>
          <input
            name="limit"
            type="number"
            min={1}
            max={50}
            defaultValue={query.limit ?? "20"}
            className="w-24 rounded-sm border border-[var(--border)] bg-[var(--background)] px-3 py-2"
          />
        </label>
        <button
          type="submit"
          className="rounded-sm border border-[var(--border)] px-3 py-2 text-sm"
        >
          Inspect evidence
        </button>
      </form>

      {!result.ok ? (
        <p className="text-sm text-[var(--danger)]" role="alert">
          {result.message}
        </p>
      ) : (
        <>
          <section
            className="rounded-sm border border-[var(--border)] p-4"
            aria-labelledby="composition-state-heading"
          >
            <h2 id="composition-state-heading" className="font-medium">
              Composition state: {result.supportState}
            </h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {result.items.length} of at most {result.limit} evidence items.
              Priority guides ordering but never hides an identified conflict.
            </p>
          </section>

          {result.conflicts.length > 0 ? (
            <section className="space-y-2" aria-labelledby="conflicts-heading">
              <h2 id="conflicts-heading" className="text-lg font-medium">
                Conflicts
              </h2>
              <ul className="space-y-2">
                {result.conflicts.map((conflict) => (
                  <li
                    key={conflict.conflictId}
                    className="rounded-sm border border-[var(--danger)] p-3 text-sm"
                  >
                    <p className="font-medium">{conflict.message}</p>
                    <p className="mt-1 text-[var(--muted)]">
                      Evidence: {conflict.evidenceIds.join(" · ")}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {result.supportState === "UNKNOWN" ? (
            <p className="rounded-sm border border-[var(--border)] p-4 text-sm">
              No current authorized evidence supports this query. No answer was
              invented.
            </p>
          ) : null}

          {result.items.length > 0 ? (
            <section className="space-y-2" aria-labelledby="evidence-heading">
              <h2 id="evidence-heading" className="text-lg font-medium">
                Runtime evidence
              </h2>
              <ul className="space-y-3">
                {result.items.map((item) => (
                  <EvidenceCard key={item.evidenceId} item={item} />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function EvidenceCard({ item }: { item: RuntimeEvidenceItem }) {
  const definition = RUNTIME_SOURCE_REGISTRY[item.sourceClass];
  return (
    <li className="rounded-sm border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium">{item.title}</h3>
        <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
          {definition.label}
        </span>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
        {item.safeText}
      </p>
      <dl className="mt-3 grid gap-1 text-xs text-[var(--muted)] sm:grid-cols-2">
        <div>
          <dt className="inline font-medium">Authority: </dt>
          <dd className="inline">{item.authority.classification}</dd>
        </div>
        <div>
          <dt className="inline font-medium">Freshness: </dt>
          <dd className="inline">{formatFreshness(item)}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="inline font-medium">Evidence ID: </dt>
          <dd className="inline">{item.evidenceId}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="inline font-medium">Provenance: </dt>
          <dd className="inline">{formatProvenance(item.provenance)}</dd>
        </div>
      </dl>
    </li>
  );
}

function normalizeClasses(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function formatFreshness(item: RuntimeEvidenceItem): string {
  const from = item.freshness.effectiveFrom ?? "unbounded start";
  const until = item.freshness.effectiveUntil ?? "no expiry";
  return `${item.freshness.state} · ${from} → ${until}`;
}

function formatProvenance(provenance: RuntimeEvidenceProvenance): string {
  if (provenance.kind === "KNOWLEDGE_PASSAGE") {
    return [
      provenance.inputKind,
      `source ${provenance.sourceId}`,
      `version ${provenance.versionId}`,
      `section ${provenance.sectionCitationKey}`,
      `passage ${provenance.passageCitationKey}`,
    ].join(" · ");
  }
  if (provenance.kind === "FUTURE_SOURCE") {
    return `source ${provenance.sourceEntityId}`;
  }
  return [
    provenance.kind,
    `offering ${provenance.offeringId}`,
    `version ${provenance.versionId}`,
    provenance.priceId ? `price ${provenance.priceId}` : null,
    provenance.variantId ? `variant ${provenance.variantId}` : null,
    provenance.featureId ? `feature ${provenance.featureId}` : null,
    provenance.eligibilityId ? `eligibility ${provenance.eligibilityId}` : null,
    provenance.customValueId
      ? `custom value ${provenance.customValueId}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
