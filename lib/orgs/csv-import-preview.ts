import "server-only";

import type { SafeUser } from "@/lib/auth/users";
import {
  OrganizationAuthError,
  requireOrganizationPermission,
} from "@/lib/orgs/authorization";
import { mapAuthError, type AuthFailure } from "@/lib/orgs/csv-import-access";
import {
  inspectPreparedCsv,
  prepareTabularInput,
} from "@/lib/orgs/tabular-preview";
import {
  CsvMappingError,
  getCsvMappingRegistry,
  suggestCsvColumnMappings,
  type CsvMappingSuggestion,
  type CsvMappingTargetFamily,
  type CsvMappingTargetFieldDefinition,
} from "@/lib/orgs/tabular-mapping";
import { TabularValidationError } from "@/lib/orgs/tabular-helpers";
import {
  TABULAR_PREVIEW_ROWS,
  type TabularHeader,
  type TabularIssue,
  type TabularPreviewRow,
  type TabularValidationOutcome,
} from "@/lib/orgs/tabular-types";
import {
  validateMappedCsvFile,
  type CsvMappedFileResult,
} from "@/lib/orgs/tabular-csv-file";

const MANAGE_PERMISSION = "org.knowledge.manage" as const;

export type CsvImportPreviewFailure = AuthFailure & {
  ok: false;
  reason: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
};

export type CsvImportPreviewView = {
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
  requiredFields: readonly CsvMappingTargetFieldDefinition[];
  optionalFields: readonly CsvMappingTargetFieldDefinition[];
  suggestions: CsvMappingSuggestion[];
};

function requireActor(actor: SafeUser | null): SafeUser {
  if (!actor) {
    throw new OrganizationAuthError("unauthenticated");
  }
  return actor;
}

function mapPreviewError(error: unknown): CsvImportPreviewFailure | null {
  const auth = mapAuthError(error);
  if (auth) return auth;
  if (error instanceof TabularValidationError) {
    return { ok: false, reason: error.code, message: error.message };
  }
  if (error instanceof CsvMappingError) {
    return { ok: false, reason: error.code, message: error.message };
  }
  return null;
}

function rejectXlsx(kind: string): void {
  if (kind !== "csv") {
    throw new CsvMappingError(
      "unsupported_kind",
      "Only CSV files can be imported. XLSX import is disabled.",
    );
  }
}

export async function previewCsvImportFile(input: {
  actor: SafeUser | null;
  organizationId: string;
  bytes: Uint8Array;
  filename: string;
  declaredMimeType: string;
  family: CsvMappingTargetFamily;
}): Promise<
  { ok: true; preview: CsvImportPreviewView } | CsvImportPreviewFailure
> {
  try {
    const actor = requireActor(input.actor);
    await requireOrganizationPermission({
      user: actor,
      organizationId: input.organizationId,
      permission: MANAGE_PERMISSION,
    });

    const prepared = prepareTabularInput({
      bytes: input.bytes,
      filename: input.filename,
      declaredMimeType: input.declaredMimeType,
    });
    rejectXlsx(prepared.kind);
    const inspection = await inspectPreparedCsv(prepared);
    const fields = getCsvMappingRegistry(input.family);
    const suggestions = suggestCsvColumnMappings(
      inspection.preview,
      input.family,
    );

    return {
      ok: true,
      preview: {
        filename: inspection.preview.filename,
        mimeType: inspection.preview.mimeType,
        byteLength: inspection.preview.byteLength,
        outcome: inspection.preview.outcome,
        headers: inspection.preview.headers,
        previewRows: inspection.preview.previewRows.slice(
          0,
          TABULAR_PREVIEW_ROWS,
        ),
        totalRowCount: inspection.preview.totalRowCount,
        previewRowCount: Math.min(
          inspection.preview.previewRows.length,
          TABULAR_PREVIEW_ROWS,
        ),
        totalColumnCount: inspection.preview.totalColumnCount,
        issues: inspection.preview.issues,
        requiredFields: fields.filter((field) => field.required),
        optionalFields: fields.filter((field) => !field.required),
        suggestions,
      },
    };
  } catch (error) {
    return (
      mapPreviewError(error) ?? {
        ok: false,
        reason: "failed",
        message: "The CSV file could not be previewed.",
      }
    );
  }
}

export async function validateCsvImportMapping(input: {
  actor: SafeUser | null;
  organizationId: string;
  bytes: Uint8Array;
  filename: string;
  declaredMimeType: string;
  mapping: unknown;
}): Promise<
  { ok: true; result: CsvMappedFileResult } | CsvImportPreviewFailure
> {
  try {
    const actor = requireActor(input.actor);
    await requireOrganizationPermission({
      user: actor,
      organizationId: input.organizationId,
      permission: MANAGE_PERMISSION,
    });
    const prepared = prepareTabularInput({
      bytes: input.bytes,
      filename: input.filename,
      declaredMimeType: input.declaredMimeType,
    });
    rejectXlsx(prepared.kind);
    const validated = await validateMappedCsvFile({
      bytes: input.bytes,
      filename: input.filename,
      declaredMimeType: input.declaredMimeType,
      mapping: input.mapping,
    });
    return {
      ok: true,
      result: validated,
    };
  } catch (error) {
    return (
      mapPreviewError(error) ?? {
        ok: false,
        reason: "failed",
        message: "The CSV mapping could not be validated.",
      }
    );
  }
}
