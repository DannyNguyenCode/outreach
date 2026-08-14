"use client";

import { useActionState } from "react";

import { updateLocaleSettingsAction } from "@/app/actions/config-3b";
import { initialActionState } from "@/app/actions/auth-state";
import { FieldError } from "@/components/auth/field-error";
import { FormStatus } from "@/components/auth/form-status";
import { SubmitButton } from "@/components/auth/submit-button";
import {
  ConflictHint,
  DirtyFormShell,
  ReadOnlyNotice,
} from "@/components/orgs/config/form-helpers";

export function LocaleForm({
  organizationSlug,
  expectedVersion,
  canManage,
  defaults,
}: {
  organizationSlug: string;
  expectedVersion: number;
  canManage: boolean;
  defaults: {
    locale: string;
    defaultLanguage: string;
    dateDisplayPreference: string;
    timeDisplayPreference: string;
    numberDisplayPreference: string;
  };
}) {
  const [state, formAction] = useActionState(
    updateLocaleSettingsAction,
    initialActionState,
  );

  if (!canManage) {
    return (
      <div className="space-y-2 text-sm">
        <ReadOnlyNotice />
        <p>Locale: {defaults.locale}</p>
        <p>Default language: {defaults.defaultLanguage}</p>
      </div>
    );
  }

  return (
    <DirtyFormShell action={formAction} className="space-y-4">
      <FormStatus status={state.status} message={state.message} />
      <ConflictHint message={state.message} />
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input type="hidden" name="expectedVersion" value={expectedVersion} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="locale" className="block text-sm font-medium">
            Locale (BCP 47)
          </label>
          <input
            id="locale"
            name="locale"
            required
            defaultValue={defaults.locale}
            placeholder="en-CA"
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
          <FieldError id="locale-error" errors={state.fieldErrors?.locale} />
        </div>
        <div className="space-y-1">
          <label
            htmlFor="defaultLanguage"
            className="block text-sm font-medium"
          >
            Default language
          </label>
          <input
            id="defaultLanguage"
            name="defaultLanguage"
            required
            defaultValue={defaults.defaultLanguage}
            placeholder="en"
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
          <FieldError
            id="defaultLanguage-error"
            errors={state.fieldErrors?.defaultLanguage}
          />
        </div>
        <div className="space-y-1">
          <label
            htmlFor="dateDisplayPreference"
            className="block text-sm font-medium"
          >
            Date display
          </label>
          <input
            id="dateDisplayPreference"
            name="dateDisplayPreference"
            defaultValue={defaults.dateDisplayPreference}
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label
            htmlFor="timeDisplayPreference"
            className="block text-sm font-medium"
          >
            Time display
          </label>
          <input
            id="timeDisplayPreference"
            name="timeDisplayPreference"
            defaultValue={defaults.timeDisplayPreference}
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <label
            htmlFor="numberDisplayPreference"
            className="block text-sm font-medium"
          >
            Number display
          </label>
          <input
            id="numberDisplayPreference"
            name="numberDisplayPreference"
            defaultValue={defaults.numberDisplayPreference}
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
        </div>
      </div>

      <SubmitButton pendingLabel="Saving…">Save locale settings</SubmitButton>
    </DirtyFormShell>
  );
}
