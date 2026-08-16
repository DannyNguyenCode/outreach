import Link from "next/link";

export function ProspectNav({
  organizationSlug,
  current,
  canCreate = false,
}: {
  organizationSlug: string;
  current: "list" | "new" | "detail" | "edit" | "merge";
  canCreate?: boolean;
}) {
  const base = `/app/orgs/${organizationSlug}/prospects`;
  return (
    <nav aria-label="Prospects" className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
        Prospects
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
            All prospects
          </Link>
        </li>
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
              New prospect
            </Link>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
