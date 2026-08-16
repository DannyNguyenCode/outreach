/** @vitest-environment node */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CSV_IMPORT_ACTIVATION_MAX_ROWS,
  CSV_IMPORT_CONFIRMATION_LANGUAGE_VERSION,
  CSV_IMPORT_CONFIRMATION_STATEMENT,
} from "@/lib/orgs/csv-import-confirmation";

describe("CSV import confirmation language", () => {
  it("is versioned and requires explicit customer accuracy responsibility", () => {
    expect(CSV_IMPORT_CONFIRMATION_LANGUAGE_VERSION).toBe(
      "csv.import.confirm.v1",
    );
    expect(CSV_IMPORT_CONFIRMATION_STATEMENT).toMatch(/authorized/i);
    expect(CSV_IMPORT_CONFIRMATION_STATEMENT).toMatch(/accuracy/i);
    expect(CSV_IMPORT_CONFIRMATION_STATEMENT).toMatch(
      /does not independently verify/i,
    );
    expect(CSV_IMPORT_ACTIVATION_MAX_ROWS).toBe(100);
  });
});

describe("CSV import activation module boundary", () => {
  it("is server-only and does not import XLSX or storage helpers", () => {
    const source = readFileSync(
      path.join(process.cwd(), "lib/orgs/csv-import-activation.ts"),
      "utf8",
    );
    expect(source).toContain('import "server-only"');
    expect(source).toContain("CSV_IMPORT_ACTIVATION_MAX_ROWS");
    expect(source).toContain("organization-csv-import:");
    expect(source).toContain("organization-knowledge:");
    expect(source).toContain("organization-offerings:");
    expect(source).not.toContain("tabular-xlsx");
    expect(source).not.toContain("document-storage");
  });
});
