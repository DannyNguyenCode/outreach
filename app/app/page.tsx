import type { Metadata } from "next";

import { logoutAction } from "@/app/actions/auth";
import { requireVerifiedUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "App",
};

export default async function AppHomePage() {
  const user = await requireVerifiedUser({ returnTo: "/app" });

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Application</h1>
        <p className="text-sm leading-6 text-[var(--muted)]">
          Signed in as {user.name} ({user.email}). This is the Phase 1
          authenticated shell — product features arrive in later phases.
        </p>
      </div>

      <form action={logoutAction}>
        <button
          type="submit"
          className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium hover:bg-[var(--background)]"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
