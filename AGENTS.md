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
cursor_implementation_sha: null
last_reviewed_sha: null
status: READY_FOR_CURSOR
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
last_cursor_activity_sha: null
stop_reason: null
unchanged_check_times: []
cursor_claimed_at: null
cursor_completed_at: null
cursor_claim_sha: null
cursor_lease_id: null
cursor_lease_expires_at: null
cursor_heartbeat_at: null
cursor_checkpoint_sha: null
cursor_checkpoint_summary: null
cursor_resume_count: 0
cursor_report: null
review_findings: null
required_tests: |
  Add focused deterministic unit/security tests proving complete-file CSV row validation beyond the 50-row preview, source-row preservation, blank-row behavior, full-file bounds, static payload-free failures, immutability, deterministic output, and no database/storage/network/formula side effects. Preserve all existing Phase 4A–4D and mapping regressions. Run the complete repository verification suite and successful exact-head GitHub Actions.
next_action: "Cursor must claim this task, implement only the server-only CSV complete-file mapped-validation foundation, checkpoint durably, verify it completely, and return READY_FOR_REVIEW."
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
