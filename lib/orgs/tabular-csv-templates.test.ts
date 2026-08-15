/** @vitest-environment node */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { validateMappedCsvFile } from "@/lib/orgs/tabular-csv-file";
import {
  CSV_MAPPING_TARGET_REGISTRY,
  getCsvMappingRegistry,
  suggestCsvColumnMappings,
  type CsvMappingColumnTarget,
  type CsvMappingInput,
  type CsvMappingTargetFamily,
} from "@/lib/orgs/tabular-mapping";
import { validateTabularImport } from "@/lib/orgs/tabular-validation";
import { CSV_MIME, csvBytes } from "@/tests/helpers/tabular-fixtures";

const TEMPLATE_DIR = path.join(process.cwd(), "public/templates");
const KNOWLEDGE_TEMPLATE = "outreach-knowledge-import-template.csv";
const OFFERING_TEMPLATE = "outreach-offering-import-template.csv";
const UNSAFE = ["=", "+", "@", "http://", "https://", "SECRET", "token="];

describe("official CSV import templates", () => {
  it("parses both templates through the shared adapter with recommended headers", async () => {
    const knowledge = await loadTemplate(KNOWLEDGE_TEMPLATE);
    const offering = await loadTemplate(OFFERING_TEMPLATE);

    expect(knowledge.preview.outcome).toBe("ready");
    expect(offering.preview.outcome).toBe("ready");
    expect(knowledge.preview.headers.map((header) => header.name)).toEqual(
      getCsvMappingRegistry("knowledge").map((field) => field.label),
    );
    expect(offering.preview.headers.map((header) => header.name)).toEqual(
      getCsvMappingRegistry("offering").map((field) => field.label),
    );
    expect(knowledge.preview.previewRows).toHaveLength(1);
    expect(offering.preview.previewRows).toHaveLength(1);

    const knowledgeMapped = await validateMappedCsvFile({
      bytes: knowledge.bytes,
      filename: KNOWLEDGE_TEMPLATE,
      declaredMimeType: CSV_MIME,
      mapping: mappingFromRegistry("knowledge"),
    });
    const offeringMapped = await validateMappedCsvFile({
      bytes: offering.bytes,
      filename: OFFERING_TEMPLATE,
      declaredMimeType: CSV_MIME,
      mapping: mappingFromRegistry("offering"),
    });
    expect(knowledgeMapped.validationComplete).toBe(true);
    expect(knowledgeMapped.persistenceEligible).toBe(true);
    expect(knowledgeMapped.validRowCount).toBe(1);
    expect(offeringMapped.validationComplete).toBe(true);
    expect(offeringMapped.persistenceEligible).toBe(true);
    expect(offeringMapped.validRowCount).toBe(1);
    expect(offeringMapped.rows[0]?.values["offering.quoteRequired"]).toEqual({
      kind: "boolean",
      value: false,
    });

    for (const text of [
      knowledge.text,
      offering.text,
      JSON.stringify(knowledgeMapped.rows[0]?.issues),
    ]) {
      for (const needle of UNSAFE) {
        expect(text).not.toContain(needle);
      }
    }
  });

  it("allows optional template columns to be omitted and fails when a required column is missing", async () => {
    const requiredKnowledge = getCsvMappingRegistry("knowledge").filter(
      (field) => field.required,
    );
    const requiredOnly = csvBytes(
      `${requiredKnowledge.map((field) => field.label).join(",")}\nVisitor parking,Access hours,Visitor parking is available on weekdays.\n`,
    );
    const mapped = await validateMappedCsvFile({
      bytes: requiredOnly,
      filename: "knowledge-required.csv",
      declaredMimeType: CSV_MIME,
      mapping: {
        family: "knowledge",
        columns: requiredKnowledge.map((field, index) => ({
          sourceColumn: index + 1,
          target: field.id,
        })),
      },
    });
    expect(mapped.validationComplete).toBe(true);
    expect(mapped.validRowCount).toBe(1);

    const preview = await validateTabularImport({
      bytes: requiredOnly,
      filename: "knowledge-required.csv",
      declaredMimeType: CSV_MIME,
    });
    await expect(
      validateMappedCsvFile({
        bytes: requiredOnly,
        filename: "knowledge-required.csv",
        declaredMimeType: CSV_MIME,
        mapping: {
          family: "knowledge",
          columns: preview.headers.map((header) => ({
            sourceColumn: header.sourceColumn,
            target: "ignored" as const,
          })),
        },
      }),
    ).rejects.toMatchObject({ code: "missing_required_target" });
  });

  it("maps rearranged supported headers only through explicit mapping", async () => {
    const bytes = csvBytes(
      "Passage body,Title,Section title\nVisitor parking is available on weekdays.,Visitor parking,Access hours\n",
    );
    const preview = await validateTabularImport({
      bytes,
      filename: "rearranged.csv",
      declaredMimeType: CSV_MIME,
    });
    const suggestions = suggestCsvColumnMappings(preview, "knowledge");
    expect(suggestions.length).toBeGreaterThan(0);

    const guessed: CsvMappingInput = {
      family: "knowledge",
      columns: preview.headers.map((header, index) => ({
        sourceColumn: header.sourceColumn,
        target: (getCsvMappingRegistry("knowledge")[index]?.id ??
          "ignored") as CsvMappingColumnTarget,
      })),
    };
    const guessedResult = await validateMappedCsvFile({
      bytes,
      filename: "rearranged.csv",
      declaredMimeType: CSV_MIME,
      mapping: guessed,
    });
    expect(guessedResult.rows[0]?.values["knowledge.title"]?.value).not.toBe(
      "Visitor parking",
    );

    const explicit: CsvMappingInput = {
      family: "knowledge",
      columns: [
        { sourceColumn: 1, target: "knowledge.passageBody" },
        { sourceColumn: 2, target: "knowledge.title" },
        { sourceColumn: 3, target: "knowledge.sectionTitle" },
      ],
    };
    const mapped = await validateMappedCsvFile({
      bytes,
      filename: "rearranged.csv",
      declaredMimeType: CSV_MIME,
      mapping: explicit,
    });
    expect(mapped.rows[0]?.values["knowledge.title"]).toEqual({
      kind: "text",
      value: "Visitor parking",
    });
    expect(mapped.validationComplete).toBe(true);
    expect(CSV_MAPPING_TARGET_REGISTRY.length).toBeGreaterThan(0);
  });
});

async function loadTemplate(filename: string) {
  const text = readFileSync(path.join(TEMPLATE_DIR, filename), "utf8");
  const bytes = csvBytes(text);
  const preview = await validateTabularImport({
    bytes,
    filename,
    declaredMimeType: CSV_MIME,
  });
  return { text, bytes, preview };
}

function mappingFromRegistry(family: CsvMappingTargetFamily): CsvMappingInput {
  return {
    family,
    columns: getCsvMappingRegistry(family).map((field, index) => ({
      sourceColumn: index + 1,
      target: field.id,
    })),
  };
}
