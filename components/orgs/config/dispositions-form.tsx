"use client";

import { useActionState, useState } from "react";

import { replaceCallDispositionsAction } from "@/app/actions/config-3b";
import { initialActionState } from "@/app/actions/auth-state";
import { FormStatus } from "@/components/auth/form-status";
import { SubmitButton } from "@/components/auth/submit-button";
import {
  ConflictHint,
  ReadOnlyNotice,
  useDirtyGuard,
} from "@/components/orgs/config/form-helpers";

export type DispositionRow = {
  key: string;
  label: string;
  isActive: boolean;
  displayOrder: number;
  expectsFollowUp: boolean;
  isTerminal: boolean;
};

export function DispositionsForm({
  organizationSlug,
  canManage,
  initialDispositions,
}: {
  organizationSlug: string;
  canManage: boolean;
  initialDispositions: DispositionRow[];
}) {
  const [rows, setRows] = useState<DispositionRow[]>(
    initialDispositions.length > 0
      ? initialDispositions
      : [
          {
            key: "no_answer",
            label: "No answer",
            isActive: true,
            displayOrder: 0,
            expectsFollowUp: true,
            isTerminal: false,
          },
        ],
  );
  const [dirty, setDirty] = useState(false);
  useDirtyGuard(dirty);
  const [state, formAction] = useActionState(
    replaceCallDispositionsAction,
    initialActionState,
  );

  if (!canManage) {
    return (
      <div className="space-y-2">
        <ReadOnlyNotice />
        <ul className="space-y-1 text-sm">
          {initialDispositions.map((row) => (
            <li key={row.key}>
              {row.label} ({row.key}){row.expectsFollowUp ? " · follow-up" : ""}
              {row.isTerminal ? " · terminal" : ""}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      className="space-y-4"
      onChange={() => setDirty(true)}
      onSubmit={() => setDirty(false)}
    >
      <FormStatus status={state.status} message={state.message} />
      <ConflictHint message={state.message} />
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input
        type="hidden"
        name="dispositionsJson"
        value={JSON.stringify(
          rows.map((row, index) => ({ ...row, displayOrder: index })),
        )}
      />

      <ul className="space-y-3">
        {rows.map((row, index) => (
          <li
            key={`${row.key}-${index}`}
            className="grid gap-2 rounded-sm border border-[var(--border)] px-3 py-3 sm:grid-cols-2"
          >
            <label className="space-y-1 text-sm">
              <span className="font-medium">Key</span>
              <input
                value={row.key}
                onChange={(event) => {
                  setDirty(true);
                  setRows((current) =>
                    current.map((item, i) =>
                      i === index ? { ...item, key: event.target.value } : item,
                    ),
                  );
                }}
                className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Label</span>
              <input
                value={row.label}
                onChange={(event) => {
                  setDirty(true);
                  setRows((current) =>
                    current.map((item, i) =>
                      i === index
                        ? { ...item, label: event.target.value }
                        : item,
                    ),
                  );
                }}
                className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
              />
            </label>
            <div className="flex flex-wrap items-center gap-4 text-sm sm:col-span-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={row.isActive}
                  onChange={(event) => {
                    setDirty(true);
                    setRows((current) =>
                      current.map((item, i) =>
                        i === index
                          ? { ...item, isActive: event.target.checked }
                          : item,
                      ),
                    );
                  }}
                />
                Active
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={row.expectsFollowUp}
                  onChange={(event) => {
                    setDirty(true);
                    setRows((current) =>
                      current.map((item, i) =>
                        i === index
                          ? { ...item, expectsFollowUp: event.target.checked }
                          : item,
                      ),
                    );
                  }}
                />
                Expects follow-up
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={row.isTerminal}
                  onChange={(event) => {
                    setDirty(true);
                    setRows((current) =>
                      current.map((item, i) =>
                        i === index
                          ? { ...item, isTerminal: event.target.checked }
                          : item,
                      ),
                    );
                  }}
                />
                Terminal
              </label>
              <button
                type="button"
                className="underline-offset-2 hover:underline"
                onClick={() => {
                  setDirty(true);
                  setRows((current) => current.filter((_, i) => i !== index));
                }}
              >
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>

      <button
        type="button"
        className="text-sm underline-offset-2 hover:underline"
        onClick={() => {
          setDirty(true);
          setRows((current) => [
            ...current,
            {
              key: `disposition_${current.length + 1}`,
              label: "New disposition",
              isActive: true,
              displayOrder: current.length,
              expectsFollowUp: false,
              isTerminal: false,
            },
          ]);
        }}
      >
        Add disposition
      </button>

      <SubmitButton pendingLabel="Saving…">Save dispositions</SubmitButton>
    </form>
  );
}
