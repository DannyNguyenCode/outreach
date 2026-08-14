# Phase 4B — Private Document Upload and Processing

Status: Implemented on `feature/phase-04b-private-document-processing`  
Depends on: Phase 4A approved SHA `ec1b81d9f2d75885639c9a36e1094621db971b01` merged into `develop`

## Architecture and trust boundaries

Phase 4B extends the Phase 4A knowledge lifecycle. It does **not** create a second knowledge system.

Trust boundaries:

- Browser clients never choose a storage bucket or object key.
- Supabase service-role credentials remain server-only.
- Malware scan results supplied by clients are ignored.
- Extraction stores plain structured text only. Uploaded content is untrusted data.
- Member retrieval continues to require confirmed `ACTIVE` customer-confirmed facts.
- Polling is UI-only. Processing correctness depends on durable database state.

## Supported formats and limits

- Extensions: `.pdf`, `.docx`, `.txt`
- Declared MIME must agree with extension and server-detected signature
- Maximum size: **10 MiB**
- PDF page cap: **40 pages** (aligned with knowledge section limits; enforced before page iteration)
- DOCX ZIP bomb protections: entry count, expanded size, compression ratio, nesting, and validation time
- TXT must be valid UTF-8 and not NUL/binary-heavy
- Rejected: DOC, DOCM, CSV/XLSX, archives, executables, encrypted/unreadable documents, polyglots, nested archives

## Storage setup (Staging only)

1. Create a **private** Supabase Storage bucket named `knowledge-documents-private` (or the value of `KNOWLEDGE_STORAGE_BUCKET`).
2. Disable public access. Do not create a public policy for reads or writes.
3. Prefer no client-facing storage policies. Outreach uses the service role exclusively from trusted server code.
4. Document object keys are server-generated as `org/<hashedOrgPrefix>/<random>.<ext>`.
5. Do not apply this automatically to Production from the Phase 4B branch workflow.

## Environment variables

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Outreach-managed Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only service role |
| `KNOWLEDGE_STORAGE_BUCKET` | Private bucket name |
| `MALWARE_SCANNER_URL` | HTTPS scanner endpoint |
| `MALWARE_SCANNER_API_KEY` | Scanner credential |
| `MALWARE_SCANNER_NAME` / `MALWARE_SCANNER_VERSION` | Stored safe scan metadata |
| `KNOWLEDGE_WORKER_TOKEN` | Bearer token for the internal worker endpoint |
| `KNOWLEDGE_DOCUMENT_ADAPTER_MODE=fake` | Local/CI only; Production rejects this |

Never log signed URLs, credentials, file bytes, or full extracted text.

## Scanner setup

Production fails closed when:

- scanner configuration is missing
- timeout / network / malformed response occurs
- verdict is unknown/indeterminate
- checksum mismatch occurs
- verdict is infected

Only a clean verdict for the exact uploaded SHA-256 may proceed to extraction.

CI and automated tests inject deterministic scanners and never contact malware providers.

## Worker invocation

Minimal Phase 4B durable jobs (`KnowledgeDocumentJob`) are claimed by:

`POST /api/internal/knowledge-documents/process`

Authorization: `Authorization: Bearer $KNOWLEDGE_WORKER_TOKEN`

Staging configuration options:

- Cron / scheduler calling the endpoint every minute
- Manual operator trigger during verification

Worker protocol:

1. Claim one job in a short committed transaction (`FOR UPDATE SKIP LOCKED`)
2. Release the claim transaction before waiting on the organization knowledge advisory lock
3. Download, scan, extract, then publish under the documented lock order

This is intentionally not Phase 12’s general-purpose job platform.

## Lifecycle

| Stage | Version state | Document processing state |
|---|---|---|
| Upload created | `PROCESSING` | `UPLOADING` → `QUEUED` |
| Clean extraction | `DRAFT` | `COMPLETE` |
| Recoverable structural issues | `NEEDS_ATTENTION` | `NEEDS_ATTENTION` |
| Unsafe/unrecoverable | `FAILED` | `FAILED` |
| Explicit confirmation | `ACTIVE` | unchanged evidence |
| Replacement confirmation | prior `SUPERSEDED` | prior object retained |
| Archive | `ARCHIVED` | objects retained |

DOCUMENT confirmation additionally requires:

- malware status `CLEAN`
- processing complete
- binary checksum equals scanned checksum
- content checksum matches the exact preview
- no unresolved blocking processing issues

## Lock order

User writers (same Phase 4A family):

1. `organization-knowledge:<organizationId>` advisory lock
2. Actor membership `FOR UPDATE` + permission recheck
3. Source row `FOR UPDATE`
4. Version rows in stable ID order
5. Document / job / section / passage rows in documented stable order

Background workers have no membership row. They acquire the organization knowledge lock first, then source → version → document → job → sections/passages. They never invert that order.

## Retries and recovery

- Deterministic job idempotency key: version + binary checksum + extractor version
- Bounded exponential backoff
- Permanent vs retryable classification
- Exactly one successful extraction publication
- Storage-success / DB-finalization failure leaves an inspectable `UPLOADING` or queued object for reconciliation
- Abandoned uploads with missing objects can be marked `ABANDONED`

## Duplicate warnings

Organization-scoped warnings for:

- exact binary checksum
- exact normalized extracted content checksum
- bounded non-AI near-duplicate text comparison

Duplicates are never silently activated or merged. The authorized reviewer must acknowledge or continue reviewing the exact version.

## Retention

Archive and replacement preserve:

- original private objects
- extracted structure
- checksums and scan evidence
- confirmation history and audits

Physical deletion of retained documents is deferred to a future retention/deletion workflow.

## Manual Staging verification

1. Configure private bucket + scanner + worker token
2. Upload a TXT/PDF/DOCX as owner/admin
3. Invoke the worker endpoint
4. Preview extracted text, acknowledge any duplicate warning, confirm
5. Verify member retrieval shows citations and excludes processing/unconfirmed versions
6. Replace and archive; confirm original objects remain
7. Attempt cross-tenant download and confirm denial

## Deferred work

- Phase 4C structured offerings
- Phase 4D CSV/XLSX imports
- Phase 12 shared job platform generalization
- AI extraction, embeddings, ranked search, and call-attribution of knowledge usage

## Security decisions

- Fail closed on malware uncertainty
- No public document URLs
- No HTML injection of extracted content
- No AI summarization or prompt execution of uploaded text
- Schema changes only through forward-only Prisma migrations
