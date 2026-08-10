"use client";

import Link from "next/link";
import { useActionState } from "react";

import { resetPasswordAction } from "@/app/actions/auth";
import { initialActionState, type ActionState } from "@/app/actions/auth-state";
import { AuthCard } from "@/components/auth/auth-card";
import { FieldError } from "@/components/auth/field-error";
import { FormStatus } from "@/components/auth/form-status";
import { SubmitButton } from "@/components/auth/submit-button";

type ResetPasswordFormProps = {
  token: string;
};

export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    resetPasswordAction,
    initialActionState,
  );

  if (state.status === "success") {
    return (
      <AuthCard title="Password updated" description={state.message}>
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
      title="Reset password"
      description="Choose a new password for your account."
    >
      <form action={formAction} className="space-y-4" noValidate>
        <input type="hidden" name="token" value={token} />
        <FormStatus status={state.status} message={state.message} />

        <div>
          <label htmlFor="password" className="block text-sm font-medium">
            New password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
            aria-invalid={Boolean(state.fieldErrors?.password)}
            aria-describedby={
              state.fieldErrors?.password ? "password-error" : undefined
            }
            className="mt-1 w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
          <FieldError
            id="password-error"
            errors={state.fieldErrors?.password}
          />
        </div>

        <div>
          <label
            htmlFor="confirmPassword"
            className="block text-sm font-medium"
          >
            Confirm new password
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
            aria-invalid={Boolean(state.fieldErrors?.confirmPassword)}
            aria-describedby={
              state.fieldErrors?.confirmPassword
                ? "confirmPassword-error"
                : undefined
            }
            className="mt-1 w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
          <FieldError
            id="confirmPassword-error"
            errors={state.fieldErrors?.confirmPassword}
          />
        </div>

        <SubmitButton pendingLabel="Updating…">Update password</SubmitButton>
      </form>
    </AuthCard>
  );
}
