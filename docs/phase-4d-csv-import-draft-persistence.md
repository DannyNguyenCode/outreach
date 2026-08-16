# Phase 4D — CSV Import Customer Workflow

Status: CSV preview, mapping, immutable staging, confirmation, and activation on `feature/phase-04d-csv-import-draft-persistence`
Depends on: complete-file mapped validation (`docs/phase-4d-csv-complete-file-validation.md`) and the approved staging checkpoint

This document is the Phase 4D contract for the supported CSV customer journey:

`template → upload → preview → explicit mapping → complete validation → stage → review → acknowledgment → confirm/activate → active data`

Outreach validates file structure, supported CSV format, required fields, mapping, supported field types, price/date/frequency compatibility, authorization, tenant isolation, and confirmation integrity. Outreach does **not** independently determine whether customer-provided business information is factually true. There is no semantic duplicate, near-duplicate, pricing-policy, or factual-verification gate.

## Preview versus persistence

`Preview file` sends the original bytes to the server. The server validates them and returns a bounded preview. Preview does **not** create `CsvImport`, `CsvImportRow`, confirmation, knowledge, offering, audit, storage, or job records.

Displayed at preview: filename, headers, up to `TABULAR_PREVIEW_ROWS` (50) sample rows, row/column counts, parser issues, required and optional target fields, and mapping controls.

XLSX is rejected before any workbook parse. `MR-4D-OOXML-001` remains OPEN. XLSX cannot enter staging, confirmation, or activation.

## Explicit mapping

Header-name suggestions may be shown. They are never auto-applied. The customer must choose a target or **Ignore this column** for every source column. Required fields must be mapped before complete-file validation. Reordered columns are supported because mapping uses stable one-based source column indexes.

The server never infers a confirmed mapping from matching header names.

## Complete-file validation

Validate mapped file re-submits the **original bytes plus the explicit mapping**. The server ignores browser preview rows, counts, checksums, issue lists, and mapping identity. `validateMappedCsvFile()` is the only validation path.

If validation is incomplete, times out, exceeds file/row/column/cell/aggregate/issue bounds, or has unresolved parser problems, staging and confirmation stay unavailable.

## Immutable staging

`stageCsvImport()` revalidates original bytes, derives source checksum, canonical mapping identity, and import identity, and persists one organization-owned snapshot when validation completed.

| Status | Meaning |
|---|---|
| `READY_TO_CONFIRM` | EOF with zero row issues. Confirmable if under the activation cap. |
| `NEEDS_ATTENTION` | EOF with row issues. Inspectable, never activatable. |

Incomplete results create no records. Duplicate technical submissions return the existing snapshot. The staged header and rows cannot be updated (database triggers). Correcting a CSV or mapping creates a **new** snapshot.

Raw bytes are not stored. Resume uses the persisted snapshot; the original local file is not required after staging.

## Resume

Owners/admins with `org.knowledge.manage` can leave and return. Recent imports list filename, target, created date, status, counts, and a continue link without loading every historical row. Detail loads one import's persisted mapping, rows, issues, confirmation, and created records.

A foreign import ID is indistinguishable from missing (`not_found`).

## Acknowledgment and confirmation language

The review page requires an unchecked acknowledgment:

`I confirm that I am authorized to provide this information and have reviewed it for accuracy.`

Language version: `csv.import.confirm.v1` (`CSV_IMPORT_CONFIRMATION_LANGUAGE_VERSION`). The accepted version is stored on `CsvImportConfirmation` and on each created knowledge/offering version.

## Confirmation receipt and row provenance

Forward-only migration `20260816120000_phase_04d_csv_import_confirmation` adds:

- `CsvImportConfirmation` — one immutable receipt per staged import
- `CsvImportKnowledgeRowActivation` — staged row → KnowledgeSource + KnowledgeVersion
- `CsvImportOfferingRowActivation` — staged row → Offering + OfferingVersion

Receipt fields: organizationId, importId, import identity, source checksum, actor, confirmed timestamp, confirmation-language version, target family, created row count, and a canonical result summary (family, count, created-identity checksum). No raw CSV cells.

Provenance uses organization-scoped composite foreign keys, not an unconstrained JSON array of IDs.

## Transaction and lock order

Confirmation/activation writers:

1. Authenticate; require `org.knowledge.manage`
2. Require the acknowledgment and expected import identity
3. Begin transaction (60s timeout)
4. `organization-csv-import:<organizationId>` advisory lock
5. Family domain lock: `organization-knowledge:` **or** `organization-offerings:` (never both)
6. Membership `FOR UPDATE` + permission recheck
7. `CsvImport` `FOR UPDATE`
8. Reparse/revalidate stored mapping JSON and row JSON; fail closed if corrupt
9. Create all domain records as ACTIVE with confirmation evidence
10. Insert provenance, confirmation receipt, and one `CSV_IMPORT_ACTIVATED` audit
11. Commit

If any row fails, the transaction rolls back. No partial activation.

Staging writers still take **only** the CSV import lock and never knowledge/offering locks.

## Activation cap

`CSV_IMPORT_ACTIVATION_MAX_ROWS = 100`

The parser may accept up to `TABULAR_MAX_ROWS - 1` (9,999) data rows for staging. Atomic synchronous activation of that bound is not safe: each knowledge row creates source, version, section, and passage records inside one interactive transaction. 100 matches `CSV_RECORD_BATCH_SIZE` and stays within the 60-second activation transaction. Imports above the cap are rejected **before domain writes**. The staged snapshot remains immutable. Tests cover exact max and max + 1.

There is no background-job importer in this task.

## Idempotency

Repeated or concurrent confirmation of the same staged import returns the same receipt, the same created IDs, and a single `CSV_IMPORT_ACTIVATED` event. Changed acknowledgment or identity after confirmation cannot mutate the result. Unique `(importId)` on the receipt plus the CSV advisory lock are the concurrency barriers.

## Audit and privacy

| Event | When |
|---|---|
| `CSV_IMPORT_STAGED` | New staged snapshot only |
| `CSV_IMPORT_ACTIVATED` | New confirmation receipt only |

Activation metadata may include import ID, family, row count, confirmation ID, and truncated identity/checksum prefixes. It must not include raw CSV values, filenames, mapping JSON, or row contents. Customer cells are not placed in URLs, logs, stack traces, or redirect parameters. Formulas are not evaluated. URLs in cells are not fetched.

## Domain activation

**Knowledge.** Each CSV row becomes a new `MANUAL` `CUSTOMER_CONFIRMED_BUSINESS_FACTS` source with one ACTIVE version, one section, and one passage. Checksum, confirmer, timestamp, confirmation-language version, and citation keys are set. Active retrieval uses the existing Phase 4A path immediately.

Supported knowledge fields: title, section title, passage body, optional effective from/until.

**Offerings.** Each CSV row becomes a new offering and ACTIVE version using Phase 4C decimal/currency/frequency rules. At most one base price. JavaScript numbers are not authoritative money storage.

Supported offering fields: name, description, offering type, pricing model, quote-required, effective dates, price amount, currency, billing frequency.

Unsupported in this import: multiple prices, variants, features, eligibility, custom fields, interval-count structures, XLSX.

Staged, NEEDS_ATTENTION, failed, and unconfirmed content remain invisible to retrieval.

## Customer factual responsibility

Confirmation publishes the customer's reviewed data. Outreach does not arbitrate whether two rows describe the same real-world offering or policy, whether a price is lawful, or whether a statement is true.

## HTTP/UI

Authenticated route `POST /api/orgs/[slug]/knowledge/csv` handles preview, validate, and stage with a 5 MiB + multipart overhead bound enforced before parsing. Confirm is a server action. Permission: `org.knowledge.manage`.

UI states: empty upload, validating, malformed/size/parser errors, mapping incomplete, complete valid mapping, staging, NEEDS_ATTENTION, READY_TO_CONFIRM, missing acknowledgment, confirming, success, authorization loss, missing import, idempotent retry.

## Exclusions

- XLSX production import (`MR-4D-OOXML-001` OPEN)
- Semantic duplicate detection
- Background jobs
- Saved mapping templates
- Raw-file object storage
- Phase 5 connectors
