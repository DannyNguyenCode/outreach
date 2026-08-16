/** @vitest-environment node */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("CSV import persistence module boundary", () => {
  it("is server-only and does not import XLSX or storage helpers", () => {
    const source = readFileSync(
      path.join(process.cwd(), "lib/orgs/csv-import.ts"),
      "utf8",
    );
    expect(source).toContain('import "server-only"');
    expect(source).toContain("validateMappedCsvFile");
    expect(source).toContain("CSV_IMPORT_VALIDATION_CONTRACT_VERSION");
    expect(source).not.toContain("tabular-xlsx");
    expect(source).not.toContain("tabular-xml");
    expect(source).not.toContain("tabular-zip");
    expect(source).not.toContain("document-storage");
    expect(source).not.toContain("createManualKnowledgeSource");
    expect(source).not.toContain("createOfferingDraft");
  });

  it("does not accept caller-supplied identity or persistenceEligible values", () => {
    const source = readFileSync(
      path.join(process.cwd(), "lib/orgs/csv-import.ts"),
      "utf8",
    );
    expect(source).toContain("Never trusts caller-supplied preview");
    const inputType = source.slice(
      source.indexOf("export type StageCsvImportInput"),
      source.indexOf("export type GetCsvImportInput"),
    );
    expect(inputType).toContain("bytes: Uint8Array");
    expect(inputType).not.toContain("persistenceEligible");
    expect(inputType).not.toContain("importIdentity");
    expect(inputType).not.toContain("sourceChecksum");
    expect(source).toContain("validationComplete");
  });
});
