import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions/prospects", () => ({
  createProspectAction: vi.fn(async () => ({
    status: "error",
    message:
      "Possible duplicate prospects were found. Review them before creating a distinct record.",
    data: {
      candidates: [
        {
          prospectId: "p1",
          displayName: "ABC Plumbing",
          lifecycle: "ACTIVE",
          reasons: ["phone"],
        },
      ],
    },
  })),
}));

import { ProspectCreateForm } from "@/components/orgs/prospects/prospect-create-form";

describe("prospect create form", () => {
  it("lets the user add a second contact and does not auto-merge duplicates", async () => {
    render(
      <ProspectCreateForm
        organizationSlug="acme"
        prospectFields={[]}
        contactFields={[]}
      />,
    );

    fireEvent.change(screen.getByLabelText("Prospect name"), {
      target: { value: "ABC Plumbing" },
    });
    fireEvent.change(screen.getByLabelText("Contact 1 first name"), {
      target: { value: "John" },
    });
    fireEvent.change(screen.getByLabelText("Contact 1 last name"), {
      target: { value: "Smith" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add contact" }));
    expect(screen.getByLabelText("Contact 2 first name")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Contact 2 first name"), {
      target: { value: "Jane" },
    });
    fireEvent.change(screen.getByLabelText("Contact 2 last name"), {
      target: { value: "Doe" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save prospect" }));

    expect(
      await screen.findByText(/Possible duplicate prospects were found/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/ABC Plumbing \(phone\)/)).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Continue with a distinct prospect/i),
    ).not.toBeChecked();
  });
});
