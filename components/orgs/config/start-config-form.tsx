"use client";

import { useActionState } from "react";

import { startConfigProgressAction } from "@/app/actions/config-3b";
import { initialActionState } from "@/app/actions/auth-state";
import { FormStatus } from "@/components/auth/form-status";
import { SubmitButton } from "@/components/auth/submit-button";

export function StartConfigForm({
  organizationSlug,
}: {
  organizationSlug: string;
}) {
  const [state, formAction] = useActionState(
    startConfigProgressAction,
    initialActionState,
  );

  return (
    <form action={formAction} className="space-y-3" method="post">
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <FormStatus status={state.status} message={state.message} />
      <p className="text-sm text-[var(--muted)]">
        Extended configuration has not been started. Starting creates locale,
        callback, recording, and notification defaults for this organization. It
        does not change Phase 3A onboarding readiness.
      </p>
      <SubmitButton pendingLabel="Starting…">Start configuration</SubmitButton>
    </form>
  );
}
