import type { OfferingVersionGraph } from "@/lib/orgs/offerings";

export function OfferingPreview({
  version,
}: {
  version: OfferingVersionGraph;
}) {
  return (
    <section
      className="space-y-4 rounded-sm border border-[var(--border)] bg-[var(--surface)] p-4"
      aria-labelledby="offering-preview-heading"
    >
      <div>
        <h2 id="offering-preview-heading" className="text-lg font-medium">
          {version.name}
        </h2>
        <p className="text-sm text-[var(--muted)]">
          {version.offeringType.replaceAll("_", " ")} ·{" "}
          {version.state.toLowerCase()} ·{" "}
          {version.pricingModel.replaceAll("_", " ")}
        </p>
      </div>
      {version.description ? (
        <p className="whitespace-pre-wrap text-sm leading-6">
          {version.description}
        </p>
      ) : null}
      {version.prices.length ? (
        <div>
          <h3 className="text-sm font-medium">Prices</h3>
          <ul className="mt-1 space-y-1 text-sm">
            {version.prices.map((price) => (
              <li key={price.id}>
                {price.label ? `${price.label}: ` : ""}
                {price.amount.toFixed(4)} {price.currencyCode} ·{" "}
                {price.billingFrequency.replaceAll("_", " ").toLowerCase()}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {version.features.length ? (
        <div>
          <h3 className="text-sm font-medium">Features</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
            {version.features.map((feature) => (
              <li key={feature.id}>
                {feature.name}
                {feature.value
                  ? `: ${feature.value}${feature.unit ? ` ${feature.unit}` : ""}`
                  : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {version.variants.length ? (
        <div>
          <h3 className="text-sm font-medium">Variants</h3>
          <ul className="mt-1 space-y-1 text-sm">
            {version.variants.map((variant) => (
              <li key={variant.id}>{variant.name}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {version.eligibility ? (
        <div>
          <h3 className="text-sm font-medium">Eligibility and review notes</h3>
          <dl className="mt-1 space-y-1 text-sm">
            {version.eligibility.description ? (
              <div>
                <dt className="font-medium">Description</dt>
                <dd className="whitespace-pre-wrap">
                  {version.eligibility.description}
                </dd>
              </div>
            ) : null}
            {version.eligibility.availabilityRestrictions ? (
              <div>
                <dt className="font-medium">Availability restrictions</dt>
                <dd className="whitespace-pre-wrap">
                  {version.eligibility.availabilityRestrictions}
                </dd>
              </div>
            ) : null}
            {version.eligibility.qualificationNotes ? (
              <div>
                <dt className="font-medium">Qualification notes</dt>
                <dd className="whitespace-pre-wrap">
                  {version.eligibility.qualificationNotes}
                </dd>
              </div>
            ) : null}
            {version.eligibility.geographicNotes ? (
              <div>
                <dt className="font-medium">Geographic notes</dt>
                <dd className="whitespace-pre-wrap">
                  {version.eligibility.geographicNotes}
                </dd>
              </div>
            ) : null}
          </dl>
        </div>
      ) : null}
      <p className="break-all text-xs text-[var(--muted)]">
        Checksum {version.contentChecksum}
      </p>
    </section>
  );
}
