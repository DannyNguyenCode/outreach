import type { ReactNode } from "react";

import { AppHeader } from "@/components/app-header";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="flex min-h-full flex-col bg-[var(--background)] text-[var(--foreground)]">
      <AppHeader />
      <main
        id="main-content"
        className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6"
      >
        {children}
      </main>
      <footer className="border-t border-[var(--border)] py-4 text-center text-sm text-[var(--muted)]">
        Outreach foundation — Phase 1
      </footer>
    </div>
  );
}
