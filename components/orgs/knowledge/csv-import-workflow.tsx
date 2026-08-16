"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type {
  TabularHeader,
  TabularIssue,
  TabularPreviewRow,
  TabularValidationOutcome,
} from "@/lib/orgs/tabular-types";

const UNSELECTED = "" as const;

type CsvMappingTargetFamily = "knowledge" | "offering";
type CsvMappingColumnTarget = string;
type MappingChoice = CsvMappingColumnTarget | typeof UNSELECTED;

type MappingField = {
  id: string;
  label: string;
  required: boolean;
};

type MappingSuggestion = {
  sourceColumn: number;
  target: string;
  alias: string;
};

type PreviewResponse = {
  filename: string;
  mimeType: string;
  byteLength: number;
  outcome: TabularValidationOutcome;
  headers: TabularHeader[];
  previewRows: TabularPreviewRow[];
  totalRowCount: number;
  previewRowCount: number;
  totalColumnCount: number;
  issues: TabularIssue[];
  requiredFields: MappingField[];
  optionalFields: MappingField[];
  suggestions: MappingSuggestion[];
};

type ValidateResponse = {
  validationComplete: boolean;
  family: CsvMappingTargetFamily;
  filename: string;
  totalRowCount: number;
  validRowCount: number;
  invalidRowCount: number;
  skippedBlankRowCount: number;
  processedRowCount: number;
  issueCount: number;
  hasMoreIssues: boolean;
  issues: Array<{
    sourceRowNumber: number;
    sourceColumn: number | null;
    targetField: string | null;
    code: string;
  }>;
};

type WorkflowStatus =
  | "empty"
  | "uploading"
  | "previewed"
  | "validating"
  | "validated"
  | "staging"
  | "error";

export function CsvImportWorkflow({
  organizationSlug,
}: {
  organizationSlug: string;
}) {
  const router = useRouter();
  const fileInputId = useId();
  const summaryRef = useRef<HTMLDivElement>(null);
  const [family, setFamily] = useState<CsvMappingTargetFamily>("knowledge");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<WorkflowStatus>("empty");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [choices, setChoices] = useState<Record<number, MappingChoice>>({});
  const [validation, setValidation] = useState<ValidateResponse | null>(null);

  useEffect(() => {
    if (message && (status === "error" || status === "validated")) {
      summaryRef.current?.focus();
    }
  }, [message, status]);

  const requiredUnmapped = useMemo(() => {
    if (!preview) return [];
    const mapped = new Set(
      Object.values(choices).filter((value) => value && value !== "ignored"),
    );
    return preview.requiredFields.filter((field) => !mapped.has(field.id));
  }, [choices, preview]);

  const mappingComplete = useMemo(() => {
    if (!preview) return false;
    const allChosen = preview.headers.every((header) => {
      const choice = choices[header.sourceColumn];
      return Boolean(choice);
    });
    return allChosen && requiredUnmapped.length === 0;
  }, [choices, preview, requiredUnmapped.length]);

  const suggestionByColumn = useMemo(() => {
    const map = new Map<number, MappingSuggestion>();
    for (const suggestion of preview?.suggestions ?? []) {
      map.set(suggestion.sourceColumn, suggestion);
    }
    return map;
  }, [preview]);

  function resetDownstream() {
    setPreview(null);
    setChoices({});
    setValidation(null);
  }

  async function postIntent(intent: "preview" | "validate" | "stage") {
    if (!file) {
      setStatus("error");
      setMessage("Choose a CSV file.");
      return null;
    }
    const payload = new FormData();
    payload.set("intent", intent);
    payload.set("family", family);
    payload.set("file", file);
    if (intent !== "preview") {
      payload.set(
        "mapping",
        JSON.stringify({
          family,
          columns: (preview?.headers ?? []).map((header) => ({
            sourceColumn: header.sourceColumn,
            target: choices[header.sourceColumn],
          })),
        }),
      );
    }
    try {
      const response = await fetch(
        `/api/orgs/${encodeURIComponent(organizationSlug)}/knowledge/csv`,
        { method: "POST", body: payload },
      );
      const body = (await response.json()) as {
        ok?: boolean;
        reason?: string;
        message?: string;
        preview?: PreviewResponse;
        importId?: string;
        created?: boolean;
        status?: string;
      } & Partial<ValidateResponse>;
      if (!response.ok || !body.ok) {
        setStatus("error");
        setMessage(body.message ?? "The CSV file could not be processed.");
        return null;
      }
      return body;
    } catch {
      setStatus("error");
      setMessage("The CSV file could not be processed.");
      return null;
    }
  }

  async function previewFile() {
    setStatus("uploading");
    setMessage("Validating the selected CSV…");
    setValidation(null);
    const body = await postIntent("preview");
    if (!body?.preview) return;
    setPreview(body.preview);
    setChoices({});
    setStatus("previewed");
    setMessage(
      "Preview is validation only. Outreach has not saved or activated this file.",
    );
  }

  async function validateFile() {
    setStatus("validating");
    setMessage("Revalidating the original CSV with your mapping…");
    const body = await postIntent("validate");
    if (!body) return;
    setValidation({
      validationComplete: Boolean(body.validationComplete),
      family: (body.family as CsvMappingTargetFamily) ?? family,
      filename: String(body.filename ?? file?.name ?? ""),
      totalRowCount: Number(body.totalRowCount ?? 0),
      validRowCount: Number(body.validRowCount ?? 0),
      invalidRowCount: Number(body.invalidRowCount ?? 0),
      skippedBlankRowCount: Number(body.skippedBlankRowCount ?? 0),
      processedRowCount: Number(body.processedRowCount ?? 0),
      issueCount: Number(body.issueCount ?? 0),
      hasMoreIssues: Boolean(body.hasMoreIssues),
      issues: body.issues ?? [],
    });
    setStatus("validated");
    if (!body.validationComplete || body.hasMoreIssues) {
      setMessage(
        "Complete-file validation did not finish. Staging and confirmation are unavailable until the file and mapping are valid.",
      );
      return;
    }
    setMessage(
      body.issueCount
        ? "Validation finished with row issues. You can stage an immutable review snapshot, but this import cannot be activated."
        : "Validation finished. You can stage an immutable review snapshot.",
    );
  }

  async function stageImport() {
    setStatus("staging");
    setMessage("Saving an immutable review snapshot…");
    const body = await postIntent("stage");
    if (!body?.importId) return;
    router.push(
      `/app/orgs/${organizationSlug}/knowledge/import/${body.importId}`,
    );
    router.refresh();
  }

  const canStage =
    validation?.validationComplete === true &&
    validation.hasMoreIssues === false;

  return (
    <div className="space-y-6">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Import target</legend>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="csv-import-family"
              value="knowledge"
              checked={family === "knowledge"}
              onChange={() => {
                setFamily("knowledge");
                resetDownstream();
                setStatus("empty");
                setMessage("");
              }}
            />
            Business Knowledge
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="csv-import-family"
              value="offering"
              checked={family === "offering"}
              onChange={() => {
                setFamily("offering");
                resetDownstream();
                setStatus("empty");
                setMessage("");
              }}
            />
            Offerings
          </label>
        </div>
        <p className="text-sm">
          <a
            href={
              family === "knowledge"
                ? "/templates/outreach-knowledge-import-template.csv"
                : "/templates/outreach-offering-import-template.csv"
            }
            download
            className="underline-offset-2 hover:underline"
          >
            Download the official{" "}
            {family === "knowledge" ? "knowledge" : "offering"} CSV template
          </a>
        </p>
      </fieldset>

      <form
        className="space-y-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void previewFile();
        }}
      >
        <div className="space-y-1">
          <label htmlFor={fileInputId} className="block text-sm font-medium">
            CSV file
          </label>
          <input
            id={fileInputId}
            name="file"
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              resetDownstream();
              setStatus(event.target.files?.[0] ? "empty" : "empty");
              setMessage("");
            }}
            className="block w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
          <p className="text-xs text-[var(--muted)]">
            Preview file sends the original bytes to the server for validation
            only. It does not create an import, knowledge, offerings, or jobs.
            Maximum 5 MiB. XLSX is not supported.
          </p>
        </div>
        <button
          type="button"
          disabled={!file || status === "uploading"}
          onClick={() => void previewFile()}
          className="inline-flex items-center justify-center rounded-sm bg-[var(--foreground)] px-4 py-2 text-sm font-medium text-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {status === "uploading" ? "Validating…" : "Preview file"}
        </button>
      </form>

      {message ? (
        <div
          ref={summaryRef}
          tabIndex={-1}
          role="alert"
          className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        >
          {message}
        </div>
      ) : null}

      {preview ? (
        <section className="space-y-4" aria-labelledby="csv-preview-heading">
          <h2 id="csv-preview-heading" className="text-lg font-semibold">
            Preview
          </h2>
          <p className="text-sm text-[var(--muted)]">
            {preview.filename} · {preview.byteLength} bytes ·{" "}
            {preview.totalRowCount} data rows · showing{" "}
            {preview.previewRowCount} preview rows · parser status{" "}
            {preview.outcome.replace("_", " ")}
          </p>
          {preview.issues.length > 0 ? (
            <div>
              <h3 className="text-sm font-medium">Parser warnings</h3>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                {preview.issues.map((issue, index) => (
                  <li key={`${issue.code}-${index}`}>
                    {issue.code}
                    {issue.row ? ` (row ${issue.row}` : ""}
                    {issue.column ? `, column ${issue.column}` : ""}
                    {issue.row ? ")" : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <caption className="sr-only">
                CSV preview rows bounded to the current preview limit
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="border px-2 py-1 text-left">
                    Source row
                  </th>
                  {preview.headers.map((header) => (
                    <th
                      key={header.sourceColumn}
                      scope="col"
                      className="border px-2 py-1 text-left"
                    >
                      {header.name || `Column ${header.sourceColumn}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.previewRows.map((row) => (
                  <tr key={row.sourceRowNumber}>
                    <td className="border px-2 py-1">{row.sourceRowNumber}</td>
                    {preview.headers.map((header, index) => (
                      <td
                        key={`${row.sourceRowNumber}-${header.sourceColumn}`}
                        className="border px-2 py-1"
                      >
                        {row.cells[index] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <section className="space-y-3" aria-labelledby="csv-mapping-heading">
            <h3 id="csv-mapping-heading" className="text-base font-semibold">
              Explicit column mapping
            </h3>
            <p className="text-sm text-[var(--muted)]">
              Suggestions are hints only and are not applied until you choose a
              target. Every source column must be mapped or ignored.
            </p>
            <p className="text-sm">
              Required fields:{" "}
              {preview.requiredFields.map((field) => field.label).join(", ")}
            </p>
            <p className="text-sm">
              Optional fields:{" "}
              {preview.optionalFields.map((field) => field.label).join(", ") ||
                "None"}
            </p>
            {requiredUnmapped.length > 0 ? (
              <p className="text-sm text-[var(--danger)]">
                Unmapped required fields:{" "}
                {requiredUnmapped.map((field) => field.label).join(", ")}
              </p>
            ) : null}
            <div className="space-y-3">
              {preview.headers.map((header) => {
                const suggestion = suggestionByColumn.get(header.sourceColumn);
                const selectId = `csv-map-${header.sourceColumn}`;
                return (
                  <div key={header.sourceColumn} className="space-y-1">
                    <label
                      htmlFor={selectId}
                      className="block text-sm font-medium"
                    >
                      Column {header.sourceColumn}: {header.name || "(blank)"}
                    </label>
                    {suggestion ? (
                      <p className="text-xs text-[var(--muted)]">
                        Suggested: {suggestion.target} (not applied)
                      </p>
                    ) : null}
                    <select
                      id={selectId}
                      value={choices[header.sourceColumn] ?? UNSELECTED}
                      onChange={(event) => {
                        const next = event.target.value as MappingChoice;
                        setChoices((current) => ({
                          ...current,
                          [header.sourceColumn]: next,
                        }));
                        setValidation(null);
                      }}
                      className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                    >
                      <option value={UNSELECTED}>Choose a target</option>
                      <option value="ignored">Ignore this column</option>
                      {preview.requiredFields
                        .concat(preview.optionalFields)
                        .map((field) => (
                          <option key={field.id} value={field.id}>
                            {field.label}
                            {field.required ? " (required)" : ""}
                          </option>
                        ))}
                    </select>
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              disabled={!mappingComplete || status === "validating"}
              onClick={() => void validateFile()}
              className="inline-flex items-center justify-center rounded-sm bg-[var(--foreground)] px-4 py-2 text-sm font-medium text-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {status === "validating" ? "Validating…" : "Validate mapped file"}
            </button>
          </section>
        </section>
      ) : null}

      {validation ? (
        <section className="space-y-3" aria-labelledby="csv-validate-heading">
          <h2 id="csv-validate-heading" className="text-lg font-semibold">
            Complete-file validation
          </h2>
          <p className="text-sm">
            {validation.processedRowCount} processed rows ·{" "}
            {validation.validRowCount} valid · {validation.invalidRowCount}{" "}
            invalid · {validation.issueCount} issues
            {validation.hasMoreIssues
              ? " · additional issues were truncated"
              : ""}
          </p>
          {validation.issues.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {validation.issues.slice(0, 20).map((issue, index) => (
                <li key={`${issue.code}-${index}`}>
                  Row {issue.sourceRowNumber}: {issue.code}
                  {issue.targetField ? ` (${issue.targetField})` : ""}
                </li>
              ))}
            </ul>
          ) : null}
          <button
            type="button"
            disabled={!canStage || status === "staging"}
            onClick={() => void stageImport()}
            className="inline-flex items-center justify-center rounded-sm bg-[var(--foreground)] px-4 py-2 text-sm font-medium text-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {status === "staging" ? "Staging…" : "Stage import"}
          </button>
          <p className="text-xs text-[var(--muted)]">
            Stage import saves an immutable review snapshot. It does not publish
            knowledge or offerings.
          </p>
        </section>
      ) : null}
    </div>
  );
}
