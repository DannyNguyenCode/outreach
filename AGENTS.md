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
cursor_implementation_sha: 50bb35a02ebd92edd6816e695a3d309c4ce6090e
last_reviewed_sha: edf544c3e5a6ff7fc03c99913bf4d0510822c1ce
status: APPROVED_TO_MERGE
previous_task_status: MERGED
previous_pr_number: 13
previous_develop_merge_sha: e22ad968f58118ffe440292fe575b8b92a4b1d09
cursor_attempt_count: 1
cursor_attempt_count_legacy: true
blocker_set_revision: 1
blocker_set_signature: []
blocker_attempt_count: 0
blocker_history:
  - revision: 1
    reviewed_sha: e46414f24810cacf8aec1f89b6a5abfdd14d2221
    implementation_sha: 2ea6271d9959e0045861f760d3f55284c52a126b
    previous_signature: []
    resulting_signature: [P4D-CSV-MAPPING-RUNTIME-001]
    verified_resolved_ids: []
    new_ids: [P4D-CSV-MAPPING-RUNTIME-001]
    attempt: 1
    evidence: "The public runtime validator dereferences mapping.family and column.sourceColumn before validating that the mapping and column entries are objects; malformed JSON can throw raw TypeError instead of a static CsvMappingError."
  - revision: 1
    reviewed_sha: edf544c3e5a6ff7fc03c99913bf4d0510822c1ce
    implementation_sha: 50bb35a02ebd92edd6816e695a3d309c4ce6090e
    previous_signature: [P4D-CSV-MAPPING-RUNTIME-001]
    resulting_signature: []
    verified_resolved_ids: [P4D-CSV-MAPPING-RUNTIME-001]
    new_ids: []
    attempt: 1
    evidence: "parseCsvMappingInput now validates unknown roots, column containers, bounds, entries, source-column types, and target types before semantic use; focused regressions cover malformed and payload-bearing inputs; all application changes are present in successful exact-head CI run 31904145210."
consecutive_unchanged_checks: 0
last_cursor_activity_sha: 50bb35a02ebd92edd6816e695a3d309c4ce6090e
stop_reason: null
unchanged_check_times: []
cursor_claimed_at: "2026-08-15T19:06:18Z"
cursor_completed_at: "2026-08-15T19:13:39Z"
cursor_claim_sha: e616b3db44e088fa3c7cda32e0c7843ef56ffa85
cursor_lease_id: null
cursor_lease_expires_at: null
cursor_heartbeat_at: "2026-08-15T19:13:39Z"
cursor_checkpoint_sha: 50bb35a02ebd92edd6816e695a3d309c4ce6090e
cursor_checkpoint_summary: "P4D-CSV-MAPPING-RUNTIME-001 parser is committed. parseCsvMappingInput accepts unknown, rejects malformed roots/columns/entries with static invalid_mapping, bounds columns at TABULAR_MAX_COLUMNS, and reuses the canonical mapping for semantic checks. Focused mapping+security tests: 2 files, 65 passed. Next: npm run format:check, lint, typecheck, prisma:validate, fresh migrate, npm test, test:integration, build, CI=true test:e2e, audit, git diff --check, exact-head GitHub Actions."
cursor_resume_count: 0
cursor_report: |
  Corrective attempt for P4D-CSV-MAPPING-RUNTIME-001 completed at implementation SHA 50bb35a02ebd92edd6816e695a3d309c4ce6090e (claim e616b3db44e088fa3c7cda32e0c7843ef56ffa85). Objective: close the remaining false TypeError path so untrusted mapping JSON is structurally validated before any property dereference or semantic assignment, without changing KNOW-004 conflict semantics or the completed CSV-only mapping behavior.
  Requirements/acceptance: parseCsvMappingInput accepts unknown and returns a canonical mapping. Null, undefined, primitive, and array mapping roots fail with static invalid_mapping. Missing, null, primitive, and non-array columns fail the same way. Null, undefined, sparse, primitive, and array column entries fail before sourceColumn is read. Missing or wrong-typed sourceColumn and target fail with invalid_mapping. Zero, negative, fractional, and non-finite numeric source columns keep invalid_source_column. Mapping arrays longer than the existing tabular column limit are rejected before semantic iteration. ISO/semantic mapping codes and precedence for validly shaped input are unchanged. CSV-only parser gating, sourceColumn identity, output shape, pricing/date rules, suggestions, immutability, server-only behavior, and XLSX rejection are preserved. MR-4D-OOXML-001 remains OPEN.
  Files changed: lib/orgs/tabular-mapping.ts; lib/orgs/tabular-mapping.test.ts; lib/orgs/tabular-mapping-security.test.ts; docs/phase-4d-csv-mapping-foundation.md. No migrations added or changed. No new npm dependencies.
  Tests added/updated: table-driven unit cases for malformed mapping roots, columns, sparse/null/primitive/array entries, missing and wrong-typed sourceColumn/target, oversized arrays, and numeric invalid_source_column values; byte-for-byte JSON equality for a valid knowledge mapping; security cases proving secret, URL, and formula targets never appear in thrown or serialized errors and that malformed input has no fetch/database side effects. Existing semantic error-code, parser-gate, offering/knowledge, suggestion, bounds, immutability, and Phase 4A-4D tests were not rewritten and passed.
  Commands and exact results on this implementation head:
  - npm ci: added 553 packages, audited 554, 0 vulnerabilities
  - focused mapping and mapping-security tests: 2 files, 65 passed
  - npm run format:check: All matched files use Prettier code style
  - npm run lint: exit 0
  - npm run typecheck: next typegen + tsc --noEmit succeeded
  - npm run prisma:validate: schema valid with DATABASE_URL/DIRECT_URL set
  - fresh DROP/CREATE outreach_ci + npm run prisma:migrate:deploy: 11 migrations applied through Phase 4C
  - npm test: 30 files, 335 passed
  - npm run test:integration: 41 files, 488 passed
  - npm run build: Next.js 16.3.0 compiled successfully
  - CI=true npm run test:e2e: 16 passed (30.2s)
  - npm audit --omit=dev: found 0 vulnerabilities
  - git diff --check: clean
  - GitHub Actions run 31903113039 success on 663e2f3073715431425ae4333ff8b0dc95c871aa (checkpoint HEAD immediately after implementation 50bb35a02ebd92edd6816e695a3d309c4ce6090e; application tree differs only in AGENTS.md). Verify job: format, lint, typecheck, unit/component, integration, production build, E2E all success. Combined push meant GitHub did not start a separate run on 50bb35a itself.
  Authorization/tenant isolation: no permission, tenant-scope, upload-route, or storage changes. This module remains pure validation and does not query the database.
  Security/privacy: mapping is server-only and does not import XLSX ZIP/XML helpers. Structural and semantic errors use static codes/messages only. Secrets, URLs, and formulas in malformed mapping JSON are not echoed. Suggestions are unchanged and never auto-applied.
  Failure/recovery: malformed mapping input now throws CsvMappingError with invalid_mapping instead of a raw TypeError/500. Unready or XLSX previews still throw CsvMappingError. Invalid mapped rows remain in the dry-run preview with machine-readable issues and are not persisted. No jobs or storage objects are created.
  Manual configuration still required: none for this correction.
  Assumptions: a validly shaped mapping whose family is not knowledge or offering still fails with incompatible_target_family before the parser gate, matching prior precedence. Empty columns arrays remain missing_required_target after a successful structural parse.
  Remaining risks: the mapper is deliberately non-semantic and does not validate the complete file beyond previewRows. MR-4D-OOXML-001 remains OPEN pending Bao's explicit removal instruction.
  Deferred work: complete-file row validation, mapping UI, saved templates, persistence, confirmation, activation, retrieval, multi-price rows, variants, features, eligibility, custom fields, intervalCount, DST disambiguation, and any XLSX mapping. Phase 5 is untouched. No PR opened; ChatGPT owns the develop merge gate. Blocker-set revision, signature, attempt count, and history were preserved exactly.
review_findings: |
  PASS — P4D-CSV-MAPPING-RUNTIME-001 is independently verified resolved at implementation SHA 50bb35a02ebd92edd6816e695a3d309c4ce6090e. Structural parsing accepts unknown, rejects malformed mapping roots/columns/entries with static payload-free errors, bounds mappings before iteration, and preserves valid semantic behavior.
  PASS — Focused regression coverage includes null, primitive, array, sparse, oversized, wrong-typed, secret, URL, and formula-bearing shapes; valid mapped-preview output remains byte-for-byte stable.
  PASS — Implementation SHA 50bb35a02ebd92edd6816e695a3d309c4ce6090e is an ancestor of review head edf544c3e5a6ff7fc03c99913bf4d0510822c1ce; later commits modify AGENTS.md only. The branch is 0 commits behind develop.
  PASS — GitHub Actions run 31904145210 succeeded on exact review head edf544c3e5a6ff7fc03c99913bf4d0510822c1ce with format, lint, typecheck, unit/component, integration, production build, and E2E gates.
  PASS — No routes, persistence, migrations, tenant boundaries, XLSX consumption, or Phase 5 behavior changed. MR-4D-OOXML-001 remains OPEN.
required_tests: |
  Add focused deterministic unit/security tests for CSV-only mapping validation, field parsing, row errors, bounds, parser-gate behavior, and output privacy. Run the complete repository verification suite and exact-head GitHub Actions.
next_action: "ChatGPT must open the develop-targeted PR, require successful CI on the final head, and squash-merge with the expected-head guard."
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


## Cursor corrective prompt — runtime-safe CSV mapping contract

### Objective

Fix blocker `P4D-CSV-MAPPING-RUNTIME-001` on the existing branch. Preserve the completed CSV-only mapping behavior, scope boundaries, recovery rules, and OPEN `MR-4D-OOXML-001` flag.

The branch already implements semantic mapping validation and a bounded dry-run preview. The remaining defect is structural runtime validation of the mapping input.

### Root cause and evidence

`validateCsvMapping(preview, mapping: CsvMappingInput)` dereferences `mapping.family` before proving that `mapping` is a non-null object. It then iterates `mapping.columns` and dereferences `column.sourceColumn` before proving that every entry is a non-null object.

Consequently, untrusted JSON shapes such as these can throw raw `TypeError` instead of a static `CsvMappingError`:

- `null` or `undefined` mapping input
- primitive or array mapping input
- missing, null, primitive, or non-array `columns`
- `columns: [null]`
- sparse arrays or undefined entries
- column entries that are primitives or arrays
- missing or wrong-typed `sourceColumn` and `target`

This violates the assigned requirement for a typed, runtime-validated mapping contract and would turn malformed later server-action input into an uncontrolled 500.

### Required fix

- Add one focused structural parser/validator for the mapping input before any property dereference or semantic mapping work.
- Prefer an existing validation dependency or a small explicit validator; do not add a new dependency for this fix.
- Accept `unknown` at the actual runtime-validation boundary, or export a schema/parser that accepts `unknown` and require `mapCsvPreview` and `validateCsvMapping` to use its parsed result.
- Reject malformed mapping containers and malformed column entries with a stable `CsvMappingError` code and static message. Add `invalid_mapping` if needed; do not echo input values.
- Bound the mapping array using the existing tabular column limit before iterating it.
- Preserve the current semantic codes and precedence for validly shaped mappings: invalid/unknown source column, unknown target, duplicates, unmapped columns, missing required targets, and incompatible families.
- Preserve CSV-only parser gating, sourceColumn identity, output shape, pricing/date rules, suggestions, immutability, server-only behavior, and XLSX rejection.
- Do not add routes, UI, persistence, jobs, migrations, activation, XLSX consumption, or Phase 5 work.
- Keep the implementation focused and reduce duplicate checks by reusing the parsed canonical mapping.

### Required regression tests

Add deterministic unit/security tests covering at least:

- null, undefined, primitive, and array mapping roots
- missing/null/primitive/non-array `columns`
- null, undefined, sparse, primitive, and array column entries
- missing or wrong-typed `sourceColumn` and `target`
- zero, negative, fractional, non-finite, and string source columns
- oversized mapping arrays rejected before semantic iteration
- malformed targets containing a secret, URL, or formula never appearing in the thrown error or serialized error
- every malformed case throws `CsvMappingError`, never raw `TypeError`
- existing valid mappings produce byte-for-byte equivalent mapped previews
- existing semantic error-code tests remain unchanged and passing
- no network, filesystem, database, storage, or formula-evaluation side effects

Use JSON-representable cases where applicable and include sparse-array/undefined cases as direct JavaScript boundary regressions.

### Verification and completion

Run and report:

- `npm ci`
- focused mapping and mapping-security tests
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

Follow the lease/checkpoint rules above. Commit and push the correction and tests before the completion report. Preserve the blocker-set fields exactly; ChatGPT owns their counters. Set `READY_FOR_REVIEW` only after all required verification and exact-head CI pass. Record the new `cursor_implementation_sha`, exact results, files changed, security evidence, and remaining risks.

Do not open or merge a pull request.
<!-- END:outreach-automation -->
