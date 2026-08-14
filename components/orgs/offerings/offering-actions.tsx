"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import { initialActionState } from "@/app/actions/auth-state";
import {
  archiveOfferingAction,
  confirmOfferingVersionAction,
  createOfferingReplacementDraftAction,
  restoreOfferingVersionAction,
} from "@/app/actions/offerings";
import { FormStatus } from "@/components/auth/form-status";
import { SubmitButton } from "@/components/auth/submit-button";
import { ConflictHint } from "@/components/orgs/config/form-helpers";
import { OFFERING_CONFIRMATION_STATEMENT } from "@/lib/orgs/offering-confirmation";

function useOfferingDraftRedirect(
  organizationSlug: string,
  state: { status: string; data?: unknown },
) {
  const router = useRouter();
  useEffect(() => {
    if (state.status !== "success" || !state.data) return;
    const data = state.data as { offeringId?: unknown; versionId?: unknown };
    if (
      typeof data.offeringId === "string" &&
      typeof data.versionId === "string"
    ) {
      router.push(
        `/app/orgs/${organizationSlug}/knowledge/offerings/${data.offeringId}/versions/${data.versionId}`,
      );
    }
  }, [organizationSlug, router, state.data, state.status]);
}

function Hidden({
  organizationSlug,
  offeringId,
  versionId,
  expectedVersion,
}: {
  organizationSlug: string;
  offeringId: string;
  versionId?: string;
  expectedVersion?: number;
}) {
  return (
    <>
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input type="hidden" name="offeringId" value={offeringId} />
      {versionId ? (
        <input type="hidden" name="versionId" value={versionId} />
      ) : null}
      {expectedVersion !== undefined ? (
        <input type="hidden" name="expectedVersion" value={expectedVersion} />
      ) : null}
    </>
  );
}

export function OfferingConfirmForm(props: {
  organizationSlug: string;
  offeringId: string;
  versionId: string;
  draftRevision: number;
  checksum: string;
}) {
  const [state, action] = useActionState(
    confirmOfferingVersionAction,
    initialActionState,
  );
  return (
    <form action={action} className="space-y-3">
      <FormStatus status={state.status} message={state.message} />
      <ConflictHint message={state.message} />
      <Hidden {...props} />
      <input
        type="hidden"
        name="expectedDraftRevision"
        value={props.draftRevision}
      />
      <input type="hidden" name="expectedChecksum" value={props.checksum} />
      <fieldset className="space-y-2 rounded-sm border border-[var(--border)] p-3">
        <legend className="text-sm font-medium">Confirmation</legend>
        <p className="text-sm leading-6">{OFFERING_CONFIRMATION_STATEMENT}</p>
        <label className="flex items-start gap-2 text-sm">
          <input
            className="mt-1"
            type="checkbox"
            name="confirmAccuracy"
            value="on"
            required
          />
          I confirm this exact offering version.
        </label>
      </fieldset>
      <SubmitButton pendingLabel="Confirming…">
        Confirm and activate
      </SubmitButton>
    </form>
  );
}

export function OfferingArchiveForm(props: {
  organizationSlug: string;
  offeringId: string;
  expectedVersion: number;
}) {
  const [state, action] = useActionState(
    archiveOfferingAction,
    initialActionState,
  );
  return (
    <form action={action} className="space-y-2">
      <FormStatus status={state.status} message={state.message} />
      <ConflictHint message={state.message} />
      <Hidden {...props} />
      <SubmitButton pendingLabel="Archiving…">Archive offering</SubmitButton>
    </form>
  );
}

export function OfferingRestoreForm(props: {
  organizationSlug: string;
  offeringId: string;
  versionId: string;
  expectedVersion: number;
}) {
  const [state, action] = useActionState(
    restoreOfferingVersionAction,
    initialActionState,
  );
  useOfferingDraftRedirect(props.organizationSlug, state);
  return (
    <form action={action} className="space-y-2">
      <FormStatus status={state.status} message={state.message} />
      <ConflictHint message={state.message} />
      <Hidden {...props} />
      <SubmitButton pendingLabel="Restoring…">
        Restore as new draft
      </SubmitButton>
    </form>
  );
}

export function OfferingReplacementForm(props: {
  organizationSlug: string;
  offeringId: string;
  expectedVersion: number;
}) {
  const [state, action] = useActionState(
    createOfferingReplacementDraftAction,
    initialActionState,
  );
  useOfferingDraftRedirect(props.organizationSlug, state);
  return (
    <form action={action} className="space-y-2">
      <FormStatus status={state.status} message={state.message} />
      <ConflictHint message={state.message} />
      <Hidden {...props} />
      <SubmitButton pendingLabel="Creating…">
        Create replacement draft
      </SubmitButton>
    </form>
  );
}
