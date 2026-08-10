"use client";

import Link from "next/link";
import { useActionState } from "react";

import { confirmVerificationAction } from "@/app/actions/auth";
import { initialActionState, type ActionState } from "@/app/actions/auth-state";
import { AuthCard } from "@/components/auth/auth-card";
import { FormStatus } from "@/components/auth/form-status";
import { SubmitButton } from "@/components/auth/submit-button";

type VerifyEmailConfirmFormProps = {
  token: string;
};

export function VerifyEmailConfirmForm({ token }: VerifyEmailConfirmFormProps) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    confirmVerificationAction,
    initialActionState,
  );

  if (state.status === "success") {
    return (
      <AuthCard title="Email verified" description={state.message}>
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

  return (
    <AuthCard
      title="Confirm email verification"
      description="Click the button below to verify your email address. Opening this page alone does not verify your account."
    >
      <form action={formAction} className="space-y-4" method="post">
        <input type="hidden" name="token" value={token} autoComplete="off" />
        <FormStatus status={state.status} message={state.message} />
        <SubmitButton pendingLabel="Verifying…">Verify email</SubmitButton>
      </form>
      <p className="text-sm text-[var(--muted)]">
        Link not working?{" "}
        <Link
          href="/verify-email"
          className="text-[var(--foreground)] underline-offset-2 hover:underline"
        >
          Resend verification
        </Link>
      </p>
    </AuthCard>
  );
}
