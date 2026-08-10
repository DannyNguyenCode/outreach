"use client";

import { useActionState } from "react";

import {
  changeMemberRoleAction,
  deactivateMemberAction,
  inviteMemberAction,
  revokeInvitationAction,
} from "@/app/actions/orgs";
import { initialActionState } from "@/app/actions/auth-state";
import { FieldError } from "@/components/auth/field-error";
import { FormStatus } from "@/components/auth/form-status";
import { SubmitButton } from "@/components/auth/submit-button";

type InviteMemberFormProps = {
  organizationSlug: string;
  canInvite: boolean;
};

export function InviteMemberForm({
  organizationSlug,
  canInvite,
}: InviteMemberFormProps) {
  const [state, formAction] = useActionState(
    inviteMemberAction,
    initialActionState,
  );

  if (!canInvite) {
    return null;
  }

  return (
    <form action={formAction} className="space-y-3" noValidate>
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <FormStatus status={state.status} message={state.message} />
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <div className="space-y-1">
          <label htmlFor="invite-email" className="block text-sm font-medium">
            Invite email
          </label>
          <input
            id="invite-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            aria-invalid={Boolean(state.fieldErrors?.email)}
            aria-describedby={
              state.fieldErrors?.email ? "invite-email-error" : undefined
            }
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
          <FieldError
            id="invite-email-error"
            errors={state.fieldErrors?.email}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="invite-role" className="block text-sm font-medium">
            Role
          </label>
          <select
            id="invite-role"
            name="role"
            defaultValue="MEMBER"
            aria-invalid={Boolean(state.fieldErrors?.role)}
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          >
            <option value="MEMBER">Member</option>
            <option value="ADMIN">Admin</option>
          </select>
          <FieldError id="invite-role-error" errors={state.fieldErrors?.role} />
        </div>
        <div className="flex items-end">
          <SubmitButton pendingLabel="Sending…">Send invitation</SubmitButton>
        </div>
      </div>
    </form>
  );
}

type MemberRowActionsProps = {
  organizationSlug: string;
  membershipId: string;
  currentRole: "OWNER" | "ADMIN" | "MEMBER";
  status: "ACTIVE" | "INACTIVE";
  canManage: boolean;
  canOffboard: boolean;
};

export function MemberRowActions({
  organizationSlug,
  membershipId,
  currentRole,
  status,
  canManage,
  canOffboard,
}: MemberRowActionsProps) {
  const [roleState, roleAction] = useActionState(
    changeMemberRoleAction,
    initialActionState,
  );
  const [offboardState, offboardAction] = useActionState(
    deactivateMemberAction,
    initialActionState,
  );

  if (status !== "ACTIVE" || currentRole === "OWNER") {
    return null;
  }

  return (
    <div className="space-y-2">
      <FormStatus status={roleState.status} message={roleState.message} />
      <FormStatus
        status={offboardState.status}
        message={offboardState.message}
      />
      {canManage ? (
        <form action={roleAction} className="flex flex-wrap items-end gap-2">
          <input
            type="hidden"
            name="organizationSlug"
            value={organizationSlug}
          />
          <input type="hidden" name="membershipId" value={membershipId} />
          <label className="sr-only" htmlFor={`role-${membershipId}`}>
            Change role
          </label>
          <select
            id={`role-${membershipId}`}
            name="role"
            defaultValue={currentRole === "ADMIN" ? "ADMIN" : "MEMBER"}
            className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm"
          >
            <option value="MEMBER">Member</option>
            <option value="ADMIN">Admin</option>
          </select>
          <button
            type="submit"
            className="rounded-sm border border-[var(--border)] px-3 py-1 text-sm hover:bg-[var(--background)]"
          >
            Update role
          </button>
        </form>
      ) : null}
      {canOffboard ? (
        <form action={offboardAction}>
          <input
            type="hidden"
            name="organizationSlug"
            value={organizationSlug}
          />
          <input type="hidden" name="membershipId" value={membershipId} />
          <button
            type="submit"
            className="rounded-sm border border-[var(--danger)]/40 px-3 py-1 text-sm text-[var(--danger)] hover:bg-[var(--background)]"
          >
            Offboard
          </button>
        </form>
      ) : null}
    </div>
  );
}

type RevokeInvitationButtonProps = {
  organizationSlug: string;
  invitationId: string;
};

export function RevokeInvitationButton({
  organizationSlug,
  invitationId,
}: RevokeInvitationButtonProps) {
  const [state, formAction] = useActionState(
    revokeInvitationAction,
    initialActionState,
  );

  return (
    <form action={formAction} className="space-y-1">
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input type="hidden" name="invitationId" value={invitationId} />
      <FormStatus status={state.status} message={state.message} />
      <button
        type="submit"
        className="rounded-sm border border-[var(--border)] px-3 py-1 text-sm hover:bg-[var(--background)]"
      >
        Revoke
      </button>
    </form>
  );
}
