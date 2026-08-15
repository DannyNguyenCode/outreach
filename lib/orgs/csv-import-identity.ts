import "server-only";

import { createHash } from "node:crypto";

import {
  canonicalizeCsvMapping,
  parseCsvMappingInput,
  type CsvMappedPreviewRow,
  type CsvMappedRowIssue,
  type CsvMappedValue,
  type CsvMappingInput,
  type CsvMappingTargetFamily,
  type CsvMappingTargetFieldId,
} from "@/lib/orgs/tabular-mapping";

export const CSV_IMPORT_VALIDATION_CONTRACT_VERSION = "csv-import.v1";

export const CSV_IMPORT_IDENTITY_PREFIX_LENGTH = 12;

const MAPPED_VALUE_KINDS = [
  "text",
  "boolean",
  "date",
  "enum",
  "decimal",
  "currency",
  "billing_frequency",
] as const;

export type CsvImportIdentityInput = {
  organizationId: string;
  family: CsvMappingTargetFamily;
  sourceChecksum: string;
  mappingIdentity: string;
  validationContractVersion?: string;
};

export function csvImportValidationContractVersion(): string {
  return CSV_IMPORT_VALIDATION_CONTRACT_VERSION;
}

/**
 * Server-owned stable import identity. Does not include customer cell values,
 * filenames, or caller-supplied identity strings.
 */
export function deriveCsvImportIdentity(input: CsvImportIdentityInput): string {
  const contractVersion =
    input.validationContractVersion ?? CSV_IMPORT_VALIDATION_CONTRACT_VERSION;
  const material = [
    input.organizationId,
    input.family,
    input.sourceChecksum,
    input.mappingIdentity,
    contractVersion,
  ].join("\n");
  return createHash("sha256").update(material, "utf8").digest("hex");
}

export function identityPrefix(value: string): string {
  return value.slice(0, CSV_IMPORT_IDENTITY_PREFIX_LENGTH);
}

export function serializeCanonicalMapping(mapping: CsvMappingInput): string {
  return JSON.stringify(canonicalizeCsvMapping(mapping));
}

export function parseStoredCanonicalMapping(raw: string): CsvMappingInput {
  return canonicalizeCsvMapping(parseCsvMappingInput(JSON.parse(raw)));
}

export function rebuildMappedValue(value: CsvMappedValue): CsvMappedValue {
  return {
    kind: value.kind,
    value: value.value,
  } as CsvMappedValue;
}

export function canonicalizeMappedValues(
  values: Partial<Record<CsvMappingTargetFieldId, CsvMappedValue>>,
  mapping: CsvMappingInput,
): Partial<Record<CsvMappingTargetFieldId, CsvMappedValue>> {
  const canonical: Partial<Record<CsvMappingTargetFieldId, CsvMappedValue>> =
    {};
  for (const column of canonicalizeCsvMapping(mapping).columns) {
    if (column.target === "ignored") {
      continue;
    }
    const value = values[column.target];
    if (value) {
      canonical[column.target] = rebuildMappedValue(value);
    }
  }
  return canonical;
}

export function serializeMappedValues(
  values: Partial<Record<CsvMappingTargetFieldId, CsvMappedValue>>,
  mapping: CsvMappingInput,
): string {
  return JSON.stringify(canonicalizeMappedValues(values, mapping));
}

export function parseStoredMappedValues(
  raw: string,
  mapping: CsvMappingInput,
): Partial<Record<CsvMappingTargetFieldId, CsvMappedValue>> {
  const parsed = JSON.parse(raw) as unknown;
  if (!isPlainObject(parsed)) {
    throw new Error("invalid_stored_mapped_values");
  }
  const values: Partial<Record<CsvMappingTargetFieldId, CsvMappedValue>> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!isMappedValue(value)) {
      throw new Error("invalid_stored_mapped_values");
    }
    values[key as CsvMappingTargetFieldId] = rebuildMappedValue(value);
  }
  return canonicalizeMappedValues(values, mapping);
}

export function canonicalizeMappedIssues(
  issues: readonly CsvMappedRowIssue[],
): CsvMappedRowIssue[] {
  return issues.map((issue) => ({
    sourceRowNumber: issue.sourceRowNumber,
    sourceColumn: issue.sourceColumn,
    targetField: issue.targetField,
    code: issue.code,
  }));
}

export function serializeMappedIssues(
  issues: readonly CsvMappedRowIssue[],
): string {
  return JSON.stringify(canonicalizeMappedIssues(issues));
}

export function parseStoredMappedIssues(raw: string): CsvMappedRowIssue[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("invalid_stored_mapped_issues");
  }
  return canonicalizeMappedIssues(
    parsed.map((issue) => {
      if (!isPlainObject(issue)) {
        throw new Error("invalid_stored_mapped_issues");
      }
      if (
        typeof issue.sourceRowNumber !== "number" ||
        (issue.sourceColumn !== null &&
          typeof issue.sourceColumn !== "number") ||
        (issue.targetField !== null && typeof issue.targetField !== "string") ||
        typeof issue.code !== "string"
      ) {
        throw new Error("invalid_stored_mapped_issues");
      }
      return {
        sourceRowNumber: issue.sourceRowNumber,
        sourceColumn: issue.sourceColumn,
        targetField: issue.targetField as CsvMappedRowIssue["targetField"],
        code: issue.code as CsvMappedRowIssue["code"],
      };
    }),
  );
}

export function serializeMappedRow(
  row: CsvMappedPreviewRow,
  mapping: CsvMappingInput,
): { valuesJson: string; issuesJson: string } {
  return {
    valuesJson: serializeMappedValues(row.values, mapping),
    issuesJson: serializeMappedIssues(row.issues),
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMappedValue(value: unknown): value is CsvMappedValue {
  if (!isPlainObject(value)) {
    return false;
  }
  if (
    typeof value.kind !== "string" ||
    !MAPPED_VALUE_KINDS.includes(
      value.kind as (typeof MAPPED_VALUE_KINDS)[number],
    )
  ) {
    return false;
  }
  if (value.kind === "boolean") {
    return typeof value.value === "boolean";
  }
  return typeof value.value === "string";
}
