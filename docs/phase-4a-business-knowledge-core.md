# Phase 4A — Manual Business Knowledge core

Status: Implemented on `feature/phase-04a-business-knowledge-core`  
Depends on: Phase 3B final commit on `develop` (`d7579ad15d1c7c9d49ef8b3ff20098f95d19e583`, merged in `268ca0f`)

## Scope

1. Manual editor for policies, explanations, scripts, FAQs, disclosures, objection handling, and other organization-authored reference content
2. Organization-scoped logical knowledge sources and immutable source versions
3. Version-scoped sections and passages with stable citation identifiers
4. Draft update, preview, confirmation, activation, replacement, archive, and restore
5. Restore by creating a new draft from historical confirmed content (never rewriting that history)
6. Server-controlled confirmation statement and confirmation-language version `knowledge.confirm.v1`
7. Search, filtering, deterministic ordering, pagination, effective dates, and freshness metadata
8. Reusable server-side retrieval of currently effective, customer-confirmed, ACTIVE knowledge
9. Permission-controlled list, editor, preview, confirmation, history, archive, and restore UI
10. Deterministic concurrency coverage for same-version activation, membership demotion/deactivation, and archive races

## Explicit exclusions

Phase 4A does **not**:

- Store or process uploaded files (PDF/DOCX/TXT)
- Scan malware, extract documents, or use `PROCESSING` / `NEEDS_ATTENTION` / `FAILED` writers
- Import CSV/XLSX
- Expand structured offerings or prices (Phase 3 catalogues remain unconfirmed operational records, not Business Knowledge)
- Add embeddings, AI generation, or live connectors
- Claim that confirmed content is true or legally valid

Those capabilities remain reserved for Phases 4B–4D and later AI phases.

## Domain model

| Concern | Persistence |
|---|---|
| Logical source | `KnowledgeSource` (org-scoped, OCC `version`) |
| Immutable version | `KnowledgeVersion` (draft OCC `draftRevision`; confirmation fields frozen after activation) |
| Sections / passages | `KnowledgeSection`, `KnowledgePassage` with stored `citationKey` |
| Input kind | `KnowledgeInputKind.MANUAL` only |
| Source class | `KnowledgeSourceCategory`; 4A activates only `CUSTOMER_CONFIRMED_BUSINESS_FACTS` |
| Lifecycle | `KnowledgeLifecycleState`: `DRAFT`, `PROCESSING`, `NEEDS_ATTENTION`, `ACTIVE`, `SUPERSEDED`, `ARCHIVED`, `FAILED` |

Manual writers use `DRAFT` → `ACTIVE` → `SUPERSEDED` / `ARCHIVED`. The remaining states exist for the shared Phase 4 contract and are never set by 4A UI.

## Confirmation

Activation is the confirmation gate. Outreach does not review content for truth or legality.

Server-controlled statement (`KNOWLEDGE_CONFIRMATION_STATEMENT`) and language version (`knowledge.confirm.v1`) are stored on the confirmed version. The browser cannot supply confirmer identity, timestamp, language version, checksum, lifecycle state, audit fields, or organization ownership.

Confirmation evidence is immutable. `confirmerUserId`, `confirmedAt`, and `confirmationLanguageVersion` stay together, and the confirmer user FK is `ON DELETE RESTRICT`. Users referenced by that evidence cannot be hard-deleted until a future explicit retention/anonymization workflow safely replaces the identity. Ordinary membership deactivation and demotion do not rewrite or clear confirmation fields.

The activation transaction:

1. Authenticates
2. Resolves the organization from the protected route
3. Rechecks active membership and `org.knowledge.confirm` in-transaction
4. Follows the documented lock order
5. Locks the logical source and version
6. Validates `expectedDraftRevision`
7. Recomputes the checksum from persisted preview content and requires it to match the previewed checksum
8. Requires explicit confirmation
9. Records server-derived confirmer, timestamp, and language version
10. Activates that exact version
11. Supersedes any previous ACTIVE version
12. Writes exactly one `KNOWLEDGE_VERSION_CONFIRMED` audit

## Retrieval

`retrieveActiveKnowledge`, member `listKnowledgeSources`, `getKnowledgeSource`, and `getKnowledgeVersion` share one SQL predicate (`memberVisibleSourceWhere` + `memberVisibleVersionWhere`):

- Source: `archivedAt` null, `inputKind: MANUAL`, `category: CUSTOMER_CONFIRMED_BUSINESS_FACTS`
- Version: `ACTIVE`, `confirmedAt` and `confirmationLanguageVersion` not null, `effectiveFrom` null or `<= now`, `effectiveUntil` null or `> now`

Members never receive draft, future, expired, archived, superseded, unconfirmed, other-category, or other-input-kind rows. Direct lookups of those IDs — including `getKnowledgeVersion` — return the same `not_found` and the same message as an unknown ID or another tenant's ID. Member list search, ordering, count, and pagination run in SQL after that visibility filter, use the currently effective ACTIVE version title (not denormalized `KnowledgeSource.title` or an unconfirmed replacement-draft title), and omit `draftRevision`, checksums, confirmer fields, and historical IDs.

`sourceTitle` in retrieval is the ACTIVE version title. `KnowledgeSource.title` is promoted from a version only on confirmation. Draft updates and restores do not overwrite it while an ACTIVE version exists.

Owners/admins keep full history.

Excluded before pagination: draft, processing, needs-attention, failed, superseded, archived, unconfirmed, future-dated, expired, other source classes, and cross-tenant rows.

Search is case-insensitive substring matching on version title, section title, and passage body. `%`, `_`, and `\` are stripped. This is not ranked full-text search.

Ordering is deterministic: version title, version id, section display order, passage display order, passage id.

## Authorization

- `org.knowledge.read` — OWNER, ADMIN, MEMBER (currently effective confirmed knowledge)
- `org.knowledge.manage` — OWNER, ADMIN (create/edit drafts, replacement drafts, preview)
- `org.knowledge.confirm` — OWNER, ADMIN (activation)
- `org.knowledge.archive` — OWNER, ADMIN (archive and restore)

UI visibility is not authorization. Mutations recheck membership and permission after the membership lock.

## Effective times

Authoritative zone is server-loaded `BusinessProfile.timeZone` (IANA). The browser timezone is never trusted.

`datetime-local` values are wall clocks in that zone, converted to UTC before range checks, checksum, and persist (`TIMESTAMPTZ(3)`). Rendering converts UTC back to the org zone and shows the IANA name beside inputs.

- DST gap: rejected with a field error
- Repeated local time: requires an explicit `earlier` or `later` choice
- Missing timezone: undated drafts are allowed; dated drafts are rejected with a field error and a settings link

## Transactions and lock ordering

Phase 4A writers use lock key `organization-knowledge:<organizationId>` and **do not** acquire Phase 3A readiness or Phase 3B config locks.

Order:

1. Phase 4A knowledge advisory lock
2. Actor membership row `FOR UPDATE` + permission recheck
3. Logical source row `FOR UPDATE`
4. Version row(s) `FOR UPDATE` in stable id order (confirm: the target version; archive: ACTIVE and DRAFT versions)
5. Section/passage rows in stable order

Deadlock safety vs Phase 3A/3B: the families share only membership row locks. If a future writer must take multiple advisory families, acquire Phase 3A readiness, then Phase 3B config, then Phase 4A knowledge.

Draft updates and confirmation use `updateMany` predicates (`organizationId`, ids, `state: DRAFT`, `draftRevision`). Archive/restore use source `version`. Stale requests conflict with zero domain writes and zero success audits.

## Audit events

Success-only: `KNOWLEDGE_SOURCE_CREATED`, `KNOWLEDGE_DRAFT_UPDATED`, `KNOWLEDGE_REPLACEMENT_DRAFT_CREATED`, `KNOWLEDGE_VERSION_CONFIRMED`, `KNOWLEDGE_SOURCE_ARCHIVED`, `KNOWLEDGE_VERSION_RESTORED`

Metadata is limited to identifiers, checksum, language version, and restored/superseded version ids. Full knowledge bodies are never stored.

## Migration

Forward-only migrations:

`prisma/migrations/20260814000000_phase_04a_business_knowledge_core`

- Additive audit enum values
- Knowledge enums and tenant-scoped tables, composite tenant FKs, partial unique indexes (at most one ACTIVE and one DRAFT version per source)
- Does not edit Phase 1–3B migrations

`prisma/migrations/20260814120000_phase_04a_knowledge_ancestry`

- Immediate-parent composite FKs: Version `(sourceId, organizationId)`; Section `(versionId, organizationId, sourceId)`; Passage `(sectionId, organizationId, sourceId, versionId)`
- `supersedesVersionId` / `restoredFromVersionId` `(id, organizationId, sourceId)` with `ON DELETE NO ACTION` (SQL-only; Prisma cannot share those scalar columns with the source relation)
- Checks: effective range; confirmation fields all-null or all-present; ACTIVE/SUPERSEDED require confirmation; DRAFT forbids confirmation metadata
- `effectiveFrom` / `effectiveUntil` migrated to `TIMESTAMPTZ(3)`
- Apply only to disposable local and CI PostgreSQL — not Supabase/production from this branch workflow

`prisma/migrations/20260814140000_phase_04a_confirmer_retention`

- Recreates `KnowledgeVersion_confirmerUserId_fkey` as `ON DELETE RESTRICT` so hard-deleting a confirmer cannot null only `confirmerUserId` and trip the confirmation-field checks
- Does not weaken confirmation consistency checks
- Apply only to disposable local and CI PostgreSQL — not Supabase/production from this branch workflow

## UI routes

- `/app/orgs/[slug]/knowledge`
- `/app/orgs/[slug]/knowledge/new`
- `/app/orgs/[slug]/knowledge/[sourceId]`
- `/app/orgs/[slug]/knowledge/[sourceId]/edit`
- `/app/orgs/[slug]/knowledge/[sourceId]/versions/[versionId]`

## Test strategy

- Unit: `lib/orgs/knowledge-validation.test.ts`, `lib/time/organization-datetime.test.ts`, permission coverage in `lib/orgs/permissions.test.ts`
- Integration: `tests/integration/knowledge.*.test.ts` including schema-integrity, concurrency gates, and action boundaries
- Playwright: `e2e/knowledge.spec.ts` (create → retrieve → replacement → confirm → archive → restore draft → reconfirm)
- Phase 0–3B regression must remain green
- Concurrency evidence uses deterministic gates/held locks — not sleeps

## Manual setup

1. Use a disposable local Postgres (port **5433** for tests)
2. `npm ci`
3. `npm run prisma:migrate:deploy`
4. `npm run dev` / `npm run test:integration` / `npm run test:e2e`

No Twilio credentials are required. Do not apply this migration to hosted Supabase from this branch.

## Deferred work

- Phase 4B: private document upload, malware scanning, extraction, `PROCESSING` / `NEEDS_ATTENTION` / `FAILED`
- Phase 4C: structured offerings and pricing as confirmable knowledge
- Phase 4D: CSV/XLSX import and cross-source hardening
- Duplicate/near-duplicate warnings, ranked full-text search, call/suggestion usage attribution, and AI grounding (later phases)
