<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:outreach-automation -->

# Outreach Automation Handoff

~~~yaml
task_id: phase-04d-csv-import-customer-workflow-002
phase: "Phase 4D — CSV preview, confirmation, activation, and integrated hardening"
active_branch: feature/phase-04d-csv-import-draft-persistence
base_develop_sha: 60ceecfbc472835faf6212601a0732f4f1b12371
cursor_implementation_sha: 737cfc7204237a6513477b5c6709ad719b041c37
last_reviewed_sha: b5b22f7f9d6c497004a7be784475ca09903349b3
status: READY_FOR_REVIEW
previous_task_status: CHECKPOINT_APPROVED
previous_pr_number: 15
previous_develop_merge_sha: 60ceecfbc472835faf6212601a0732f4f1b12371
current_pr_number: 16
cursor_attempt_count: 1
cursor_attempt_count_legacy: true
blocker_set_revision: 0
blocker_set_signature: []
blocker_attempt_count: 0
blocker_history: []
consecutive_unchanged_checks: 0
last_cursor_activity_sha: 737cfc7204237a6513477b5c6709ad719b041c37
stop_reason: null
unchanged_check_times: []
cursor_claimed_at: "2026-08-16T15:17:15Z"
cursor_completed_at: "2026-08-16T16:06:00Z"
cursor_claim_sha: e28620d20e91128adcc62a143bd19b49d20d69cc
cursor_lease_id: 212e3b23-8895-4dfb-af04-bbd524454fff
cursor_lease_expires_at: "2026-08-16T16:53:09Z"
cursor_heartbeat_at: "2026-08-16T16:06:00Z"
cursor_checkpoint_sha: 737cfc7204237a6513477b5c6709ad719b041c37
cursor_checkpoint_summary: "CSV customer workflow implemented on the approved immutable staging snapshot: preview without persistence, explicit mapping, complete-file validation, stageCsvImport, acknowledgment, CsvImportConfirmation plus row provenance, atomic knowledge/offering activation with cap 100, and exact-head CI success on 737cfc7204237a6513477b5c6709ad719b041c37 (push run 31957343158, PR run 31957347694)."
cursor_resume_count: 0
cursor_report: |
  Attempt 1 completed at implementation SHA 737cfc7204237a6513477b5c6709ad719b041c37. Objective: complete the remaining Phase 4D CSV customer journey on the approved immutable staging architecture without redesigning persistence or opening another PR.
  Requirements/acceptance: template → preview original bytes (no persistence) → explicit mapping (suggestions not auto-applied) → complete-file validation via validateMappedCsvFile → stageCsvImport → resume/review snapshot → unchecked acknowledgment csv.import.confirm.v1 → atomic confirm/activate with CsvImportConfirmation and organization-scoped row provenance → ACTIVE knowledge/offering retrieval. NEEDS_ATTENTION never activatable. XLSX rejected. Activation cap 100. Foreign import IDs indistinguishable from missing.
  Files changed: prisma/schema.prisma and migration 20260816120000_phase_04d_csv_import_confirmation; lib/orgs/csv-import-preview.ts, csv-import-request.ts, csv-import-activation.ts, csv-import-knowledge.ts, csv-import-offering.ts, csv-import-confirmation.ts, csv-import-access.ts, csv-import.ts; app/api/orgs/[slug]/knowledge/csv/route.ts; app/actions/csv-import.ts; import UI pages and workflow/review/recent-list components; tests (unit, RTL, integration, concurrency, E2E); docs/phase-4d-csv-import-draft-persistence.md. Staging migration 20260815220000 unchanged. No new npm dependencies.
  Commands and exact results on this implementation head:
  - npm ci: added 553 packages, audited 554, 0 vulnerabilities
  - npx prisma generate: Prisma Client v6.19.3
  - npm run format:check: CI Format check success (local Windows checkout reports CRLF on unchanged files; Linux CI is the gate)
  - npm run lint: exit 0
  - npm run typecheck: next typegen + tsc --noEmit succeeded
  - npm run prisma:validate: schema valid
  - fresh DROP SCHEMA public CASCADE + CREATE SCHEMA public + npm run prisma:migrate:deploy: 13 migrations applied through 20260816120000_phase_04d_csv_import_confirmation
  - npm test: 37 files, 372 passed
  - npm run test:integration: 48 files, 513 passed
  - npm run build: Next.js 16.3.0 compiled successfully; /knowledge/import and /knowledge/import/[importId] routes present
  - CI=true npm run test:e2e: 17 passed (30.1s) including csv-import.spec.ts
  - npm audit --omit=dev: found 0 vulnerabilities
  - git diff --check 60ceecfb..737cfc7: clean
  - Exact-head CI push run 31957343158 SUCCESS; PR run 31957347694 SUCCESS
  Authorization/tenant isolation: org.knowledge.manage outside and inside the transaction; foreign import IDs return the same not_found as missing; inactive membership and wrong permission denied; no partial activation.
  Security/privacy: original bytes revalidated; mapping identity server-derived; audit metadata has IDs/counts/prefixes only; XLSX rejected before workbook parse; formulas not evaluated; URLs not fetched. MR-4D-OOXML-001 remains OPEN.
  Remaining risks: dated CSV rows require an organization time zone at activation (missing timezone is not_confirmable, not a corrupt snapshot). Synchronous activation is capped at 100 rows. No additional blocking correctness/security issues were discovered.
  No PR opened or merged; draft PR #16 remains. This is the Cursor completion report for the customer workflow.
review_findings: |
  PASS: CSV persistence checkpoint 50051ae5dc094bf06bb761686e39cb08e6ad5a2e is a clean ancestor of review head b5b22f7f9d6c497004a7be784475ca09903349b3; later commits changed AGENTS.md only; the branch is 0 behind develop. Original bytes are revalidated server-side; incomplete, malformed, capped, timeout, parser-attention, over-limit, and XLSX inputs create no records. Organization-scoped composite keys, immutable triggers, permission rechecks, deterministic concurrent idempotency, audit deduplication, rollback, and zero active knowledge/offering visibility are covered. Committed-range git diff --check passed. Exact-head CI run 31912298810 passed dependency install, Prisma generation/validation/migrations, format, lint, typecheck, unit/component, integration, build, and 16 E2E tests.
  PRODUCT DECISION: Keep the remaining related Phase 4D work on this same branch and draft PR #16. Outreach will validate structure and supported business formats, but it will not attempt semantic duplicate, near-duplicate, or factual truth arbitration for customer-provided CSV rows. The customer is responsible for reviewing and confirming accuracy. Technical duplicate submissions must still remain idempotent.
required_tests: |
  Add Vitest unit tests, React Testing Library component tests, database-backed integration/security/concurrency tests, and Playwright E2E for the full customer journey: template download; CSV selection; server validation and preview before persistence; explicit mapping confirmation; complete-file validation; staging; accuracy/authority acknowledgment; atomic confirmation/activation; idempotent retry; active source-backed retrieval; invalid/incomplete recovery; permissions; tenant isolation; accessibility; and no partial activation. Preserve all prior Phase 4 tests and run every repository gate plus exact-head CI.
next_action: "ChatGPT owns review of draft PR #16 at implementation SHA 737cfc7204237a6513477b5c6709ad719b041c37. Do not merge. Do not open another PR."
manual_review_flags:
  - id: MR-4D-OOXML-001
    status: OPEN
    title: Phase 4D XLSX OOXML structural validation
    phase: Phase 4D
    issue: The original XLSX validation branch allowed structurally invalid OOXML fragments to produce previews. The corrective implementation is merged, but Bao has not yet explicitly authorized removal of this persistent flag.
    likelihood: bounded edge involving malformed or adversarial OOXML structure
    current_product_impact: none on the supported CSV workflow; XLSX consumption remains disabled
    promotion_impact: Bao can truthfully demonstrate and promote CSV imports, but must not claim production XLSX import support while this flag is OPEN
    affected_branch: feature/phase-04d-tabular-validation-foundation
    reviewed_sha: aa8c0aae242f63c150ec8b92d7d623b08300df3c
    blocked_capability: XLSX tabular import mapping, persistence, activation, or any production path consuming its preview until Bao authorizes flag removal
    deferred_capability: XLSX mapping, persistence, confirmation, and activation
    safe_continuation_scope: CSV-only customer workflow that rejects XLSX and never consumes an XLSX preview
    existing_mitigation: XLSX is rejected before CSV staging, confirmation, or activation; corrective parser work and regression tests are already merged
    library_research: JSZip and the existing OOXML/XML validation stack were retained and hardened; the corrective implementation was independently verified
    required_resolution: Bao must explicitly request removal after the independently verified corrective PR #12 merge; ChatGPT must then mark the flag RESOLVED with evidence rather than deleting its history.
    created_at: "2026-08-15"
    last_reviewed_at: "2026-08-15"
    resolution_evidence: "Corrective implementation f49e3a54847a5317cde2fc1187b301da78636b0e; exact final-head CI run 31887553240; PR #12 squash-merged to develop at 01eb8b88a9b0cafa5bc07d0bd78359f9bc19ecad. Awaiting Bao explicit removal instruction."
    removal_authority: Bao explicit instruction after independent verification
~~~

## Cursor execution durability, lease, checkpoint, and recovery

A CURSOR_WORKING claim is a renewable 55-minute lease. The remote branch is the durable source of truth.

- Claim READY_FOR_CURSOR with a unique lease, heartbeat, and expiry committed before implementation.
- Inspect both READY_FOR_CURSOR and CURSOR_WORKING every run. Resume an expired lease from the durable checkpoint only after atomically reclaiming it and incrementing cursor_resume_count.
- Before every commit or push, re-fetch AGENTS.md and verify lease ownership.
- After each meaningful milestone below, commit and push code/tests/docs, update the checkpoint SHA/summary/heartbeat/exact next action, and keep CURSOR_WORKING until the complete combined task is verified.
- End only READY_FOR_REVIEW, resumable CURSOR_WORKING, retryable READY_FOR_CURSOR after discarding unsafe ephemeral work, or genuine BLOCKED.
- Preserve blocker fields. ChatGPT owns review findings, retry accounting, and merge decisions.

## Git verification preferences

- Review and verify the committed range, not only the working tree.
- Run git diff --check before each commit and git diff --check 60ceecfbc472835faf6212601a0732f4f1b12371..<final-implementation-sha> before completion.
- Keep the working tree clean before READY_FOR_REVIEW.
- Push checkpoints before long verification.
- Exact-head GitHub Actions on draft PR #16 supplements local verification.
- Do not rebase, force-push, merge develop, open another PR, or merge PR #16.

## Combined Phase 4D customer workflow

### Product decisions

Bao wants related Phase 4D work kept on one branch for easier review before develop is promoted to main. Continue on this branch and PR #16.

The supported product is approved knowledge and offering CSV import for practices and small/medium service businesses. It is not real-time inventory, a marketplace catalogue, warehouse, transaction-history system, or 100,000-row search product.

The customer owns factual accuracy. Outreach must validate CSV/file structure, explicit mapping, supported field types, required fields, price/date/frequency compatibility, authorization, tenant isolation, and safe confirmation. Do not build semantic duplicate, near-duplicate, conflicting-policy, or factual truth arbitration in this task. Clearly warn that confirmation publishes the customer's reviewed data. Preserve technical idempotency so retries never duplicate records, versions, confirmations, or audit events.

### Required customer flow

Implement one accessible workflow under the existing organization knowledge area:

1. Customer chooses Knowledge or Offerings and can download the matching official template.
2. Customer selects a CSV file and clicks Preview file.
3. The server validates the original bytes and returns a bounded preview without creating CsvImport, knowledge, offering, audit, storage, or job records.
4. Show headers, up to the existing 50 preview rows, row/file counts, safe static issues, required/optional fields, and explicit mapping controls.
5. Mapping suggestions may be displayed but never auto-applied. The customer must explicitly confirm every mapped/ignored column. Rearranged columns remain supported; required template columns cannot be omitted.
6. Re-submit original bytes plus explicit mapping for complete-file validation. Do not trust the earlier preview. If validation is incomplete or invalid, show actionable static errors and keep activation unavailable.
7. For a complete valid result, let the customer stage the immutable import. stageCsvImport must continue revalidating the original bytes.
8. Show the exact staged summary and a required unchecked acknowledgment that the customer is authorized to provide the information and has reviewed it for accuracy.
9. Confirm and activate atomically. The success state links to the created knowledge or offering records and makes only confirmed active data available to current source-backed retrieval.
10. Provide a bounded recent-import/detail view so an authorized manager can resume a staged import later. Do not load all rows for all imports or expose raw file bytes.

Use clear UI language: preview sends bytes to the server for validation but does not persist or activate them; Stage import saves an immutable review snapshot; Confirm and activate publishes the reviewed rows.

### Confirmation and activation

- Add the smallest forward-only migration needed for an immutable one-to-one confirmation receipt and row-to-created-record provenance. Do not edit the approved migration.
- Prefer a separate CsvImportConfirmation/activation receipt over weakening the immutable staged snapshot. It must include organization/import identity, actor, confirmation timestamp, confirmation-language version, exact staged identity/checksum, and a stable result summary.
- Require READY_TO_CONFIRM, exact expected import identity, the explicit acknowledgment, verified actor, active membership, selected route organization, and org.knowledge.manage.
- Recheck authorization and lock state inside the transaction. Use a documented deadlock-safe family-specific lock order compatible with current knowledge/offering writers. A knowledge import and offering import each touch only its own domain lock family.
- Reparse/revalidate stored canonical mapping, values, and issues at the trust boundary. Any corrupt or inconsistent stored snapshot fails closed before domain writes.
- Confirm all rows or none. A failure at any row must roll back domain records, receipt, provenance, and audit.
- A KNOWLEDGE row creates the existing canonical customer-confirmed knowledge source/version/section/passage graph, with current checksums, effective dates, confirmation evidence, citations, and input/provenance classification suitable for retrieval.
- An OFFERING row creates the existing canonical offering/version and supported base price graph using current decimal, currency, frequency, quote-required, effective-date, lifecycle, and confirmation rules.
- Do not implement deferred multi-price, variants, features, eligibility, custom fields, interval-count expansion, or XLSX.
- Link each staged row deterministically to the exact created logical record/version through organization-scoped provenance with database constraints.
- Repeated or concurrent confirmation of the same import returns the same receipt and domain IDs with one activation audit event. Changed request values cannot mutate a confirmed result.
- Semantic similarity with existing records is not a gate. Do not silently overwrite existing records. Each newly confirmed row becomes a new logical customer-confirmed source/offering unless it is the same technical import retry.
- Preserve existing active retrieval filters. Staged, NEEDS_ATTENTION, failed, partial, and unconfirmed content must remain invisible.

If activating the maximum validation boundary cannot be safely atomic within existing application/database limits, add a clear lower supported activation-row cap, reject above it before writes, document it honestly, and test the exact boundary. Do not invent background-job infrastructure in this task.

### HTTP/UI/security boundaries

- Use existing authenticated Server Component, server action, route-handler, rate-limit, CSRF/origin, validation, and safe-error conventions.
- Enforce the existing 5 MiB limit before expensive parsing and in the request boundary. Do not log raw bytes, customer cells, mapping payloads, formulas, secrets, internal paths, or stack traces.
- Do not fetch or execute URLs/formulas from CSV cells.
- A foreign import ID must remain indistinguishable from missing.
- Owners/admins with org.knowledge.manage may preview, stage, resume, confirm, and activate. Other roles may not.
- Provide loading, empty, invalid, expired-session/file-missing, retry, conflict, and success states.
- Meet keyboard, focus, label, error-summary, table semantics, screen-reader status, and responsive layout requirements.
- Reuse existing components/services and keep client JavaScript minimal. Do not introduce a state-management, upload, serializer, table, or form library unless official documentation and mature-library research demonstrates a real need.

### Tests and checkpoints

Checkpoint A: preview/mapping UI and no-persistence boundary.
- Vitest parser/action tests and React Testing Library component tests for templates, file selection, mapping confirmation, rearranged/optional columns, safe issues, empty/error/loading/retry states, accessibility, and no auto-application.
- Integration tests proving preview creates no database, audit, storage, job, knowledge, or offering records.

Checkpoint B: confirmation/activation domain service.
- Database-backed integration tests for knowledge and offering happy paths, exact stored snapshot use, authorization, cross-tenant denial, corrupt snapshot rejection, failure rollback, provenance, active retrieval, and no staged/unconfirmed visibility.
- Deterministic concurrency barriers proving one receipt, one domain graph per row, and one activation audit across repeated/concurrent confirmation.

Checkpoint C: complete UI and E2E hardening.
- Playwright customer journeys for template -> preview -> mapping -> stage -> acknowledgment -> confirm -> active retrieval/detail.
- Failure/recovery flows for malformed, over-limit, parser-attention, incomplete/capped, invalid mapped rows, missing permission, foreign IDs, double-click, refreshed resume, and activation cap.
- Assert customer content is not leaked into URLs, logs, audit metadata, or error payloads.

Run npm ci; focused Vitest/RTL/integration/E2E tests at each checkpoint; format; lint; typecheck; Prisma validation; fresh migration; full unit/component and integration suites; production build; CI=true E2E; npm audit --omit=dev; committed-range diff check; and exact-head CI.

Update docs/phase-4d-csv-import-draft-persistence.md or add one combined workflow document describing UI semantics, validation-vs-persistence, acknowledgment language/version, activation schema and locks, idempotency, provenance, supported row cap, privacy, recovery, exclusions, and the explicit customer-accuracy responsibility.

READY_FOR_REVIEW only after all three checkpoints and every gate pass. Report exact SHAs, files, migrations, tests, CI, auth/tenant evidence, activation/retrieval evidence, concurrency, security/privacy, accessibility, failure/recovery, remaining limitations, and deferred work.

Keep MR-4D-OOXML-001 OPEN and reject XLSX throughout.

<!-- END:outreach-automation -->
