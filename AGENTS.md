<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:outreach-automation -->

# Outreach Automation Handoff

```yaml
task_id: phase-04d-csv-mapping-foundation-001
phase: "Phase 4D — CSV mapping foundation"
active_branch: feature/phase-04d-csv-mapping-foundation
base_develop_sha: e22ad968f58118ffe440292fe575b8b92a4b1d09
cursor_implementation_sha: 2ea6271d9959e0045861f760d3f55284c52a126b
last_reviewed_sha: null
status: CHATGPT_REVIEWING_FOR_DEVELOP
previous_task_status: MERGED
previous_pr_number: 13
previous_develop_merge_sha: e22ad968f58118ffe440292fe575b8b92a4b1d09
cursor_attempt_count: 1
cursor_attempt_count_legacy: true
blocker_set_revision: 0
blocker_set_signature: []
blocker_attempt_count: 0
blocker_history: []
consecutive_unchanged_checks: 0
last_cursor_activity_sha: 2ea6271d9959e0045861f760d3f55284c52a126b
stop_reason: null
unchanged_check_times: []
cursor_claimed_at: "2026-08-15T17:10:00Z"
cursor_completed_at: "2026-08-15T17:38:00Z"
cursor_claim_sha: 5e9842267369dcba18fbf8ee220061e2b5b5deba
cursor_lease_id: null
cursor_lease_expires_at: null
cursor_heartbeat_at: "2026-08-15T17:38:00Z"
cursor_checkpoint_sha: 2ea6271d9959e0045861f760d3f55284c52a126b
cursor_checkpoint_summary: "Implementation committed, full verification complete, and handed off as READY_FOR_REVIEW."
cursor_resume_count: 0
cursor_report: |
  Attempt 1 completed at implementation SHA 2ea6271d9959e0045861f760d3f55284c52a126b (claim 5e9842267369dcba18fbf8ee220061e2b5b5deba). Objective: add a server-only CSV column-mapping and bounded dry-run mapped-preview foundation on top of the existing tabular validator without persisting, activating, or importing records.
  Requirements/acceptance: mapCsvPreview accepts only kind=csv previews whose parser outcome is ready and that have no error-level or security-relevant parser issues. XLSX previews fail closed as unsupported_kind. Mapping identity is the parser's stable one-based sourceColumn. Every source column must be assigned to a knowledge or offering target or explicitly ignored. Duplicate source/target, unknown columns/targets, missing required targets, and cross-family targets are rejected. Knowledge required fields are title, section title, and passage body. Offering required fields are name, offering type, and pricing model. Preview rows keep sourceRowNumber, skip only completely blank rows, parse booleans/ISO dates/enums/decimals/ISO currencies/billing frequencies without locale guessing, distinguish missing vs invalid values, and emit payload-free row issues. Price amount/currency/frequency triples, quote-required vs QUOTE_REQUIRED, FIXED_ONE_TIME vs RECURRING frequency rules, and effectiveUntil-after-effectiveFrom are enforced. MULTI_OPTION and TIERED cannot form a complete single-row draft and receive incompatible_pricing_model. Exact-alias suggestions are returned separately only when unique and are never auto-applied. hasMoreRows is true when totalRowCount exceeds the bounded preview rows inspected. Inputs are not mutated. Mapped customer values appear only in explicit preview values. MR-4D-OOXML-001 remains OPEN; no XLSX mapping path was added.
  Files changed: lib/orgs/tabular-mapping.ts; lib/orgs/tabular-mapping.test.ts; lib/orgs/tabular-mapping-security.test.ts; docs/phase-4d-csv-mapping-foundation.md; docs/phase-4d-tabular-import-hardening.md (pointer to task 2). No migrations added or changed. No new npm dependencies.
  Tests added/updated: unit coverage for XLSX rejection, needs_attention/formula_like/hyperlink parser gating, unknown/missing/duplicate/cross-family mappings, sourceColumn identity after header rename, blank-row skip with original row numbers, required/enum/boolean/decimal/currency/frequency/date parsing, incomplete price pairs, invalid effective-date order, pricing-model and quote-required rules, exact-alias and ambiguous-alias suggestions, bounds/hasMoreRows, immutability, and a real validateTabularImport CSV round-trip. Security tests cover payload-free issues, XLSX static errors, and no fetch/database side effects. Existing Phase 4A-4D, tabular validation, and XLSX security tests were not modified and passed.
  Commands and exact results on this implementation head:
  - npm ci: added 553 packages, audited 554, 0 vulnerabilities
  - focused mapping tests: 32 passed; with tabular validation/security: 4 files, 56 passed
  - npm run format:check: All matched files use Prettier code style
  - npm run lint: exit 0
  - npm run typecheck: next typegen + tsc --noEmit succeeded after typing the table-driven fixtures
  - npm run prisma:validate: schema valid with DATABASE_URL/DIRECT_URL set
  - fresh DROP/CREATE outreach_ci + npm run prisma:migrate:deploy: 11 migrations applied through Phase 4C
  - npm test: 30 files, 302 passed
  - npm run test:integration: 41 files, 488 passed
  - npm run build: Next.js 16.3.0 compiled successfully
  - CI=true npm run test:e2e: 16 passed (27.4s)
  - npm audit --omit=dev: found 0 vulnerabilities
  - git diff --check: clean
  - exact-head GitHub Actions run 31898696627 on 2ea6271d9959e0045861f760d3f55284c52a126b: success (format, lint, typecheck, unit/component, integration, production build, E2E)
  Authorization/tenant isolation: no permission, tenant-scope, upload-route, or storage changes. This module is pure validation and does not query the database.
  Security/privacy: mapping is server-only and does not import XLSX ZIP/XML helpers. Row issues and thrown errors use static codes/messages only. Malicious cell text, formulas, URLs, and secrets are not echoed. Suggestions never become an applied mapping. Parser formula/link issues fail closed before mapping.
  Failure/recovery: unready or XLSX previews throw CsvMappingError. Invalid mapped rows remain in the dry-run preview with machine-readable issues and are not persisted. No jobs or storage objects are created.
  Manual configuration still required: none for this foundation.
  Assumptions: unmapped quoteRequired on a QUOTE_REQUIRED row defaults to true using existing Phase 4C semantics. Effective dates are strict YYYY-MM-DD calendar dates; timezone/DST conversion remains deferred. Completely blank means every header column is empty after trim.
  Remaining risks: the mapper is deliberately non-semantic and does not validate the complete file beyond previewRows. MR-4D-OOXML-001 remains OPEN pending Bao's explicit removal instruction.
  Deferred work: complete-file row validation, mapping UI, saved templates, persistence, confirmation, activation, retrieval, multi-price rows, variants, features, eligibility, custom fields, intervalCount, DST disambiguation, and any XLSX mapping. Phase 5 is untouched. No PR opened; ChatGPT owns the develop merge gate.
review_findings: null
required_tests: |
  Add focused deterministic unit/security tests for CSV-only mapping validation, field parsing, row errors, bounds, parser-gate behavior, and output privacy. Run the complete repository verification suite and exact-head GitHub Actions.
next_action: "ChatGPT owns the branch while reviewing implementation SHA 2ea6271d9959e0045861f760d3f55284c52a126b and the full remote head."
manual_review_flags:
  - id: MR-4D-OOXML-001
    status: OPEN
    title: Phase 4D XLSX OOXML structural validation
    phase: Phase 4D
    issue: The original XLSX validation branch allowed structurally invalid OOXML fragments to produce previews. The corrective implementation is merged, but Bao has not yet explicitly authorized removal of this persistent flag.
    affected_branch: feature/phase-04d-tabular-validation-foundation
    reviewed_sha: aa8c0aae242f63c150ec8b92d7d623b08300df3c
    blocked_capability: XLSX tabular import mapping, persistence, activation, or any production path consuming its preview until Bao authorizes flag removal
    safe_continuation_scope: This CSV-only mapping foundation and later work that rejects XLSX and does not consume an XLSX preview
    required_resolution: Bao must explicitly request removal after the independently verified corrective PR #12 merge; ChatGPT must then mark the flag RESOLVED with evidence rather than deleting its history.
    created_at: "2026-08-15"
    resolution_evidence: "Corrective implementation f49e3a54847a5317cde2fc1187b301da78636b0e; exact final-head CI run 31887553240; PR #12 squash-merged to develop at 01eb8b88a9b0cafa5bc07d0bd78359f9bc19ecad. Awaiting Bao explicit removal instruction."
```


## Cursor execution durability, lease, checkpoint, and recovery

A `CURSOR_WORKING` claim is a renewable lease, not permanent ownership by one ephemeral workspace. The remote branch is the durable source of truth.

Track these fields in the YAML handoff on every new task:

- `cursor_claim_sha`
- `cursor_lease_id`
- `cursor_lease_expires_at`
- `cursor_heartbeat_at`
- `cursor_checkpoint_sha`
- `cursor_checkpoint_summary`
- `cursor_resume_count`

Initialize them to `null`, `null`, `null`, `null`, `null`, `null`, and `0` respectively.

### Claim and lease

- When claiming `READY_FOR_CURSOR`, generate a unique lease ID, set `cursor_heartbeat_at`, set `cursor_lease_expires_at` to 55 minutes after the claim, change status to `CURSOR_WORKING`, and commit and push the claim before implementation.
- Every Cursor run must inspect both `READY_FOR_CURSOR` and `CURSOR_WORKING`. Never skip a task merely because it is already `CURSOR_WORKING`.
- If `CURSOR_WORKING` has an unexpired lease and the remote branch has recent activity from that lease, do not start competing work.
- If the lease is expired and no newer Cursor heartbeat or checkpoint exists, atomically reclaim the same task: re-fetch the remote head, generate a new lease ID, increment `cursor_resume_count`, refresh the heartbeat/expiry, record the checkpoint to resume from, commit and push the recovery claim, then continue.
- Before every commit or push, re-fetch `AGENTS.md` and verify the current lease ID still matches the run. A superseded run must stop without pushing.
- Refresh the heartbeat and lease in the same commit as every durable checkpoint.

### Mandatory durable checkpoints

Cursor must never end a run with application code or tests existing only in an ephemeral working tree.

After implementation and focused tests pass, and before starting the long full verification suite:

1. Commit the implementation, tests, and documentation.
2. Push the commit to the active branch.
3. Record that SHA in `cursor_checkpoint_sha`.
4. Write a concise `cursor_checkpoint_summary` with completed work, focused-test results, and the exact next command.
5. Keep status `CURSOR_WORKING`, refresh the heartbeat/lease, and push the checkpoint state.

Create additional checkpoint commits after any later meaningful milestone if the run may end before completion. Checkpoint commits may be labelled WIP and are not eligible for review or merge.

### Required end-of-run invariant

Before any run yields, times out, or ends, it must leave the remote branch in exactly one recoverable state:

1. `READY_FOR_REVIEW`: implementation is committed and pushed, the complete required verification and exact-head CI passed, and the completion report and `cursor_implementation_sha` are recorded.
2. `CURSOR_WORKING`: all meaningful work is committed and pushed as a checkpoint, with a current checkpoint SHA, summary, heartbeat, lease expiry, and exact next action so another hourly run can resume.
3. `READY_FOR_CURSOR`: no safe implementation checkpoint exists; discard ephemeral changes, record why the run could not progress, clear the lease, and permit a clean retry.
4. `BLOCKED`: only for a genuine external, permission, infrastructure, safety, or human-decision blocker—not because the run is ending or verification remains.

A run must not end with an uncommitted implementation, an unpushed commit, a missing checkpoint summary, or a permanent `CURSOR_WORKING` claim that later hourly runs skip. Finishing the full verification in one run is preferred, but recoverability is mandatory.

ChatGPT must not review or merge a checkpoint. It reviews only `READY_FOR_REVIEW`. A checkpoint or recovery claim is genuine Cursor activity and resets `consecutive_unchanged_checks` without changing the blocker-attempt epoch.


## Cursor implementation prompt — CSV mapping foundation

### Objective

Build the next small Phase 4D slice: a server-only, deterministic CSV column-mapping and mapped-preview foundation on top of the existing normalized tabular validator.

This task defines and validates customer-reviewed mapping data and produces a bounded dry-run preview. It must not upload, store, persist, confirm, activate, retrieve, or import any record.

### Mandatory scope boundary

- Accept only a `TabularNormalizedPreview` whose `kind` is exactly `csv` and whose parser outcome is safe for mapping.
- Reject every XLSX preview. Do not import or call XLSX helpers, consume XLSX rows, add an XLSX mapping path, or weaken `MR-4D-OOXML-001`.
- Keep this module `server-only`.
- Do not add routes, server actions, forms, UI, storage, Prisma models, migrations, jobs, saved templates, activation, confirmation, or runtime retrieval.
- Do not change Phase 4A–4C persistence or the existing CSV/XLSX validation semantics.
- Do not start Phase 5.

### Mapping contract

Inspect `requirements.md`, `outreach-implementation-phases.md`, the Phase 4A/4C models and validators, and `docs/phase-4d-tabular-import-hardening.md`. Reuse established enums, normalization helpers, validation limits, and field semantics rather than creating a competing offering or knowledge schema.

Create a typed, runtime-validated mapping contract for two explicit target families:

1. customer-confirmed business knowledge draft rows;
2. structured offering draft rows.

The mapping must:

- identify source columns by the parser's stable one-based `sourceColumn`, never only by header text;
- permit an explicit ignored/unmapped source column;
- reject unknown source columns, duplicate source assignments, duplicate target assignments, unknown targets, missing required targets, and mappings incompatible with the selected target family;
- keep knowledge and offering targets distinct;
- expose a stable target-field registry with user-facing labels, required/optional state, data type, and accepted values derived from existing Phase 4 contracts;
- require explicit mapping for the minimum fields needed to form a useful draft row;
- validate cross-field requirements such as price amount/currency pairs, pricing model, billing frequency, quote-required behavior, offering type, and effective-date ordering using existing Phase 4C semantics where applicable;
- never silently guess a target from a header name. Deterministic suggestions may be returned separately only when exact normalized aliases are unique and must still require customer confirmation.

If existing domain validation cannot safely support a field without persistence context, leave that field out of this bounded foundation and document the deferral instead of inventing behavior.

### Dry-run mapped preview

Add a pure mapping function that consumes the validated CSV preview plus the validated mapping and returns only the bounded preview rows already present in `previewRows`.

Requirements:

- preserve `sourceRowNumber`;
- skip only completely blank rows and report the skipped count;
- normalize whitespace deterministically;
- parse booleans, strict ISO dates, enum values, decimal amounts, ISO currency codes, and billing frequencies without locale guessing;
- reject exponent notation, non-finite numbers, invalid calendar dates, unknown enum values, malformed currency codes, and incomplete paired fields;
- distinguish missing required values from invalid values;
- return stable machine-readable row issues containing row number, source column, target field, and issue code;
- error messages and issue objects must not echo cell contents, formulas, URLs, file bytes, or secrets;
- keep mapped customer data only in the explicit bounded mapped-preview values intended for the later authorized UI;
- report `hasMoreRows` whenever `totalRowCount` exceeds the bounded preview rows and never imply that the complete file has been validated against the mapping;
- never mutate the parser preview or mapping input;
- remain deterministically bounded by existing preview row/column/cell limits.

A parser result with unresolved error-level or security-relevant attention issues must fail closed for this task. Do not add acknowledgment or override behavior yet.

### Security and correctness tests

Add direct regressions for at least:

- XLSX preview rejection;
- `needs_attention` and parser-issue gating;
- unknown, missing, duplicate, and cross-family mappings;
- stable one-based source-column identity with renamed or similar headers;
- blank-row handling and preservation of original source row numbers;
- required-field, enum, boolean, decimal, currency, billing-frequency, and strict-date parsing;
- incomplete price/currency pairs and invalid effective-date order;
- exact-alias suggestions that remain non-authoritative;
- duplicate/ambiguous aliases producing no suggestion;
- bounded output and `hasMoreRows`;
- immutability and deterministic repeated output;
- row issues that do not expose malicious cell text, formulas, URLs, or secrets;
- no database, storage, network, file-system, formula-evaluation, or external-resource side effects;
- existing Phase 4A knowledge, Phase 4B document, Phase 4C offering, runtime-composition, CSV validation, and XLSX security tests remaining unchanged and passing.

### Documentation

Create a focused Phase 4D CSV-mapping document, or add a clearly bounded task-2 section to the existing tabular hardening document. State:

- this is a dry-run preview foundation only;
- XLSX mapping remains prohibited by the open flag;
- only preview rows are mapped;
- complete-file row validation, authorization/upload UI, persistence, saved templates, idempotent jobs, confirmation, activation, and retrieval are deferred;
- no imported customer data is persisted by this task.

Do not claim Phase 4D or KNOW-002/003 complete.

### Verification

Run and report exact results for:

- `npm ci`
- focused mapping and tabular security tests
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

Missing, skipped, cancelled, unavailable, flaky, or failing checks are not passing.

### Completion

Commit implementation and tests before the completion report. Push only to this active branch. Set `READY_FOR_REVIEW`, record `cursor_implementation_sha`, and provide the files changed, mapping decisions, tests, exact command results, security/privacy evidence, assumptions, remaining risks, and deferred work.

The legacy `cursor_attempt_count` is not the retry budget. ChatGPT owns blocker-set counting. Cursor must preserve `blocker_set_revision`, `blocker_set_signature`, `blocker_attempt_count`, and `blocker_history`.

Do not open or merge a pull request.

<!-- END:outreach-automation -->
