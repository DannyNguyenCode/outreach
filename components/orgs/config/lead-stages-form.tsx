"use client";

import { useActionState, useState } from "react";

import { replaceLeadStagesAction } from "@/app/actions/config-3b";
import { initialActionState } from "@/app/actions/auth-state";
import { FormStatus } from "@/components/auth/form-status";
import { SubmitButton } from "@/components/auth/submit-button";
import {
  ConflictHint,
  ReadOnlyNotice,
  useDirtyGuard,
} from "@/components/orgs/config/form-helpers";

const LEAD_STAGE_CLASSIFICATIONS = [
  "NONE",
  "INITIAL",
  "WON",
  "LOST",
  "TERMINAL",
] as const;

export type LeadStageRow = {
  key: string;
  label: string;
  isActive: boolean;
  displayOrder: number;
  classification: string;
  isDefault: boolean;
};

type DraftStage = LeadStageRow;

export function LeadStagesForm({
  organizationSlug,
  canManage,
  initialStages,
}: {
  organizationSlug: string;
  canManage: boolean;
  initialStages: LeadStageRow[];
}) {
  const [stages, setStages] = useState<DraftStage[]>(
    initialStages.length > 0
      ? initialStages
      : [
          {
            key: "new",
            label: "New",
            isActive: true,
            displayOrder: 0,
            classification: "INITIAL",
            isDefault: true,
          },
        ],
  );
  const [dirty, setDirty] = useState(false);
  useDirtyGuard(dirty);
  const [state, formAction] = useActionState(
    replaceLeadStagesAction,
    initialActionState,
  );

  if (!canManage) {
    return (
      <div className="space-y-2">
        <ReadOnlyNotice />
        <ul className="space-y-1 text-sm">
          {initialStages.map((stage) => (
            <li key={stage.key}>
              {stage.label} ({stage.key}){stage.isDefault ? " · default" : ""}
              {!stage.isActive ? " · inactive" : ""}
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
        name="stagesJson"
        value={JSON.stringify(
          stages.map((stage, index) => ({
            ...stage,
            displayOrder: index,
          })),
        )}
      />

      <ul className="space-y-3">
        {stages.map((stage, index) => (
          <li
            key={`${stage.key}-${index}`}
            className="grid gap-2 rounded-sm border border-[var(--border)] px-3 py-3 sm:grid-cols-2"
          >
            <label className="space-y-1 text-sm">
              <span className="font-medium">Key</span>
              <input
                value={stage.key}
                onChange={(event) => {
                  setDirty(true);
                  setStages((current) =>
                    current.map((row, i) =>
                      i === index ? { ...row, key: event.target.value } : row,
                    ),
                  );
                }}
                className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Label</span>
              <input
                value={stage.label}
                onChange={(event) => {
                  setDirty(true);
                  setStages((current) =>
                    current.map((row, i) =>
                      i === index ? { ...row, label: event.target.value } : row,
                    ),
                  );
                }}
                className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Classification</span>
              <select
                value={stage.classification}
                onChange={(event) => {
                  setDirty(true);
                  setStages((current) =>
                    current.map((row, i) =>
                      i === index
                        ? { ...row, classification: event.target.value }
                        : row,
                    ),
                  );
                }}
                className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
              >
                {LEAD_STAGE_CLASSIFICATIONS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={stage.isActive}
                  onChange={(event) => {
                    setDirty(true);
                    setStages((current) =>
                      current.map((row, i) =>
                        i === index
                          ? { ...row, isActive: event.target.checked }
                          : row,
                      ),
                    );
                  }}
                />
                Active
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="defaultStage"
                  checked={stage.isDefault}
                  onChange={() => {
                    setDirty(true);
                    setStages((current) =>
                      current.map((row, i) => ({
                        ...row,
                        isDefault: i === index,
                      })),
                    );
                  }}
                />
                Default
              </label>
              <button
                type="button"
                className="underline-offset-2 hover:underline"
                onClick={() => {
                  setDirty(true);
                  setStages((current) => current.filter((_, i) => i !== index));
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
          setStages((current) => [
            ...current,
            {
              key: `stage_${current.length + 1}`,
              label: "New stage",
              isActive: true,
              displayOrder: current.length,
              classification: "NONE",
              isDefault: current.length === 0,
            },
          ]);
        }}
      >
        Add stage
      </button>

      <SubmitButton pendingLabel="Saving…">Save lead stages</SubmitButton>
    </form>
  );
}
