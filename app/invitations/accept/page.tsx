import type { Metadata } from "next";
import Link from "next/link";

import { AcceptInvitationForm } from "@/components/orgs/accept-invitation-form";
import { getCurrentUser } from "@/lib/auth/session";
import { getSafeRedirect } from "@/lib/auth/redirects";
import { previewOrganizationInvitation } from "@/lib/orgs/invitations";

type InvitationPageProps = {
  searchParams: Promise<{ token?: string }>;
};

export const metadata: Metadata = {
  title: "Organization invitation",
};

export default async function InvitationAcceptPage({
  searchParams,
}: InvitationPageProps) {
  const { token } = await searchParams;
  const rawToken = typeof token === "string" ? token : "";
  const preview = rawToken
    ? await previewOrganizationInvitation(rawToken)
    : { ok: false as const, reason: "invalid" as const };

  const user = await getCurrentUser();
  const loginReturn = getSafeRedirect(
    rawToken
      ? `/invitations/accept?token=${encodeURIComponent(rawToken)}`
      : "/login",
    "/app",
  );

  if (!preview.ok) {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          Invitation unavailable
        </h1>
        <p className="text-sm leading-6 text-[var(--muted)]">
          This invitation link is invalid or no longer available.
        </p>
        <Link
          href="/app"
          className="text-sm underline-offset-2 hover:underline"
        >
          Go to app
        </Link>
      </div>
    );
  }

  const statusMessage: Record<string, string> = {
    expired: "This invitation has expired.",
    revoked: "This invitation has been revoked.",
    accepted: "This invitation has already been used.",
    pending: "Review the details below, then accept intentionally.",
  };

  const emailMatches =
    user?.email &&
    preview.emailDomain &&
    user.email.endsWith(`@${preview.emailDomain}`);

  let disabled = preview.status !== "pending";
  let disabledReason = statusMessage[preview.status];

  if (preview.status === "pending" && user && !user.emailVerifiedAt) {
    disabled = true;
    disabledReason = "Verify your email before accepting this invitation.";
  } else if (
    preview.status === "pending" &&
    user &&
    !user.email.endsWith(`@${preview.emailDomain}`)
  ) {
    // Soft hint only — acceptance still enforces exact email match server-side.
    disabled = false;
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Organization invitation
        </h1>
        <p className="text-sm leading-6 text-[var(--muted)]">
          You are invited to join{" "}
          <span className="font-medium text-[var(--foreground)]">
            {preview.organizationName}
          </span>{" "}
          as {preview.role.toLowerCase()}. Visiting this page does not accept
          the invitation.
        </p>
        <p className="text-sm text-[var(--muted)]" role="status">
          {statusMessage[preview.status]}
        </p>
        <p className="text-xs text-[var(--muted)]">
          Invited address domain: @{preview.emailDomain}. Expires{" "}
          {preview.expiresAt.toUTCString()}.
        </p>
      </div>

      {!user ? (
        <div className="space-y-3 rounded-sm border border-[var(--border)] bg-[var(--surface)] p-4">
          <p className="text-sm">
            Sign in or register with the invited email to continue. Acceptance
            is a separate step after authentication.
          </p>
          <div className="flex flex-wrap gap-3 text-sm">
            <Link
              href={`/login?callbackUrl=${encodeURIComponent(loginReturn)}`}
              className="rounded-sm border border-[var(--border)] px-3 py-2 hover:bg-[var(--background)]"
            >
              Sign in
            </Link>
            <Link
              href={`/register?callbackUrl=${encodeURIComponent(loginReturn)}`}
              className="rounded-sm border border-[var(--border)] px-3 py-2 hover:bg-[var(--background)]"
            >
              Create account
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-[var(--muted)]">
            Signed in as {user.email}
            {emailMatches ? "" : " (must match the invited address)"}.
          </p>
          <AcceptInvitationForm
            token={rawToken}
            disabled={disabled}
            disabledReason={disabledReason}
          />
        </div>
      )}
    </div>
  );
}
