import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { CustomFieldInputs } from "@/components/orgs/prospects/custom-field-inputs";
import { ProspectCreateForm } from "@/components/orgs/prospects/prospect-create-form";
import type { CustomFieldFormControl } from "@/lib/orgs/prospect-validation";

vi.mock("@/app/actions/prospects", () => ({
  createProspectAction: vi.fn(async () => ({
    status: "error",
    message: "Please correct the highlighted fields.",
    fieldErrors: {
      "customValues.job_size": ['Required custom field "Job size" is missing.'],
      "customValues.contact_role": ['Required custom field "Role" is missing.'],
    },
  })),
}));

function allTypeFields(scopeLabel: string): CustomFieldFormControl[] {
  return [
    {
      key: "notes",
      label: `${scopeLabel} notes`,
      description: "Short text",
      dataType: "TEXT",
      required: false,
      isActive: true,
      options: [],
      value: "existing",
    },
    {
      key: "details",
      label: `${scopeLabel} details`,
      description: null,
      dataType: "LONG_TEXT",
      required: false,
      isActive: true,
      options: [],
      value: null,
    },
    {
      key: "count",
      label: `${scopeLabel} count`,
      description: null,
      dataType: "NUMBER",
      required: false,
      isActive: true,
      options: [],
      value: "3",
    },
    {
      key: "flag",
      label: `${scopeLabel} flag`,
      description: null,
      dataType: "BOOLEAN",
      required: false,
      isActive: true,
      options: [],
      value: true,
    },
    {
      key: "started",
      label: `${scopeLabel} started`,
      description: null,
      dataType: "DATE",
      required: false,
      isActive: true,
      options: [],
      value: "2026-01-15",
    },
    {
      key: "size",
      label: `${scopeLabel} size`,
      description: null,
      dataType: "SINGLE_SELECT",
      required: true,
      isActive: true,
      options: ["small", "large"],
      value: "small",
    },
    {
      key: "tags",
      label: `${scopeLabel} tags`,
      description: null,
      dataType: "MULTI_SELECT",
      required: false,
      isActive: true,
      options: ["a", "b"],
      value: ["a"],
    },
    {
      key: "site",
      label: `${scopeLabel} site`,
      description: null,
      dataType: "URL",
      required: false,
      isActive: true,
      options: [],
      value: "https://example.com",
    },
    {
      key: "mail",
      label: `${scopeLabel} mail`,
      description: null,
      dataType: "EMAIL",
      required: false,
      isActive: true,
      options: [],
      value: "a@example.com",
    },
    {
      key: "phone",
      label: `${scopeLabel} phone`,
      description: null,
      dataType: "PHONE",
      required: false,
      isActive: true,
      options: [],
      value: "+14165551234",
    },
  ];
}

function Harness({
  fields,
  errors,
}: {
  fields: CustomFieldFormControl[];
  errors?: Record<string, string[]>;
}) {
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    for (const field of fields) initial[field.key] = field.value;
    return initial;
  });
  return (
    <CustomFieldInputs
      fields={fields}
      values={values}
      onChange={(key, value) =>
        setValues((current) => ({ ...current, [key]: value }))
      }
      fieldErrors={errors}
      idPrefix="test-custom"
    />
  );
}

describe("custom field inputs", () => {
  it("renders every supported data type with accessible labels", () => {
    render(<Harness fields={allTypeFields("Prospect")} />);
    expect(screen.getByLabelText(/Prospect notes/)).toHaveValue("existing");
    expect(screen.getByLabelText(/Prospect details/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Prospect count/)).toHaveValue("3");
    expect(screen.getByLabelText(/Prospect flag/)).toHaveValue("true");
    expect(screen.getByLabelText(/Prospect started/)).toHaveValue("2026-01-15");
    expect(screen.getByLabelText(/Prospect size \(required\)/)).toHaveValue(
      "small",
    );
    expect(screen.getByRole("checkbox", { name: "a" })).toBeChecked();
    expect(screen.getByLabelText(/Prospect site/)).toHaveValue(
      "https://example.com",
    );
    expect(screen.getByLabelText(/Prospect mail/)).toHaveValue("a@example.com");
    expect(screen.getByLabelText(/Prospect phone/)).toHaveValue("+14165551234");
    expect(
      screen.getByRole("button", { name: "Clear Prospect notes" }),
    ).toBeInTheDocument();
  });

  it("marks required fields and shows field-specific errors", () => {
    render(
      <Harness
        fields={[
          {
            key: "job_size",
            label: "Job size",
            description: "How large",
            dataType: "TEXT",
            required: true,
            isActive: true,
            options: [],
            value: null,
          },
        ]}
        errors={{
          "customValues.job_size": [
            'Required custom field "Job size" is missing.',
          ],
        }}
      />,
    );
    const input = screen.getByLabelText(/Job size \(required\)/);
    expect(input).toHaveAttribute("aria-required", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(
      'Required custom field "Job size" is missing.',
    );
  });

  it("clears an optional field without removing the control", () => {
    render(
      <Harness
        fields={[
          {
            key: "notes",
            label: "Notes",
            description: null,
            dataType: "TEXT",
            required: false,
            isActive: true,
            options: [],
            value: "keep me",
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear Notes" }));
    expect(screen.getByLabelText("Notes")).toHaveValue("");
  });

  it("shows inactive stored values as read-only history", () => {
    render(
      <Harness
        fields={[
          {
            key: "legacy",
            label: "Legacy",
            description: null,
            dataType: "TEXT",
            required: false,
            isActive: false,
            options: [],
            value: "stored",
          },
        ]}
      />,
    );
    expect(screen.getByText(/Legacy/)).toBeInTheDocument();
    expect(screen.getByText("stored")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Clear/ }),
    ).not.toBeInTheDocument();
  });
});

describe("prospect and contact custom field scope in create UI", () => {
  it("renders prospect and contact fields separately with required marks", async () => {
    render(
      <ProspectCreateForm
        organizationSlug="acme"
        prospectFields={[
          {
            key: "job_size",
            label: "Job size",
            description: null,
            dataType: "TEXT",
            required: true,
            isActive: true,
            options: [],
            value: null,
          },
        ]}
        contactFields={[
          {
            key: "contact_role",
            label: "Role",
            description: null,
            dataType: "TEXT",
            required: true,
            isActive: true,
            options: [],
            value: null,
          },
        ]}
      />,
    );
    expect(screen.getByLabelText(/Job size \(required\)/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Role \(required\)/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Prospect name"), {
      target: { value: "ABC Plumbing" },
    });
    fireEvent.change(screen.getByLabelText("Contact 1 first name"), {
      target: { value: "John" },
    });
    fireEvent.change(screen.getByLabelText("Contact 1 last name"), {
      target: { value: "Smith" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save prospect" }));
    expect(await screen.findAllByRole("alert")).toHaveLength(2);
  });
});
