"use client";

import { useActionState } from "react";

import { updateNotificationDefaultsAction } from "@/app/actions/config-3b";
import { initialActionState } from "@/app/actions/auth-state";
import { FieldError } from "@/components/auth/field-error";
import { FormStatus } from "@/components/auth/form-status";
import { SubmitButton } from "@/components/auth/submit-button";
import {
  ConflictHint,
  DirtyFormShell,
  ReadOnlyNotice,
} from "@/components/orgs/config/form-helpers";

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function NotificationDefaultsForm({
  organizationSlug,
  expectedVersion,
  canManage,
  defaults,
}: {
  organizationSlug: string;
  expectedVersion: number;
  canManage: boolean;
  defaults: {
    escalationContactLabel: string | null;
    escalationContactEmail: string | null;
    notificationCategories: unknown;
    enabledChannels: unknown;
    thresholdPlaceholders: unknown;
  };
}) {
  const [state, formAction] = useActionState(
    updateNotificationDefaultsAction,
    initialActionState,
  );
  const categories = asStringArray(defaults.notificationCategories);
  const channels = asStringArray(defaults.enabledChannels);
  const thresholdsJson =
    defaults.thresholdPlaceholders != null
      ? JSON.stringify(defaults.thresholdPlaceholders)
      : "{}";

  if (!canManage) {
    return (
      <div className="space-y-2 text-sm">
        <ReadOnlyNotice />
        <p>Escalation: {defaults.escalationContactLabel || "—"}</p>
        <p>Email: {defaults.escalationContactEmail || "—"}</p>
        <p>Channels: {channels.join(", ") || "—"}</p>
      </div>
    );
  }

  return (
    <DirtyFormShell action={formAction} className="space-y-4">
      <FormStatus status={state.status} message={state.message} />
      <ConflictHint message={state.message} />
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input type="hidden" name="expectedVersion" value={expectedVersion} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label
            htmlFor="escalationContactLabel"
            className="block text-sm font-medium"
          >
            Escalation contact label
          </label>
          <input
            id="escalationContactLabel"
            name="escalationContactLabel"
            maxLength={120}
            defaultValue={defaults.escalationContactLabel ?? ""}
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label
            htmlFor="escalationContactEmail"
            className="block text-sm font-medium"
          >
            Escalation contact email
          </label>
          <input
            id="escalationContactEmail"
            name="escalationContactEmail"
            type="email"
            defaultValue={defaults.escalationContactEmail ?? ""}
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
          <FieldError
            id="escalationContactEmail-error"
            errors={state.fieldErrors?.escalationContactEmail}
          />
        </div>
      </div>

      <div className="space-y-1">
        <label
          htmlFor="notificationCategories"
          className="block text-sm font-medium"
        >
          Notification categories{" "}
          <span className="text-[var(--muted)]">(comma-separated)</span>
        </label>
        <input
          id="notificationCategories"
          name="notificationCategories"
          defaultValue={categories.join(", ")}
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Enabled channels</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="enabledChannels"
            value="in_app"
            defaultChecked={
              channels.includes("in_app") || channels.length === 0
            }
          />
          In-app
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="enabledChannels"
            value="email"
            defaultChecked={channels.includes("email")}
          />
          Email
        </label>
      </fieldset>

      <div className="space-y-1">
        <label
          htmlFor="thresholdPlaceholdersJson"
          className="block text-sm font-medium"
        >
          Threshold placeholders (JSON)
        </label>
        <textarea
          id="thresholdPlaceholdersJson"
          name="thresholdPlaceholdersJson"
          rows={3}
          defaultValue={thresholdsJson}
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-xs"
        />
      </div>

      <SubmitButton pendingLabel="Saving…">
        Save notification defaults
      </SubmitButton>
    </DirtyFormShell>
  );
}
