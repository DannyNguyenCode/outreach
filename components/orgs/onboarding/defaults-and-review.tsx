"use client";

import { useActionState } from "react";

import {
  completeOnboardingAction,
  reopenOnboardingAction,
  updateEmployeeDefaultsAction,
} from "@/app/actions/business";
import { initialActionState } from "@/app/actions/auth-state";
import { FormStatus } from "@/components/auth/form-status";
import { SubmitButton } from "@/components/auth/submit-button";

export function EmployeeDefaultsForm({
  organizationSlug,
  expectedVersion,
  onboardingExpectedVersion,
  markStep = true,
  defaults,
}: {
  organizationSlug: string;
  expectedVersion: number;
  onboardingExpectedVersion?: number;
  markStep?: boolean;
  defaults: {
    membersCanViewServices: boolean;
    membersCanViewProducts: boolean;
    membersCanViewBusinessInfo: boolean;
    futureCallingAccessDefault: string;
  };
}) {
  const [state, formAction] = useActionState(
    updateEmployeeDefaultsAction,
    initialActionState,
  );

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormStatus status={state.status} message={state.message} />
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input type="hidden" name="expectedVersion" value={expectedVersion} />
      {markStep && onboardingExpectedVersion !== undefined ? (
        <>
          <input type="hidden" name="markStep" value="EMPLOYEE_DEFAULTS" />
          <input
            type="hidden"
            name="onboardingExpectedVersion"
            value={onboardingExpectedVersion}
          />
        </>
      ) : null}

      <p className="text-sm text-[var(--muted)]">
        These defaults never grant members owner or admin capabilities. Server
        permission policy remains authoritative.
      </p>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="membersCanViewServices"
          defaultChecked={defaults.membersCanViewServices}
          className="mt-1"
        />
        <span>Members can view the service catalogue</span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="membersCanViewProducts"
          defaultChecked={defaults.membersCanViewProducts}
          className="mt-1"
        />
        <span>Members can view the product catalogue</span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="membersCanViewBusinessInfo"
          defaultChecked={defaults.membersCanViewBusinessInfo}
          className="mt-1"
        />
        <span>Members can view public business information</span>
      </label>

      <div className="space-y-1">
        <label
          htmlFor="futureCallingAccessDefault"
          className="block text-sm font-medium"
        >
          Future calling access default
        </label>
        <select
          id="futureCallingAccessDefault"
          name="futureCallingAccessDefault"
          defaultValue={defaults.futureCallingAccessDefault}
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        >
          <option value="DISABLED">Disabled until configured later</option>
          <option value="STANDARD">Standard (reserved for later phases)</option>
        </select>
      </div>

      <SubmitButton pendingLabel="Saving…">Save defaults</SubmitButton>
    </form>
  );
}

export function CompleteOnboardingForm({
  organizationSlug,
  missing,
  ready,
}: {
  organizationSlug: string;
  missing: string[];
  ready: boolean;
}) {
  const [state, formAction] = useActionState(
    completeOnboardingAction,
    initialActionState,
  );

  return (
    <form action={formAction} className="space-y-3" method="post">
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <FormStatus status={state.status} message={state.message} />
      {!ready ? (
        <div
          role="status"
          className="rounded-sm border border-[var(--border)] bg-[var(--surface)] p-3 text-sm"
        >
          <p className="font-medium">Still needed before completion:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--muted)]">
            {missing.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-[var(--muted)]">
          All required configuration looks ready. Completing onboarding is an
          intentional action — visiting this page does not complete it.
        </p>
      )}
      <SubmitButton pendingLabel="Completing…">
        Complete onboarding
      </SubmitButton>
    </form>
  );
}

export function ReopenOnboardingForm({
  organizationSlug,
  expectedVersion,
}: {
  organizationSlug: string;
  expectedVersion: number;
}) {
  const [state, formAction] = useActionState(
    reopenOnboardingAction,
    initialActionState,
  );

  return (
    <form action={formAction} className="space-y-3" method="post">
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input type="hidden" name="expectedVersion" value={expectedVersion} />
      <FormStatus status={state.status} message={state.message} />
      <SubmitButton pendingLabel="Reopening…">Reopen onboarding</SubmitButton>
    </form>
  );
}
