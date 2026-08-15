# Phase 4D — Tabular Import Hardening

Status: Validation/preview foundation in progress on `feature/phase-04d-tabular-validation-foundation`  
Depends on: Phase 4B squash-merged into `develop` at `d446ca52c1c8397d8b24bf7c2dc009b14800808d` (PR #10) and the Phase 4C structured-offering catalog on the same `develop` tree

This document is the Phase 4D contract for **task 1 only**: a server-only, bounded CSV/XLSX validation and normalized-preview module. Later Phase 4D tasks own upload UI, mapping persistence, import records, jobs, activation, and connectors.

## Task boundary

This foundation:

- Accepts caller-supplied bytes, an original filename, and a declared MIME type
- Returns a deterministic normalized preview suitable for a later customer-reviewed column-mapping flow
- Fails closed on unsupported, mismatched, malformed, encrypted, macro-enabled, polyglot, traversal, or over-limit input
- Does **not** upload, store, persist, activate, retrieve, or confirm imported knowledge or offerings

Explicitly deferred:

- Authorized upload routes, browser forms, and server actions
- Column mapping UI and saved mapping templates
- Import records, background jobs, progress, retry, and idempotent persistence
- Offering/knowledge creation, activation, confirmation, and retrieval integration
- Live commerce, CRM, inventory, pricing, or scheduling connectors
- Database schema or Prisma migrations
- Storage bucket changes and production credentials

## Trust boundaries

- Browser MIME types and filenames are untrusted hints. Extension, declared MIME, and server-detected signature/content must agree.
- Parsing is server-only (`server-only` module) and independent from production storage, scanner credentials, and document extraction.
- Spreadsheet content is untrusted data. Formulas, cached formula results, hyperlinks, and external workbook links are never evaluated or fetched.
- Safe errors expose machine codes and source locations only. They must not include file bytes, full rows, formula text, URLs, or secrets.
- Preview rows are a bounded, customer-facing mapping aid. They are not an audit log and are not written by this task.
- This module does not weaken Phase 4B PDF/DOCX/TXT validation and does not treat CSV/XLSX as extractable documents.

## Accepted formats

| Kind | Extension | Declared MIME | Server signature |
|---|---|---|---|
| CSV | `.csv` | `text/csv` | Valid UTF-8 text; not ZIP, OLE, PDF, or executable |
| XLSX | `.xlsx` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | ZIP local-file signature `PK\x03\x04` plus spreadsheet workbook parts |

Rejected:

- Legacy `.xls` / OLE compound files
- Macro-enabled `.xlsm`, `.xlsb`, `.xltm`, and `macroEnabled` content types
- Archives, executables, PDFs, DOCX, TXT, ODS, and other non-tabular types
- Encrypted or password-protected workbooks (ZIP encryption flag, `EncryptionInfo`, or encrypted content types)
- Polyglots, nested archives, ZIP64, and ZIP path traversal
- Extension/MIME/signature disagreement

## Limits

| Limit | Value |
|---|---|
| File size | 5 MiB |
| Worksheets | 16 |
| Rows (including header) | 10,000 |
| Columns | 100 |
| Cell length | 4,000 characters |
| Aggregate cell text | 1,000,000 characters |
| Preview data rows | 50 |
| Parse/validation time | 2,000 ms |
| ZIP entries | 1,000 |
| ZIP expanded total | 50 MiB |
| ZIP expanded entry | 20 MiB |
| ZIP per-entry ratio | 100:1 |
| ZIP total ratio | 50:1 |

Limits are enforced at the boundary (accepted) and one past it (rejected). CSV trailing whitespace is ignored after size checks so a maximum-size file can still be a small valid table.

## Normalized preview contract

`validateTabularImport({ bytes, filename, declaredMimeType })` either throws `TabularValidationError` or returns:

| Field | Meaning |
|---|---|
| `outcome` | `ready` when a single usable sheet has unique non-blank headers and no attention issues; otherwise `needs_attention` |
| `kind` | `csv` or `xlsx` |
| `filename` | Sanitized leaf name |
| `mimeType` | Canonical MIME for the validated kind |
| `byteLength` | Original byte size |
| `sha256` | SHA-256 of the original bytes (hex), for later idempotency |
| `sheets` | Stable workbook order with visibility (`visible` / `hidden` / `veryHidden`) |
| `selectedSheet` | The one visible non-empty sheet, or `null` when zero or multiple candidates exist |
| `headers` | Source column positions, display names, and whitespace-normalized names |
| `previewRows` | At most 50 data rows with 1-based source row numbers |
| `totalRowCount` / `totalColumnCount` | Data rows and header-derived columns when a sheet is selected |
| `issues` | Safe codes plus optional sheet/row/column locations; no cell payloads |

CSV is modeled as a single visible sheet named `Sheet1`.

The parser does **not** silently choose among multiple visible worksheets or invent a header row. Ambiguous workbooks return `needs_attention` with `selectedSheet: null` and empty preview rows so a later UI can ask the customer.

## Formula, link, and header behavior

- `<f>` formula cells stay inert. Cached `<v>` values may appear in the preview and are flagged as `cached_formula` or `formula`.
- CSV fields and literal string-bearing XLSX cells (`t="s"`, `t="inlineStr"`, `t="str"`, or inline `<is>`) are classified from the untrimmed source. A leading spreadsheet execution prefix (`=`, `+`, `-`, `@`, tab, CR, or LF) is flagged `formula_like` and left as literal text after ordinary whitespace normalization. Numeric, boolean, and other non-string XLSX cell types are not flagged merely because a cached number such as `-12.5` is negative. Issue objects stay payload-free.
- Hyperlinks and `xl/externalLinks/` are flagged and never fetched.
- Hidden and very-hidden sheets are listed and flagged; they are never auto-selected when a visible candidate exists.
- Merged cells are flagged and not expanded.
- Blank or duplicate headers (case-insensitive, whitespace-normalized) yield `needs_attention`.
- XML comments, CDATA, and processing instructions are ignored as markup. CDATA character data is preserved as ordinary text after escaping, so embedded `<sheet>`, `<Relationship>`, `<c>`, `<f>`, `<hyperlink>`, or `<mergeCell>` payloads cannot create workbook evidence. Only real OOXML elements in the required workbook, relationship, and worksheet locations are consumed. Duplicate cell coordinates fail closed as `malformed`.
- Aggregate character limits count every populated CSV field and XLSX cell once, including extra columns and hidden sheets, without widening the header-derived preview.
- `[Content_Types].xml` must bind the non-macro workbook main content type to the canonical `/xl/workbook.xml` part, including namespace-prefixed `Override` elements.

## Safe errors

Hard failures throw `TabularValidationError` with a stable `code` and a static message:

`empty`, `too_large`, `filename`, `unsupported_type`, `type_mismatch`, `invalid_signature`, `malformed`, `encrypted`, `macros`, `polyglot`, `zip_bomb`, `binary_text`, `invalid_encoding`, `too_many_rows`, `too_many_columns`, `too_many_sheets`, `cell_too_long`, `text_too_large`, `timeout`

Parseable-but-attention results stay in the preview model. Neither thrown errors nor issue objects include file bytes, full rows, formulas, URLs, or secrets. Causes from ZIP/XML libraries are not attached, to avoid leaking entry payloads.

## Dependency choice

No new runtime parser dependency is added.

- CSV is parsed by a bounded RFC 4180-style state machine in this repository (UTF-8 BOM, CRLF/LF/CR, quoted commas/newlines, escaped quotes, trailing blank rows). Bytes after a closing quote other than a delimiter, CR/LF, or end-of-input fail closed as `malformed`.
- XLSX reuses the existing `jszip` dependency already required for DOCX ZIP inspection, with the same class of entry/expansion/ratio/nesting/time guards. Worksheet XML comments, processing instructions, and CDATA wrappers are stripped with a bounded scanner that preserves quoted attributes; CDATA payloads are reinserted as escaped character data so later tag scans cannot see non-element markup. Markup is then read only from the required OOXML elements. There is no general XML tree, DTD/entity expansion, or formula evaluation.

Adding SheetJS, ExcelJS, or a second CSV library would overlap this fail-closed ZIP/XML approach and increase the formula-evaluation risk surface. `package-lock.json` is unchanged.

## Recovery expectations

- Over-limit, encrypted, macro, polyglot, and signature failures are terminal for this parse attempt. The caller must not retry the same bytes without a new customer file.
- `needs_attention` is recoverable in a later UI: choose a sheet, fix headers, or acknowledge formulas/links before mapping.
- Leftover claims, storage objects, and jobs are out of scope; this module is pure validation.
- Existing Phase 4A–4C knowledge/offering recovery protocols are unchanged.

## Relationship to other Phase 4 work

- Phase 4A remains the manual knowledge editor.
- Phase 4B remains the only PDF/DOCX/TXT upload and extraction path. CSV/XLSX still fail document validation.
- Phase 4C remains the structured offering catalog. This task does not create offerings.
- Later Phase 4D tasks must consume this normalized preview rather than re-parsing untrusted bytes with a second library.
