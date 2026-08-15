# Phase 4D — CSV Mapping Foundation

Status: Dry-run mapping/preview foundation in progress on `feature/phase-04d-csv-mapping-foundation`  
Depends on: Phase 4D task 1 tabular validation/preview (`docs/phase-4d-tabular-import-hardening.md`) and the Phase 4A/4C knowledge and offering contracts

This document is the Phase 4D contract for **task 2 only**: a server-only, deterministic CSV column-mapping and mapped-preview module. It does not complete Phase 4D, KNOW-002, or KNOW-003.

## Task boundary

This foundation:

- Accepts a `TabularNormalizedPreview` whose `kind` is exactly `csv` and whose parser outcome is safe for mapping
- Validates a customer-reviewed mapping against a stable target-field registry
- Returns a bounded dry-run mapped preview of the parser's existing `previewRows`
- Fails closed on XLSX previews, `needs_attention` parser results, and unresolved error-level or security-relevant parser issues

It does **not** upload, store, persist, confirm, activate, retrieve, or import any record.

Explicitly deferred:

- Authorized upload routes, browser forms, server actions, and mapping UI
- Saved mapping templates
- Complete-file row validation beyond the bounded preview (see `docs/phase-4d-csv-complete-file-validation.md`)
- Acknowledgment or override of parser attention issues
- Import records, background jobs, progress, retry, and idempotent persistence
- Offering/knowledge creation, confirmation, activation, and retrieval
- XLSX mapping (prohibited while `MR-4D-OOXML-001` is OPEN)
- Multi-price `MULTI_OPTION` / `TIERED` drafts from a single CSV row
- Variants, features, eligibility notes, custom field values, DST disambiguation, and price interval counts (these need persistence or org context that this dry-run does not have)
- Phase 5 work

No imported customer data is persisted by this task.

## Trust boundaries

- Mapping identity is the parser's stable one-based `sourceColumn`, never header text alone.
- Header names may inform non-authoritative suggestions only when an exact normalized alias is unique. Suggestions are never applied unless the customer maps that source column explicitly.
- Spreadsheet content remains untrusted data. Formulas are not evaluated. URLs, file bytes, and secrets are not fetched or echoed in error objects.
- Row issues expose machine codes plus row/column/target locations. They must not include cell contents, formulas, URLs, or secrets.
- Mapped customer values appear only in the explicit bounded preview intended for a later authorized UI.
- This module is `server-only` and does not import XLSX ZIP/XML helpers.
- `mapCsvPreview` and `validateCsvMapping` accept untrusted mapping input as `unknown`. A structural parser runs before any property dereference or semantic assignment.
- Malformed mapping roots, non-array `columns`, oversized mapping arrays (`TABULAR_MAX_COLUMNS`), and non-object column entries fail with static `invalid_mapping`. Validly shaped mappings keep the existing semantic codes (`invalid_source_column`, `unknown_target`, duplicates, unmapped columns, missing required targets, and incompatible families).
- Mapping errors never echo input values, secrets, URLs, or formulas.

## Parser gate

Mapping runs only when all of the following are true:

- `kind === "csv"`
- `outcome === "ready"`
- headers are present
- no parser issue has `severity: "error"`
- no security-relevant issue is present (`formula`, `formula_like`, `cached_formula`, `hyperlink`, `external_link`)

XLSX previews are rejected with `unsupported_kind`. Unresolved parser attention is rejected with `parser_not_ready`. There is no override path in this task.

## Target families

Two explicit families, kept distinct:

| Family | Useful draft row | Required mapped targets |
|---|---|---|
| `knowledge` | One customer-confirmed business-knowledge draft with a single section and passage | `knowledge.title`, `knowledge.sectionTitle`, `knowledge.passageBody` |
| `offering` | One structured offering draft with at most one price | `offering.name`, `offering.offeringType`, `offering.pricingModel` |

Optional knowledge targets: `knowledge.effectiveFrom`, `knowledge.effectiveUntil` (strict `YYYY-MM-DD`).

Optional offering targets: description, quote-required, effective dates, price amount, price currency, and billing frequency.

Every source column in the preview must be assigned exactly once, either to a family target or to the explicit `ignored` target. Unknown, duplicate, missing required, and cross-family assignments fail closed.

## Dry-run mapped preview

`mapCsvPreview(preview, mapping)`:

- Copies bounded `previewRows` (at most 50) and preserves `sourceRowNumber`
- Skips only completely blank rows and reports `skippedBlankRowCount`
- Normalizes whitespace deterministically (trim; collapse internal whitespace for short text fields; preserve internal spacing in passage body and description)
- Parses booleans, strict ISO dates, enums, decimal amounts, ISO currency codes, and billing frequencies without locale guessing
- Rejects exponent notation, non-finite numbers, invalid calendar dates, unknown enum values, malformed currency codes, and incomplete price/currency/frequency triples
- Distinguishes missing required values from invalid values
- Applies Phase 4C cross-field rules that can be checked without org persistence: price pairs, pricing-model compatibility, quote-required behavior, and effective-date order (`effectiveUntil` must be after `effectiveFrom`)
- Sets `hasMoreRows` when `totalRowCount` exceeds the bounded preview rows actually inspected
- Never mutates the parser preview or mapping input
- Never implies that the complete file has been validated against the mapping

`MULTI_OPTION` and `TIERED` cannot form a complete draft from one price column in this foundation; those rows receive `incompatible_pricing_model` rather than inventing a second price.

## Suggestions

`suggestCsvColumnMappings(preview, family)` returns exact normalized alias matches only when a single source column maps to a given target. Duplicate aliases (for example both `Price` and `Amount`) produce no suggestion for that target. Similar header text is not guessed. Callers must still send an explicit mapping.

## Recovery expectations

- Parser-gate failures are terminal for this mapping attempt. The caller must supply a ready CSV preview or a corrected mapping.
- Row issues are recoverable in a later UI by editing cells or remapping columns. This task does not persist those edits.
- Leftover claims, storage objects, and jobs are out of scope; this module is pure validation.
- Existing Phase 4A–4C knowledge/offering recovery protocols are unchanged.

## Relationship to other Phase 4 work

- Phase 4A remains the manual knowledge editor. This task does not create knowledge sources.
- Phase 4B remains the only PDF/DOCX/TXT upload and extraction path.
- Phase 4C remains the structured offering catalog. This task does not create offerings.
- Phase 4D task 1 remains the only CSV/XLSX byte validator. This task consumes its normalized preview and does not re-parse untrusted bytes.
- XLSX mapping remains prohibited until Bao authorizes removal of `MR-4D-OOXML-001`.
