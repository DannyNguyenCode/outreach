"use client";

import { useActionState, useState } from "react";

import {
  createHolidayClosureAction,
  deactivateHolidayClosureAction,
  updateHolidayClosureAction,
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

export type HolidayClosureRow = {
  id: string;
  localDateStart: string;
  localDateEnd: string | null;
  isClosedAllDay: boolean;
  replacementIntervals: unknown;
  customerNote: string | null;
  internalLabel: string | null;
  isActive: boolean;
  version: number;
};

export function HolidayClosuresManager({
  organizationSlug,
  closures,
  canManage,
  organizationTimeZone,
}: {
  organizationSlug: string;
  closures: HolidayClosureRow[];
  canManage: boolean;
  organizationTimeZone: string | null;
}) {
  return (
    <div className="space-y-6">
      <p className="text-sm text-[var(--muted)]">
        Holiday dates are local calendar days
        {organizationTimeZone ? (
          <>
            {" "}
            in{" "}
            <span className="font-medium text-[var(--foreground)]">
              {organizationTimeZone}
            </span>
          </>
        ) : null}
        . Weekly operating hours stay on the main settings page.
      </p>

      {!canManage ? <ReadOnlyNotice /> : null}

      <ul className="space-y-4">
        {closures.length === 0 ? (
          <li className="text-sm text-[var(--muted)]">
            No holiday closures yet.
          </li>
        ) : (
          closures.map((closure) => (
            <li key={closure.id} className="space-y-2">
              {canManage ? (
                <>
                  <UpdateHolidayClosureForm
                    organizationSlug={organizationSlug}
                    closure={closure}
                  />
                  {closure.isActive ? (
                    <DeactivateHolidayClosureForm
                      organizationSlug={organizationSlug}
                      closureId={closure.id}
                      expectedVersion={closure.version}
                    />
                  ) : null}
                </>
              ) : (
                <div className="rounded-sm border border-[var(--border)] px-3 py-2 text-sm">
                  <p className="font-medium">
                    {closure.internalLabel || "Holiday closure"}
                    {!closure.isActive ? (
                      <span className="ml-2 text-[var(--muted)]">
                        (inactive)
                      </span>
                    ) : null}
                  </p>
                  <p className="text-[var(--muted)]">
                    {closure.localDateStart}
                    {closure.localDateEnd ? ` → ${closure.localDateEnd}` : ""}
                    {closure.isClosedAllDay
                      ? " · Closed all day"
                      : " · Modified hours"}
                  </p>
                  {closure.customerNote ? (
                    <p className="text-[var(--muted)]">
                      {closure.customerNote}
                    </p>
                  ) : null}
                </div>
              )}
            </li>
          ))
        )}
      </ul>

      {canManage ? (
        <CreateHolidayClosureForm organizationSlug={organizationSlug} />
      ) : null}
    </div>
  );
}

function CreateHolidayClosureForm({
  organizationSlug,
}: {
  organizationSlug: string;
}) {
  const [state, formAction] = useActionState(
    createHolidayClosureAction,
    initialActionState,
  );
  const [closedAllDay, setClosedAllDay] = useState(true);

  return (
    <DirtyFormShell action={formAction} className="space-y-3">
      <h3 className="text-sm font-semibold">Add holiday closure</h3>
      <FormStatus status={state.status} message={state.message} />
      <ConflictHint message={state.message} />
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <HolidayClosureFields
        prefix="create"
        fieldErrors={state.fieldErrors}
        closedAllDay={closedAllDay}
        onClosedAllDayChange={setClosedAllDay}
      />
      <SubmitButton pendingLabel="Creating…">Create closure</SubmitButton>
    </DirtyFormShell>
  );
}

function UpdateHolidayClosureForm({
  organizationSlug,
  closure,
}: {
  organizationSlug: string;
  closure: HolidayClosureRow;
}) {
  const [state, formAction] = useActionState(
    updateHolidayClosureAction,
    initialActionState,
  );
  const [closedAllDay, setClosedAllDay] = useState(closure.isClosedAllDay);

  return (
    <DirtyFormShell
      action={formAction}
      className="space-y-3 rounded-sm border border-[var(--border)] px-3 py-3"
    >
      <FormStatus status={state.status} message={state.message} />
      <ConflictHint message={state.message} />
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input type="hidden" name="closureId" value={closure.id} />
      <input type="hidden" name="expectedVersion" value={closure.version} />
      <HolidayClosureFields
        prefix={`update-${closure.id}`}
        fieldErrors={state.fieldErrors}
        closedAllDay={closedAllDay}
        onClosedAllDayChange={setClosedAllDay}
        defaults={closure}
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="isActive"
          defaultChecked={closure.isActive}
        />
        Active
      </label>
      <SubmitButton pendingLabel="Saving…">Save closure</SubmitButton>
    </DirtyFormShell>
  );
}

function DeactivateHolidayClosureForm({
  organizationSlug,
  closureId,
  expectedVersion,
}: {
  organizationSlug: string;
  closureId: string;
  expectedVersion: number;
}) {
  const [state, formAction] = useActionState(
    deactivateHolidayClosureAction,
    initialActionState,
  );
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input type="hidden" name="closureId" value={closureId} />
      <input type="hidden" name="expectedVersion" value={expectedVersion} />
      <FormStatus status={state.status} message={state.message} />
      <ConflictHint message={state.message} />
      <SubmitButton pendingLabel="Deactivating…">Deactivate</SubmitButton>
    </form>
  );
}

function HolidayClosureFields({
  prefix,
  fieldErrors,
  closedAllDay,
  onClosedAllDayChange,
  defaults,
}: {
  prefix: string;
  fieldErrors?: Record<string, string[]>;
  closedAllDay: boolean;
  onClosedAllDayChange: (value: boolean) => void;
  defaults?: Partial<HolidayClosureRow>;
}) {
  const intervalsJson =
    defaults?.replacementIntervals != null
      ? JSON.stringify(defaults.replacementIntervals)
      : "";

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1">
        <label
          htmlFor={`${prefix}-start`}
          className="block text-sm font-medium"
        >
          Start date
        </label>
        <input
          id={`${prefix}-start`}
          name="localDateStart"
          type="date"
          required
          defaultValue={defaults?.localDateStart ?? ""}
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        />
        <FieldError
          id={`${prefix}-start-error`}
          errors={fieldErrors?.localDateStart}
        />
      </div>
      <div className="space-y-1">
        <label htmlFor={`${prefix}-end`} className="block text-sm font-medium">
          End date <span className="text-[var(--muted)]">(optional)</span>
        </label>
        <input
          id={`${prefix}-end`}
          name="localDateEnd"
          type="date"
          defaultValue={defaults?.localDateEnd ?? ""}
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        />
        <FieldError
          id={`${prefix}-end-error`}
          errors={fieldErrors?.localDateEnd}
        />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <input
          type="hidden"
          name="isClosedAllDay"
          value={closedAllDay ? "true" : "false"}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={closedAllDay}
            onChange={(event) => onClosedAllDayChange(event.target.checked)}
          />
          Closed all day
        </label>
      </div>
      {!closedAllDay ? (
        <div className="space-y-1 sm:col-span-2">
          <label
            htmlFor={`${prefix}-intervals`}
            className="block text-sm font-medium"
          >
            Replacement intervals JSON
          </label>
          <textarea
            id={`${prefix}-intervals`}
            name="replacementIntervalsJson"
            rows={3}
            defaultValue={
              intervalsJson || '[{"startMinute":540,"endMinute":720}]'
            }
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-xs"
          />
          <FieldError
            id={`${prefix}-intervals-error`}
            errors={fieldErrors?.replacementIntervals}
          />
        </div>
      ) : (
        <input type="hidden" name="replacementIntervalsJson" value="" />
      )}
      <div className="space-y-1">
        <label
          htmlFor={`${prefix}-label`}
          className="block text-sm font-medium"
        >
          Internal label
        </label>
        <input
          id={`${prefix}-label`}
          name="internalLabel"
          maxLength={120}
          defaultValue={defaults?.internalLabel ?? ""}
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor={`${prefix}-note`} className="block text-sm font-medium">
          Customer note
        </label>
        <input
          id={`${prefix}-note`}
          name="customerNote"
          maxLength={500}
          defaultValue={defaults?.customerNote ?? ""}
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        />
      </div>
    </div>
  );
}
