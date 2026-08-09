"use client";

import { useEffect } from "react";

import "./globals.css";

type GlobalErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-full bg-[var(--background)] text-[var(--foreground)] antialiased">
        <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center px-4 py-8 sm:px-6">
          <div className="space-y-4" role="alert">
            <h1 className="text-2xl font-semibold tracking-tight text-[var(--danger)]">
              Something went wrong
            </h1>
            <p className="max-w-xl text-base text-[var(--muted)]">
              An unexpected error occurred. You can try again.
            </p>
            <button
              type="button"
              onClick={reset}
              className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--background)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]"
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
