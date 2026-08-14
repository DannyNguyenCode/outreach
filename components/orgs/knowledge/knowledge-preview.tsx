import type { KnowledgeVersionDetail } from "@/lib/orgs/knowledge";

export function KnowledgePreview({
  version,
}: {
  version: KnowledgeVersionDetail;
}) {
  return (
    <article className="space-y-4" aria-label="Knowledge preview">
      <header className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">
          {version.title}
        </h2>
        <p className="text-sm text-[var(--muted)]">
          State: {version.state.toLowerCase()}. Checksum{" "}
          {version.contentChecksum}.
          {version.confirmedAt
            ? ` Confirmed ${version.confirmedAt.toISOString()}.`
            : " Not confirmed."}
          {version.effectiveFrom
            ? ` Effective from ${version.effectiveFrom.toISOString()}.`
            : ""}
          {version.effectiveUntil
            ? ` Effective until ${version.effectiveUntil.toISOString()}.`
            : ""}
        </p>
      </header>
      {version.sections.map((section) => (
        <section key={section.id} className="space-y-2">
          <h3 className="text-base font-medium">{section.title}</h3>
          <p className="text-xs text-[var(--muted)]">
            Section citation {section.citationKey}
          </p>
          {section.passages.map((passage) => (
            <div
              key={passage.id}
              className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            >
              <p className="whitespace-pre-wrap text-sm leading-6">
                {passage.body}
              </p>
              <p className="mt-2 text-xs text-[var(--muted)]">
                Passage citation {passage.citationKey}
              </p>
            </div>
          ))}
        </section>
      ))}
    </article>
  );
}
