"use client";

import { useActionState, useMemo, useState } from "react";

import { updateProspectAction } from "@/app/actions/prospects";
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

export function ProspectEditForm({
  organizationSlug,
  prospectId,
  expectedVersion,
  initial,
  customFields,
}: {
  organizationSlug: string;
  prospectId: string;
  expectedVersion: number;
  customFields: CustomFieldFormControl[];
  initial: {
    kind: string;
    displayName: string;
    websiteDisplay: string | null;
    locationLabel: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    region: string | null;
    postalCode: string | null;
    countryCode: string | null;
    timeZone: string | null;
  };
}) {
  const [state, formAction] = useActionState(
    updateProspectAction,
    initialActionState,
  );
  const [kind, setKind] = useState(initial.kind);
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [website, setWebsite] = useState(initial.websiteDisplay ?? "");
  const [locationLabel, setLocationLabel] = useState(
    initial.locationLabel ?? "",
  );
  const [addressLine1, setAddressLine1] = useState(initial.addressLine1 ?? "");
  const [addressLine2, setAddressLine2] = useState(initial.addressLine2 ?? "");
  const [city, setCity] = useState(initial.city ?? "");
  const [region, setRegion] = useState(initial.region ?? "");
  const [postalCode, setPostalCode] = useState(initial.postalCode ?? "");
  const [countryCode, setCountryCode] = useState(initial.countryCode ?? "");
  const [timeZone, setTimeZone] = useState(initial.timeZone ?? "");
  const [customValues, setCustomValues] = useState(
    initialCustomValues(customFields),
  );
  const payload = useMemo(
    () =>
      JSON.stringify({
        kind,
        displayName,
        website,
        locationLabel,
        addressLine1,
        addressLine2,
        city,
        region,
        postalCode,
        countryCode,
        timeZone,
        customValues: customValuesToPayload(customValues),
      }),
    [
      kind,
      displayName,
      website,
      locationLabel,
      addressLine1,
      addressLine2,
      city,
      region,
      postalCode,
      countryCode,
      timeZone,
      customValues,
    ],
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input type="hidden" name="prospectId" value={prospectId} />
      <input
        type="hidden"
        name="expectedVersion"
        value={String(expectedVersion)}
      />
      <input type="hidden" name="payload" value={payload} />
      <FormStatus status={state.status} message={state.message} />
      <label className="block space-y-1 text-sm">
        <span className="font-medium">Type</span>
        <select
          value={kind}
          onChange={(event) => setKind(event.target.value)}
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
        >
          <option value="BUSINESS">Business</option>
          <option value="INDIVIDUAL">Individual</option>
          <option value="HOUSEHOLD">Household</option>
          <option value="ORGANIZATION">Organization / account</option>
        </select>
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">Prospect name</span>
        <input
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          required
          maxLength={120}
          aria-invalid={Boolean(state.fieldErrors?.displayName)}
          aria-describedby="edit-name-error"
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
        />
        <FieldError
          id="edit-name-error"
          errors={state.fieldErrors?.displayName}
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">Website</span>
        <input
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
          maxLength={2048}
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">Location</span>
        <input
          value={locationLabel}
          onChange={(event) => setLocationLabel(event.target.value)}
          maxLength={120}
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">Address line 1</span>
        <input
          value={addressLine1}
          onChange={(event) => setAddressLine1(event.target.value)}
          maxLength={200}
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">Address line 2</span>
        <input
          value={addressLine2}
          onChange={(event) => setAddressLine2(event.target.value)}
          maxLength={200}
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1 text-sm">
          <span className="font-medium">City</span>
          <input
            value={city}
            onChange={(event) => setCity(event.target.value)}
            maxLength={120}
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Region</span>
          <input
            value={region}
            onChange={(event) => setRegion(event.target.value)}
            maxLength={120}
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
          />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Postal code</span>
          <input
            value={postalCode}
            onChange={(event) => setPostalCode(event.target.value)}
            maxLength={20}
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Country code</span>
          <input
            value={countryCode}
            onChange={(event) => setCountryCode(event.target.value)}
            maxLength={2}
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
          />
        </label>
      </div>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">Time zone</span>
        <input
          value={timeZone}
          onChange={(event) => setTimeZone(event.target.value)}
          maxLength={64}
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
        />
      </label>
      <CustomFieldInputs
        fields={customFields}
        values={customValues}
        onChange={(key, value) =>
          setCustomValues((current) => ({ ...current, [key]: value }))
        }
        fieldErrors={state.fieldErrors}
        idPrefix="edit-custom"
      />
      <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
    </form>
  );
}
