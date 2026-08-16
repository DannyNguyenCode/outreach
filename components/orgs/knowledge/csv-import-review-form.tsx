"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { confirmCsvImportAction } from "@/app/actions/csv-import";
import { initialActionState } from "@/app/actions/auth-state";
import { FieldError } from "@/components/auth/field-error";
import { FormStatus } from "@/components/auth/form-status";
import { SubmitButton } from "@/components/auth/submit-button";
import {
  CSV_IMPORT_CONFIRMATION_LANGUAGE_VERSION,
  CSV_IMPORT_CONFIRMATION_STATEMENT,
} from "@/lib/orgs/csv-import-confirmation";

export function CsvImportReviewForm({
  organizationSlug,
  importId,
  expectedImportIdentity,
}: {
  organizationSlug: string;
  importId: string;
  expectedImportIdentity: string;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(
    confirmCsvImportAction,
    initialActionState,
  );
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.status === "error" || state.status === "success") {
      summaryRef.current?.focus();
    }
    if (state.status === "success") {
      router.refresh();
    }
  }, [router, state.status, state.message]);
  return (
    <form action={formAction} className="space-y-3" noValidate>
      <div ref={summaryRef} tabIndex={-1}>
        <FormStatus status={state.status} message={state.message} />
      </div>
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input type="hidden" name="importId" value={importId} />
      <input
        type="hidden"
        name="expectedImportIdentity"
        value={expectedImportIdentity}
      />
      <fieldset className="space-y-2 rounded-sm border border-[var(--border)] p-3">
        <legend className="text-sm font-medium">Required acknowledgment</legend>
        <p className="text-sm leading-6">{CSV_IMPORT_CONFIRMATION_STATEMENT}</p>
        <p className="text-xs text-[var(--muted)]">
          Confirmation language version{" "}
          {CSV_IMPORT_CONFIRMATION_LANGUAGE_VERSION}. Confirm and activate
          publishes the reviewed rows. Outreach does not independently determine
          whether this information is factually true.
        </p>
        <div className="flex items-start gap-2">
          <input
            id="acknowledgeAccuracy"
            name="acknowledgeAccuracy"
            type="checkbox"
            value="on"
            required
            className="mt-1"
          />
          <label htmlFor="acknowledgeAccuracy" className="text-sm">
            I confirm that I am authorized to provide this information and have
            reviewed it for accuracy.
          </label>
        </div>
        <FieldError
          id="acknowledgeAccuracy-error"
          errors={state.fieldErrors?.acknowledgeAccuracy}
        />
      </fieldset>
      <SubmitButton pendingLabel="Confirming…">
        Confirm and activate
      </SubmitButton>
    </form>
  );
}
