"use client";

import { useActionState, useEffect, useState } from "react";

import { advanceConfigSectionAction } from "@/app/actions/config-3b";
import { initialActionState } from "@/app/actions/auth-state";
import { FormStatus } from "@/components/auth/form-status";
import { SubmitButton } from "@/components/auth/submit-button";
import type { ConfigSectionValue } from "@/lib/orgs/config-3b-validation";

export function useDirtyGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
}

export function MarkSectionCompleteForm({
  organizationSlug,
  expectedVersion,
  section,
  label = "Mark section complete",
}: {
  organizationSlug: string;
  expectedVersion: number;
  section: ConfigSectionValue;
  label?: string;
}) {
  const [state, formAction] = useActionState(
    advanceConfigSectionAction,
    initialActionState,
  );

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input type="hidden" name="expectedVersion" value={expectedVersion} />
      <input type="hidden" name="section" value={section} />
      <FormStatus status={state.status} message={state.message} />
      <ConflictHint message={state.message} />
      <SubmitButton pendingLabel="Saving…">{label}</SubmitButton>
    </form>
  );
}

export function ConflictHint({ message }: { message?: string }) {
  if (!message || !message.toLowerCase().includes("reload")) return null;
  return (
    <p className="text-sm text-[var(--muted)]">
      Someone else may have saved changes. Reload this page, then try again.
    </p>
  );
}

export function ReadOnlyNotice() {
  return (
    <p className="text-sm text-[var(--muted)]">
      You can view these settings. Only owners and admins can make changes.
    </p>
  );
}

export function DirtyFormShell({
  children,
  className = "space-y-4",
  onSubmit,
  action,
}: {
  children: React.ReactNode;
  className?: string;
  onSubmit?: React.FormEventHandler<HTMLFormElement>;
  action: (formData: FormData) => void;
}) {
  const [dirty, setDirty] = useState(false);
  useDirtyGuard(dirty);

  return (
    <form
      action={action}
      className={className}
      noValidate
      onChange={() => setDirty(true)}
      onSubmit={(event) => {
        setDirty(false);
        onSubmit?.(event);
      }}
    >
      {children}
    </form>
  );
}
