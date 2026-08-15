# Phase 4D — CSV Complete-File Mapped Validation

Status: Complete-file mapped-validation foundation in progress on `feature/phase-04d-csv-complete-file-validation`  
Depends on: Phase 4D task 1 tabular validation (`docs/phase-4d-tabular-import-hardening.md`) and Phase 4D task 2 CSV mapping (`docs/phase-4d-csv-mapping-foundation.md`)

This document is the Phase 4D contract for **task 3 only**: a server-only, deterministic complete-file CSV mapped-validation module. It does not complete Phase 4D, KNOW-002, KNOW-003, or the overall Phase 4 gate.

## Task boundary

This foundation:

- Accepts original CSV bytes, a filename, a declared MIME type, and an untrusted mapping
- Revalidates those bytes with the same CSV parser used for the bounded preview
- Validates every accepted nonblank data row against the customer-reviewed mapping
- Returns a bounded, deterministic result suitable for later authorized persistence work

It does **not** upload, store, persist, confirm, activate, retrieve, or import any record.

Explicitly deferred:

- Authorized upload routes, browser forms, server actions, and mapping UI
- Saved mapping templates
- Acknowledgment or override of parser attention issues
- Import records, background jobs, progress, retry, and idempotent persistence
- Offering/knowledge creation, confirmation, activation, and retrieval
- Duplicate and existing-record conflict resolution
- XLSX mapping (prohibited while `MR-4D-OOXML-001` is OPEN)
- Multi-price `MULTI_OPTION` / `TIERED` drafts from a single CSV row
- Variants, features, eligibility notes, custom field values, DST disambiguation, and price interval counts
- Phase 5 work

No imported customer data is persisted by this task.

## Trust boundaries

- Callers must supply the original bytes. A preview object is not accepted and is not evidence that the complete file is valid.
- Mapping identity remains the parser's stable one-based `sourceColumn`.
- Spreadsheet content remains untrusted data. Formulas are not evaluated. URLs, file bytes, and secrets are not fetched.
- Thrown errors and flattened row issues stay static and payload-free. They expose machine codes plus row/column/target locations only.
- Mapped customer values appear only on the explicit server-only mapped-row `values` intended for later authorized persistence or preview work.
- This module is `server-only`. It does not import XLSX ZIP/XML helpers or consume an XLSX preview.
- `validateMappedCsvFile` classifies the file before any XLSX parser runs. `.xlsx` inputs fail with `unsupported_kind`.
- Byte/signature/encoding/limit failures reuse the existing `TabularValidationError` codes. Mapping-contract failures reuse the existing `CsvMappingError` codes and precedence.

## Parser and mapping reuse

Complete-file validation shares the CSV inspect/preview path with task 1 so the two cannot drift:

- Same RFC 4180 parser, UTF-8/BOM handling, trailing-blank stripping, and deadline
- Same file, row, column, cell, aggregate-text, and time limits
- Same header normalization and attention/security issue classification
- Same `parseCsvMappingInput` structural parser and semantic mapping validation
- Same cell parsers and knowledge/offering cross-field rules

The bounded preview still returns at most 50 `previewRows`. This task maps every accepted data row from the same parse, including rows after preview row 50, while preserving original one-based `sourceRowNumber`.

Trailing blank records are stripped by the shared parser, matching task 1. Internal completely blank data rows are skipped and counted; they are not treated as valid drafts.

## Result shape

`validateMappedCsvFile({ bytes, filename, declaredMimeType, mapping })` either throws or returns:

| Field | Meaning |
|---|---|
| `family` | Canonical target family (`knowledge` or `offering`) |
| `mapping` / `mappingIdentity` | Canonical mapping copy and its stable JSON identity |
| `filename` / `mimeType` / `byteLength` | Sanitized leaf name, canonical CSV MIME, original byte size |
| `sourceChecksum` | SHA-256 of the original bytes (hex) |
| `totalRowCount` | Parser data-row count, including internal blanks |
| `nonblankRowCount` | Mapped draft rows actually returned |
| `validRowCount` / `invalidRowCount` | Drafts with zero issues vs one or more issues |
| `skippedBlankRowCount` | Internal completely blank data rows |
| `rows` | Complete mapped drafts in source order, each with `sourceRowNumber`, `values`, and `issues` |
| `issues` | Flattened row issues, capped at `CSV_MAPPED_FILE_MAX_ISSUES` (1000) |
| `issueCount` / `hasMoreIssues` | Total issue count before the cap, and whether the flattened list was truncated |

If the flattened issue list is truncated, `invalidRowCount` and per-row `issues` still include every invalid draft. Truncation never implies that omitted rows were valid.

## Bounds

All task-1 limits remain in force, including 5 MiB files, 10,000 rows including the header, 100 columns, 4,000 characters per cell, 1,000,000 aggregate characters, and a 2,000 ms deadline. The accepted CSV row boundary is header plus 9,999 data rows; one past that fails `too_many_rows` during parse, before unbounded mapping allocation.

## Recovery expectations

- Over-limit, signature, encoding, and type failures are terminal for this attempt. The caller must supply a new file.
- Parser-gate failures (`parser_not_ready`, `unsupported_kind`) are terminal until the CSV is ready or the mapping is corrected.
- Row issues are recoverable in a later UI by editing cells or remapping columns. This task does not persist those edits.
- Leftover claims, storage objects, and jobs are out of scope; this module is pure validation.

## Relationship to other Phase 4 work

- Phase 4A remains the manual knowledge editor. This task does not create knowledge sources.
- Phase 4B remains the only PDF/DOCX/TXT upload and extraction path.
- Phase 4C remains the structured offering catalog. This task does not create offerings.
- Phase 4D task 1 remains the byte validator and bounded preview.
- Phase 4D task 2 remains the dry-run mapped preview of at most 50 rows.
- XLSX mapping remains prohibited until Bao authorizes removal of `MR-4D-OOXML-001`.
