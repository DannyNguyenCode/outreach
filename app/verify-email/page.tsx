import type { Metadata } from "next";
import Link from "next/link";

import { consumeVerificationTokenAction } from "@/app/actions/auth";
import { AuthCard } from "@/components/auth/auth-card";
import { ResendVerificationForm } from "@/components/auth/resend-verification-form";

export const metadata: Metadata = {
  title: "Verify email",
};

type VerifyEmailPageProps = {
  searchParams: Promise<{ token?: string; reason?: string }>;
};

export default async function VerifyEmailPage({
  searchParams,
}: VerifyEmailPageProps) {
  const params = await searchParams;
  const token = params.token?.trim() ?? "";

  if (token) {
    const status = await consumeVerificationTokenAction(token);

    if (status === "verified" || status === "already_verified") {
      return (
        <AuthCard
          title="Email verified"
          description={
            status === "already_verified"
              ? "This email was already verified. You can sign in."
              : "Your email is verified. You can now sign in."
          }
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

    const message =
      status === "expired"
        ? "This verification link has expired. Request a new one below."
        : "This verification link is invalid or has already been used. Request a new one below.";

    return (
      <div className="space-y-8">
        <AuthCard title="Verification unsuccessful" description={message} />
        <ResendVerificationForm />
      </div>
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
