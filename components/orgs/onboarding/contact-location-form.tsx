"use client";

import { useActionState } from "react";

import { updateContactLocationAction } from "@/app/actions/business";
import { initialActionState } from "@/app/actions/auth-state";
import { FieldError } from "@/components/auth/field-error";
import { FormStatus } from "@/components/auth/form-status";
import { SubmitButton } from "@/components/auth/submit-button";

const COMMON_TIMEZONES = [
  "America/Toronto",
  "America/Vancouver",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Halifax",
  "America/St_Johns",
  "Europe/London",
  "UTC",
];

type ContactFormProps = {
  organizationSlug: string;
  expectedVersion: number;
  markStep?: boolean;
  defaults: {
    primaryEmail: string;
    primaryPhone: string;
    preferredContactMethod: string;
    timeZone: string;
    addressLine1: string;
    addressLine2: string;
    city: string;
    region: string;
    postalCode: string;
    countryCode: string;
  };
};

export function ContactLocationForm({
  organizationSlug,
  expectedVersion,
  markStep = true,
  defaults,
}: ContactFormProps) {
  const [state, formAction] = useActionState(
    updateContactLocationAction,
    initialActionState,
  );

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormStatus status={state.status} message={state.message} />
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input type="hidden" name="expectedVersion" value={expectedVersion} />
      {markStep ? (
        <input type="hidden" name="markStep" value="CONTACT_LOCATION" />
      ) : null}

      <div className="space-y-1">
        <label htmlFor="primaryEmail" className="block text-sm font-medium">
          Primary business email
        </label>
        <input
          id="primaryEmail"
          name="primaryEmail"
          type="email"
          required
          defaultValue={defaults.primaryEmail}
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        />
        <FieldError
          id="primaryEmail-error"
          errors={state.fieldErrors?.primaryEmail}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="countryCode" className="block text-sm font-medium">
            Country
          </label>
          <input
            id="countryCode"
            name="countryCode"
            type="text"
            required
            maxLength={2}
            defaultValue={defaults.countryCode || "CA"}
            placeholder="CA"
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm uppercase"
          />
          <FieldError
            id="countryCode-error"
            errors={state.fieldErrors?.countryCode}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="primaryPhone" className="block text-sm font-medium">
            Primary business phone
          </label>
          <input
            id="primaryPhone"
            name="primaryPhone"
            type="tel"
            required
            defaultValue={defaults.primaryPhone}
            placeholder="+14165551234"
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
          <FieldError
            id="primaryPhone-error"
            errors={state.fieldErrors?.primaryPhone}
          />
        </div>
      </div>

      <div className="space-y-1">
        <label
          htmlFor="preferredContactMethod"
          className="block text-sm font-medium"
        >
          Preferred public contact method
        </label>
        <select
          id="preferredContactMethod"
          name="preferredContactMethod"
          defaultValue={defaults.preferredContactMethod || "EMAIL"}
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        >
          <option value="EMAIL">Email</option>
          <option value="PHONE">Phone</option>
          <option value="WEBSITE">Website</option>
        </select>
      </div>

      <div className="space-y-1">
        <label htmlFor="timeZone" className="block text-sm font-medium">
          Time zone (IANA)
        </label>
        <input
          id="timeZone"
          name="timeZone"
          type="text"
          required
          list="timezone-options"
          defaultValue={defaults.timeZone || "America/Toronto"}
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        />
        <datalist id="timezone-options">
          {COMMON_TIMEZONES.map((tz) => (
            <option key={tz} value={tz} />
          ))}
        </datalist>
        <FieldError id="timeZone-error" errors={state.fieldErrors?.timeZone} />
      </div>

      <div className="space-y-1">
        <label htmlFor="addressLine1" className="block text-sm font-medium">
          Address line 1
        </label>
        <input
          id="addressLine1"
          name="addressLine1"
          type="text"
          defaultValue={defaults.addressLine1}
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="addressLine2" className="block text-sm font-medium">
          Address line 2
        </label>
        <input
          id="addressLine2"
          name="addressLine2"
          type="text"
          defaultValue={defaults.addressLine2}
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1">
          <label htmlFor="city" className="block text-sm font-medium">
            City
          </label>
          <input
            id="city"
            name="city"
            type="text"
            defaultValue={defaults.city}
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="region" className="block text-sm font-medium">
            Province / state
          </label>
          <input
            id="region"
            name="region"
            type="text"
            defaultValue={defaults.region}
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="postalCode" className="block text-sm font-medium">
            Postal / ZIP
          </label>
          <input
            id="postalCode"
            name="postalCode"
            type="text"
            defaultValue={defaults.postalCode}
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
        </div>
      </div>

      <SubmitButton pendingLabel="Saving…">Save and continue</SubmitButton>
    </form>
  );
}
