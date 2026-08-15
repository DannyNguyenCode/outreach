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
import {
  OFFERING_BILLING_FREQUENCIES,
  OFFERING_PRICING_MODELS,
  OFFERING_TYPES,
} from "@/lib/orgs/offering-validation";

type DraftPrice = {
  label?: string | null;
  amount: string;
  currencyCode: string;
  billingFrequency: string;
  intervalCount?: number | null;
  isActive?: boolean;
  effectiveFrom?: string | null;
  effectiveUntil?: string | null;
  clientKey?: string;
};

type DraftFeature = {
  featureKey?: string;
  name: string;
  value?: string | null;
  unit?: string | null;
};

export type OfferingEditorDefaults = {
  name: string;
  description: string;
  offeringType: string;
  pricingModel: string;
  quoteRequired: boolean;
  effectiveFrom: string;
  effectiveUntil: string;
  prices: DraftPrice[];
  features: DraftFeature[];
  variants: unknown[];
  eligibility: unknown;
  customValues: unknown[];
};

export function OfferingEditorForm({
  organizationSlug,
  action,
  offeringId,
  versionId,
  expectedDraftRevision,
  defaults,
}: {
  organizationSlug: string;
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  offeringId?: string;
  versionId?: string;
  expectedDraftRevision?: number;
  defaults: OfferingEditorDefaults;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  const router = useRouter();
  const [description, setDescription] = useState(defaults.description);
  const [prices, setPrices] = useState(defaults.prices);
  const [features, setFeatures] = useState(defaults.features);
  const contentJson = useMemo(
    () =>
      JSON.stringify({
        description,
        prices,
        features,
        variants: defaults.variants,
        eligibility: defaults.eligibility,
        customValues: defaults.customValues,
      }),
    [defaults, description, features, prices],
  );

  useEffect(() => {
    if (state.status !== "success" || !state.data) return;
    const data = state.data as { offeringId?: unknown; versionId?: unknown };
    if (
      typeof data.offeringId === "string" &&
      typeof data.versionId === "string"
    ) {
      router.push(
        `/app/orgs/${organizationSlug}/knowledge/offerings/${data.offeringId}/versions/${data.versionId}`,
      );
    }
  }, [organizationSlug, router, state.data, state.status]);

  return (
    <DirtyFormShell action={formAction} className="space-y-4">
      <FormStatus status={state.status} message={state.message} />
      <ConflictHint message={state.message} />
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input type="hidden" name="contentJson" value={contentJson} />
      {offeringId ? (
        <input type="hidden" name="offeringId" value={offeringId} />
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

      <div className="space-y-1">
        <label htmlFor="offering-name" className="block text-sm font-medium">
          Name
        </label>
        <input
          id="offering-name"
          name="name"
          required
          maxLength={200}
          defaultValue={defaults.name}
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        />
        <FieldError id="name-error" errors={state.fieldErrors?.name} />
      </div>
      <div className="space-y-1">
        <label
          htmlFor="offering-description"
          className="block text-sm font-medium"
        >
          Description
        </label>
        <textarea
          id="offering-description"
          rows={4}
          maxLength={4000}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Type</span>
          <select
            name="offeringType"
            defaultValue={defaults.offeringType}
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
          >
            {OFFERING_TYPES.map((value) => (
              <option key={value} value={value}>
                {value.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Pricing model</span>
          <select
            name="pricingModel"
            defaultValue={defaults.pricingModel}
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
          >
            {OFFERING_PRICING_MODELS.map((value) => (
              <option key={value} value={value}>
                {value.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input
            type="checkbox"
            name="quoteRequired"
            defaultChecked={defaults.quoteRequired}
          />
          Quote required
        </label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Effective from (optional)</span>
          <input
            type="datetime-local"
            name="effectiveFrom"
            defaultValue={defaults.effectiveFrom}
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Effective until (optional)</span>
          <input
            type="datetime-local"
            name="effectiveUntil"
            defaultValue={defaults.effectiveUntil}
            className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
          />
        </label>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Prices</legend>
        {prices.map((price, index) => (
          <div
            key={price.clientKey ?? index}
            className="grid gap-3 rounded-sm border border-[var(--border)] p-3 sm:grid-cols-4"
          >
            <label className="space-y-1 text-sm">
              <span className="block">Amount</span>
              <input
                aria-label={`Price ${index + 1} amount`}
                value={price.amount}
                onChange={(event) =>
                  setPrices((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index
                        ? { ...item, amount: event.target.value }
                        : item,
                    ),
                  )
                }
                className="w-full rounded-sm border border-[var(--border)] px-2 py-1"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="block">Currency</span>
              <input
                aria-label={`Price ${index + 1} currency`}
                maxLength={3}
                value={price.currencyCode}
                onChange={(event) =>
                  setPrices((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index
                        ? { ...item, currencyCode: event.target.value }
                        : item,
                    ),
                  )
                }
                className="w-full rounded-sm border border-[var(--border)] px-2 py-1"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="block">Frequency</span>
              <select
                aria-label={`Price ${index + 1} frequency`}
                value={price.billingFrequency}
                onChange={(event) =>
                  setPrices((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index
                        ? { ...item, billingFrequency: event.target.value }
                        : item,
                    ),
                  )
                }
                className="w-full rounded-sm border border-[var(--border)] px-2 py-1"
              >
                {OFFERING_BILLING_FREQUENCIES.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() =>
                setPrices((current) =>
                  current.filter((_, itemIndex) => itemIndex !== index),
                )
              }
              className="self-end text-sm underline-offset-2 hover:underline"
            >
              Remove price
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            setPrices((current) => [
              ...current,
              {
                amount: "0",
                currencyCode: "USD",
                billingFrequency: "ONE_TIME",
                isActive: true,
                clientKey: `price_${current.length + 1}`,
              },
            ])
          }
          className="text-sm underline-offset-2 hover:underline"
        >
          Add price
        </button>
        <FieldError id="prices-error" errors={state.fieldErrors?.prices} />
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Features</legend>
        {features.map((feature, index) => (
          <div
            key={`${feature.featureKey ?? "new"}-${index}`}
            className="grid gap-3 rounded-sm border border-[var(--border)] p-3 sm:grid-cols-3"
          >
            <input
              aria-label={`Feature ${index + 1} name`}
              placeholder="Feature name"
              value={feature.name}
              onChange={(event) =>
                setFeatures((current) =>
                  current.map((item, itemIndex) =>
                    itemIndex === index
                      ? { ...item, name: event.target.value }
                      : item,
                  ),
                )
              }
              className="rounded-sm border border-[var(--border)] px-2 py-1 text-sm"
            />
            <input
              aria-label={`Feature ${index + 1} value`}
              placeholder="Value"
              value={feature.value ?? ""}
              onChange={(event) =>
                setFeatures((current) =>
                  current.map((item, itemIndex) =>
                    itemIndex === index
                      ? { ...item, value: event.target.value }
                      : item,
                  ),
                )
              }
              className="rounded-sm border border-[var(--border)] px-2 py-1 text-sm"
            />
            <button
              type="button"
              onClick={() =>
                setFeatures((current) =>
                  current.filter((_, itemIndex) => itemIndex !== index),
                )
              }
              className="text-sm underline-offset-2 hover:underline"
            >
              Remove feature
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            setFeatures((current) => [...current, { name: "", value: "" }])
          }
          className="text-sm underline-offset-2 hover:underline"
        >
          Add feature
        </button>
      </fieldset>
      <SubmitButton pendingLabel="Saving…">Save offering draft</SubmitButton>
    </DirtyFormShell>
  );
}
