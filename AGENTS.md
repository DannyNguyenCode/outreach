<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:outreach-automation -->

# Outreach Automation Handoff

```yaml
task_id: phase-04d-csv-complete-file-validation-001
phase: "Phase 4D — CSV complete-file mapped validation"
active_branch: feature/phase-04d-csv-complete-file-validation
base_develop_sha: a10489131522e79cf6bec9983ff520171254a7df
cursor_implementation_sha: 8b2a6e0a831e9f457a80c66cd3c99de56eea20b0
last_reviewed_sha: null
status: READY_FOR_REVIEW
previous_task_status: MERGED
previous_pr_number: 14
previous_develop_merge_sha: a10489131522e79cf6bec9983ff520171254a7df
cursor_attempt_count: 0
cursor_attempt_count_legacy: true
blocker_set_revision: 0
blocker_set_signature: []
blocker_attempt_count: 0
blocker_history: []
consecutive_unchanged_checks: 0
last_cursor_activity_sha: 8b2a6e0a831e9f457a80c66cd3c99de56eea20b0
stop_reason: null
unchanged_check_times: []
cursor_claimed_at: "2026-08-15T20:06:35Z"
cursor_completed_at: "2026-08-15T20:19:05Z"
cursor_claim_sha: babbea38a8df7432744ef7b4169aa67581e9055d
cursor_lease_id: null
cursor_lease_expires_at: null
cursor_heartbeat_at: "2026-08-15T20:19:05Z"
cursor_checkpoint_sha: 8b2a6e0a831e9f457a80c66cd3c99de56eea20b0
cursor_checkpoint_summary: "CSV complete-file mapped validation is committed. validateMappedCsvFile revalidates original CSV bytes, reuses parseCsvMappingInput/mapCsvRows, maps every nonblank row past the 50-row preview, caps flattened issues at CSV_MAPPED_FILE_MAX_ISSUES, and rejects XLSX without workbook helpers. Focused complete-file+mapping+validation+security tests: 6 files, 106 passed. Next: npm run format:check, lint, typecheck, prisma:validate, fresh migrate, npm test, test:integration, build, CI=true test:e2e, audit, git diff --check, exact-head GitHub Actions."
cursor_resume_count: 0
cursor_report: |
  Complete-file CSV mapped-validation foundation completed at implementation SHA 8b2a6e0a831e9f457a80c66cd3c99de56eea20b0 (claim babbea38a8df7432744ef7b4169aa67581e9055d). Objective: prove every accepted CSV data row is structurally and semantically validated against a customer-reviewed mapping before later persistence work, without trusting a caller-supplied preview and without persisting, activating, or mapping XLSX.
  Requirements/acceptance: validateMappedCsvFile accepts original bytes, filename, declared MIME, and untrusted mapping. CSV bytes are revalidated through the shared inspect/preview path. parseCsvMappingInput and existing semantic mapping validation run before complete-row mapping. Every nonblank data row is mapped in source order, including rows after the 50-row preview, with original one-based sourceRowNumber. Knowledge and offering cell parsers and cross-field rules are reused. The result includes canonical family/mapping identity, source SHA-256 checksum, total/nonblank/valid/invalid/skipped counts, complete mapped drafts, flattened row issues, and hasMoreIssues when the issue list is capped at CSV_MAPPED_FILE_MAX_ISSUES. Trailing blanks follow the shared parser strip; internal blanks are skipped. XLSX is rejected with unsupported_kind before workbook helpers run. Byte/limit failures keep TabularValidationError codes. Mapping-contract failures keep CsvMappingError codes and precedence. MR-4D-OOXML-001 remains OPEN.
  Files changed: lib/orgs/tabular-csv-file.ts; lib/orgs/tabular-csv-file.test.ts; lib/orgs/tabular-csv-file-security.test.ts; lib/orgs/tabular-preview.ts; lib/orgs/tabular-validation.ts; lib/orgs/tabular-mapping.ts; lib/orgs/tabular-types.ts; docs/phase-4d-csv-complete-file-validation.md; docs/phase-4d-csv-mapping-foundation.md; docs/phase-4d-tabular-import-hardening.md. No migrations added or changed. No new npm dependencies.
  Tests added/updated: complete-file unit coverage for more-than-50-row source order, invalid values only after preview row 50, first/last source rows, internal and all-blank data rows, knowledge and offering families, malformed bytes/mappings/headers/formulas/limits, XLSX rejection, accepted and rejected row-limit boundaries, issue-list truncation with preserved invalid counts, determinism/checksum/immutability, byte-for-byte mapped-preview stability, and no XLSX imports. Security coverage for payload-free issues/errors, formula-like parser-gate failure, URL values confined to mapped-row values, and no fetch/database side effects. Existing Phase 4A-4D mapping, tabular-validation, and security tests were not rewritten and passed.
  Commands and exact results on this implementation head:
  - npm ci: added 553 packages, audited 554, 0 vulnerabilities
  - focused complete-file, mapping, validation, and security tests: 6 files, 106 passed
  - npm run format:check: All matched files use Prettier code style
  - npm run lint: exit 0
  - npm run typecheck: next typegen + tsc --noEmit succeeded
  - npm run prisma:validate: schema valid with DATABASE_URL/DIRECT_URL set
  - fresh DROP/CREATE outreach_ci + npm run prisma:migrate:deploy: 11 migrations applied through Phase 4C; outreach_test migrated the same way
  - npm test: 32 files, 352 passed
  - npm run test:integration: 41 files, 488 passed
  - npm run build: Next.js 16.3.0 compiled successfully
  - CI=true npm run test:e2e: 16 passed (30.7s)
  - npm audit --omit=dev: found 0 vulnerabilities
  - git diff --check: clean
  - GitHub Actions run 31906095982 success on checkpoint HEAD 65bc33b82065d83844ca27a314b8c158e9c019bf immediately after implementation 8b2a6e0a831e9f457a80c66cd3c99de56eea20b0 (application tree differs only in AGENTS.md). Verify job: format, lint, typecheck, unit/component, integration, production build, E2E all success. Combined push meant GitHub cancelled the in-progress run on 8b2a6e0 itself.
  Authorization/tenant isolation: no permission, tenant-scope, upload-route, or storage changes. This module remains pure validation and does not query the database.
  Security/privacy: complete-file validation is server-only and does not import XLSX ZIP/XML helpers. Structural and semantic errors use static codes/messages only. Secrets, URLs, and formulas in mapping JSON or cells are not echoed in thrown errors or row issues. Mapped customer values appear only on explicit server-only row values. Suggestions remain unused here and are never auto-applied.
  Failure/recovery: malformed bytes throw TabularValidationError; unready CSV or XLSX throw CsvMappingError. Invalid mapped rows remain in the complete result with machine-readable issues and are not persisted. Truncated issue lists still count every invalid row. No jobs or storage objects are created.
  Manual configuration still required: none for this foundation.
  Assumptions: trailing blank records are stripped by the shared CSV parser, matching task 1; internal blank data rows are skipped and counted. A validly shaped mapping whose family is not knowledge or offering still fails with incompatible_target_family before row mapping.
  Remaining risks: complete-file validation still does not persist, confirm, or activate drafts, and does not detect duplicates against existing records. MR-4D-OOXML-001 remains OPEN pending Bao's explicit removal instruction.
  Deferred work: mapping UI, saved templates, persistence, confirmation, activation, retrieval, duplicate/existing-record conflicts, multi-price rows, variants, features, eligibility, custom fields, intervalCount, DST disambiguation, and any XLSX mapping. Phase 5 is untouched. No PR opened; ChatGPT owns the develop merge gate. Blocker-set revision, signature, attempt count, and history were preserved exactly.
review_findings: null
required_tests: |
  Add focused deterministic unit/security tests proving complete-file CSV row validation beyond the 50-row preview, source-row preservation, blank-row behavior, full-file bounds, static payload-free failures, immutability, deterministic output, and no database/storage/network/formula side effects. Preserve all existing Phase 4A–4D and mapping regressions. Run the complete repository verification suite and successful exact-head GitHub Actions.
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
    safe_continuation_scope: CSV-only complete-file validation that rejects XLSX, does not consume an XLSX preview, and performs no persistence or activation
    required_resolution: Bao must explicitly request removal after the independently verified corrective PR #12 merge; ChatGPT must then mark the flag RESOLVED with evidence rather than deleting its history.
    created_at: "2026-08-15"
    resolution_evidence: "Corrective implementation f49e3a54847a5317cde2fc1187b301da78636b0e; exact final-head CI run 31887553240; PR #12 squash-merged to develop at 01eb8b88a9b0cafa5bc07d0bd78359f9bc19ecad. Awaiting Bao explicit removal instruction."
```

## Cursor execution durability, lease, checkpoint, and recovery

A `CURSOR_WORKING` claim is a renewable 55-minute lease. The remote branch is the durable source of truth.

- When claiming `READY_FOR_CURSOR`, generate a unique lease ID, set the claim/heartbeat/expiry fields, change status to `CURSOR_WORKING`, and commit and push the claim before implementation.
- Every Cursor run must inspect both `READY_FOR_CURSOR` and `CURSOR_WORKING`. An unexpired active lease prevents competing work. An expired lease with no newer heartbeat/checkpoint may be reclaimed atomically on the same task by refreshing the lease, incrementing `cursor_resume_count`, and resuming from the recorded checkpoint.
- Before every commit or push, re-fetch `AGENTS.md` and verify the lease ID still belongs to the run. A superseded run must stop without pushing.
- After implementation and focused tests pass, but before long verification, commit and push code/tests/docs; record the implementation checkpoint SHA, summary, heartbeat, lease expiry, and exact next command while keeping `CURSOR_WORKING`.
- Add durable checkpoints after later meaningful milestones when the run may end before completion. Meaningful work must never exist only in an ephemeral workspace.
- End only in one recoverable state: `READY_FOR_REVIEW` after full verification and exact-head CI; resumable `CURSOR_WORKING` with a pushed checkpoint and live lease; retryable `READY_FOR_CURSOR` after discarding unsafe ephemeral work and clearing the lease; or genuine `BLOCKED` for an external, permission, infrastructure, safety, or human-decision blocker.
- ChatGPT reviews only `READY_FOR_REVIEW`. Preserve blocker-set fields exactly; ChatGPT owns blocker identity, epochs, counters, and history. The legacy `cursor_attempt_count` is not a retry budget.

## Cursor implementation prompt — CSV complete-file mapped validation

### Objective

Build the next small Phase 4D slice: a server-only, deterministic complete-file CSV mapped-validation foundation on top of the merged byte validator and CSV mapping module.

The current mapped preview intentionally inspects at most 50 preview rows. This task must prove that every row in an accepted CSV is structurally and semantically validated against the customer-reviewed mapping before later persistence work can rely on it. It remains a pure validation foundation: do not persist, activate, confirm, upload, or expose records.

### Required source-of-truth review

Read `requirements.md` KNOW-001 through KNOW-004, Phase 4D and the overall Phase 4 gate in `outreach-implementation-phases.md`, `docs/phase-4d-tabular-import-hardening.md`, `docs/phase-4d-csv-mapping-foundation.md`, and the existing tabular validator/mapping tests before changing code.

Reuse the existing bounded RFC 4180 parser, normalized headers, limits, error types, target registry, field parsers, mapping semantics, source-column identity, and Phase 4C offering rules. Do not introduce a second CSV parser, competing schemas, or duplicated field-validation logic.

### Mandatory scope and trust boundaries

- Accept and revalidate the original CSV bytes, filename, declared MIME type, and an untrusted mapping input. Do not trust a caller-supplied preview as evidence for the complete file.
- CSV only. Reject XLSX and do not import/call XLSX helpers or consume XLSX previews. Preserve OPEN flag `MR-4D-OOXML-001`.
- Reuse the exact existing CSV byte/signature/encoding/header/row/column/cell/aggregate-text/deadline rules. Refactor shared internal parsing safely if necessary so preview and complete-file paths cannot drift.
- Run `parseCsvMappingInput` and the existing semantic mapping validation before mapping complete rows. Preserve all current error codes and precedence for existing valid and invalid inputs.
- Validate every accepted nonblank data row, including rows after preview row 50, while preserving original one-based `sourceRowNumber`.
- Apply the existing knowledge/offering cell parsing and cross-field rules without weakening required fields, enums, dates, prices, currencies, billing frequencies, pricing models, or quote-required behavior.
- Return a deterministic server-only result suitable for later persistence work: canonical family/mapping identity, validated source checksum, total/nonblank/valid/invalid/skipped counts, complete mapped draft rows in source order, row issues, and explicit bounded/truncation metadata if issue output is capped.
- Keep memory and output bounded by existing file, row, column, cell, and aggregate-text limits. If a total-issue cap is required, make it deterministic, preserve invalid-row counts, expose `hasMoreIssues`, and never imply omitted rows were valid.
- Errors and row issues must remain static/payload-free. Mapped customer values may appear only in the explicit server-only mapped-row values intended for later authorized persistence/preview work.
- Never evaluate formulas, fetch URLs, access storage/database/network/filesystem beyond the supplied bytes, or mutate caller inputs.
- Do not add routes, server actions, UI, Prisma models/migrations, jobs, saved templates, persistence, confirmation, activation, duplicate/existing-record conflict resolution, live connectors, XLSX behavior, or Phase 5 work.

### Required tests

Add direct deterministic regressions for at least:

- a valid CSV with more than 50 rows where all complete rows are returned in source order;
- an invalid mapped value only after preview row 50, proving complete-file validation detects and counts it;
- first/last source-row numbers, internal blank rows, trailing blank rows, and completely blank data rows;
- knowledge and offering families using the existing mapping and cross-field semantics;
- malformed/unsafe bytes, mapping roots, headers, formulas/links, row/column/cell/text limits, and oversized files failing through existing static errors;
- CSV row limit at the accepted boundary and one past it without unbounded allocation;
- deterministic repeated output, canonical checksum/mapping identity, and input immutability;
- payload-bearing secrets, formulas, and URLs absent from thrown errors and row issues;
- no database, storage, network, external-resource, or formula-evaluation side effects;
- existing 50-row mapped-preview output remaining byte-for-byte unchanged;
- all existing Phase 4A knowledge, Phase 4B document, Phase 4C offering, runtime-composition, tabular-validation, mapping, and security tests remaining unchanged and passing.

### Documentation and exclusions

Add a focused task-3 section/document describing the complete-file contract, bounds, privacy behavior, result shape, and the explicit absence of persistence/activation. Do not claim Phase 4D, KNOW-002, KNOW-003, or the overall Phase 4 gate complete.

### Verification and completion

Run and report exact results for:

- `npm ci`
- focused complete-file, tabular-validation, mapping, and security tests
- `npm run format:check`
- `npm run lint`
- `npm run typecheck`
- `npm run prisma:validate`
- fresh test-database `npm run prisma:migrate:deploy`
- `npm test`
- `npm run test:integration`
- `npm run build`
- `CI=true npm run test:e2e`
- `npm audit --omit=dev`
- `git diff --check`
- successful exact-head GitHub Actions

Commit and push the implementation/test/docs checkpoint before the full suite. Set `READY_FOR_REVIEW` only after the full suite and exact-head CI pass. Record the implementation SHA, exact results, files changed, design/bounds decisions, security/privacy evidence, assumptions, remaining risks, and deferred work. Do not open or merge a pull request.

<!-- END:outreach-automation -->
