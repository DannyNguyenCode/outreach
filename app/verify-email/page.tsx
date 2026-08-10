import type { Metadata } from "next";
import Link from "next/link";

import { AuthCard } from "@/components/auth/auth-card";
import { ResendVerificationForm } from "@/components/auth/resend-verification-form";
import { VerifyEmailConfirmForm } from "@/components/auth/verify-email-confirm-form";

export const metadata: Metadata = {
  title: "Verify email",
};

type VerifyEmailPageProps = {
  searchParams: Promise<{ token?: string; reason?: string; status?: string }>;
};

function isPlausibleTokenShape(token: string): boolean {
  // base64url from 32 bytes is typically 43 chars; allow a bounded range.
  return token.length >= 20 && token.length <= 256 && !/\s/.test(token);
}

export default async function VerifyEmailPage({
  searchParams,
}: VerifyEmailPageProps) {
  const params = await searchParams;
  const token = params.token?.trim() ?? "";

  // GET never consumes tokens or mutates auth state (email scanners / link previews).
  if (token) {
    if (!isPlausibleTokenShape(token)) {
      return (
        <div className="space-y-8">
          <AuthCard
            title="Verification unsuccessful"
            description="This verification link is invalid. Request a new one below."
          />
          <ResendVerificationForm />
        </div>
      );
    }
    return <VerifyEmailConfirmForm token={token} />;
  }

  if (params.status === "verified") {
    return (
      <AuthCard
        title="Email verified"
        description="Your email is verified. You can now sign in."
      >
        <p className="text-sm text-[var(--muted)]">
          <Link
            href="/login"
            className="text-[var(--foreground)] underline-offset-2 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </AuthCard>
    );
  }

  if (params.reason === "unverified") {
    return (
      <ResendVerificationForm
        heading="Verify your email"
        description="Your account must be verified before you can access the application."
      />
    );
  }

  return <ResendVerificationForm />;
}
