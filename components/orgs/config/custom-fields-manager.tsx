"use client";

import { useActionState, useMemo, useState } from "react";

import {
  createCustomFieldAction,
  deactivateCustomFieldAction,
  reorderCustomFieldsAction,
  updateCustomFieldAction,
} from "@/app/actions/config-3b";
import { initialActionState } from "@/app/actions/auth-state";
import { FieldError } from "@/components/auth/field-error";
import { FormStatus } from "@/components/auth/form-status";
import { SubmitButton } from "@/components/auth/submit-button";
import {
  ConflictHint,
  DirtyFormShell,
  ReadOnlyNotice,
} from "@/components/orgs/config/form-helpers";

const DATA_TYPES = [
  "TEXT",
  "LONG_TEXT",
  "NUMBER",
  "BOOLEAN",
  "DATE",
  "SINGLE_SELECT",
  "MULTI_SELECT",
  "URL",
  "EMAIL",
  "PHONE",
] as const;

const SCOPES = ["BUSINESS", "OFFERING", "PROSPECT", "KNOWLEDGE"] as const;

export type CustomFieldRow = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  dataType: string;
  required: boolean;
  isActive: boolean;
  displayOrder: number;
  options: unknown;
  scope: string;
  version: number;
};

function optionsToText(options: unknown): string {
  if (!Array.isArray(options)) return "";
  return options
    .filter((item): item is string => typeof item === "string")
    .join("\n");
}

export function CustomFieldsManager({
  organizationSlug,
  fields,
  canManage,
}: {
  organizationSlug: string;
  fields: CustomFieldRow[];
  canManage: boolean;
}) {
  const [order, setOrder] = useState(fields.map((field) => field.id));
  const orderedFields = useMemo(() => {
    const byId = new Map(fields.map((field) => [field.id, field]));
    return order
      .map((id) => byId.get(id))
      .filter((field): field is CustomFieldRow => Boolean(field));
  }, [fields, order]);

  if (!canManage) {
    return (
      <div className="space-y-3">
        <ReadOnlyNotice />
        <ul className="space-y-2">
          {fields.length === 0 ? (
            <li className="text-sm text-[var(--muted)]">
              No custom fields yet.
            </li>
          ) : (
            fields.map((field) => (
              <li
                key={field.id}
                className="rounded-sm border border-[var(--border)] px-3 py-2 text-sm"
              >
                <p className="font-medium">
                  {field.label}
                  {!field.isActive ? (
                    <span className="ml-2 text-[var(--muted)]">(inactive)</span>
                  ) : null}
                </p>
                <p className="text-[var(--muted)]">
                  {field.key} · {field.scope} · {field.dataType}
                </p>
              </li>
            ))
          )}
        </ul>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <ul className="space-y-4">
        {orderedFields.length === 0 ? (
          <li className="text-sm text-[var(--muted)]">No custom fields yet.</li>
        ) : (
          orderedFields.map((field, index) => (
            <li key={field.id} className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">
                  {field.label}{" "}
                  <span className="text-[var(--muted)]">({field.key})</span>
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="text-xs underline-offset-2 hover:underline disabled:opacity-40"
                    disabled={index === 0}
                    onClick={() =>
                      setOrder((current) => {
                        if (index === 0) return current;
                        const next = [...current];
                        [next[index - 1], next[index]] = [
                          next[index]!,
                          next[index - 1]!,
                        ];
                        return next;
                      })
                    }
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    className="text-xs underline-offset-2 hover:underline disabled:opacity-40"
                    disabled={index === orderedFields.length - 1}
                    onClick={() =>
                      setOrder((current) => {
                        if (index >= current.length - 1) return current;
                        const next = [...current];
                        [next[index], next[index + 1]] = [
                          next[index + 1]!,
                          next[index]!,
                        ];
                        return next;
                      })
                    }
                  >
                    Move down
                  </button>
                </div>
              </div>
              <UpdateCustomFieldForm
                organizationSlug={organizationSlug}
                field={field}
              />
              {field.isActive ? (
                <DeactivateCustomFieldForm
                  organizationSlug={organizationSlug}
                  fieldId={field.id}
                  expectedVersion={field.version}
                />
              ) : null}
            </li>
          ))
        )}
      </ul>

      {fields.length > 1 ? (
        <ReorderCustomFieldsForm
          organizationSlug={organizationSlug}
          orderedIds={order}
        />
      ) : null}

      <CreateCustomFieldForm organizationSlug={organizationSlug} />
    </div>
  );
}

function CreateCustomFieldForm({
  organizationSlug,
}: {
  organizationSlug: string;
}) {
  const [state, formAction] = useActionState(
    createCustomFieldAction,
    initialActionState,
  );

  return (
    <DirtyFormShell action={formAction} className="space-y-3">
      <h3 className="text-sm font-semibold">Add custom field</h3>
      <FormStatus status={state.status} message={state.message} />
      <ConflictHint message={state.message} />
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="create-key" className="block text-sm font-medium">
            Key
          </label>
          <input
            id="create-key"
            name="key"
            required
            pattern="^[a-z][a-z0-9_]{1,63}$"
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
          <FieldError id="create-key-error" errors={state.fieldErrors?.key} />
        </div>
        <div className="space-y-1">
          <label htmlFor="create-label" className="block text-sm font-medium">
            Label
          </label>
          <input
            id="create-label"
            name="label"
            required
            maxLength={120}
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
          <FieldError
            id="create-label-error"
            errors={state.fieldErrors?.label}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="create-scope" className="block text-sm font-medium">
            Scope
          </label>
          <select
            id="create-scope"
            name="scope"
            defaultValue="BUSINESS"
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          >
            {SCOPES.map((scope) => (
              <option key={scope} value={scope}>
                {scope}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label
            htmlFor="create-dataType"
            className="block text-sm font-medium"
          >
            Data type
          </label>
          <select
            id="create-dataType"
            name="dataType"
            defaultValue="TEXT"
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          >
            {DATA_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="space-y-1">
        <label
          htmlFor="create-description"
          className="block text-sm font-medium"
        >
          Description
        </label>
        <textarea
          id="create-description"
          name="description"
          rows={2}
          maxLength={500}
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="create-options" className="block text-sm font-medium">
          Options{" "}
          <span className="text-[var(--muted)]">
            (one per line, for select types)
          </span>
        </label>
        <textarea
          id="create-options"
          name="options"
          rows={3}
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        />
        <FieldError
          id="create-options-error"
          errors={state.fieldErrors?.options}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="required" />
        Required
      </label>
      <SubmitButton pendingLabel="Creating…">Create field</SubmitButton>
    </DirtyFormShell>
  );
}

function UpdateCustomFieldForm({
  organizationSlug,
  field,
}: {
  organizationSlug: string;
  field: CustomFieldRow;
}) {
  const [state, formAction] = useActionState(
    updateCustomFieldAction,
    initialActionState,
  );

  return (
    <DirtyFormShell
      action={formAction}
      className="space-y-3 rounded-sm border border-[var(--border)] px-3 py-3"
    >
      <FormStatus status={state.status} message={state.message} />
      <ConflictHint message={state.message} />
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input type="hidden" name="fieldId" value={field.id} />
      <input type="hidden" name="expectedVersion" value={field.version} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label
            htmlFor={`update-label-${field.id}`}
            className="block text-sm font-medium"
          >
            Label
          </label>
          <input
            id={`update-label-${field.id}`}
            name="label"
            required
            defaultValue={field.label}
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label
            htmlFor={`update-dataType-${field.id}`}
            className="block text-sm font-medium"
          >
            Data type
          </label>
          <select
            id={`update-dataType-${field.id}`}
            name="dataType"
            defaultValue={field.dataType}
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          >
            {DATA_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="space-y-1">
        <label
          htmlFor={`update-description-${field.id}`}
          className="block text-sm font-medium"
        >
          Description
        </label>
        <textarea
          id={`update-description-${field.id}`}
          name="description"
          rows={2}
          defaultValue={field.description ?? ""}
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        />
      </div>
      <div className="space-y-1">
        <label
          htmlFor={`update-options-${field.id}`}
          className="block text-sm font-medium"
        >
          Options (one per line)
        </label>
        <textarea
          id={`update-options-${field.id}`}
          name="options"
          rows={3}
          defaultValue={optionsToText(field.options)}
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="required"
          defaultChecked={field.required}
        />
        Required
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="isActive"
          defaultChecked={field.isActive}
        />
        Active
      </label>
      <SubmitButton pendingLabel="Saving…">Save field</SubmitButton>
    </DirtyFormShell>
  );
}

function DeactivateCustomFieldForm({
  organizationSlug,
  fieldId,
  expectedVersion,
}: {
  organizationSlug: string;
  fieldId: string;
  expectedVersion: number;
}) {
  const [state, formAction] = useActionState(
    deactivateCustomFieldAction,
    initialActionState,
  );
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input type="hidden" name="fieldId" value={fieldId} />
      <input type="hidden" name="expectedVersion" value={expectedVersion} />
      <FormStatus status={state.status} message={state.message} />
      <ConflictHint message={state.message} />
      <SubmitButton pendingLabel="Deactivating…">Deactivate</SubmitButton>
    </form>
  );
}

function ReorderCustomFieldsForm({
  organizationSlug,
  orderedIds,
}: {
  organizationSlug: string;
  orderedIds: string[];
}) {
  const [state, formAction] = useActionState(
    reorderCustomFieldsAction,
    initialActionState,
  );
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input
        type="hidden"
        name="orderedIdsJson"
        value={JSON.stringify(orderedIds)}
      />
      <FormStatus status={state.status} message={state.message} />
      <SubmitButton pendingLabel="Saving order…">Save order</SubmitButton>
    </form>
  );
}
