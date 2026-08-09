import Link from "next/link";

export default function NotFound() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight text-[var(--foreground)]">
        Page not found
      </h1>
      <p className="max-w-xl text-base text-[var(--muted)]">
        The page you requested does not exist or may have moved.
      </p>
      <Link
        href="/"
        className="inline-flex rounded-sm border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--background)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]"
      >
        Back to home
      </Link>
    </div>
  );
}
