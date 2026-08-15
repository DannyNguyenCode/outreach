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
- Canonical mapping identity sorts mapping entries by numeric `sourceColumn` (with `target` as a defensive tie-breaker) and rebuilds objects with a fixed property order. Incoming mapping-array order is not part of the identity. Physical customer CSV column order remains separate and is supported through explicit header/mapping confirmation.
- Spreadsheet content remains untrusted data. Formulas are not evaluated. URLs, file bytes, and secrets are not fetched.
- Thrown errors and flattened row issues stay static and payload-free. They expose machine codes plus row/column/target locations only.
- Mapped customer values appear only on the explicit server-only mapped-row `values` intended for later authorized persistence or preview work.
- This module is `server-only`. It does not import XLSX ZIP/XML helpers or consume an XLSX preview.
- `validateMappedCsvFile` classifies the file before any XLSX parser runs. `.xlsx` inputs fail with `unsupported_kind`.
- Byte/signature/encoding/limit failures reuse the existing `TabularValidationError` codes. Mapping-contract failures reuse the existing `CsvMappingError` codes and precedence.

## Parser and mapping reuse

Complete-file validation shares one `csv-parse` adapter (`csv-parse` 7.0.2, Adaltas `node-csv`, MIT) with task 1 so preview and complete-file paths cannot disagree about whether the same CSV is structurally valid:

- Official stream/async-iterator parsing; the sync API that materializes the whole dataset is not used
- Same UTF-8/BOM handling, quoting, escaped quotes, multiline fields, record delimiters, trailing-blank stripping, and fail-closed malformed quoting
- Same file, row, column, cell, aggregate-text, and time limits, plus a bounded `max_record_size`
- Same header normalization and attention/security issue classification
- Same `parseCsvMappingInput` structural parser, canonical mapping helper, and semantic mapping validation
- Same cell parsers and knowledge/offering cross-field rules

`csv-parse` is a CSV grammar parser only. It does not validate Outreach business semantics. Zod and the current knowledge/offering mapped-cell validators remain responsible for mapped values.

The bounded preview still returns at most 50 `previewRows`. This task maps accepted data rows from the same parser incrementally, including rows after preview row 50, while preserving original one-based `sourceRowNumber`.

Trailing blank records are stripped by the shared parser, matching task 1. Internal completely blank data rows are skipped and counted; they are not treated as valid drafts.

## Result shape

`validateMappedCsvFile({ bytes, filename, declaredMimeType, mapping })` either throws or returns:

| Field | Meaning |
|---|---|
| `family` | Canonical target family (`knowledge` or `offering`) |
| `mapping` / `mappingIdentity` | Canonical mapping copy (sourceColumn-sorted) and its stable JSON identity |
| `filename` / `mimeType` / `byteLength` | Sanitized leaf name, canonical CSV MIME, original byte size |
| `sourceChecksum` | SHA-256 of the original bytes (hex) |
| `totalRowCount` | Data-row count for the processed prefix, including internal blanks. Exact full-file count only when `validationComplete` is true |
| `nonblankRowCount` | Mapped draft rows actually returned |
| `validRowCount` / `invalidRowCount` | Drafts with zero issues vs one or more issues, for the processed prefix |
| `skippedBlankRowCount` | Internal completely blank data rows in the processed prefix |
| `processedRowCount` | Data rows examined, including skipped blanks and the row that overflowed the issue cap |
| `validationComplete` | True only when the parser reached EOF without crossing the issue cap |
| `persistenceEligible` | True only when validation completed, every mapped draft is valid, and `hasMoreIssues` is false. Incomplete results are never persistence-eligible |
| `rows` | Mapped drafts in source order for the processed prefix, each with `sourceRowNumber`, `values`, and `issues` |
| `issues` | Flattened row issues retained while observed, never larger than `CSV_MAPPED_FILE_MAX_ISSUES` (1000) |
| `issueCount` / `hasMoreIssues` | Retained flattened issue count, and whether processing stopped because a later issue was observed |

When `validationComplete` is false, counts are processed-prefix counts or lower bounds. They must not be labeled as full-file or exact totals. Later persistence/activation consumers must treat `persistenceEligible === false` as not eligible.

## Bounds

All task-1 limits remain in force, including 5 MiB files, 10,000 rows including the header, 100 columns, 4,000 characters per cell, 1,000,000 aggregate characters, and a 2,000 ms deadline. The accepted CSV row boundary is header plus 9,999 data rows; the first record beyond that fails `too_many_rows` and stops the parser.

These layers are distinct:

- Parser limits (`csv-parse` plus Outreach byte/row/column/cell/aggregate/`max_record_size` checks) decide whether the CSV is structurally acceptable
- Batch and deadline checks (100-row batches; 2,000 ms before parse, at every batch boundary, after a final partial batch, and immediately before return) are defense-in-depth and do not replace the deterministic size limits
- Issue retention keeps at most 1,000 flattened mapped-row issues while they are observed. The list is never fully accumulated and then sliced
- Business-schema validation (Zod / mapped knowledge and offering rules) runs only on processed rows after the mapping contract is accepted

Valid files must be processed through EOF before they can be declared valid or later become persistence-eligible. Invalid files with fewer than or exactly 1,000 observed issues also reach EOF with exact counts. Once processing observes the first issue beyond `CSV_MAPPED_FILE_MAX_ISSUES`, the file is already conclusively invalid: stop parsing/mapping promptly, retain only the first 1,000 issues, set `hasMoreIssues: true` and `validationComplete: false`, and return truthful partial metadata.

## Official customer CSV templates

Static sample assets:

- `public/templates/outreach-knowledge-import-template.csv`
- `public/templates/outreach-offering-import-template.csv`

These are the recommended customer path. Headers are the current registry labels in canonical recommended order, with one safe fictional example row. Templates contain no formulas, formula-like prefixes, live URLs, secrets, personal information, comments, or unsupported fields.

Template rules:

- Required columns cannot be removed
- Optional columns may be removed or left blank
- Columns may be rearranged because the server uses explicit headers/mapping rather than trusting position
- Unknown or renamed columns require deliberate customer mapping confirmation and are never guessed or auto-applied
- Templates are guidance, not a trust boundary. Every upload and mapping remains untrusted

This task adds no download UI, route, server action, or mapping UI.

## Recovery expectations

- Over-limit, signature, encoding, and type failures are terminal for this attempt. The caller must supply a new file.
- Parser-gate failures (`parser_not_ready`, `unsupported_kind`) are terminal until the CSV is ready or the mapping is corrected.
- Deadline failures stay `timeout` with a static payload-free message.
- Row issues are recoverable in a later UI by editing cells or remapping columns. This task does not persist those edits.
- Leftover claims, storage objects, and jobs are out of scope; this module is pure validation.

## Relationship to other Phase 4 work

- Phase 4A remains the manual knowledge editor. This task does not create knowledge sources.
- Phase 4B remains the only PDF/DOCX/TXT upload and extraction path.
- Phase 4C remains the structured offering catalog. This task does not create offerings.
- Phase 4D task 1 remains the byte validator and bounded preview.
- Phase 4D task 2 remains the dry-run mapped preview of at most 50 rows.
- XLSX mapping remains prohibited until Bao authorizes removal of `MR-4D-OOXML-001`.
