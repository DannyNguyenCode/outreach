"use client";

import { useActionState, useMemo, useState } from "react";

import { mergeProspectsAction } from "@/app/actions/prospects";
import { initialActionState } from "@/app/actions/auth-state";
import { FormStatus } from "@/components/auth/form-status";
import { SubmitButton } from "@/components/auth/submit-button";
import type { MergePreview } from "@/lib/orgs/prospect-merge";

export function ProspectMergeForm({
  organizationSlug,
  preview,
}: {
  organizationSlug: string;
  preview: MergePreview;
}) {
  const [state, formAction] = useActionState(
    mergeProspectsAction,
    initialActionState,
  );
  const [survivorIsLeft, setSurvivorIsLeft] = useState(true);
  const [choices, setChoices] = useState<
    Record<string, "survivor" | "duplicate">
  >(() =>
    Object.fromEntries(
      preview.conflicts.map((conflict) => [conflict.field, "survivor"]),
    ),
  );
  const [confirmed, setConfirmed] = useState(false);

  const survivorId = survivorIsLeft
    ? preview.survivor.id
    : preview.duplicate.id;
  const duplicateId = survivorIsLeft
    ? preview.duplicate.id
    : preview.survivor.id;
  const survivorVersion = survivorIsLeft
    ? preview.survivor.version
    : preview.duplicate.version;
  const duplicateVersion = survivorIsLeft
    ? preview.duplicate.version
    : preview.survivor.version;

  const resolutions = useMemo(() => {
    const customValues: Record<string, "survivor" | "duplicate"> = {};
    const fields: Record<string, "survivor" | "duplicate"> = {};
    for (const [field, choice] of Object.entries(choices)) {
      const mapped = survivorIsLeft
        ? choice
        : choice === "survivor"
          ? "duplicate"
          : "survivor";
      if (field.startsWith("custom:")) {
        customValues[field.slice(7)] = mapped;
      } else {
        fields[field] = mapped;
      }
    }
    return JSON.stringify({ ...fields, customValues });
  }, [choices, survivorIsLeft]);

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input type="hidden" name="survivorProspectId" value={survivorId} />
      <input type="hidden" name="duplicateProspectId" value={duplicateId} />
      <input
        type="hidden"
        name="expectedSurvivorVersion"
        value={String(survivorVersion)}
      />
      <input
        type="hidden"
        name="expectedDuplicateVersion"
        value={String(duplicateVersion)}
      />
      <input type="hidden" name="resolutions" value={resolutions} />
      <FormStatus status={state.status} message={state.message} />

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Surviving prospect</legend>
        <p className="text-sm text-[var(--muted)]">
          The other record is kept as merged history and is not deleted.
        </p>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name="survivorChoice"
            checked={survivorIsLeft}
            onChange={() => setSurvivorIsLeft(true)}
          />
          <span>
            Keep {preview.survivor.displayName} (contacts:{" "}
            {preview.contacts.survivorCount})
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name="survivorChoice"
            checked={!survivorIsLeft}
            onChange={() => setSurvivorIsLeft(false)}
          />
          <span>
            Keep {preview.duplicate.displayName} (contacts:{" "}
            {preview.contacts.duplicateCount})
          </span>
        </label>
      </fieldset>

      {preview.conflicts.length > 0 ? (
        <fieldset className="space-y-4">
          <legend className="text-sm font-medium">Conflicting fields</legend>
          {preview.conflicts.map((conflict) => (
            <div key={conflict.field} className="space-y-2">
              <p className="text-sm font-medium">{conflict.field}</p>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name={`conflict-${conflict.field}`}
                  checked={
                    (choices[conflict.field] ?? "survivor") === "survivor"
                  }
                  onChange={() =>
                    setChoices((current) => ({
                      ...current,
                      [conflict.field]: "survivor",
                    }))
                  }
                />
                <span>
                  {preview.survivor.displayName}:{" "}
                  {conflict.survivorValue || "—"}
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name={`conflict-${conflict.field}`}
                  checked={choices[conflict.field] === "duplicate"}
                  onChange={() =>
                    setChoices((current) => ({
                      ...current,
                      [conflict.field]: "duplicate",
                    }))
                  }
                />
                <span>
                  {preview.duplicate.displayName}:{" "}
                  {conflict.duplicateValue || "—"}
                </span>
              </label>
            </div>
          ))}
        </fieldset>
      ) : (
        <p className="text-sm text-[var(--muted)]">
          No conflicting prospect fields. Distinct contacts and communication
          points will be kept. Identical communication points will not be
          duplicated.
        </p>
      )}

      <p className="text-sm text-[var(--muted)]">
        Resulting contacts:{" "}
        {preview.contacts.survivorCount + preview.contacts.duplicateCount}.
        Identical prospect-level channels skipped:{" "}
        {preview.channels.duplicateIdenticalCount}.
      </p>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="confirmMerge"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        <span>
          I have reviewed the surviving record, conflicts, and contacts. Merge
          these prospects.
        </span>
      </label>
      <SubmitButton pendingLabel="Merging…">Confirm merge</SubmitButton>
    </form>
  );
}
