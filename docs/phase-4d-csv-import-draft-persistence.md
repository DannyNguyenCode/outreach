# Phase 4D — CSV Import Draft Persistence Foundation

Status: Import-stage persistence foundation in progress on `feature/phase-04d-csv-import-draft-persistence`
Depends on: Phase 4D complete-file mapped validation (`docs/phase-4d-csv-complete-file-validation.md`)

This document is the Phase 4D contract for **task 4 only**: a server-only, tenant-scoped, retry-safe snapshot of one complete CSV mapped-validation result. It does not complete Phase 4D, confirmation, activation, or the overall Phase 4 gate.

## Task boundary

This foundation:

- Accepts original CSV bytes, a filename, a declared MIME type, and an untrusted mapping
- Revalidates those bytes inside `stageCsvImport` by calling `validateMappedCsvFile`
- Persists one organization-owned import and its immutable ordered row snapshots when validation completed
- Returns the same import for sequential or concurrent retries of the same organization, source, mapping, and contract

It does **not** confirm, activate, edit, list, upload, store raw bytes, or create knowledge/offering domain records.

Explicitly deferred:

- Customer UI, upload/download routes, and mapping UI
- Raw-file object storage
- Saved mapping templates
- Row editing or issue resolution
- Duplicate and existing-record conflict detection
- Confirmation and atomic knowledge/offering activation
- Background jobs, live connectors, and Phase 5 work
- XLSX consumption while `MR-4D-OOXML-001` remains OPEN

## Trust boundary

Callers may supply only:

- Authenticated actor context
- Selected `organizationId`
- Original CSV bytes
- Filename and declared MIME type
- Explicit untrusted mapping

The service must not trust a caller-supplied preview, checksum, import identity, counts, rows, issues, status, or `persistenceEligible` value. `validateMappedCsvFile` is invoked internally. XLSX fails before persistence.

`csv-parse` still does not validate Outreach business semantics. Zod and the current mapped knowledge/offering validators remain responsible for cell values. Persistence only stores a completed validation snapshot.

## Status meanings

| Status | Meaning |
|---|---|
| `READY_TO_CONFIRM` | Validation reached EOF with zero row issues. Eligible for a later confirmation task, not confirmed here. |
| `NEEDS_ATTENTION` | Validation reached EOF with one or more row issues. Reviewable, not confirmable, not activatable. |

Incomplete results are never persisted:

- Timeout, malformed bytes, parser-attention issues, over-limit files, XLSX, or thrown mapping/parser errors
- `validationComplete === false` or `hasMoreIssues === true`, including issue-cap early stop

Those failures create no import, row, or audit record. Partial counts from an incomplete validator result are not stored and must not be treated as exact totals.

## Identity formula and contract version

The current validation-contract version is `csv-import.v1`.

Server-owned import identity is SHA-256 hex of these UTF-8 lines, in order:

1. Organization ID
2. Canonical target family (`knowledge` or `offering`)
3. SHA-256 hex of the original bytes
4. Canonical mapping identity from `canonicalizeCsvMapping`
5. Validation-contract version

Customer cell values, filenames, and caller-supplied identity strings are not part of the identity. Equivalent mappings that differ only in incoming column-array order produce the same identity.

A changed file, family, mapping, contract version, or organization produces a different identity. The same file in a different organization is isolated.

## Schema

`CsvImport` is the organization-owned header. `CsvImportRow` stores immutable ordered snapshots.

Persisted header fields: sanitized filename, canonical `text/csv` MIME, byte length, source checksum, family, canonical mapping JSON/identity, contract version, exact complete counts, status, creator, and created timestamp.

Persisted row fields: `displayOrder`, `sourceRowNumber`, canonical mapped values JSON, and static machine-readable issues JSON.

Raw upload bytes, formulas that failed the parser gate, storage credentials, secrets, stack traces, fetched URLs, and fuzzy suggestions are not stored.

Mapping and row payloads are stored as `TEXT`, not JSONB, because PostgreSQL JSONB does not preserve object insertion order. The service recanonicalizes mapping, values, and issues at the read trust boundary.

Database constraints prevent:

- Cross-organization row attachment (composite FK on `(importId, organizationId)`)
- Duplicate `displayOrder` or `sourceRowNumber` within one import
- Impossible status/count combinations
- Non-CSV MIME types
- Updates to staged import or row content after creation

Deletes remain available for organization cascade and test reset only.

## Transaction and lock order

CSV import writers use advisory lock `organization-csv-import:<organizationId>` and do **not** acquire Phase 3A readiness, Phase 3B config, Phase 4A/4B knowledge, or Phase 4C offerings locks.

Write order:

1. Pre-transaction authorization: authenticated, verified, selected organization, active membership, `org.knowledge.manage`
2. Internal `validateMappedCsvFile`
3. Reject incomplete results with no database writes
4. Open a transaction
5. Acquire the CSV import advisory lock
6. Recheck membership and permission with `FOR UPDATE`
7. Lookup `(organizationId, importIdentity)`
8. Return the existing import without an audit event, or insert the import, rows, and one `CSV_IMPORT_STAGED` audit event
9. On a unique-constraint conflict, re-read the existing organization-scoped import and return it without a second audit event

## Retry and conflict recovery

Idempotency is enforced by the unique `(organizationId, importIdentity)` constraint plus the organization-scoped advisory lock. There is no in-memory mutex and no client-provided canonical identity.

Sequential retries and truly concurrent retries of the same organization/source/mapping/contract return the same import, the same row set, and a single audit event.

No new serialization library is used. Official `JSON.stringify` on objects rebuilt with a fixed property order is sufficient because mapping entries are sorted by `sourceColumn` (then `target`) before serialization.

## Immutable row representation

Rows are stored in source order as `displayOrder` 0..n-1. `sourceRowNumber` remains the original one-based CSV row number. Mapped values are rebuilt in canonical mapping-target order with `{ kind, value }` properties. Issues are rebuilt as `{ sourceRowNumber, sourceColumn, targetField, code }`.

Get returns those recanonicalized rows. There is no organization-wide unbounded list in this task.

## Privacy and audit

`CSV_IMPORT_STAGED` is emitted only when a new import is created. Metadata may include import ID, family, status, counts, checksum/identity prefixes, and contract version. It must not include raw rows, mapped values, mapping payloads, unsafe path filenames, secrets, or error payloads.

Thrown and returned errors stay static and payload-free.

## Failure recovery

| Failure | Persistence | Recovery |
|---|---|---|
| Unauthenticated / unverified / inactive / forbidden / wrong organization | None | Correct actor or membership |
| Timeout / malformed / parser-attention / over-limit / XLSX | None | Supply a new file or mapping |
| Incomplete / issue-cap early stop | None | File is already invalid; do not treat counts as exact |
| Unique identity retry | Existing import | Return the original snapshot |
| Mid-insert exception | Rolled back | No partial import or rows remain |

## Next confirmation dependency

A later Phase 4D confirmation task may load one authorized import through `getCsvImport`, require `READY_TO_CONFIRM`, and then create knowledge or offering drafts. That task does not exist yet. Staged `NEEDS_ATTENTION` imports are not confirmable. Incomplete validator results are not reviewable snapshots.

`MR-4D-OOXML-001` remains OPEN. This module rejects XLSX and does not consume an XLSX preview.
