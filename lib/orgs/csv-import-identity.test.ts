/** @vitest-environment node */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CSV_IMPORT_VALIDATION_CONTRACT_VERSION,
  canonicalizeMappedValues,
  deriveCsvImportIdentity,
  parseStoredCanonicalMapping,
  parseStoredMappedIssues,
  parseStoredMappedValues,
  serializeCanonicalMapping,
  serializeMappedIssues,
  serializeMappedValues,
} from "@/lib/orgs/csv-import-identity";
import { canonicalizeCsvMapping } from "@/lib/orgs/tabular-mapping";

const KNOWLEDGE_MAPPING_A = {
  family: "knowledge" as const,
  columns: [
    { sourceColumn: 3, target: "knowledge.passageBody" as const },
    { sourceColumn: 1, target: "knowledge.title" as const },
    { sourceColumn: 2, target: "knowledge.sectionTitle" as const },
  ],
};

const KNOWLEDGE_MAPPING_B = {
  family: "knowledge" as const,
  columns: [
    { sourceColumn: 1, target: "knowledge.title" as const },
    { sourceColumn: 2, target: "knowledge.sectionTitle" as const },
    { sourceColumn: 3, target: "knowledge.passageBody" as const },
  ],
};

const OFFERING_MAPPING_A = {
  family: "offering" as const,
  columns: [
    { sourceColumn: 3, target: "offering.pricingModel" as const },
    { sourceColumn: 1, target: "offering.name" as const },
    { sourceColumn: 2, target: "offering.offeringType" as const },
  ],
};

const OFFERING_MAPPING_B = {
  family: "offering" as const,
  columns: [
    { sourceColumn: 1, target: "offering.name" as const },
    { sourceColumn: 2, target: "offering.offeringType" as const },
    { sourceColumn: 3, target: "offering.pricingModel" as const },
  ],
};

describe("CSV import identity", () => {
  it("is stable for equivalent mappings and changes with org, bytes, family, or contract", () => {
    const sourceChecksum = "a".repeat(64);
    const knowledgeIdentity = serializeCanonicalMapping(KNOWLEDGE_MAPPING_A);
    expect(knowledgeIdentity).toBe(
      serializeCanonicalMapping(KNOWLEDGE_MAPPING_B),
    );
    expect(serializeCanonicalMapping(OFFERING_MAPPING_A)).toBe(
      serializeCanonicalMapping(OFFERING_MAPPING_B),
    );

    const first = deriveCsvImportIdentity({
      organizationId: "org-a",
      family: "knowledge",
      sourceChecksum,
      mappingIdentity: knowledgeIdentity,
    });
    const second = deriveCsvImportIdentity({
      organizationId: "org-a",
      family: "knowledge",
      sourceChecksum,
      mappingIdentity: serializeCanonicalMapping(KNOWLEDGE_MAPPING_B),
    });
    expect(first).toBe(second);
    expect(first).toBe(
      createHash("sha256")
        .update(
          [
            "org-a",
            "knowledge",
            sourceChecksum,
            knowledgeIdentity,
            CSV_IMPORT_VALIDATION_CONTRACT_VERSION,
          ].join("\n"),
          "utf8",
        )
        .digest("hex"),
    );

    expect(
      deriveCsvImportIdentity({
        organizationId: "org-b",
        family: "knowledge",
        sourceChecksum,
        mappingIdentity: knowledgeIdentity,
      }),
    ).not.toBe(first);
    expect(
      deriveCsvImportIdentity({
        organizationId: "org-a",
        family: "knowledge",
        sourceChecksum: "b".repeat(64),
        mappingIdentity: knowledgeIdentity,
      }),
    ).not.toBe(first);
    expect(
      deriveCsvImportIdentity({
        organizationId: "org-a",
        family: "offering",
        sourceChecksum,
        mappingIdentity: serializeCanonicalMapping(OFFERING_MAPPING_A),
      }),
    ).not.toBe(first);
    expect(
      deriveCsvImportIdentity({
        organizationId: "org-a",
        family: "knowledge",
        sourceChecksum,
        mappingIdentity: knowledgeIdentity,
        validationContractVersion: "csv-import.v2",
      }),
    ).not.toBe(first);
  });

  it("does not include customer cell values in the identity material", () => {
    const source = readFileSync(
      path.join(process.cwd(), "lib/orgs/csv-import-identity.ts"),
      "utf8",
    );
    const derive = source.slice(
      source.indexOf("const material = ["),
      source.indexOf("return createHash"),
    );
    expect(derive).toContain("input.organizationId");
    expect(derive).toContain("input.family");
    expect(derive).toContain("input.sourceChecksum");
    expect(derive).toContain("input.mappingIdentity");
    expect(derive).toContain("contractVersion");
    expect(derive).not.toContain("values");
    expect(derive).not.toContain("filename");
  });

  it("round-trips canonical mapping, values, and issues with fixed property order", () => {
    const mapping = canonicalizeCsvMapping(KNOWLEDGE_MAPPING_A);
    const values = {
      "knowledge.passageBody": { kind: "text" as const, value: "Body" },
      "knowledge.title": { kind: "text" as const, value: "Title" },
      "knowledge.sectionTitle": { kind: "text" as const, value: "Section" },
    };
    const storedValues = serializeMappedValues(values, KNOWLEDGE_MAPPING_A);
    expect(storedValues).toBe(
      '{"knowledge.title":{"kind":"text","value":"Title"},"knowledge.sectionTitle":{"kind":"text","value":"Section"},"knowledge.passageBody":{"kind":"text","value":"Body"}}',
    );
    expect(JSON.stringify(parseStoredMappedValues(storedValues, mapping))).toBe(
      storedValues,
    );
    expect(
      JSON.stringify(canonicalizeMappedValues(values, KNOWLEDGE_MAPPING_B)),
    ).toBe(storedValues);

    const issues = [
      {
        sourceRowNumber: 2,
        sourceColumn: 1,
        targetField: "knowledge.title" as const,
        code: "missing_required_value" as const,
      },
    ];
    const storedIssues = serializeMappedIssues(issues);
    expect(storedIssues).toBe(
      '[{"sourceRowNumber":2,"sourceColumn":1,"targetField":"knowledge.title","code":"missing_required_value"}]',
    );
    expect(JSON.stringify(parseStoredMappedIssues(storedIssues))).toBe(
      storedIssues,
    );
    expect(
      parseStoredCanonicalMapping(serializeCanonicalMapping(mapping)),
    ).toEqual(mapping);
  });
});
