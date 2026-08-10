"use client";

import Link from "next/link";
import { useActionState } from "react";

import { forgotPasswordAction } from "@/app/actions/auth";
import { initialActionState, type ActionState } from "@/app/actions/auth-state";
import { AuthCard } from "@/components/auth/auth-card";
import { FieldError } from "@/components/auth/field-error";
import { FormStatus } from "@/components/auth/form-status";
import { SubmitButton } from "@/components/auth/submit-button";

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState<ActionState, FormData>(
    forgotPasswordAction,
    initialActionState,
  );

  return (
    <AuthCard
      title="Forgot password"
      description="Enter your email. If an account exists, we will send reset instructions."
    >
      <form action={formAction} className="space-y-4" noValidate>
        <FormStatus status={state.status} message={state.message} />

        <div>
          <label htmlFor="email" className="block text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            aria-invalid={Boolean(state.fieldErrors?.email)}
            aria-describedby={
              state.fieldErrors?.email ? "email-error" : undefined
            }
            className="mt-1 w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
          <FieldError id="email-error" errors={state.fieldErrors?.email} />
        </div>

        <SubmitButton pendingLabel="Sending…">Send reset link</SubmitButton>
      </form>

      <p className="text-sm text-[var(--muted)]">
        <Link
          href="/login"
          className="text-[var(--foreground)] underline-offset-2 hover:underline"
        >
          Back to sign in
        </Link>
      </p>
    </AuthCard>
  );
}
