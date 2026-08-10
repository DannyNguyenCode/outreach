"use client";

import Link from "next/link";
import { useActionState } from "react";

import { registerAction } from "@/app/actions/auth";
import { initialActionState, type ActionState } from "@/app/actions/auth-state";
import { AuthCard } from "@/components/auth/auth-card";
import { FieldError } from "@/components/auth/field-error";
import { FormStatus } from "@/components/auth/form-status";
import { SubmitButton } from "@/components/auth/submit-button";

export function RegisterForm() {
  const [state, formAction] = useActionState<ActionState, FormData>(
    registerAction,
    initialActionState,
  );

  return (
    <AuthCard
      title="Create an account"
      description="Register with your name, email, and password. You must verify your email before signing in."
    >
      <form action={formAction} className="space-y-4" noValidate>
        <FormStatus status={state.status} message={state.message} />

        <div>
          <label htmlFor="name" className="block text-sm font-medium">
            Name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            required
            aria-invalid={Boolean(state.fieldErrors?.name)}
            aria-describedby={
              state.fieldErrors?.name ? "name-error" : undefined
            }
            className="mt-1 w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
          <FieldError id="name-error" errors={state.fieldErrors?.name} />
        </div>

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
            Confirm password
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

        <SubmitButton pendingLabel="Creating account…">
          Create account
        </SubmitButton>
      </form>

      <p className="text-sm text-[var(--muted)]">
        Already have an account?{" "}
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
