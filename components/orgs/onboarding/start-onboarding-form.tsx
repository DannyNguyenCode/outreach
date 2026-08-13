"use client";

import { useActionState } from "react";

import { startOnboardingAction } from "@/app/actions/business";
import { initialActionState } from "@/app/actions/auth-state";
import { FormStatus } from "@/components/auth/form-status";
import { SubmitButton } from "@/components/auth/submit-button";

export function StartOnboardingForm({
  organizationSlug,
}: {
  organizationSlug: string;
}) {
  const [state, formAction] = useActionState(
    startOnboardingAction,
    initialActionState,
  );

  return (
    <form action={formAction} className="space-y-3" method="post">
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <FormStatus status={state.status} message={state.message} />
      <p className="text-sm text-[var(--muted)]">
        Onboarding has not been started. Starting creates the
        organization&apos;s business configuration records and begins the guided
        setup.
      </p>
      <SubmitButton pendingLabel="Starting…">Start onboarding</SubmitButton>
    </form>
  );
}
