"use client";

import { useActionState, useMemo } from "react";

import {
  confirmTemplateSwitchAction,
  previewTemplateSwitchAction,
} from "@/app/actions/config-3b";
import { initialActionState } from "@/app/actions/auth-state";
import { FieldError } from "@/components/auth/field-error";
import { FormStatus } from "@/components/auth/form-status";
import { SubmitButton } from "@/components/auth/submit-button";
import {
  ConflictHint,
  DirtyFormShell,
} from "@/components/orgs/config/form-helpers";

type TemplateOption = {
  key: string;
  label: string;
  description: string;
};

type TemplateSwitchPreviewView = {
  fromKey: string | null;
  toKey: string;
  retainedCustomFields: unknown[];
  newlySuggestedFields: unknown[];
  conflicts: Array<{ key: string; reason: string }>;
  sectionsHidden: string[];
  notes: string[];
};

function isPreview(value: unknown): value is TemplateSwitchPreviewView {
  return (
    typeof value === "object" &&
    value !== null &&
    "toKey" in value &&
    "notes" in value &&
    Array.isArray((value as TemplateSwitchPreviewView).notes)
  );
}

export function TemplateSwitchForm({
  organizationSlug,
  expectedVersion,
  currentKey,
  templates,
}: {
  organizationSlug: string;
  expectedVersion: number;
  currentKey: string;
  templates: TemplateOption[];
}) {
  const [previewState, previewAction] = useActionState(
    previewTemplateSwitchAction,
    initialActionState,
  );
  const [confirmState, confirmAction] = useActionState(
    confirmTemplateSwitchAction,
    initialActionState,
  );

  const preview = useMemo(
    () => (isPreview(previewState.data) ? previewState.data : null),
    [previewState.data],
  );

  return (
    <div className="space-y-6">
      <DirtyFormShell action={previewAction} className="space-y-4">
        <FormStatus
          status={previewState.status}
          message={previewState.message}
        />
        <input type="hidden" name="organizationSlug" value={organizationSlug} />
        <p className="text-sm text-[var(--muted)]">
          Current template:{" "}
          <span className="font-medium text-[var(--foreground)]">
            {currentKey}
          </span>
          . Preview a switch before confirming. Customer fields and catalogue
          items are retained.
        </p>
        <div className="space-y-1">
          <label
            htmlFor="switch-templateKey"
            className="block text-sm font-medium"
          >
            Switch to
          </label>
          <select
            id="switch-templateKey"
            name="templateKey"
            required
            defaultValue=""
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          >
            <option value="" disabled>
              Select a template
            </option>
            {templates
              .filter((template) => template.key !== currentKey)
              .map((template) => (
                <option key={template.key} value={template.key}>
                  {template.label}
                </option>
              ))}
          </select>
          <FieldError
            id="switch-templateKey-error"
            errors={previewState.fieldErrors?.templateKey}
          />
        </div>
        <SubmitButton pendingLabel="Previewing…">Preview switch</SubmitButton>
      </DirtyFormShell>

      {preview ? (
        <div className="space-y-4 rounded-sm border border-[var(--border)] px-3 py-3">
          <h3 className="text-sm font-semibold">
            Preview: {preview.fromKey ?? "none"} → {preview.toKey}
          </h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--muted)]">
            {preview.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
            <li>
              Retained custom fields: {preview.retainedCustomFields.length}
            </li>
            <li>
              Newly suggested fields: {preview.newlySuggestedFields.length}
            </li>
            <li>Conflicts: {preview.conflicts.length}</li>
            <li>
              Sections hidden after switch:{" "}
              {preview.sectionsHidden.length > 0
                ? preview.sectionsHidden.join(", ")
                : "none"}
            </li>
          </ul>
          {preview.conflicts.length > 0 ? (
            <ul className="space-y-1 text-sm text-[var(--danger)]">
              {preview.conflicts.map((conflict) => (
                <li key={`${conflict.key}-${conflict.reason}`}>
                  {conflict.key}: {conflict.reason}
                </li>
              ))}
            </ul>
          ) : null}

          <DirtyFormShell action={confirmAction} className="space-y-3">
            <FormStatus
              status={confirmState.status}
              message={confirmState.message}
            />
            <ConflictHint message={confirmState.message} />
            <input
              type="hidden"
              name="organizationSlug"
              value={organizationSlug}
            />
            <input
              type="hidden"
              name="expectedVersion"
              value={expectedVersion}
            />
            <input type="hidden" name="templateKey" value={preview.toKey} />
            <div className="space-y-1">
              <label
                htmlFor="switch-notes"
                className="block text-sm font-medium"
              >
                Switch notes{" "}
                <span className="text-[var(--muted)]">(optional)</span>
              </label>
              <textarea
                id="switch-notes"
                name="notes"
                rows={2}
                maxLength={2000}
                className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
              />
            </div>
            <SubmitButton pendingLabel="Switching…">
              Confirm switch
            </SubmitButton>
          </DirtyFormShell>
        </div>
      ) : null}
    </div>
  );
}
