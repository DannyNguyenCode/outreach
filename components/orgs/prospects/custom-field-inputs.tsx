"use client";

import { FieldError } from "@/components/auth/field-error";
import type { CustomFieldFormControl } from "@/lib/orgs/prospect-validation";

export function CustomFieldInputs({
  fields,
  values,
  onChange,
  fieldErrors,
  idPrefix,
}: {
  fields: CustomFieldFormControl[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  fieldErrors?: Record<string, string[]>;
  idPrefix: string;
}) {
  if (fields.length === 0) {
    return null;
  }

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">Custom fields</legend>
      {fields.map((field) => {
        const errorKey = `customValues.${field.key}`;
        const errors = fieldErrors?.[errorKey] ?? fieldErrors?.[field.key];
        const errorId = `${idPrefix}-${field.key}-error`;
        const inputId = `${idPrefix}-${field.key}`;
        const current = Object.hasOwn(values, field.key)
          ? values[field.key]
          : field.value;
        const requiredMark = field.required ? (
          <span className="text-[var(--danger)]"> (required)</span>
        ) : null;

        if (!field.isActive) {
          return (
            <div key={field.key} className="space-y-1 text-sm">
              <p className="font-medium">
                {field.label}
                <span className="font-normal text-[var(--muted)]">
                  {" "}
                  (inactive)
                </span>
              </p>
              <p>{formatInactiveValue(current)}</p>
            </div>
          );
        }

        return (
          <div key={field.key} className="space-y-1 text-sm">
            <label className="block space-y-1" htmlFor={inputId}>
              <span className="font-medium">
                {field.label}
                {requiredMark}
              </span>
              {field.description ? (
                <span className="block font-normal text-[var(--muted)]">
                  {field.description}
                </span>
              ) : null}
              <CustomFieldControl
                field={field}
                id={inputId}
                errorId={errorId}
                invalid={Boolean(errors?.length)}
                value={current}
                onChange={(value) => onChange(field.key, value)}
              />
            </label>
            {!field.required ? (
              <button
                type="button"
                className="text-sm underline-offset-2 hover:underline"
                onClick={() => onChange(field.key, null)}
              >
                Clear {field.label}
              </button>
            ) : null}
            <FieldError id={errorId} errors={errors} />
          </div>
        );
      })}
    </fieldset>
  );
}

function formatInactiveValue(value: unknown): string {
  if (value == null || value === "") return "—";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function CustomFieldControl({
  field,
  id,
  errorId,
  invalid,
  value,
  onChange,
}: {
  field: CustomFieldFormControl;
  id: string;
  errorId: string;
  invalid: boolean;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const common = {
    id,
    "aria-required": field.required,
    "aria-invalid": invalid,
    "aria-describedby": errorId,
    className:
      "w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2",
  } as const;

  switch (field.dataType) {
    case "LONG_TEXT":
      return (
        <textarea
          {...common}
          rows={4}
          maxLength={4000}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    case "BOOLEAN":
      return (
        <select
          {...common}
          value={value === true ? "true" : value === false ? "false" : ""}
          onChange={(event) => {
            if (event.target.value === "") onChange(null);
            else onChange(event.target.value === "true");
          }}
        >
          <option value="">{field.required ? "Select…" : "Not set"}</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      );
    case "DATE":
      return (
        <input
          {...common}
          type="date"
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    case "NUMBER":
      return (
        <input
          {...common}
          inputMode="decimal"
          value={value == null ? "" : String(value)}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    case "EMAIL":
      return (
        <input
          {...common}
          type="email"
          maxLength={500}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    case "URL":
      return (
        <input
          {...common}
          type="url"
          maxLength={500}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    case "PHONE":
      return (
        <input
          {...common}
          type="tel"
          maxLength={500}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    case "SINGLE_SELECT":
      return (
        <select
          {...common}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">{field.required ? "Select…" : "Not set"}</option>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    case "MULTI_SELECT": {
      const selected = Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : [];
      return (
        <div className="space-y-1" role="group" aria-labelledby={id}>
          <span id={id} className="sr-only">
            {field.label}
          </span>
          {field.options.map((option) => {
            const optionId = `${id}-${option}`;
            const checked = selected.includes(option);
            return (
              <label
                key={option}
                htmlFor={optionId}
                className="flex items-center gap-2"
              >
                <input
                  id={optionId}
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    onChange(
                      checked
                        ? selected.filter((item) => item !== option)
                        : [...selected, option],
                    );
                  }}
                />
                <span>{option}</span>
              </label>
            );
          })}
        </div>
      );
    }
    default:
      return (
        <input
          {...common}
          type="text"
          maxLength={500}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
        />
      );
  }
}
