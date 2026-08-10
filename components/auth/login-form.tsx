"use client";

import Link from "next/link";
import { useActionState } from "react";

import { loginAction } from "@/app/actions/auth";
import { initialActionState, type ActionState } from "@/app/actions/auth-state";
import { AuthCard } from "@/components/auth/auth-card";
import { FieldError } from "@/components/auth/field-error";
import { FormStatus } from "@/components/auth/form-status";
import { SubmitButton } from "@/components/auth/submit-button";

type LoginFormProps = {
  callbackUrl: string;
};

export function LoginForm({ callbackUrl }: LoginFormProps) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    loginAction,
    initialActionState,
  );

  return (
    <AuthCard
      title="Sign in"
      description="Use your verified email and password to access Outreach."
    >
      <form action={formAction} className="space-y-4" noValidate>
        <input type="hidden" name="callbackUrl" value={callbackUrl} />
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

        <div>
          <label htmlFor="password" className="block text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
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

        <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>
      </form>

      <ul className="space-y-2 text-sm text-[var(--muted)]">
        <li>
          <Link
            href="/forgot-password"
            className="text-[var(--foreground)] underline-offset-2 hover:underline"
          >
            Forgot password?
          </Link>
        </li>
        <li>
          Need an account?{" "}
          <Link
            href="/register"
            className="text-[var(--foreground)] underline-offset-2 hover:underline"
          >
            Register
          </Link>
        </li>
        <li>
          Didn’t get a verification email?{" "}
          <Link
            href="/verify-email"
            className="text-[var(--foreground)] underline-offset-2 hover:underline"
          >
            Resend verification
          </Link>
        </li>
      </ul>
    </AuthCard>
  );
}
