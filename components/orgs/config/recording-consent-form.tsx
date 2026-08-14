"use client";

import { useActionState, useState } from "react";

import { updateRecordingConsentPolicyAction } from "@/app/actions/config-3b";
import { initialActionState } from "@/app/actions/auth-state";
import { FieldError } from "@/components/auth/field-error";
import { FormStatus } from "@/components/auth/form-status";
import { SubmitButton } from "@/components/auth/submit-button";
import {
  ConflictHint,
  DirtyFormShell,
  ReadOnlyNotice,
} from "@/components/orgs/config/form-helpers";

const RECORDING_ACCESS_DEFAULTS = [
  "ADMINS_ONLY",
  "ADMINS_AND_OWNERS",
  "ROLE_GATED_LATER",
] as const;

export function RecordingConsentForm({
  organizationSlug,
  expectedVersion,
  canManage,
  defaults,
}: {
  organizationSlug: string;
  expectedVersion: number;
  canManage: boolean;
  defaults: {
    recordingEnabled: boolean;
    transcriptionEnabled: boolean;
    consentCaptureRequired: boolean;
    disclosureTextPlaceholder: string | null;
    retentionDays: number;
    accessDefault: string;
    reviewRequired: boolean;
  };
}) {
  const [state, formAction] = useActionState(
    updateRecordingConsentPolicyAction,
    initialActionState,
  );
  const [consentCaptureRequired, setConsentCaptureRequired] = useState(
    defaults.consentCaptureRequired,
  );
  const [reviewRequired, setReviewRequired] = useState(defaults.reviewRequired);

  const disclaimer = (
    <div
      role="note"
      className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--muted)]"
    >
      <p className="font-medium text-[var(--foreground)]">
        Legal / compliance disclaimer
      </p>
      <p>
        These settings are operational placeholders, not legal advice. Recording
        and transcription default to off. Your organization must review
        applicable consent, disclosure, and retention requirements before
        enabling recording features.
      </p>
    </div>
  );

  if (!canManage) {
    return (
      <div className="space-y-3 text-sm">
        {disclaimer}
        <ReadOnlyNotice />
        <p>Recording: {defaults.recordingEnabled ? "On" : "Off"}</p>
        <p>Transcription: {defaults.transcriptionEnabled ? "On" : "Off"}</p>
        <p>
          Consent capture required:{" "}
          {defaults.consentCaptureRequired ? "Yes" : "No"}
        </p>
      </div>
    );
  }

  return (
    <DirtyFormShell action={formAction} className="space-y-4">
      {disclaimer}
      <FormStatus status={state.status} message={state.message} />
      <ConflictHint message={state.message} />
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input type="hidden" name="expectedVersion" value={expectedVersion} />
      <input
        type="hidden"
        name="consentCaptureRequired"
        value={consentCaptureRequired ? "true" : "false"}
      />
      <input
        type="hidden"
        name="reviewRequired"
        value={reviewRequired ? "true" : "false"}
      />

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="recordingEnabled"
          defaultChecked={defaults.recordingEnabled}
        />
        Enable call recording
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="transcriptionEnabled"
          defaultChecked={defaults.transcriptionEnabled}
        />
        Enable transcription (requires recording)
      </label>
      <FieldError
        id="transcriptionEnabled-error"
        errors={state.fieldErrors?.transcriptionEnabled}
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={consentCaptureRequired}
          onChange={(event) => setConsentCaptureRequired(event.target.checked)}
        />
        Require consent capture
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={reviewRequired}
          onChange={(event) => setReviewRequired(event.target.checked)}
        />
        Require policy review before go-live
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="retentionDays" className="block text-sm font-medium">
            Retention days
          </label>
          <input
            id="retentionDays"
            name="retentionDays"
            type="number"
            min={1}
            max={3650}
            defaultValue={defaults.retentionDays}
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="accessDefault" className="block text-sm font-medium">
            Access default
          </label>
          <select
            id="accessDefault"
            name="accessDefault"
            defaultValue={defaults.accessDefault}
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          >
            {RECORDING_ACCESS_DEFAULTS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1">
        <label
          htmlFor="disclosureTextPlaceholder"
          className="block text-sm font-medium"
        >
          Disclosure text placeholder
        </label>
        <textarea
          id="disclosureTextPlaceholder"
          name="disclosureTextPlaceholder"
          rows={3}
          maxLength={2000}
          defaultValue={defaults.disclosureTextPlaceholder ?? ""}
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        />
      </div>

      <SubmitButton pendingLabel="Saving…">
        Save recording consent policy
      </SubmitButton>
    </DirtyFormShell>
  );
}
