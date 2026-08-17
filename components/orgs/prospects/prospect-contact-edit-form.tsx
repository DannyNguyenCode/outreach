"use client";

import { useActionState, useMemo, useState } from "react";

import { updateProspectContactAction } from "@/app/actions/prospects";
import { initialActionState } from "@/app/actions/auth-state";
import { FieldError } from "@/components/auth/field-error";
import { FormStatus } from "@/components/auth/form-status";
import { SubmitButton } from "@/components/auth/submit-button";
import { CustomFieldInputs } from "@/components/orgs/prospects/custom-field-inputs";
import {
  customValuesToPayload,
  type CustomFieldFormControl,
} from "@/lib/orgs/prospect-validation";

function initialCustomValues(
  fields: CustomFieldFormControl[],
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.isActive) values[field.key] = field.value;
  }
  return values;
}

export function ProspectContactEditForm({
  organizationSlug,
  prospectId,
  contactId,
  expectedVersion,
  customFields,
  initial,
}: {
  organizationSlug: string;
  prospectId: string;
  contactId: string;
  expectedVersion: number;
  customFields: CustomFieldFormControl[];
  initial: {
    firstName: string;
    lastName: string;
    displayName: string;
    title: string | null;
    preferredLanguage: string | null;
    isPrimary: boolean;
  };
}) {
  const [state, formAction] = useActionState(
    updateProspectContactAction,
    initialActionState,
  );
  const [firstName, setFirstName] = useState(initial.firstName);
  const [lastName, setLastName] = useState(initial.lastName);
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [title, setTitle] = useState(initial.title ?? "");
  const [preferredLanguage, setPreferredLanguage] = useState(
    initial.preferredLanguage ?? "",
  );
  const [isPrimary, setIsPrimary] = useState(initial.isPrimary);
  const [customValues, setCustomValues] = useState(
    initialCustomValues(customFields),
  );
  const payload = useMemo(
    () =>
      JSON.stringify({
        firstName,
        lastName,
        displayName,
        title,
        preferredLanguage,
        isPrimary,
        customValues: customValuesToPayload(customValues),
      }),
    [
      firstName,
      lastName,
      displayName,
      title,
      preferredLanguage,
      isPrimary,
      customValues,
    ],
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input type="hidden" name="prospectId" value={prospectId} />
      <input type="hidden" name="contactId" value={contactId} />
      <input
        type="hidden"
        name="expectedVersion"
        value={String(expectedVersion)}
      />
      <input type="hidden" name="payload" value={payload} />
      <FormStatus status={state.status} message={state.message} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1 text-sm">
          <span className="font-medium">First name</span>
          <input
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
            required
            maxLength={80}
            aria-invalid={Boolean(state.fieldErrors?.firstName)}
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
          />
          <FieldError
            id="contact-first-error"
            errors={state.fieldErrors?.firstName}
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Last name</span>
          <input
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
            required
            maxLength={80}
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
          />
        </label>
      </div>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">Display name</span>
        <input
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          maxLength={120}
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">Title / role</span>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={80}
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">Preferred language</span>
        <input
          value={preferredLanguage}
          onChange={(event) => setPreferredLanguage(event.target.value)}
          maxLength={16}
          placeholder="en"
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
        />
      </label>
      <label
        className="flex items-center gap-2 text-sm"
        htmlFor="primary-contact"
      >
        <input
          id="primary-contact"
          type="checkbox"
          checked={isPrimary}
          onChange={(event) => setIsPrimary(event.target.checked)}
        />
        <span>Primary contact</span>
      </label>
      <CustomFieldInputs
        fields={customFields}
        values={customValues}
        onChange={(key, value) =>
          setCustomValues((current) => ({ ...current, [key]: value }))
        }
        fieldErrors={state.fieldErrors}
        idPrefix="contact-custom"
      />
      <SubmitButton pendingLabel="Saving…">Save contact</SubmitButton>
    </form>
  );
}
