import Link from "next/link";

export function AppHeader() {
  return (
    <header className="border-b border-[var(--border)] bg-[var(--surface)]">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link
          href="/"
          className="rounded-sm text-lg font-semibold tracking-tight text-[var(--foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]"
        >
          Outreach
        </Link>
        <nav aria-label="Primary">
          <ul className="flex items-center gap-4 text-sm text-[var(--muted)]">
            <li>
              <Link
                href="/"
                className="rounded-sm hover:text-[var(--foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]"
              >
                Home
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}
