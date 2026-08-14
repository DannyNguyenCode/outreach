"use client";

import { useActionState } from "react";

import { updateTemplateCustomizationAction } from "@/app/actions/config-3b";
import { initialActionState } from "@/app/actions/auth-state";
import { FormStatus } from "@/components/auth/form-status";
import { SubmitButton } from "@/components/auth/submit-button";
import {
  ConflictHint,
  DirtyFormShell,
} from "@/components/orgs/config/form-helpers";

type SuggestedField = {
  key: string;
  label: string;
  scope: string;
  dataType: string;
};

export function TemplateCustomizeForm({
  organizationSlug,
  expectedVersion,
  suggestedFields,
  confirmedFieldKeys,
  notes,
}: {
  organizationSlug: string;
  expectedVersion: number;
  suggestedFields: SuggestedField[];
  confirmedFieldKeys: string[];
  notes: string;
}) {
  const [state, formAction] = useActionState(
    updateTemplateCustomizationAction,
    initialActionState,
  );
  const confirmed = new Set(confirmedFieldKeys);

  return (
    <DirtyFormShell action={formAction} className="space-y-4">
      <FormStatus status={state.status} message={state.message} />
      <ConflictHint message={state.message} />
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input type="hidden" name="expectedVersion" value={expectedVersion} />

      <p className="text-sm text-[var(--muted)]">
        Confirming a suggested field only records intent. It does not create
        custom field definitions automatically.
      </p>

      {suggestedFields.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          This template has no suggested custom fields.
        </p>
      ) : (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">
            Confirmed suggested fields
          </legend>
          {suggestedFields.map((field) => (
            <label
              key={`${field.scope}:${field.key}`}
              className="flex items-start gap-2 text-sm"
            >
              <input
                type="checkbox"
                name="confirmedFieldKeys"
                value={field.key}
                defaultChecked={confirmed.has(field.key)}
                className="mt-1"
              />
              <span>
                <span className="font-medium">{field.label}</span>
                <span className="block text-[var(--muted)]">
                  {field.key} · {field.scope} · {field.dataType}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      <div className="space-y-1">
        <label
          htmlFor="customization-notes"
          className="block text-sm font-medium"
        >
          Notes
        </label>
        <textarea
          id="customization-notes"
          name="notes"
          rows={3}
          maxLength={2000}
          defaultValue={notes}
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        />
      </div>

      <SubmitButton pendingLabel="Saving…">Save customization</SubmitButton>
    </DirtyFormShell>
  );
}
