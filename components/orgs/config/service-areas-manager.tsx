"use client";

import { useActionState, useMemo, useState } from "react";

import {
  createServiceAreaAction,
  deactivateServiceAreaAction,
  reorderServiceAreasAction,
  updateServiceAreaAction,
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

export type ServiceAreaRow = {
  id: string;
  label: string;
  countryCode: string | null;
  region: string | null;
  city: string | null;
  postalPrefix: string | null;
  isRemote: boolean;
  isActive: boolean;
  version: number;
  displayOrder: number;
};

export function ServiceAreasManager({
  organizationSlug,
  areas,
  canManage,
}: {
  organizationSlug: string;
  areas: ServiceAreaRow[];
  canManage: boolean;
}) {
  const [order, setOrder] = useState(areas.map((area) => area.id));
  const orderedAreas = useMemo(() => {
    const byId = new Map(areas.map((area) => [area.id, area]));
    return order
      .map((id) => byId.get(id))
      .filter((area): area is ServiceAreaRow => Boolean(area));
  }, [areas, order]);

  if (!canManage) {
    return (
      <div className="space-y-3">
        <ReadOnlyNotice />
        <ul className="space-y-2">
          {areas.length === 0 ? (
            <li className="text-sm text-[var(--muted)]">
              No service areas yet.
            </li>
          ) : (
            areas.map((area) => (
              <li
                key={area.id}
                className="rounded-sm border border-[var(--border)] px-3 py-2 text-sm"
              >
                <p className="font-medium">
                  {area.label}
                  {!area.isActive ? (
                    <span className="ml-2 text-[var(--muted)]">(inactive)</span>
                  ) : null}
                </p>
                <p className="text-[var(--muted)]">
                  {[area.city, area.region, area.countryCode, area.postalPrefix]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                  {area.isRemote ? " · Remote" : ""}
                </p>
              </li>
            ))
          )}
        </ul>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <ul className="space-y-4">
        {orderedAreas.length === 0 ? (
          <li className="text-sm text-[var(--muted)]">No service areas yet.</li>
        ) : (
          orderedAreas.map((area, index) => (
            <li key={area.id} className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">
                  {area.label}
                  {!area.isActive ? (
                    <span className="ml-2 text-[var(--muted)]">(inactive)</span>
                  ) : null}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="text-xs underline-offset-2 hover:underline disabled:opacity-40"
                    disabled={index === 0}
                    onClick={() =>
                      setOrder((current) => {
                        if (index === 0) return current;
                        const next = [...current];
                        [next[index - 1], next[index]] = [
                          next[index]!,
                          next[index - 1]!,
                        ];
                        return next;
                      })
                    }
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    className="text-xs underline-offset-2 hover:underline disabled:opacity-40"
                    disabled={index === orderedAreas.length - 1}
                    onClick={() =>
                      setOrder((current) => {
                        if (index >= current.length - 1) return current;
                        const next = [...current];
                        [next[index], next[index + 1]] = [
                          next[index + 1]!,
                          next[index]!,
                        ];
                        return next;
                      })
                    }
                  >
                    Move down
                  </button>
                </div>
              </div>
              <UpdateServiceAreaForm
                organizationSlug={organizationSlug}
                area={area}
              />
              {area.isActive ? (
                <DeactivateServiceAreaForm
                  organizationSlug={organizationSlug}
                  serviceAreaId={area.id}
                />
              ) : null}
            </li>
          ))
        )}
      </ul>

      {areas.length > 1 ? (
        <ReorderServiceAreasForm
          organizationSlug={organizationSlug}
          orderedIds={order}
        />
      ) : null}

      <CreateServiceAreaForm organizationSlug={organizationSlug} />
    </div>
  );
}

function CreateServiceAreaForm({
  organizationSlug,
}: {
  organizationSlug: string;
}) {
  const [state, formAction] = useActionState(
    createServiceAreaAction,
    initialActionState,
  );

  return (
    <DirtyFormShell action={formAction} className="space-y-3">
      <h3 className="text-sm font-semibold">Add service area</h3>
      <FormStatus status={state.status} message={state.message} />
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <ServiceAreaFields prefix="create" fieldErrors={state.fieldErrors} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isRemote" />
        Remote / virtual coverage
      </label>
      <SubmitButton pendingLabel="Creating…">Create service area</SubmitButton>
    </DirtyFormShell>
  );
}

function UpdateServiceAreaForm({
  organizationSlug,
  area,
}: {
  organizationSlug: string;
  area: ServiceAreaRow;
}) {
  const [state, formAction] = useActionState(
    updateServiceAreaAction,
    initialActionState,
  );

  return (
    <DirtyFormShell
      action={formAction}
      className="space-y-3 rounded-sm border border-[var(--border)] px-3 py-3"
    >
      <FormStatus status={state.status} message={state.message} />
      <ConflictHint message={state.message} />
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input type="hidden" name="serviceAreaId" value={area.id} />
      <input type="hidden" name="expectedVersion" value={area.version} />
      <ServiceAreaFields
        prefix={`update-${area.id}`}
        fieldErrors={state.fieldErrors}
        defaults={area}
      />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isRemote" defaultChecked={area.isRemote} />
        Remote / virtual coverage
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isActive" defaultChecked={area.isActive} />
        Active
      </label>
      <SubmitButton pendingLabel="Saving…">Save area</SubmitButton>
    </DirtyFormShell>
  );
}

function DeactivateServiceAreaForm({
  organizationSlug,
  serviceAreaId,
}: {
  organizationSlug: string;
  serviceAreaId: string;
}) {
  const [state, formAction] = useActionState(
    deactivateServiceAreaAction,
    initialActionState,
  );
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input type="hidden" name="serviceAreaId" value={serviceAreaId} />
      <FormStatus status={state.status} message={state.message} />
      <SubmitButton pendingLabel="Deactivating…">Deactivate</SubmitButton>
    </form>
  );
}

function ReorderServiceAreasForm({
  organizationSlug,
  orderedIds,
}: {
  organizationSlug: string;
  orderedIds: string[];
}) {
  const [state, formAction] = useActionState(
    reorderServiceAreasAction,
    initialActionState,
  );
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input
        type="hidden"
        name="orderedIdsJson"
        value={JSON.stringify(orderedIds)}
      />
      <FormStatus status={state.status} message={state.message} />
      <SubmitButton pendingLabel="Saving order…">Save order</SubmitButton>
    </form>
  );
}

function ServiceAreaFields({
  prefix,
  fieldErrors,
  defaults,
}: {
  prefix: string;
  fieldErrors?: Record<string, string[]>;
  defaults?: Partial<ServiceAreaRow>;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1 sm:col-span-2">
        <label
          htmlFor={`${prefix}-label`}
          className="block text-sm font-medium"
        >
          Label
        </label>
        <input
          id={`${prefix}-label`}
          name="label"
          required
          maxLength={120}
          defaultValue={defaults?.label ?? ""}
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        />
        <FieldError id={`${prefix}-label-error`} errors={fieldErrors?.label} />
      </div>
      <div className="space-y-1">
        <label
          htmlFor={`${prefix}-country`}
          className="block text-sm font-medium"
        >
          Country code
        </label>
        <input
          id={`${prefix}-country`}
          name="countryCode"
          maxLength={2}
          defaultValue={defaults?.countryCode ?? ""}
          placeholder="CA"
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        />
      </div>
      <div className="space-y-1">
        <label
          htmlFor={`${prefix}-region`}
          className="block text-sm font-medium"
        >
          Region
        </label>
        <input
          id={`${prefix}-region`}
          name="region"
          maxLength={80}
          defaultValue={defaults?.region ?? ""}
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor={`${prefix}-city`} className="block text-sm font-medium">
          City
        </label>
        <input
          id={`${prefix}-city`}
          name="city"
          maxLength={80}
          defaultValue={defaults?.city ?? ""}
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        />
      </div>
      <div className="space-y-1">
        <label
          htmlFor={`${prefix}-postal`}
          className="block text-sm font-medium"
        >
          Postal prefix
        </label>
        <input
          id={`${prefix}-postal`}
          name="postalPrefix"
          maxLength={10}
          defaultValue={defaults?.postalPrefix ?? ""}
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        />
        <FieldError
          id={`${prefix}-postal-error`}
          errors={fieldErrors?.postalPrefix}
        />
      </div>
    </div>
  );
}
