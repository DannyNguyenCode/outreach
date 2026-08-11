"use client";

import { useActionState, useMemo, useState } from "react";

import { replaceOperatingHoursAction } from "@/app/actions/business";
import { initialActionState } from "@/app/actions/auth-state";
import { FormStatus } from "@/components/auth/form-status";
import { SubmitButton } from "@/components/auth/submit-button";
import {
  DAYS_OF_WEEK,
  minutesToTimeString,
  type DayOfWeekValue,
} from "@/lib/orgs/business-validation";

type IntervalInput = {
  dayOfWeek: DayOfWeekValue;
  isClosed: boolean;
  startTime: string;
  endTime: string;
};

type HoursFormProps = {
  organizationSlug: string;
  markStep?: boolean;
  customerNote: string;
  initial: Array<{
    dayOfWeek: DayOfWeekValue;
    isClosed: boolean;
    startMinute: number | null;
    endMinute: number | null;
  }>;
};

function buildInitial(initial: HoursFormProps["initial"]): IntervalInput[] {
  return DAYS_OF_WEEK.map((day) => {
    const open = initial.find((i) => i.dayOfWeek === day && !i.isClosed);
    const closed = initial.find((i) => i.dayOfWeek === day && i.isClosed);
    if (open && open.startMinute !== null && open.endMinute !== null) {
      return {
        dayOfWeek: day,
        isClosed: false,
        startTime: minutesToTimeString(open.startMinute),
        endTime:
          open.endMinute === 1440
            ? "24:00"
            : minutesToTimeString(open.endMinute),
      };
    }
    if (closed || initial.length === 0) {
      return {
        dayOfWeek: day,
        isClosed: true,
        startTime: "09:00",
        endTime: "17:00",
      };
    }
    return {
      dayOfWeek: day,
      isClosed: true,
      startTime: "09:00",
      endTime: "17:00",
    };
  });
}

export function OperatingHoursForm({
  organizationSlug,
  markStep = true,
  customerNote,
  initial,
}: HoursFormProps) {
  const [state, formAction] = useActionState(
    replaceOperatingHoursAction,
    initialActionState,
  );
  const [days, setDays] = useState(() => buildInitial(initial));
  const [note, setNote] = useState(customerNote);

  const intervalsJson = useMemo(
    () =>
      JSON.stringify(
        days.map((day) => ({
          dayOfWeek: day.dayOfWeek,
          isClosed: day.isClosed,
          startTime: day.isClosed ? undefined : day.startTime,
          endTime: day.isClosed ? undefined : day.endTime,
          sortOrder: 0,
        })),
      ),
    [days],
  );

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormStatus status={state.status} message={state.message} />
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input type="hidden" name="intervalsJson" value={intervalsJson} />
      <input type="hidden" name="customerNote" value={note} />
      {markStep ? (
        <input type="hidden" name="markStep" value="OPERATING_HOURS" />
      ) : null}

      <p className="text-sm text-[var(--muted)]">
        Times use the organization time zone. Intervals are half-open (start
        inclusive, end exclusive). Overnight hours are not supported.
      </p>

      <ul className="space-y-3">
        {days.map((day, index) => (
          <li
            key={day.dayOfWeek}
            className="grid gap-3 rounded-sm border border-[var(--border)] p-3 sm:grid-cols-[8rem_auto]"
          >
            <div className="text-sm font-medium capitalize">
              {day.dayOfWeek.toLowerCase()}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={day.isClosed}
                  onChange={(event) => {
                    const next = [...days];
                    next[index] = {
                      ...day,
                      isClosed: event.target.checked,
                    };
                    setDays(next);
                  }}
                />
                Closed
              </label>
              {!day.isClosed ? (
                <>
                  <label className="text-sm">
                    Open{" "}
                    <input
                      type="time"
                      value={day.startTime}
                      onChange={(event) => {
                        const next = [...days];
                        next[index] = {
                          ...day,
                          startTime: event.target.value,
                        };
                        setDays(next);
                      }}
                      className="ml-1 rounded-sm border border-[var(--border)] bg-[var(--surface)] px-2 py-1"
                    />
                  </label>
                  <label className="text-sm">
                    Close{" "}
                    <input
                      type="time"
                      value={day.endTime === "24:00" ? "23:59" : day.endTime}
                      onChange={(event) => {
                        const next = [...days];
                        next[index] = {
                          ...day,
                          endTime: event.target.value,
                        };
                        setDays(next);
                      }}
                      className="ml-1 rounded-sm border border-[var(--border)] bg-[var(--surface)] px-2 py-1"
                    />
                  </label>
                </>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      <div className="space-y-1">
        <label htmlFor="customerNote" className="block text-sm font-medium">
          Customer-facing note
        </label>
        <input
          id="customerNote"
          type="text"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={200}
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        />
      </div>

      <SubmitButton pendingLabel="Saving…">Save weekly hours</SubmitButton>
    </form>
  );
}
