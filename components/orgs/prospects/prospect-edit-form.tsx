"use client";

import { useActionState, useMemo, useState } from "react";

import { updateProspectAction } from "@/app/actions/prospects";
import { initialActionState } from "@/app/actions/auth-state";
import { FieldError } from "@/components/auth/field-error";
import { FormStatus } from "@/components/auth/form-status";
import { SubmitButton } from "@/components/auth/submit-button";

export function ProspectEditForm({
  organizationSlug,
  prospectId,
  expectedVersion,
  initial,
}: {
  organizationSlug: string;
  prospectId: string;
  expectedVersion: number;
  initial: {
    kind: string;
    displayName: string;
    websiteDisplay: string | null;
    locationLabel: string | null;
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
  const [timeZone, setTimeZone] = useState(initial.timeZone ?? "");
  const payload = useMemo(
    () =>
      JSON.stringify({
        kind,
        displayName,
        website,
        locationLabel,
        timeZone,
      }),
    [kind, displayName, website, locationLabel, timeZone],
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
        <span className="font-medium">Time zone</span>
        <input
          value={timeZone}
          onChange={(event) => setTimeZone(event.target.value)}
          maxLength={64}
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
        />
      </label>
      <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
    </form>
  );
}
