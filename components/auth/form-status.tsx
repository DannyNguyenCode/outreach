type FormStatusProps = {
  status: "idle" | "success" | "error" | "unverified" | "rate_limited";
  message?: string;
};

export function FormStatus({ status, message }: FormStatusProps) {
  if (!message || status === "idle") {
    return null;
  }

  const isSuccess = status === "success";
  return (
    <div
      role="status"
      aria-live="polite"
      className={
        isSuccess
          ? "rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)]"
          : "rounded-sm border border-[var(--danger)]/30 bg-[var(--surface)] px-3 py-2 text-sm text-[var(--danger)]"
      }
    >
      {message}
    </div>
  );
}
