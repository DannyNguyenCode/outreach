import type { Metadata } from "next";
import Link from "next/link";

import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { AuthCard } from "@/components/auth/auth-card";

export const metadata: Metadata = {
  title: "Reset password",
};

type ResetPasswordPageProps = {
  searchParams: Promise<{ token?: string }>;
};

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const params = await searchParams;
  const token = params.token?.trim() ?? "";

  if (!token || token.length > 256) {
    return (
      <AuthCard
        title="Invalid reset link"
        description="This password reset link is missing or malformed. Request a new one from the forgot password page."
      >
        <p className="text-sm text-[var(--muted)]">
          <Link
            href="/forgot-password"
            className="text-[var(--foreground)] underline-offset-2 hover:underline"
          >
            Forgot password
          </Link>
        </p>
      </AuthCard>
    );
  }

  return <ResetPasswordForm token={token} />;
}
