"use client";

import { useActionState } from "react";

import { createOrganizationAction } from "@/app/actions/orgs";
import { initialActionState } from "@/app/actions/auth-state";
import { FieldError } from "@/components/auth/field-error";
import { FormStatus } from "@/components/auth/form-status";
import { SubmitButton } from "@/components/auth/submit-button";

export function CreateOrganizationForm() {
  const [state, formAction] = useActionState(
    createOrganizationAction,
    initialActionState,
  );

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormStatus status={state.status} message={state.message} />

      <div className="space-y-1">
        <label htmlFor="org-name" className="block text-sm font-medium">
          Organization name
        </label>
        <input
          id="org-name"
          name="name"
          type="text"
          autoComplete="organization"
          required
          minLength={2}
          maxLength={80}
          aria-invalid={Boolean(state.fieldErrors?.name)}
          aria-describedby={
            state.fieldErrors?.name ? "org-name-error" : undefined
          }
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        />
        <FieldError id="org-name-error" errors={state.fieldErrors?.name} />
      </div>

      <div className="space-y-1">
        <label htmlFor="org-slug" className="block text-sm font-medium">
          URL slug <span className="text-[var(--muted)]">(optional)</span>
        </label>
        <input
          id="org-slug"
          name="slug"
          type="text"
          spellCheck={false}
          maxLength={48}
          placeholder="acme-outreach"
          aria-invalid={Boolean(state.fieldErrors?.slug)}
          aria-describedby={
            state.fieldErrors?.slug ? "org-slug-error" : "org-slug-hint"
          }
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        />
        <p id="org-slug-hint" className="text-xs text-[var(--muted)]">
          Lowercase letters, numbers, and hyphens. Leave blank to generate from
          the name.
        </p>
        <FieldError id="org-slug-error" errors={state.fieldErrors?.slug} />
      </div>

      <SubmitButton pendingLabel="Creating…">Create organization</SubmitButton>
    </form>
  );
}
