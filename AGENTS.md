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
last_reviewed_sha: 0894ea4c1733d3c0253ff3d9157e05dc52f67f1e
status: READY_FOR_CURSOR
previous_task_status: MERGED
previous_pr_number: 14
previous_develop_merge_sha: a10489131522e79cf6bec9983ff520171254a7df
cursor_attempt_count: 0
cursor_attempt_count_legacy: true
blocker_set_revision: 1
blocker_set_signature: [P4D-CSV-COMPLETE-BOUNDS-001, P4D-CSV-COMPLETE-IDENTITY-001, P4D-CSV-COMPLETE-VERIFICATION-001]
blocker_attempt_count: 1
blocker_history:
  - revision: 1
    reviewed_sha: 0894ea4c1733d3c0253ff3d9157e05dc52f67f1e
    implementation_sha: 8b2a6e0a831e9f457a80c66cd3c99de56eea20b0
    previous_signature: []
    resulting_signature: [P4D-CSV-COMPLETE-BOUNDS-001, P4D-CSV-COMPLETE-IDENTITY-001, P4D-CSV-COMPLETE-VERIFICATION-001]
    verified_resolved_ids: []
    new_ids: [P4D-CSV-COMPLETE-BOUNDS-001, P4D-CSV-COMPLETE-IDENTITY-001, P4D-CSV-COMPLETE-VERIFICATION-001]
    attempt: 1
    evidence: "Complete-row mapping has no periodic deadline checks and flattened issues are fully accumulated before the 1000-item slice; canonical mapping identity preserves caller column order; base-to-implementation git diff --check fails on trailing whitespace despite the completion report claiming clean."
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
cursor_checkpoint_summary: "Base implementation is committed and verified; resume from 8b2a6e0a831e9f457a80c66cd3c99de56eea20b0 to fix the complete-file bounds, canonical-identity, and verification blockers together."
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
review_findings: |
  P4D-CSV-COMPLETE-BOUNDS-001: validateMappedCsvFile checks the 2,000 ms deadline only before and after the complete mapCsvRows call. mapCsvRows performs the full row loop without periodic enforcement, and the later aggregation loop has no deadline check. It also accumulates every flattened issue in allIssues before slicing to the 1,000-item public cap, so the cap does not bound intermediate issue allocation. This violates the complete-file bounded-execution contract.
  P4D-CSV-COMPLETE-IDENTITY-001: canonicalizeMapping copies columns in caller-provided order and mappingIdentity is JSON.stringify of that copy. Semantically identical mappings with permuted column entries therefore produce different canonical identities and different JSON property insertion order in mapped values. Column-array order is not part of sourceColumn mapping semantics, so this is not a stable canonical identity for later idempotency.
  P4D-CSV-COMPLETE-VERIFICATION-001: git diff --check a10489131522e79cf6bec9983ff520171254a7df..8b2a6e0a831e9f457a80c66cd3c99de56eea20b0 exits 2 because docs/phase-4d-csv-complete-file-validation.md line 3 has trailing whitespace. The completion report claims git diff --check was clean, apparently checking only an already-clean working tree rather than the committed branch range.
  PASS: Original bytes are revalidated, rows after preview row 50 are mapped, source row numbers and blank-row counts are preserved, unsafe parser issues fail closed, XLSX remains rejected, and no persistence/route/migration/tenant behavior was added.
  PASS: Implementation SHA 8b2a6e0a831e9f457a80c66cd3c99de56eea20b0 is an ancestor of review head 0894ea4c1733d3c0253ff3d9157e05dc52f67f1e; later commits change AGENTS.md only; the branch is 0 commits behind develop. GitHub Actions run 31906362597 succeeded on the Cursor completion head.
required_tests: |
  Add regressions proving equivalent mappings with different column-array order produce byte-for-byte identical canonical mapping, mappingIdentity, and mapped rows. Add deterministic deadline tests that expire during complete-row mapping and during result aggregation, plus a cap test proving only the first CSV_MAPPED_FILE_MAX_ISSUES flattened issues are retained while total issue and invalid-row counts remain exact. Preserve all existing complete-file, preview, mapping, validation, security, and Phase 4 regressions. Run git diff --check against the committed base-to-final range and run the full suite plus successful exact-head GitHub Actions.
next_action: "Cursor must claim and fix all three complete-file blockers together on this branch, preserve the blocker epoch, checkpoint durably, verify the committed range, and return READY_FOR_REVIEW."
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

## Cursor corrective prompt — complete-file determinism and bounds

### Objective

Fix all three blockers in blocker-set revision 1 on the existing branch. Preserve the completed CSV-only complete-file behavior, the OPEN XLSX flag, and every explicit exclusion.

### Required corrections

1. **P4D-CSV-COMPLETE-BOUNDS-001 — enforce bounds during all complete-file work**
   - Enforce the existing 2,000 ms deadline periodically inside the complete-row mapping loop, not only after the loop returns.
   - Enforce it periodically during result counting/aggregation and once immediately before returning.
   - Do not change bounded-preview behavior merely to add complete-file timing. Prefer an optional deadline/check callback or a focused complete-file helper so existing callers remain deterministic.
   - Retain at most `CSV_MAPPED_FILE_MAX_ISSUES` flattened issues as rows are processed while separately counting the exact total issue count and exact valid/invalid row counts. Do not first build an unbounded-to-the-public-cap `allIssues` array and slice it afterward.
   - Per-row issues may remain on returned mapped rows under the existing file/row/column bounds; document the distinction between complete per-row issues and the capped flattened index.

2. **P4D-CSV-COMPLETE-IDENTITY-001 — make mapping identity genuinely canonical**
   - Canonicalize validated mapping columns by stable `sourceColumn` order before producing `mapping`, `mappingIdentity`, assignments, and mapped value insertion order.
   - Equivalent mappings that differ only in column-array order must produce byte-for-byte identical canonical mapping JSON, mappingIdentity, rows, values, issues, and counts.
   - Preserve every existing source/target validation code and precedence. Do not make header names authoritative or auto-apply suggestions.
   - Keep the identity payload-free beyond the already-approved field IDs and numeric source columns. Do not add customer cell values to it.

3. **P4D-CSV-COMPLETE-VERIFICATION-001 — repair committed-range cleanliness**
   - Remove the trailing whitespace in `docs/phase-4d-csv-complete-file-validation.md`.
   - Verify the actual committed feature range with `git diff --check a10489131522e79cf6bec9983ff520171254a7df..<final-implementation-sha>`; a clean working-tree-only check is insufficient.
   - Report the exact command and exit result. Do not rewrite unrelated documentation.

### Regression tests

Add deterministic tests that:

- submit at least two semantically identical knowledge mappings and two offering mappings with different column-array orders and prove byte-for-byte identical canonical mappings, identities, mapped rows, values, issues, and counts;
- prove deadline expiry during a long complete-row mapping loop returns the existing static timeout error before all rows are processed;
- prove deadline expiry during aggregation/finalization cannot return a result after the deadline;
- prove the flattened issue array never retains more than `CSV_MAPPED_FILE_MAX_ISSUES` while `issueCount`, `invalidRowCount`, per-row issues, ordering, and `hasMoreIssues` remain exact;
- preserve valid 50-row preview output and all existing row-limit, post-preview invalid-row, parser-gate, privacy, side-effect, XLSX-rejection, and Phase 4A–4D regressions.

Use deterministic clock control or an injected internal deadline checker; do not add flaky wall-clock tests.

### Exclusions

Do not add routes, server actions, UI, persistence, Prisma changes, migrations, jobs, activation, confirmation, duplicate/existing-record conflict handling, XLSX consumption, live connectors, or Phase 5 work. Do not remove or weaken `MR-4D-OOXML-001`.

### Verification and completion

Run and report:

- `npm ci`
- focused complete-file, mapping, tabular-validation, and security tests
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
- committed-range `git diff --check a10489131522e79cf6bec9983ff520171254a7df..<final-implementation-sha>`
- successful exact-head GitHub Actions

Follow the lease/checkpoint rules. Commit and push code/tests/docs before the completion report. Preserve blocker revision 1, its three stable IDs, attempt count, and history exactly; ChatGPT owns their resolution. Set `READY_FOR_REVIEW` only after every gate passes, and do not open or merge a pull request.

<!-- END:outreach-automation -->
