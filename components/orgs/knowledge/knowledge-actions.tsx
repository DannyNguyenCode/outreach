"use client";

import { useActionState } from "react";

import {
  archiveKnowledgeSourceAction,
  confirmKnowledgeVersionAction,
  createReplacementDraftAction,
  restoreKnowledgeVersionAction,
} from "@/app/actions/knowledge";
import { initialActionState } from "@/app/actions/auth-state";
import { FieldError } from "@/components/auth/field-error";
import { FormStatus } from "@/components/auth/form-status";
import { SubmitButton } from "@/components/auth/submit-button";
import { ConflictHint } from "@/components/orgs/config/form-helpers";
import { KNOWLEDGE_CONFIRMATION_STATEMENT } from "@/lib/orgs/knowledge-validation";

export function KnowledgeConfirmForm({
  organizationSlug,
  sourceId,
  versionId,
  expectedDraftRevision,
  expectedChecksum,
}: {
  organizationSlug: string;
  sourceId: string;
  versionId: string;
  expectedDraftRevision: number;
  expectedChecksum: string;
}) {
  const [state, formAction] = useActionState(
    confirmKnowledgeVersionAction,
    initialActionState,
  );

  return (
    <form action={formAction} className="space-y-3" noValidate>
      <FormStatus status={state.status} message={state.message} />
      <ConflictHint message={state.message} />
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input type="hidden" name="sourceId" value={sourceId} />
      <input type="hidden" name="versionId" value={versionId} />
      <input
        type="hidden"
        name="expectedDraftRevision"
        value={expectedDraftRevision}
      />
      <input type="hidden" name="expectedChecksum" value={expectedChecksum} />
      <fieldset className="space-y-2 rounded-sm border border-[var(--border)] p-3">
        <legend className="text-sm font-medium">Confirmation</legend>
        <p className="text-sm leading-6">{KNOWLEDGE_CONFIRMATION_STATEMENT}</p>
        <p className="text-xs text-[var(--muted)]">
          Confirmation language version knowledge.confirm.v1. Outreach does not
          review this information for truth or legal validity.
        </p>
        <div className="flex items-start gap-2">
          <input
            id="confirmAccuracy"
            name="confirmAccuracy"
            type="checkbox"
            value="on"
            required
            className="mt-1"
          />
          <label htmlFor="confirmAccuracy" className="text-sm">
            I confirm the statement above for this exact version.
          </label>
        </div>
        <FieldError
          id="confirmAccuracy-error"
          errors={state.fieldErrors?.confirmAccuracy}
        />
      </fieldset>
      <SubmitButton pendingLabel="Confirming…">
        Confirm and activate
      </SubmitButton>
    </form>
  );
}

export function KnowledgeArchiveForm({
  organizationSlug,
  sourceId,
  expectedVersion,
}: {
  organizationSlug: string;
  sourceId: string;
  expectedVersion: number;
}) {
  const [state, formAction] = useActionState(
    archiveKnowledgeSourceAction,
    initialActionState,
  );

  return (
    <form action={formAction} className="space-y-3">
      <FormStatus status={state.status} message={state.message} />
      <ConflictHint message={state.message} />
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input type="hidden" name="sourceId" value={sourceId} />
      <input type="hidden" name="expectedVersion" value={expectedVersion} />
      <SubmitButton pendingLabel="Archiving…">Archive knowledge</SubmitButton>
    </form>
  );
}

export function KnowledgeRestoreForm({
  organizationSlug,
  sourceId,
  versionId,
  expectedVersion,
}: {
  organizationSlug: string;
  sourceId: string;
  versionId: string;
  expectedVersion: number;
}) {
  const [state, formAction] = useActionState(
    restoreKnowledgeVersionAction,
    initialActionState,
  );

  return (
    <form action={formAction} className="space-y-3">
      <FormStatus status={state.status} message={state.message} />
      <ConflictHint message={state.message} />
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input type="hidden" name="sourceId" value={sourceId} />
      <input type="hidden" name="versionId" value={versionId} />
      <input type="hidden" name="expectedVersion" value={expectedVersion} />
      <SubmitButton pendingLabel="Restoring…">
        Restore as new draft
      </SubmitButton>
    </form>
  );
}

export function KnowledgeReplacementForm({
  organizationSlug,
  sourceId,
  expectedVersion,
}: {
  organizationSlug: string;
  sourceId: string;
  expectedVersion: number;
}) {
  const [state, formAction] = useActionState(
    createReplacementDraftAction,
    initialActionState,
  );

  return (
    <form action={formAction} className="space-y-3">
      <FormStatus status={state.status} message={state.message} />
      <ConflictHint message={state.message} />
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input type="hidden" name="sourceId" value={sourceId} />
      <input type="hidden" name="expectedVersion" value={expectedVersion} />
      <SubmitButton pendingLabel="Creating draft…">
        Create replacement draft
      </SubmitButton>
    </form>
  );
}
