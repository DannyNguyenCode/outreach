"use client";

import { useActionState } from "react";

import { acceptInvitationAction } from "@/app/actions/orgs";
import { initialActionState } from "@/app/actions/auth-state";
import { FormStatus } from "@/components/auth/form-status";
import { SubmitButton } from "@/components/auth/submit-button";

type AcceptInvitationFormProps = {
  token: string;
  disabled?: boolean;
  disabledReason?: string;
};

export function AcceptInvitationForm({
  token,
  disabled = false,
  disabledReason,
}: AcceptInvitationFormProps) {
  const [state, formAction] = useActionState(
    acceptInvitationAction,
    initialActionState,
  );

  if (disabled) {
    return (
      <p className="text-sm text-[var(--muted)]" role="status">
        {disabledReason ?? "This invitation cannot be accepted."}
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <FormStatus status={state.status} message={state.message} />
      <SubmitButton pendingLabel="Accepting…">Accept invitation</SubmitButton>
    </form>
  );
}
