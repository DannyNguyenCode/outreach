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
- Multipart requests are stream-bounded to **10 MiB + 256 KiB overhead** before parsing; oversized and chunked bodies receive `413`
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

## Deployment request limit

The application enforces its own bounded multipart reader and 10 MiB document
limit without trusting `Content-Length`. Vercel Functions also impose a lower
4.5 MiB request/response body limit and return an infrastructure `413` before a
Route Handler runs. Deployments that must accept documents above that platform
limit require a direct signed-storage upload flow; changing Next.js body-size
configuration does not raise Vercel's limit.

## Worker invocation

Minimal Phase 4B durable jobs (`KnowledgeDocumentJob`) are claimed by:

`POST /api/internal/knowledge-documents/process`

Authorization: `Authorization: Bearer $KNOWLEDGE_WORKER_TOKEN`

Staging configuration options:

- Cron / scheduler calling the endpoint every minute
- Manual operator trigger during verification

Worker protocol (two-stage; never invert lock order):

1. Candidate reservation or claim may use a short committed `FOR UPDATE SKIP LOCKED` transaction that touches only `KnowledgeDocumentJob`
2. That transaction must commit and release the job row before the worker waits on `organization-knowledge:<organizationId>`
3. Graph mutation (document attach after claim, scan-state transition, publish, retry/failure, exhausted-lease terminalization) then:
   - acquires the organization knowledge advisory lock
   - locks source → version → document → job
   - revalidates job state, lease owner/expiry, attempt count, document state, version state, and tenant identifiers
   - applies a conditional, idempotent update so a stale worker cannot overwrite a newer retry, publication, archive, restore, or other lifecycle transition
   - a stale retry/failure result is a no-op: it does not requeue work, change source/version/document lifecycle, or write a processing-failure audit. Leftover claims are left to the bounded lease/recovery protocol
4. Concurrent exhausted-lease sweepers produce at most one terminal job/document/version result and one failure audit

This is intentionally not Phase 12’s general-purpose job platform.

## Lifecycle

| Stage | Version state | Document processing state |
|---|---|---|
| Upload created | `PROCESSING` | `UPLOADING` → `QUEUED` |
| Clean extraction | `DRAFT` | `COMPLETE` |
| Recoverable structural issues | `NEEDS_ATTENTION` | `NEEDS_ATTENTION` |
| Unsafe/unrecoverable | `FAILED` | `FAILED` |
| Interrupted upload | removed after cleanup, or temporary `FAILED` | temporary `ABANDONED` |
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

Background workers have no membership row. After the short job reservation/claim is released, they acquire the organization knowledge lock first, then source → version → document → job → sections/passages. They never lock a job and then wait for source, version, or document locks.

## Retries and recovery

- Deterministic job idempotency key: version + binary checksum + extractor version
- Bounded exponential backoff
- Permanent vs retryable classification
- Exactly one successful extraction publication
- Upload/storage/finalization failures atomically become non-runnable before object deletion
- Successful compensation removes the unfinished graph and restores replacement OCC
- Failed object deletion remains `FAILED` / `ABANDONED`; the worker retries tenant-scoped cleanup after 15 minutes
- Compensation and cleanup are idempotent and never act on finalized documents

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
