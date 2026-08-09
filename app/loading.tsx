export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="space-y-3">
      <p className="text-sm text-[var(--muted)]">Loading…</p>
      <div
        className="h-8 w-48 rounded-sm bg-[var(--border)]"
        aria-hidden="true"
      />
      <div
        className="h-20 w-full max-w-xl rounded-sm bg-[var(--border)]"
        aria-hidden="true"
      />
    </div>
  );
}
