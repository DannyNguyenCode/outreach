<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:outreach-automation -->

# Outreach Automation Handoff

~~~yaml
task_id: phase-04d-csv-import-draft-persistence-001
phase: "Phase 4D — CSV import draft persistence foundation"
active_branch: feature/phase-04d-csv-import-draft-persistence
base_develop_sha: 60ceecfbc472835faf6212601a0732f4f1b12371
cursor_implementation_sha: 50051ae5dc094bf06bb761686e39cb08e6ad5a2e
last_reviewed_sha: null
status: READY_FOR_REVIEW
previous_task_status: MERGED
previous_pr_number: 15
previous_develop_merge_sha: 60ceecfbc472835faf6212601a0732f4f1b12371
cursor_attempt_count: 0
cursor_attempt_count_legacy: true
blocker_set_revision: 0
blocker_set_signature: []
blocker_attempt_count: 0
blocker_history: []
consecutive_unchanged_checks: 0
last_cursor_activity_sha: 50051ae5dc094bf06bb761686e39cb08e6ad5a2e
stop_reason: null
unchanged_check_times: []
cursor_claimed_at: "2026-08-15T22:05:43Z"
cursor_completed_at: "2026-08-15T22:17:32Z"
cursor_claim_sha: 016994c7d90a9fa3bb52da168f76894eac49d249
cursor_lease_id: null
cursor_lease_expires_at: null
cursor_heartbeat_at: "2026-08-15T22:17:32Z"
cursor_checkpoint_sha: 50051ae5dc094bf06bb761686e39cb08e6ad5a2e
cursor_checkpoint_summary: "CSV import draft persistence is committed at 50051ae5dc094bf06bb761686e39cb08e6ad5a2e: Prisma CsvImport/CsvImportRow plus immutable-update triggers, server-owned identity, stage/get with org.knowledge.manage and organization-csv-import lock, official-template/invalid/incomplete/XLSX/auth/idempotency/concurrency coverage, and docs/phase-4d-csv-import-draft-persistence.md. Focused unit 7 files/110 passed; focused integration 4 files/14 passed. Next: format:check, lint, typecheck, prisma:validate, fresh migrate, npm test, test:integration, build, CI=true test:e2e, audit, committed-range git diff --check, exact-head GitHub Actions."
cursor_resume_count: 0
cursor_report: |
  CSV import draft persistence foundation completed at implementation SHA 50051ae5dc094bf06bb761686e39cb08e6ad5a2e (claim 016994c7d90a9fa3bb52da168f76894eac49d249). Objective: add a server-only, tenant-scoped, retry-safe snapshot of one complete CSV mapped-validation result without creating knowledge/offering domain records, UI, jobs, or XLSX consumption, and without changing the OPEN MR-4D-OOXML-001 flag.
  Requirements/acceptance: stageCsvImport revalidates original bytes through validateMappedCsvFile and never trusts caller-supplied preview, checksum, identity, counts, rows, status, or persistenceEligible values. Authenticated verified actors with a selected organization, active membership, and org.knowledge.manage are required; membership and permission are rechecked after the organization-csv-import advisory lock. Complete valid files persist as READY_TO_CONFIRM; complete invalid files persist as NEEDS_ATTENTION with exact counts and static issues. Timeout, malformed, parser-attention, issue-cap/incomplete, over-limit, and XLSX results create no import, row, or audit records. Import identity is SHA-256 of organization, family, source checksum, canonical mapping identity, and csv-import.v1. Sequential and concurrent retries return one import, one row set, and one CSV_IMPORT_STAGED audit event. Mapping and row payloads are stored as TEXT and recanonicalized on read. Database constraints and update triggers keep staged content immutable and organization-scoped. getCsvImport returns one authorized import with deterministic ordered rows. MR-4D-OOXML-001 remains OPEN.
  Files changed: lib/orgs/csv-import.ts; lib/orgs/csv-import-access.ts; lib/orgs/csv-import-identity.ts; lib/orgs/csv-import.test.ts; lib/orgs/csv-import-identity.test.ts; prisma/schema.prisma; prisma/migrations/20260815220000_phase_04d_csv_import_draft_persistence/migration.sql; tests/integration/reset.ts; tests/integration/helpers/csv-import.ts; tests/integration/csv-import.schema.test.ts; tests/integration/csv-import.security.test.ts; tests/integration/csv-import.lifecycle.test.ts; tests/integration/csv-import.concurrency.test.ts; docs/phase-4d-csv-import-draft-persistence.md. One forward-only migration added. No new runtime dependency.
  Tests added/updated: identity stability across permuted mappings and changed org/bytes/family/contract; module-boundary source checks; schema unique/FK/check/immutability constraints; unauthenticated/unverified/inactive/wrong-selected/missing-permission/cross-tenant denial; official knowledge and offering template staging; complete-invalid NEEDS_ATTENTION; timeout/malformed/formula/incomplete/over-limit/XLSX zero side effects; sequential and concurrent idempotent retries; changed identity isolation; canonical row-order round trip; transaction rollback; exact-cap complete persist; no KnowledgeSource/KnowledgeVersion/Offering/OfferingVersion/document/job/retrieval writes. Existing Phase 4A-4D regressions kept green.
  Commands and exact results on this implementation head:
  - npm ci: added 564 packages, audited 565, 0 vulnerabilities
  - focused unit tests (csv-import, identity, complete-file, mapping, templates, tabular-validation, security): 7 files, 110 passed
  - focused integration tests (schema, security, lifecycle, concurrency): 4 files, 14 passed
  - npm run format:check: All matched files use Prettier code style
  - npm run lint: exit 0
  - npm run typecheck: next typegen + tsc --noEmit succeeded
  - npm run prisma:validate: schema valid with DATABASE_URL/DIRECT_URL set
  - fresh DROP/CREATE outreach_ci + outreach_test + npm run prisma:migrate:deploy: 12 migrations applied through Phase 4D CSV import draft persistence
  - npm test: 35 files, 367 passed
  - npm run test:integration: 45 files, 502 passed
  - npm run build: Next.js 16.3.0 compiled successfully
  - CI=true npm run test:e2e: 16 passed (29.9s)
  - npm audit --omit=dev: found 0 vulnerabilities
  - git diff --check 60ceecfbc472835faf6212601a0732f4f1b12371..50051ae5dc094bf06bb761686e39cb08e6ad5a2e: exit 0
  - GitHub Actions: exact-head verify is required on the READY_FOR_REVIEW completion-report SHA after this push.
  Authorization/tenant isolation: writes and gets require verified active membership and org.knowledge.manage. Foreign import IDs are indistinguishable from not found. Cross-organization row attachment is rejected by composite FK. The same file in another organization produces a different organization-owned identity and record.
  Security/privacy: server-only module; XLSX rejected before persistence; raw bytes, formulas, secrets, stack traces, fetched URLs, and mapping payloads are excluded from audit metadata. Errors stay static and payload-free. Mapped values exist only on authorized get/stage snapshots.
  Failure/recovery: validation failures and incomplete results write nothing. Unique-constraint races re-read the existing import without a second audit event. Mid-insert exceptions roll back the transaction so no partial import or rows remain.
  Manual configuration still required: none for this task.
  Assumptions: no client idempotency key is accepted because existing Phase 4 writers derive server-owned identities. Official JSON.stringify on rebuilt objects is sufficient; no extra serializer was added. Get requires org.knowledge.manage, matching later review work rather than member-visible retrieval.
  Remaining risks: staged imports are not confirmed, activated, listed, or checked for duplicates against existing records. MR-4D-OOXML-001 remains OPEN pending Bao's explicit removal instruction.
  Deferred work: mapping UI, upload/download routes, raw-file storage, saved templates, row editing, duplicate/existing-record conflicts, confirmation, activation, jobs, live connectors, and Phase 5. No PR opened; ChatGPT owns the develop merge gate. Blocker-set revision 0, empty signature, attempt count 0, and empty history were preserved exactly.
review_findings: |
  PR #15 passed review and exact-head CI run 31909884395, then squash-merged to develop at 60ceecfbc472835faf6212601a0732f4f1b12371. P4D-CSV-COMPLETE-BOUNDS-001, P4D-CSV-COMPLETE-IDENTITY-001, and P4D-CSV-COMPLETE-VERIFICATION-001 are verified resolved for the merged CSV complete-file validator. No blockers are assigned to this new task.
required_tests: |
  Add focused unit and integration coverage for schema constraints, authenticated organization authorization, tenant isolation, stable import identity, sequential and concurrent idempotent retries, complete-valid and complete-invalid staging, rejection of incomplete/capped/timeout/XLSX inputs, immutable ordered row snapshots, transaction rollback, audit deduplication, and proof that no KnowledgeSource, KnowledgeVersion, Offering, OfferingVersion, active retrieval, storage object, job, or external side effect is created. Preserve Phase 4A-4D regressions and run the repository's format, lint, typecheck, Prisma validation, fresh migration, unit/component, integration, build, E2E, audit, committed-range diff, and exact-head CI gates.
next_action: "ChatGPT must review the complete branch against the current develop branch."
manual_review_flags:
  - id: MR-4D-OOXML-001
    status: OPEN
    title: Phase 4D XLSX OOXML structural validation
    phase: Phase 4D
    issue: The original XLSX validation branch allowed structurally invalid OOXML fragments to produce previews. The corrective implementation is merged, but Bao has not yet explicitly authorized removal of this persistent flag.
    affected_branch: feature/phase-04d-tabular-validation-foundation
    reviewed_sha: aa8c0aae242f63c150ec8b92d7d623b08300df3c
    blocked_capability: XLSX tabular import mapping, persistence, activation, or any production path consuming its preview until Bao authorizes flag removal
    safe_continuation_scope: CSV-only import staging that rejects XLSX, revalidates original CSV bytes, and performs no confirmation or activation
    required_resolution: Bao must explicitly request removal after the independently verified corrective PR #12 merge; ChatGPT must then mark the flag RESOLVED with evidence rather than deleting its history.
    created_at: "2026-08-15"
    resolution_evidence: "Corrective implementation f49e3a54847a5317cde2fc1187b301da78636b0e; exact final-head CI run 31887553240; PR #12 squash-merged to develop at 01eb8b88a9b0cafa5bc07d0bd78359f9bc19ecad. Awaiting Bao explicit removal instruction."
~~~

## Cursor execution durability, lease, checkpoint, and recovery

A CURSOR_WORKING claim is a renewable 55-minute lease. The remote branch is the durable source of truth.

- When claiming READY_FOR_CURSOR, generate a unique lease ID, set the claim/heartbeat/expiry fields, change status to CURSOR_WORKING, and commit and push the claim before implementation.
- Every Cursor run must inspect both READY_FOR_CURSOR and CURSOR_WORKING. An unexpired active lease prevents competing work. An expired lease with no newer heartbeat/checkpoint may be reclaimed atomically on the same task by refreshing the lease, incrementing cursor_resume_count, and resuming from the recorded checkpoint.
- Before every commit or push, re-fetch AGENTS.md and verify the lease ID still belongs to the run. A superseded run must stop without pushing.
- After implementation and focused tests pass, but before long verification, commit and push code/tests/docs; record the implementation checkpoint SHA, summary, heartbeat, lease expiry, and exact next command while keeping CURSOR_WORKING.
- Add durable checkpoints after later meaningful milestones when the run may end before completion. Meaningful work must never exist only in an ephemeral workspace.
- End only in one recoverable state: READY_FOR_REVIEW after full verification and exact-head CI; resumable CURSOR_WORKING with a pushed checkpoint and live lease; retryable READY_FOR_CURSOR after discarding unsafe ephemeral work and clearing the lease; or genuine BLOCKED for an external, permission, infrastructure, safety, or human-decision blocker.
- ChatGPT reviews only READY_FOR_REVIEW. Preserve blocker-set fields exactly; ChatGPT owns blocker identity, epochs, counters, and history. The legacy cursor_attempt_count is not a retry budget.

## Git verification preferences

- Treat the committed branch range as the review artifact. A clean working tree alone does not prove committed changes are clean.
- Before committing, run git diff --check for unstaged and staged changes.
- After the final implementation commit, run git diff --check 60ceecfbc472835faf6212601a0732f4f1b12371..<final-implementation-sha>.
- Use the committed application implementation SHA, not a later AGENTS-only report commit, as the final SHA.
- Fix any committed-range whitespace error, recommit, and rerun the immutable range check.
- Confirm git status --short is empty before READY_FOR_REVIEW.
- Exact-head GitHub Actions supplements local verification and does not replace committed-range verification.

## Cursor task — CSV import draft persistence foundation

### Product and dependency gate

This is the next small Phase 4D prerequisite:

CSV complete-file validation from PR #15 -> tenant-scoped immutable import staging in this task -> later duplicate/conflict review -> later explicit customer confirmation and atomic knowledge/offering activation.

A later Phase 4D confirmation task depends on a durable, organization-owned, retry-safe snapshot. That makes this task a roadmap prerequisite. It is not a real-time inventory, retail catalogue, warehouse, connector, or 100,000-row search task.

Read requirements.md, outreach-implementation-phases.md, docs/phase-4d-tabular-import-hardening.md, docs/phase-4d-csv-mapping-foundation.md, docs/phase-4d-csv-complete-file-validation.md, the current Prisma schema/migrations, and existing Phase 4A/4B/4C authorization, transaction, audit, confirmation, and concurrency patterns before changing code.

### Goal

Add a server-only persistence service and minimal relational foundation that stages one complete CSV mapped-validation snapshot for later review. It must revalidate original bytes and the explicit mapping inside the trusted service boundary. It must never trust a caller-supplied preview, checksum, identity, counts, rows, issues, status, organization ID, or persistenceEligible value.

This task creates import-stage records only. It must not create, update, confirm, supersede, archive, or activate KnowledgeSource, KnowledgeVersion, KnowledgeSection, KnowledgePassage, Offering, OfferingVersion, prices, variants, features, eligibility, or custom values.

### Required behavior

1. Authorization and tenancy
   - Require an authenticated verified actor, selected organization, active membership, and org.knowledge.manage, matching existing knowledge/offering management policy.
   - Recheck membership and permission inside the write transaction after acquiring a documented organization-scoped import advisory lock.
   - Scope every read, unique lookup, write, row relation, and audit record by organization. A foreign import ID must be indistinguishable from not found.
   - Use the repository's established Auth.js/Prisma service patterns. Add no browser-direct database access and no privileged bypass.

2. Trusted validation boundary
   - Accept original CSV bytes, filename, declared MIME type, explicit untrusted mapping, and an explicit idempotency request value only if the existing repository pattern requires one.
   - Call validateMappedCsvFile internally. Do not accept its result from the caller.
   - XLSX must fail before persistence while MR-4D-OOXML-001 is OPEN.
   - Timeout, structural/parser failure, validationComplete false, issue-cap early stop, or any other incomplete result must create no import, row, issue, or audit record.
   - A validationComplete true result may be staged:
     - zero row issues -> READY_TO_CONFIRM;
     - one or more row issues -> NEEDS_ATTENTION.
   - Incomplete results are never treated as complete, exact, reviewable, confirmable, or persistence eligible.

3. Durable import identity and retries
   - Derive one server-owned stable import identity from organization scope, target family, original source checksum, canonical mapping identity, and an explicit validation-contract version. Do not include customer cell values in logs, errors, audit metadata, or public identifiers.
   - Sequential and truly concurrent retries of the same organization/source/mapping/contract must return the same import and must not duplicate rows or audit events.
   - The same file in a different organization must be isolated and produce a different organization-owned record. A changed file, target family, mapping, or contract version must not collide.
   - Enforce idempotency with database uniqueness plus transaction-safe conflict recovery. Do not rely on an in-memory mutex, check-then-create race, or client-provided canonical identity.
   - Use Prisma/PostgreSQL and existing transaction patterns. No new dependency is expected. If custom serialization or infrastructure is proposed, first research official documentation and a mature maintained library, then record why it is or is not adopted.

4. Persistence shape and immutability
   - Add the smallest clear Prisma models/enums and one forward-only migration for an organization-owned CSV import and its ordered staged rows. Use composite organization-scoped foreign keys and indexes consistent with current Phase 4 models.
   - Persist only the safe metadata needed for later exact review: sanitized filename, canonical MIME, byte length, source checksum, family, canonical mapping/identity, validation-contract version, exact complete counts, deterministic status, creator, timestamps, and immutable ordered row snapshots with sourceRowNumber, canonical mapped values, and static machine-readable issues.
   - Never persist raw upload bytes, formulas that failed the parser gate, storage credentials/keys, secrets from errors, internal stack traces, URLs fetched from cells, or fuzzy suggestions.
   - Preserve canonical semantics across database round trips. Do not assume PostgreSQL JSONB preserves object insertion order; revalidate/recanonicalize stored JSON at the trust boundary or use a representation whose ordering contract is explicit.
   - Database constraints must prevent cross-organization row attachment, duplicate row order/source-row identity within one import, impossible status/count combinations where practical, and mutation of immutable staged content after creation.
   - Do not add upload storage, jobs, background workers, mapping templates in the database, UI, routes, server actions, edit/resolve behavior, confirmation, activation, duplicate matching, or conflict detection in this task.

5. Reads and audit
   - Provide a bounded server-only get operation for one authorized import sufficient for later review work. It must return deterministic ordered rows and safe static issues and must enforce tenant/permission checks.
   - Do not add an organization-wide unbounded list or load unrelated imports.
   - Emit one existing-style audit event only when a new import is created. Retried idempotent reads must not create duplicate audit events. Audit metadata may include IDs, family, status, counts, checksum/identity prefixes if current policy permits, and contract version; it must exclude raw rows, mapped values, mapping payloads, filenames containing unsafe paths, secrets, and error payloads.

### Tests

Write deterministic failing-then-passing coverage for:

- migration forward application and schema constraints;
- valid knowledge and offering CSV staging;
- complete invalid CSV staging as NEEDS_ATTENTION with exact counts and static issues;
- timeout, malformed, parser-attention, issue-cap/incomplete, over-limit, and XLSX rejection with zero database/audit/domain side effects;
- unauthenticated, unverified, inactive, wrong-selected-organization, missing-permission, and cross-tenant access denial;
- sequential retry and forced concurrent retry returning one import, one row set, and one audit event;
- changed bytes, mapping, family, and validation-contract identity behavior;
- deterministic row order/sourceRowNumber and canonical mapping/values after database round trip;
- transaction rollback with no partial import or rows;
- zero writes to Phase 4A/4B/4C domain entities and zero activation/retrieval visibility;
- preserved existing complete-file validation, privacy, source limits, mapping identity, and Phase 4 regressions.

Use explicit test hooks/barriers for concurrency; do not use timing or sleep assertions. Do not mock away the database constraints in integration tests.

### Documentation, exclusions, and completion report

Create docs/phase-4d-csv-import-draft-persistence.md describing the trust boundary, schema, status meanings, identity formula/contract version, transaction and lock order, retry/conflict recovery, immutable row representation, privacy/audit fields, failure recovery, and the next confirmation dependency.

Explicit exclusions: customer UI, upload/download routes, raw-file storage, XLSX consumption, saved mapping templates, row editing, duplicate/near-duplicate matching, existing-record conflicts, confirmation, activation, domain record creation, background jobs, live connectors, Phase 5, and real-time inventory/catalogue behavior.

Run and report npm ci; focused tests; npm run format:check; npm run lint; npm run typecheck; npm run prisma:validate; a fresh database npm run prisma:migrate:deploy; npm test; npm run test:integration; npm run build; CI=true npm run test:e2e; npm audit --omit=dev; committed-range git diff --check; successful exact-head GitHub Actions; changed files; migration behavior; authorization/tenant evidence; concurrency/idempotency evidence; security/privacy; failure/recovery; assumptions; remaining risks; deferred work; and any manual configuration.

Follow the lease/checkpoint rules. Do not open or merge a pull request. Keep MR-4D-OOXML-001 OPEN.

<!-- END:outreach-automation -->
