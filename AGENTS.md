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
cursor_implementation_sha: null
last_reviewed_sha: null
status: CURSOR_WORKING
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
last_cursor_activity_sha: null
stop_reason: null
unchanged_check_times: []
cursor_claimed_at: "2026-08-15T17:10:00Z"
cursor_completed_at: null
cursor_report: null
review_findings: null
required_tests: |
  Add focused deterministic unit/security tests for CSV-only mapping validation, field parsing, row errors, bounds, parser-gate behavior, and output privacy. Run the complete repository verification suite and exact-head GitHub Actions.
next_action: "Cursor must claim this task, implement only the bounded server-only CSV mapping foundation, verify it completely, and return READY_FOR_REVIEW."
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
