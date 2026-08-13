"use client";

import { useActionState } from "react";

import { updateBusinessBasicsAction } from "@/app/actions/business";
import { initialActionState } from "@/app/actions/auth-state";
import { FieldError } from "@/components/auth/field-error";
import { FormStatus } from "@/components/auth/form-status";
import { SubmitButton } from "@/components/auth/submit-button";

type BasicsFormProps = {
  organizationSlug: string;
  expectedVersion: number;
  onboardingExpectedVersion?: number;
  markStep?: boolean;
  defaults: {
    legalName: string;
    displayName: string;
    description: string;
    industry: string;
    businessType: string;
    websiteUrl: string;
    logoUrl: string;
    organizationName: string;
  };
};

export function BusinessBasicsForm({
  organizationSlug,
  expectedVersion,
  onboardingExpectedVersion,
  markStep = true,
  defaults,
}: BasicsFormProps) {
  const [state, formAction] = useActionState(
    updateBusinessBasicsAction,
    initialActionState,
  );

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormStatus status={state.status} message={state.message} />
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input type="hidden" name="expectedVersion" value={expectedVersion} />
      {markStep && onboardingExpectedVersion !== undefined ? (
        <>
          <input type="hidden" name="markStep" value="BUSINESS_BASICS" />
          <input
            type="hidden"
            name="onboardingExpectedVersion"
            value={onboardingExpectedVersion}
          />
        </>
      ) : null}

      <p className="text-sm text-[var(--muted)]">
        Organization system name:{" "}
        <span className="font-medium text-[var(--foreground)]">
          {defaults.organizationName}
        </span>
        . Customer-facing display name can differ.
      </p>

      <div className="space-y-1">
        <label htmlFor="legalName" className="block text-sm font-medium">
          Legal / registered name
        </label>
        <input
          id="legalName"
          name="legalName"
          type="text"
          defaultValue={defaults.legalName}
          maxLength={120}
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        />
        <FieldError
          id="legalName-error"
          errors={state.fieldErrors?.legalName}
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="displayName" className="block text-sm font-medium">
          Customer-facing display name
        </label>
        <input
          id="displayName"
          name="displayName"
          type="text"
          required
          defaultValue={defaults.displayName}
          maxLength={120}
          aria-invalid={Boolean(state.fieldErrors?.displayName)}
          aria-describedby={
            state.fieldErrors?.displayName ? "displayName-error" : undefined
          }
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        />
        <FieldError
          id="displayName-error"
          errors={state.fieldErrors?.displayName}
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="description" className="block text-sm font-medium">
          Short description
        </label>
        <textarea
          id="description"
          name="description"
          rows={3}
          defaultValue={defaults.description}
          maxLength={1000}
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        />
        <FieldError
          id="description-error"
          errors={state.fieldErrors?.description}
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="industry" className="block text-sm font-medium">
          Industry / category
        </label>
        <input
          id="industry"
          name="industry"
          type="text"
          required
          defaultValue={defaults.industry}
          maxLength={80}
          aria-invalid={Boolean(state.fieldErrors?.industry)}
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        />
        <FieldError id="industry-error" errors={state.fieldErrors?.industry} />
      </div>

      <div className="space-y-1">
        <label htmlFor="businessType" className="block text-sm font-medium">
          Business type
        </label>
        <select
          id="businessType"
          name="businessType"
          required
          defaultValue={defaults.businessType || "SERVICES"}
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        >
          <option value="SERVICES">Services</option>
          <option value="PRODUCTS">Products</option>
          <option value="BOTH">Services and products</option>
        </select>
        <FieldError
          id="businessType-error"
          errors={state.fieldErrors?.businessType}
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="websiteUrl" className="block text-sm font-medium">
          Website URL
        </label>
        <input
          id="websiteUrl"
          name="websiteUrl"
          type="url"
          defaultValue={defaults.websiteUrl}
          placeholder="https://example.com"
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        />
        <FieldError
          id="websiteUrl-error"
          errors={state.fieldErrors?.websiteUrl}
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="logoUrl" className="block text-sm font-medium">
          Logo URL{" "}
          <span className="text-[var(--muted)]">(optional, https)</span>
        </label>
        <input
          id="logoUrl"
          name="logoUrl"
          type="url"
          defaultValue={defaults.logoUrl}
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        />
        <FieldError id="logoUrl-error" errors={state.fieldErrors?.logoUrl} />
      </div>

      <SubmitButton pendingLabel="Saving…">Save and continue</SubmitButton>
    </form>
  );
}
