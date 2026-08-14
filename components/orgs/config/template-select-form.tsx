"use client";

import { useActionState } from "react";

import { selectBusinessTemplateAction } from "@/app/actions/config-3b";
import { initialActionState } from "@/app/actions/auth-state";
import { FieldError } from "@/components/auth/field-error";
import { FormStatus } from "@/components/auth/form-status";
import { SubmitButton } from "@/components/auth/submit-button";
import {
  ConflictHint,
  DirtyFormShell,
} from "@/components/orgs/config/form-helpers";

type TemplateOption = {
  key: string;
  label: string;
  description: string;
  suggestedCustomFields: Array<{ key: string; label: string; scope: string }>;
};

export function TemplateSelectForm({
  organizationSlug,
  templates,
}: {
  organizationSlug: string;
  templates: TemplateOption[];
}) {
  const [state, formAction] = useActionState(
    selectBusinessTemplateAction,
    initialActionState,
  );

  return (
    <DirtyFormShell action={formAction} className="space-y-4">
      <FormStatus status={state.status} message={state.message} />
      <ConflictHint message={state.message} />
      <input type="hidden" name="organizationSlug" value={organizationSlug} />

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Choose a template</legend>
        {templates.map((template) => (
          <label
            key={template.key}
            className="flex cursor-pointer gap-3 rounded-sm border border-[var(--border)] px-3 py-3 text-sm"
          >
            <input
              type="radio"
              name="templateKey"
              value={template.key}
              required
              className="mt-1"
            />
            <span className="space-y-1">
              <span className="block font-medium">{template.label}</span>
              <span className="block text-[var(--muted)]">
                {template.description}
              </span>
              {template.suggestedCustomFields.length > 0 ? (
                <span className="block text-xs text-[var(--muted)]">
                  Suggested fields (not auto-created):{" "}
                  {template.suggestedCustomFields
                    .map((field) => field.label)
                    .join(", ")}
                </span>
              ) : null}
            </span>
          </label>
        ))}
        <FieldError
          id="templateKey-error"
          errors={state.fieldErrors?.templateKey}
        />
      </fieldset>

      <div className="space-y-1">
        <label htmlFor="select-notes" className="block text-sm font-medium">
          Notes <span className="text-[var(--muted)]">(optional)</span>
        </label>
        <textarea
          id="select-notes"
          name="notes"
          rows={2}
          maxLength={2000}
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        />
      </div>

      <SubmitButton pendingLabel="Selecting…">Select template</SubmitButton>
    </DirtyFormShell>
  );
}
