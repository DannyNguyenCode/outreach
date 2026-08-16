import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/app/actions/csv-import", () => ({
  confirmCsvImportAction: vi.fn(async () => ({
    status: "error",
    message:
      "Confirm that you are authorized to provide this information and have reviewed it for accuracy.",
  })),
}));

import { CsvImportWorkflow } from "@/components/orgs/knowledge/csv-import-workflow";
import { CsvImportReviewForm } from "@/components/orgs/knowledge/csv-import-review-form";
import { CsvImportRecentList } from "@/components/orgs/knowledge/csv-import-recent-list";

describe("CSV import workflow UI", () => {
  it("starts empty, requires an explicit mapping choice, and does not auto-apply suggestions", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        preview: {
          filename: "knowledge.csv",
          mimeType: "text/csv",
          byteLength: 40,
          outcome: "ready",
          headers: [
            { sourceColumn: 1, name: "Title", normalizedName: "title" },
            { sourceColumn: 2, name: "Section", normalizedName: "section" },
            { sourceColumn: 3, name: "Body", normalizedName: "body" },
          ],
          previewRows: [
            {
              sourceRowNumber: 2,
              cells: ["Parking", "Hours", "Visitor parking is available."],
            },
          ],
          totalRowCount: 1,
          previewRowCount: 1,
          totalColumnCount: 3,
          issues: [],
          requiredFields: [
            { id: "knowledge.title", label: "Title", required: true },
            {
              id: "knowledge.sectionTitle",
              label: "Section title",
              required: true,
            },
            {
              id: "knowledge.passageBody",
              label: "Passage body",
              required: true,
            },
          ],
          optionalFields: [],
          suggestions: [
            { sourceColumn: 1, target: "knowledge.title", alias: "title" },
          ],
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<CsvImportWorkflow organizationSlug="demo" />);
    expect(screen.getByText("Import target")).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: /Download the official knowledge CSV template/i,
      }),
    ).toHaveAttribute(
      "href",
      "/templates/outreach-knowledge-import-template.csv",
    );
    expect(screen.getByLabelText("CSV file")).toBeInTheDocument();

    const file = new File(["Title,Section,Body\nA,B,C\n"], "knowledge.csv", {
      type: "text/csv",
    });
    await user.upload(screen.getByLabelText("CSV file"), file);
    await user.click(screen.getByRole("button", { name: "Preview file" }));
    expect(fetchMock).toHaveBeenCalled();
    expect(await screen.findByText(/Suggested: knowledge.title/)).toBeVisible();
    expect(screen.getByLabelText(/Column 1/)).toHaveValue("");
    expect(
      screen.getByRole("button", { name: "Validate mapped file" }),
    ).toBeDisabled();
    expect(screen.getByText(/Unmapped required fields/)).toBeVisible();

    await user.selectOptions(
      screen.getByLabelText(/Column 1/),
      "knowledge.title",
    );
    await user.selectOptions(
      screen.getByLabelText(/Column 2/),
      "knowledge.sectionTitle",
    );
    await user.selectOptions(
      screen.getByLabelText(/Column 3/),
      "knowledge.passageBody",
    );
    expect(
      screen.getByRole("button", { name: "Validate mapped file" }),
    ).toBeEnabled();
    vi.unstubAllGlobals();
  });

  it("keeps the acknowledgment unchecked and labels the review table", () => {
    render(
      <CsvImportReviewForm
        organizationSlug="demo"
        importId="imp_1"
        expectedImportIdentity={"a".repeat(64)}
      />,
    );
    const checkbox = screen.getByLabelText(
      /I confirm that I am authorized to provide this information/i,
    );
    expect(checkbox).not.toBeChecked();
    expect(
      screen.getByRole("button", { name: "Confirm and activate" }),
    ).toBeInTheDocument();
  });

  it("renders recent imports with table headers", () => {
    render(
      <CsvImportRecentList
        organizationSlug="demo"
        imports={[
          {
            id: "imp_1",
            filename: "knowledge.csv",
            family: "knowledge",
            status: "READY_TO_CONFIRM",
            createdAt: new Date("2026-08-16T00:00:00.000Z"),
            totalRowCount: 1,
            validRowCount: 1,
            invalidRowCount: 0,
            issueCount: 0,
            confirmed: false,
          },
        ]}
      />,
    );
    expect(
      screen.getByRole("columnheader", { name: "Filename" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Continue reviewing" }),
    ).toHaveAttribute("href", "/app/orgs/demo/knowledge/import/imp_1");
  });
});
