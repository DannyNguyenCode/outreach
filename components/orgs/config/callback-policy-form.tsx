"use client";

import { useActionState } from "react";

import { updateCallbackPolicyAction } from "@/app/actions/config-3b";
import { initialActionState } from "@/app/actions/auth-state";
import { FieldError } from "@/components/auth/field-error";
import { FormStatus } from "@/components/auth/form-status";
import { SubmitButton } from "@/components/auth/submit-button";
import {
  ConflictHint,
  DirtyFormShell,
  ReadOnlyNotice,
} from "@/components/orgs/config/form-helpers";

const CALLBACK_ASSIGNMENT_BEHAVIORS = [
  "UNASSIGNED",
  "ROUND_ROBIN_PLACEHOLDER",
  "CREATOR",
] as const;

export function CallbackPolicyForm({
  organizationSlug,
  expectedVersion,
  canManage,
  defaults,
}: {
  organizationSlug: string;
  expectedVersion: number;
  canManage: boolean;
  defaults: {
    defaultWindowMinutes: number;
    maxSuggestedAttempts: number;
    minSpacingMinutes: number;
    businessHoursOnly: boolean;
    defaultAssignmentBehavior: string;
  };
}) {
  const [state, formAction] = useActionState(
    updateCallbackPolicyAction,
    initialActionState,
  );

  if (!canManage) {
    return (
      <div className="space-y-2 text-sm">
        <ReadOnlyNotice />
        <p>Window: {defaults.defaultWindowMinutes} minutes</p>
        <p>Max attempts: {defaults.maxSuggestedAttempts}</p>
        <p>Min spacing: {defaults.minSpacingMinutes} minutes</p>
        <p>Business hours only: {defaults.businessHoursOnly ? "Yes" : "No"}</p>
        <p>Assignment: {defaults.defaultAssignmentBehavior}</p>
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
          <label
            htmlFor="defaultWindowMinutes"
            className="block text-sm font-medium"
          >
            Default window (minutes)
          </label>
          <input
            id="defaultWindowMinutes"
            name="defaultWindowMinutes"
            type="number"
            min={15}
            max={480}
            required
            defaultValue={defaults.defaultWindowMinutes}
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
          <FieldError
            id="defaultWindowMinutes-error"
            errors={state.fieldErrors?.defaultWindowMinutes}
          />
        </div>
        <div className="space-y-1">
          <label
            htmlFor="maxSuggestedAttempts"
            className="block text-sm font-medium"
          >
            Max suggested attempts
          </label>
          <input
            id="maxSuggestedAttempts"
            name="maxSuggestedAttempts"
            type="number"
            min={1}
            max={20}
            required
            defaultValue={defaults.maxSuggestedAttempts}
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label
            htmlFor="minSpacingMinutes"
            className="block text-sm font-medium"
          >
            Minimum spacing (minutes)
          </label>
          <input
            id="minSpacingMinutes"
            name="minSpacingMinutes"
            type="number"
            min={15}
            max={10080}
            required
            defaultValue={defaults.minSpacingMinutes}
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label
            htmlFor="defaultAssignmentBehavior"
            className="block text-sm font-medium"
          >
            Default assignment
          </label>
          <select
            id="defaultAssignmentBehavior"
            name="defaultAssignmentBehavior"
            defaultValue={defaults.defaultAssignmentBehavior}
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          >
            {CALLBACK_ASSIGNMENT_BEHAVIORS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="businessHoursOnly"
          defaultChecked={defaults.businessHoursOnly}
        />
        Suggest callbacks during business hours only
      </label>

      <SubmitButton pendingLabel="Saving…">Save callback policy</SubmitButton>
    </DirtyFormShell>
  );
}
