import Link from "next/link";

export function KnowledgeNav({
  organizationSlug,
  current,
  canCreate = false,
}: {
  organizationSlug: string;
  current: "list" | "new" | "detail" | "offerings" | "sources" | "import";
  canCreate?: boolean;
}) {
  const base = `/app/orgs/${organizationSlug}/knowledge`;
  return (
    <nav aria-label="Business knowledge" className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
        Knowledge
      </p>
      <ul className="flex flex-wrap gap-2">
        <li>
          <Link
            href={base}
            className={[
              "inline-flex items-center rounded-sm border px-3 py-1.5 text-sm",
              current === "list"
                ? "border-[var(--foreground)] bg-[var(--surface)] font-medium"
                : "border-[var(--border)] hover:bg-[var(--background)]",
            ].join(" ")}
          >
            All knowledge
          </Link>
        </li>
        <li>
          <Link
            href={`${base}/offerings`}
            className={[
              "inline-flex items-center rounded-sm border px-3 py-1.5 text-sm",
              current === "offerings"
                ? "border-[var(--foreground)] bg-[var(--surface)] font-medium"
                : "border-[var(--border)] hover:bg-[var(--background)]",
            ].join(" ")}
          >
            Offerings
          </Link>
        </li>
        <li>
          <Link
            href={`${base}/sources`}
            className={[
              "inline-flex items-center rounded-sm border px-3 py-1.5 text-sm",
              current === "sources"
                ? "border-[var(--foreground)] bg-[var(--surface)] font-medium"
                : "border-[var(--border)] hover:bg-[var(--background)]",
            ].join(" ")}
          >
            Runtime sources
          </Link>
        </li>
        {canCreate ? (
          <li>
            <Link
              href={`${base}/import`}
              className={[
                "inline-flex items-center rounded-sm border px-3 py-1.5 text-sm",
                current === "import"
                  ? "border-[var(--foreground)] bg-[var(--surface)] font-medium"
                  : "border-[var(--border)] hover:bg-[var(--background)]",
              ].join(" ")}
            >
              CSV import
            </Link>
          </li>
        ) : null}
        {canCreate ? (
          <li>
            <Link
              href={`${base}/new`}
              className={[
                "inline-flex items-center rounded-sm border px-3 py-1.5 text-sm",
                current === "new"
                  ? "border-[var(--foreground)] bg-[var(--surface)] font-medium"
                  : "border-[var(--border)] hover:bg-[var(--background)]",
              ].join(" ")}
            >
              New draft
            </Link>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
