"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useState } from "react";

import type { ActionState } from "@/app/actions/auth-state";
import { initialActionState } from "@/app/actions/auth-state";
import { FieldError } from "@/components/auth/field-error";
import { FormStatus } from "@/components/auth/form-status";
import { SubmitButton } from "@/components/auth/submit-button";
import {
  ConflictHint,
  DirtyFormShell,
} from "@/components/orgs/config/form-helpers";

type DraftPassage = { citationKey?: string; body: string };
type DraftSection = {
  citationKey?: string;
  title: string;
  passages: DraftPassage[];
};

function DstOccurrenceSelect({
  id,
  name,
  value,
  onChange,
}: {
  id: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-medium">
        If this local time occurs twice
      </label>
      <select
        id={id}
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
      >
        <option value="">Not a repeated time</option>
        <option value="earlier">Earlier occurrence</option>
        <option value="later">Later occurrence</option>
      </select>
    </div>
  );
}

export function KnowledgeEditorForm({
  organizationSlug,
  action,
  submitLabel,
  pendingLabel,
  sourceId,
  versionId,
  expectedDraftRevision,
  organizationTimeZone,
  settingsHref,
  defaults,
}: {
  organizationSlug: string;
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel: string;
  pendingLabel: string;
  sourceId?: string;
  versionId?: string;
  expectedDraftRevision?: number;
  organizationTimeZone: string | null;
  settingsHref: string;
  defaults: {
    title: string;
    effectiveFrom: string;
    effectiveUntil: string;
    effectiveFromDisambiguation?: string;
    effectiveUntilDisambiguation?: string;
    sections: DraftSection[];
  };
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  const router = useRouter();
  const [title, setTitle] = useState(defaults.title);
  const [effectiveFrom, setEffectiveFrom] = useState(defaults.effectiveFrom);
  const [effectiveUntil, setEffectiveUntil] = useState(defaults.effectiveUntil);
  const [effectiveFromDisambiguation, setEffectiveFromDisambiguation] =
    useState(defaults.effectiveFromDisambiguation ?? "");
  const [effectiveUntilDisambiguation, setEffectiveUntilDisambiguation] =
    useState(defaults.effectiveUntilDisambiguation ?? "");
  const [sections, setSections] = useState<DraftSection[]>(
    defaults.sections.length > 0
      ? defaults.sections
      : [{ title: "", passages: [{ body: "" }] }],
  );

  const contentJson = useMemo(() => JSON.stringify({ sections }), [sections]);

  useEffect(() => {
    if (
      state.status !== "success" ||
      !state.data ||
      typeof state.data !== "object"
    ) {
      return;
    }
    const data = state.data as { sourceId?: unknown; versionId?: unknown };
    if (
      typeof data.sourceId === "string" &&
      typeof data.versionId === "string"
    ) {
      router.push(
        `/app/orgs/${organizationSlug}/knowledge/${data.sourceId}/versions/${data.versionId}`,
      );
    }
  }, [organizationSlug, router, state.data, state.status]);

  function updateSection(index: number, patch: Partial<DraftSection>) {
    setSections((current) =>
      current.map((section, i) =>
        i === index ? { ...section, ...patch } : section,
      ),
    );
  }

  function updatePassage(
    sectionIndex: number,
    passageIndex: number,
    body: string,
  ) {
    setSections((current) =>
      current.map((section, i) =>
        i === sectionIndex
          ? {
              ...section,
              passages: section.passages.map((passage, j) =>
                j === passageIndex ? { ...passage, body } : passage,
              ),
            }
          : section,
      ),
    );
  }

  return (
    <DirtyFormShell action={formAction} className="space-y-4">
      <FormStatus status={state.status} message={state.message} />
      <ConflictHint message={state.message} />
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      {sourceId ? (
        <input type="hidden" name="sourceId" value={sourceId} />
      ) : null}
      {versionId ? (
        <input type="hidden" name="versionId" value={versionId} />
      ) : null}
      {expectedDraftRevision !== undefined ? (
        <input
          type="hidden"
          name="expectedDraftRevision"
          value={expectedDraftRevision}
        />
      ) : null}
      <input type="hidden" name="contentJson" value={contentJson} />

      <div className="space-y-1">
        <label htmlFor="knowledge-title" className="block text-sm font-medium">
          Title
        </label>
        <input
          id="knowledge-title"
          name="title"
          type="text"
          required
          maxLength={200}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        />
        <FieldError id="title-error" errors={state.fieldErrors?.title} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="effectiveFrom" className="block text-sm font-medium">
            Effective from (optional)
          </label>
          <input
            id="effectiveFrom"
            name="effectiveFrom"
            type="datetime-local"
            value={effectiveFrom}
            onChange={(event) => setEffectiveFrom(event.target.value)}
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
          <DstOccurrenceSelect
            id="effectiveFromDisambiguation"
            name="effectiveFromDisambiguation"
            value={effectiveFromDisambiguation}
            onChange={setEffectiveFromDisambiguation}
          />
          <FieldError
            id="effectiveFrom-error"
            errors={state.fieldErrors?.effectiveFrom}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="effectiveUntil" className="block text-sm font-medium">
            Effective until (optional)
          </label>
          <input
            id="effectiveUntil"
            name="effectiveUntil"
            type="datetime-local"
            value={effectiveUntil}
            onChange={(event) => setEffectiveUntil(event.target.value)}
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
          <DstOccurrenceSelect
            id="effectiveUntilDisambiguation"
            name="effectiveUntilDisambiguation"
            value={effectiveUntilDisambiguation}
            onChange={setEffectiveUntilDisambiguation}
          />
          <FieldError
            id="effectiveUntil-error"
            errors={state.fieldErrors?.effectiveUntil}
          />
        </div>
      </div>
      <p className="text-sm text-[var(--muted)]">
        {organizationTimeZone ? (
          <>Times are in {organizationTimeZone}.</>
        ) : (
          <>
            Set this organization&apos;s time zone in{" "}
            <a
              href={settingsHref}
              className="underline-offset-2 hover:underline"
            >
              settings
            </a>{" "}
            before using effective dates. Undated drafts can still be saved.
          </>
        )}
      </p>

      <fieldset className="space-y-4">
        <legend className="text-sm font-medium">Sections and passages</legend>
        <FieldError id="sections-error" errors={state.fieldErrors?.sections} />
        {sections.map((section, sectionIndex) => (
          <div
            key={`${section.citationKey ?? "new"}-${sectionIndex}`}
            className="space-y-3 rounded-sm border border-[var(--border)] p-3"
          >
            <div className="space-y-1">
              <label
                htmlFor={`section-title-${sectionIndex}`}
                className="block text-sm font-medium"
              >
                Section {sectionIndex + 1} title
              </label>
              <input
                id={`section-title-${sectionIndex}`}
                type="text"
                maxLength={200}
                value={section.title}
                onChange={(event) =>
                  updateSection(sectionIndex, { title: event.target.value })
                }
                className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
              />
            </div>
            {section.passages.map((passage, passageIndex) => (
              <div
                key={`${passage.citationKey ?? "new"}-${passageIndex}`}
                className="space-y-1"
              >
                <label
                  htmlFor={`passage-${sectionIndex}-${passageIndex}`}
                  className="block text-sm font-medium"
                >
                  Passage {passageIndex + 1}
                </label>
                <textarea
                  id={`passage-${sectionIndex}-${passageIndex}`}
                  rows={5}
                  maxLength={8000}
                  value={passage.body}
                  onChange={(event) =>
                    updatePassage(
                      sectionIndex,
                      passageIndex,
                      event.target.value,
                    )
                  }
                  className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                />
                {section.passages.length > 1 ? (
                  <button
                    type="button"
                    className="text-sm underline-offset-2 hover:underline"
                    onClick={() =>
                      updateSection(sectionIndex, {
                        passages: section.passages.filter(
                          (_, i) => i !== passageIndex,
                        ),
                      })
                    }
                  >
                    Remove passage
                  </button>
                ) : null}
              </div>
            ))}
            <div className="flex flex-wrap gap-3 text-sm">
              <button
                type="button"
                className="underline-offset-2 hover:underline"
                onClick={() =>
                  updateSection(sectionIndex, {
                    passages: [...section.passages, { body: "" }],
                  })
                }
              >
                Add passage
              </button>
              {sections.length > 1 ? (
                <button
                  type="button"
                  className="underline-offset-2 hover:underline"
                  onClick={() =>
                    setSections((current) =>
                      current.filter((_, i) => i !== sectionIndex),
                    )
                  }
                >
                  Remove section
                </button>
              ) : null}
            </div>
          </div>
        ))}
        <button
          type="button"
          className="text-sm underline-offset-2 hover:underline"
          onClick={() =>
            setSections((current) => [
              ...current,
              { title: "", passages: [{ body: "" }] },
            ])
          }
        >
          Add section
        </button>
      </fieldset>

      <SubmitButton pendingLabel={pendingLabel}>{submitLabel}</SubmitButton>
    </DirtyFormShell>
  );
}
