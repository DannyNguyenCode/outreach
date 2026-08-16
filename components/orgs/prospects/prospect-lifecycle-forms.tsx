"use client";

import { useActionState } from "react";

import {
  addProspectChannelAction,
  addProspectContactAction,
  archiveProspectAction,
  restoreProspectAction,
} from "@/app/actions/prospects";
import { initialActionState } from "@/app/actions/auth-state";
import { FormStatus } from "@/components/auth/form-status";
import { SubmitButton } from "@/components/auth/submit-button";

export function ProspectArchiveForm({
  organizationSlug,
  prospectId,
  expectedVersion,
}: {
  organizationSlug: string;
  prospectId: string;
  expectedVersion: number;
}) {
  const [state, formAction] = useActionState(
    archiveProspectAction,
    initialActionState,
  );
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input type="hidden" name="prospectId" value={prospectId} />
      <input
        type="hidden"
        name="expectedVersion"
        value={String(expectedVersion)}
      />
      <FormStatus status={state.status} message={state.message} />
      <SubmitButton pendingLabel="Archiving…">Archive prospect</SubmitButton>
    </form>
  );
}

export function ProspectRestoreForm({
  organizationSlug,
  prospectId,
  expectedVersion,
}: {
  organizationSlug: string;
  prospectId: string;
  expectedVersion: number;
}) {
  const [state, formAction] = useActionState(
    restoreProspectAction,
    initialActionState,
  );
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input type="hidden" name="prospectId" value={prospectId} />
      <input
        type="hidden"
        name="expectedVersion"
        value={String(expectedVersion)}
      />
      <FormStatus status={state.status} message={state.message} />
      <SubmitButton pendingLabel="Restoring…">Restore prospect</SubmitButton>
    </form>
  );
}

export function AddContactForm({
  organizationSlug,
  prospectId,
  expectedVersion,
}: {
  organizationSlug: string;
  prospectId: string;
  expectedVersion: number;
}) {
  const [state, formAction] = useActionState(
    addProspectContactAction,
    initialActionState,
  );
  return (
    <form
      action={formAction}
      className="space-y-3"
      onSubmit={(event) => {
        const form = event.currentTarget;
        const firstName = String(
          new FormData(form).get("firstNameVisible") ?? "",
        );
        const lastName = String(
          new FormData(form).get("lastNameVisible") ?? "",
        );
        const title = String(new FormData(form).get("titleVisible") ?? "");
        const phone = String(new FormData(form).get("phoneVisible") ?? "");
        const email = String(new FormData(form).get("emailVisible") ?? "");
        const payload = form.querySelector<HTMLInputElement>(
          'input[name="payload"]',
        );
        if (payload) {
          payload.value = JSON.stringify({
            firstName,
            lastName,
            title,
            channels: [
              ...(phone ? [{ kind: "PHONE", value: phone }] : []),
              ...(email ? [{ kind: "EMAIL", value: email }] : []),
            ],
          });
        }
      }}
    >
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input type="hidden" name="prospectId" value={prospectId} />
      <input
        type="hidden"
        name="expectedVersion"
        value={String(expectedVersion)}
      />
      <input type="hidden" name="payload" value="{}" />
      <FormStatus status={state.status} message={state.message} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1 text-sm">
          <span className="font-medium">First name</span>
          <input
            name="firstNameVisible"
            required
            maxLength={80}
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Last name</span>
          <input
            name="lastNameVisible"
            required
            maxLength={80}
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
          />
        </label>
      </div>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">Title / role</span>
        <input
          name="titleVisible"
          maxLength={80}
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">Phone</span>
        <input
          name="phoneVisible"
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">Email</span>
        <input
          name="emailVisible"
          type="email"
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
        />
      </label>
      <SubmitButton pendingLabel="Adding…">Add contact</SubmitButton>
    </form>
  );
}

export function AddChannelForm({
  organizationSlug,
  prospectId,
  expectedVersion,
  contactId,
}: {
  organizationSlug: string;
  prospectId: string;
  expectedVersion: number;
  contactId?: string;
}) {
  const [state, formAction] = useActionState(
    addProspectChannelAction,
    initialActionState,
  );
  return (
    <form
      action={formAction}
      className="space-y-3"
      onSubmit={(event) => {
        const form = event.currentTarget;
        const data = new FormData(form);
        const payload = form.querySelector<HTMLInputElement>(
          'input[name="payload"]',
        );
        if (payload) {
          payload.value = JSON.stringify({
            kind: data.get("kindVisible"),
            label: data.get("labelVisible"),
            value: data.get("valueVisible"),
          });
        }
      }}
    >
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input type="hidden" name="prospectId" value={prospectId} />
      {contactId ? (
        <input type="hidden" name="contactId" value={contactId} />
      ) : null}
      <input
        type="hidden"
        name="expectedVersion"
        value={String(expectedVersion)}
      />
      <input type="hidden" name="payload" value="{}" />
      <FormStatus status={state.status} message={state.message} />
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Type</span>
          <select
            name="kindVisible"
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
          >
            <option value="PHONE">Phone</option>
            <option value="EMAIL">Email</option>
          </select>
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Label</span>
          <input
            name="labelVisible"
            maxLength={40}
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Value</span>
          <input
            name="valueVisible"
            required
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
          />
        </label>
      </div>
      <SubmitButton pendingLabel="Adding…">
        Add communication point
      </SubmitButton>
    </form>
  );
}
