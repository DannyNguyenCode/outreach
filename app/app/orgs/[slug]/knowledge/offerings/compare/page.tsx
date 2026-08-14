import Link from "next/link";
import { notFound } from "next/navigation";

import { requireVerifiedUser } from "@/lib/auth/session";
import {
  OrganizationAuthError,
  requireOrganizationMemberBySlug,
} from "@/lib/orgs/authorization";
import { compareActiveOfferings } from "@/lib/orgs/offering-comparison";
import { retrieveActiveOfferings } from "@/lib/orgs/offering-retrieval";

export default async function CompareOfferingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ offeringId?: string | string[] }>;
}) {
  const { slug } = await params;
  const search = await searchParams;
  const selected = Array.isArray(search.offeringId)
    ? search.offeringId
    : search.offeringId
      ? [search.offeringId]
      : [];
  const user = await requireVerifiedUser({
    returnTo: `/app/orgs/${slug}/knowledge/offerings/compare`,
  });
  let membership;
  try {
    membership = await requireOrganizationMemberBySlug({ user, slug });
  } catch (error) {
    if (error instanceof OrganizationAuthError) notFound();
    throw error;
  }
  const active = await retrieveActiveOfferings({
    actor: user,
    organizationId: membership.organizationId,
    pageSize: 50,
  });
  const comparison =
    selected.length >= 2
      ? await compareActiveOfferings({
          actor: user,
          organizationId: membership.organizationId,
          offeringIds: selected,
        })
      : null;
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
          Compare active plans
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Deterministic comparison from confirmed structured records. No AI is
          used.
        </p>
      </div>
      {active.ok ? (
        <form method="get" className="space-y-3">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">
              Select 2–6 offerings
            </legend>
            {active.items
              .filter((item) =>
                ["PLAN", "PACKAGE", "SUBSCRIPTION"].includes(item.offeringType),
              )
              .map((item) => (
                <label
                  key={item.offeringId}
                  className="flex items-center gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    name="offeringId"
                    value={item.offeringId}
                    defaultChecked={selected.includes(item.offeringId)}
                  />
                  {item.name} ({item.offeringType.toLowerCase()})
                </label>
              ))}
          </fieldset>
          <button className="rounded-sm border border-[var(--border)] px-3 py-2 text-sm">
            Compare selected
          </button>
        </form>
      ) : (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {active.message}
        </p>
      )}
      {comparison && !comparison.ok ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {comparison.message}
        </p>
      ) : comparison?.ok ? (
        <section className="space-y-4" aria-labelledby="comparison-results">
          <h2 id="comparison-results" className="text-lg font-medium">
            Comparison
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr>
                  <th className="border border-[var(--border)] p-2">Field</th>
                  {comparison.comparison.offerings.map((item) => (
                    <th
                      key={item.offeringId}
                      className="border border-[var(--border)] p-2"
                    >
                      {item.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th className="border border-[var(--border)] p-2">Price</th>
                  {comparison.comparison.offerings.map((item) => (
                    <td
                      key={item.offeringId}
                      className="border border-[var(--border)] p-2"
                    >
                      {item.quoteRequired
                        ? "Quote required"
                        : item.currentPrices
                            .map(
                              (price) =>
                                `${price.amount} ${price.currencyCode} ${price.billingFrequency.toLowerCase()}`,
                            )
                            .join(", ") || "No current price"}
                    </td>
                  ))}
                </tr>
                {comparison.comparison.features.map((row) => (
                  <tr key={row.featureKey}>
                    <th className="border border-[var(--border)] p-2">
                      {row.label}
                    </th>
                    {comparison.comparison.offerings.map((item) => (
                      <td
                        key={item.offeringId}
                        className="border border-[var(--border)] p-2"
                      >
                        {row.values[item.offeringId] ?? "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
