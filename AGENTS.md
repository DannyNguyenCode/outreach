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
status: CURSOR_WORKING
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
cursor_claimed_at: "2026-08-15T21:08:18Z"
cursor_completed_at: "2026-08-15T20:19:05Z"
cursor_claim_sha: babbea38a8df7432744ef7b4169aa67581e9055d
cursor_lease_id: 40fedcba-56e3-45ed-b186-25e1fecf2272
cursor_lease_expires_at: "2026-08-15T22:03:18Z"
cursor_heartbeat_at: "2026-08-15T21:08:18Z"
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
  Bao supersedes the earlier exact-count-after-cap requirement. Add regressions for the official csv-parse streaming path, existing byte/row/column/cell/aggregate limits, rejection at the first record beyond TABULAR_MAX_ROWS, deterministic 100-row batch deadline checks, and early termination after observing more than CSV_MAPPED_FILE_MAX_ISSUES while retaining only the first capped issues and truthfully marking counts/results partial. Prove valid files and invalid files below the cap still scan fully with exact counts. Prove equivalent mappings with different column-array order produce byte-for-byte identical canonical mapping, mappingIdentity, and mapped rows. Validate both official template CSV assets through the shared parser and schemas. Preserve all existing privacy, side-effect, XLSX-rejection, preview, mapping, validation, security, and Phase 4 regressions. Run git diff --check against the committed base-to-final range and the full suite plus successful exact-head GitHub Actions.
next_action: "Cursor must claim and implement Bao's revised bounded-streaming product decision plus the canonical-mapper and committed-range fixes together, preserve blocker revision 1 and attempt 1, checkpoint durably, and return READY_FOR_REVIEW."
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

## Git verification preferences

These rules apply to every implementation, correction, checkpoint, and completion report:

- Treat the committed branch range as the review artifact. A clean working tree alone does not prove committed changes are clean.
- Before committing, run `git diff --check` to inspect unstaged and staged working-tree changes.
- After the final implementation commit, resolve the immutable base and final SHAs and run `git diff --check <base_sha>..<final_implementation_sha>`.
- Use `base_develop_sha` from the active Outreach automation block as `<base_sha>` unless ChatGPT explicitly records a different review base. Use the committed application implementation SHA—not a later AGENTS-only report or review commit—as `<final_implementation_sha>`.
- If the committed range check fails, fix the reported file, recommit, and rerun the check against the new final implementation SHA.
- Never report a bare post-commit `git diff --check` as proof that the committed feature range passed; with no working-tree changes, that command can succeed without inspecting earlier commits.
- Record the exact committed-range command, both SHAs, and its exit result in `cursor_report`.
- Confirm `git status --short` is empty before setting `READY_FOR_REVIEW`. All meaningful application, test, and documentation work must already be committed and pushed.
- Exact-head GitHub Actions supplements these local checks; it does not replace committed-range verification when the workflow does not run the same range check.

## Cursor corrective prompt — bounded CSV streaming, templates, and canonical identity

### User-approved product decision

Bao explicitly supersedes the earlier requirement to scan the remainder of an already-invalid file merely to calculate exact totals after the public issue cap.

The accepted behavior is now:

- Valid files must be processed through the final row before they can be declared valid or later become eligible for persistence.
- Invalid files with fewer than or exactly `CSV_MAPPED_FILE_MAX_ISSUES` observed issues must be processed through the final row and retain exact counts.
- Once processing observes the first issue beyond `CSV_MAPPED_FILE_MAX_ISSUES`, the file is already conclusively invalid. Stop parsing/mapping promptly, retain only the first capped issues, and return truthful partial/lower-bound metadata. Do not claim full-file counts or validation completion.
- The existing 5 MiB byte limit, row/column/cell/aggregate limits, and 2,000 ms deadline remain defense-in-depth. Do not increase or weaken them in this task.
- The templates are the recommended customer path, but the server must continue treating every upload and mapping as untrusted.

Fix all three blocker IDs in blocker-set revision 1 on the existing branch. The revised product requirement does not create a new blocker epoch or increment the attempt counter.

### Required corrections

1. **P4D-CSV-COMPLETE-BOUNDS-001 — use a proven parser and bounded application processing**

   #### Parser dependency and shared parsing path

   - Add the official `csv-parse` package from the Adaltas `node-csv` project as the minimum direct runtime dependency required for CSV parsing:
     - https://csv.js.org/parse/
     - https://github.com/adaltas/node-csv
   - Use its stream or async-iterator API for complete-file processing; do not use the sync/callback API that materializes the complete dataset before application validation.
   - Configure the parser explicitly and fail closed. Preserve the existing UTF-8/BOM, quoting, escaped-quote, multiline-field, blank-row, record-delimiter, duplicate-header, formula-like-content, column-count, cell, aggregate, and error-code contracts. Do not silently skip malformed records and do not enable permissive column-count behavior.
   - Use a bounded `max_record_size` consistent with Outreach's existing cell/column/aggregate limits. Keep the existing pre-parse `TABULAR_MAX_BYTES` check.
   - Route preview and complete-file validation through one shared parser adapter so they cannot disagree about whether the same CSV is structurally valid. Do not leave two independent CSV grammar implementations as competing sources of truth. Remove obsolete custom grammar code only after parity tests pass.
   - Update `package.json` and `package-lock.json`; verify the selected official package, license, Node 22 compatibility, dependency tree, and `npm audit --omit=dev`.

   #### Row, batch, time, and issue bounds

   - Reject and stop the parser at the first record beyond the existing `TABULAR_MAX_ROWS` boundary. Preserve the repository's current definition of whether that boundary includes the header; the existing exact-boundary tests are authoritative.
   - Process and map records incrementally in deterministic batches of 100 rows. Do not parse all rows and only then begin business mapping.
   - Check the existing 2,000 ms deadline:
     - before parsing begins;
     - at every 100-row batch boundary;
     - during/following final partial-batch aggregation;
     - immediately before returning.
   - If the deadline expires, destroy/close the parser safely and return the existing static payload-free timeout failure. Use injected deterministic clock/check hooks in tests; do not write wall-clock-sensitive tests.
   - Keep a capped flattened issue list while issues are observed. Never build a larger flattened list and slice it later.
   - Continue processing while the observed issue count is at most `CSV_MAPPED_FILE_MAX_ISSUES`. Upon observing the first issue beyond the cap:
     - retain only the first `CSV_MAPPED_FILE_MAX_ISSUES`;
     - stop the parser and mapping loop promptly;
     - mark the result as invalid and incomplete;
     - expose `hasMoreIssues: true`;
     - expose enough type-safe metadata to distinguish partial from complete results, at minimum `validationComplete: false` and `processedRowCount`;
     - treat row/issue/valid/invalid/skipped counts as processed-prefix counts or lower bounds and document their exact semantics;
     - never label those partial counts as full-file or exact totals;
     - ensure no later persistence/activation consumer can treat an incomplete result as eligible.
   - For a file that reaches EOF without crossing the issue cap, return `validationComplete: true` and exact counts. A valid file must always reach EOF.
   - Per-row issue storage may remain only for processed rows under the existing file/row/column bounds. Do not retain unprocessed or duplicate flattened data.

2. **P4D-CSV-COMPLETE-IDENTITY-001 — central canonical object mapper**

   - Implement one focused canonical mapping helper at the validated-input trust boundary. Do not mutate caller input.
   - Sort mapping entries by numeric `sourceColumn`, with stable `target` ordering as a defensive tie-breaker, before producing assignments, canonical mapping JSON, `mappingIdentity`, mapped value insertion order, storage/comparison representations, or deterministic API output.
   - Rebuild each object with an explicit fixed property set and ordering. If a stable JSON serializer is introduced, keep it minimal and direct; remember that stable serializers sort object keys but do not semantically reorder arrays, so the mapping-entry sort is still required.
   - Equivalent mappings that differ only in incoming mapping-array order must produce byte-for-byte identical canonical mapping, identity, processed rows, values, issues, and complete-result counts.
   - Physical customer CSV column order remains separate from incoming mapping-array order. Template columns have a recommended order, but rearranged customer columns must remain supportable through explicit header/mapping confirmation.
   - Preserve every existing validation code and precedence. Do not auto-apply fuzzy header suggestions or add customer cell values to the identity.

3. **P4D-CSV-COMPLETE-VERIFICATION-001 — repair and verify the committed artifact**

   - Remove the trailing whitespace in `docs/phase-4d-csv-complete-file-validation.md`.
   - Follow the repository-wide Git verification preferences above.
   - Verify the committed feature range with `git diff --check a10489131522e79cf6bec9983ff520171254a7df..<final-implementation-sha>`.
   - Report the exact command, immutable SHAs, and exit result. A bare clean-working-tree check is insufficient.
   - Do not rewrite unrelated documentation.

4. **Official customer CSV templates**

   - Add two static, industry-neutral sample assets:
     - `public/templates/outreach-knowledge-import-template.csv`
     - `public/templates/outreach-offering-import-template.csv`
   - Derive supported, required, and optional headers from the current validated knowledge and offering schemas. Put headers in the canonical recommended order and include one safe fictional example row.
   - Templates must contain no formulas, formula-like prefixes, live URLs, secrets, personal information, comments that become data rows, or unsupported fields.
   - Document:
     - required columns cannot be removed;
     - optional columns may be removed or left blank;
     - columns may be rearranged because the server uses explicit headers/mapping rather than trusting position;
     - unknown or renamed columns require deliberate customer mapping confirmation and are never guessed or auto-applied;
     - templates are guidance, not a trust boundary.
   - Add no download UI, route, server action, or mapping UI in this task. The static assets and their validation coverage are the complete template scope.

### Required regression tests

Add deterministic tests proving:

- the shared `csv-parse` adapter preserves all existing valid CSV fixtures and fail-closed parser/security behavior;
- preview and complete-file parsing cannot disagree on accepted syntax;
- exact 5 MiB, row, column, cell, aggregate-character, BOM, quote, multiline, blank-row, CRLF/LF, inconsistent-column, duplicate-header, formula-like, and malformed-input boundaries retain the documented codes and precedence;
- the parser stops at the first record beyond `TABULAR_MAX_ROWS` rather than materializing the remainder;
- deadline expiry at a 100-row batch boundary and during final partial-batch/finalization returns the static timeout failure before successful completion;
- valid inputs reach EOF with `validationComplete: true` and exact counts;
- invalid inputs below or exactly at the issue cap reach EOF with complete/exact result metadata;
- observing issue `CSV_MAPPED_FILE_MAX_ISSUES + 1` retains only the first capped issues, stops before later sentinel rows, reports `hasMoreIssues: true`, `validationComplete: false`, and truthful processed-prefix/lower-bound counts;
- incomplete results cannot be mistaken for valid or persistence-eligible results;
- at least two semantically identical knowledge mappings and two offering mappings with different input mapping-array orders produce byte-for-byte identical canonical mapping, identity, processed rows, values, issues, and applicable counts;
- both committed template assets parse through the shared adapter, conform to the current schemas, contain no unsafe example values, and retain their canonical recommended header order;
- optional template columns can be absent, required columns fail clearly when absent, and rearranged supported headers can be deliberately mapped without fuzzy guessing;
- all existing 50-row preview, post-preview invalid-row, privacy, payload-free error, no-fetch, no-database-side-effect, XLSX-rejection, and Phase 4A–4D regressions remain green.

### Documentation

Update the Phase 4D documents to describe:

- why `csv-parse` is used and which official package/version is installed;
- the difference between parser limits, batch/deadline checks, issue retention, and business-schema validation;
- the revised early-stop contract and partial-count semantics;
- the template-first customer workflow and explicit-mapping fallback;
- the canonical identity normalization rule;
- that the 2,000 ms deadline is defense-in-depth and does not replace deterministic byte/row/column/cell/aggregate/issue limits.

Do not claim that `csv-parse` validates Outreach business semantics; Zod/current business validators remain responsible for mapped knowledge and offering values.

### Exclusions

Do not add routes, server actions, download UI, mapping UI, persistence, Prisma changes, migrations, jobs, activation, confirmation, duplicate/existing-record conflict handling, XLSX consumption, live connectors, or Phase 5 work. Do not remove or weaken `MR-4D-OOXML-001`.

### Verification and completion

Run and report:

- `npm ci`
- focused shared-parser, complete-file, mapping, template, tabular-validation, and security tests
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

Follow the lease/checkpoint rules. Commit and push dependency, implementation, tests, templates, and documentation before the completion report. Preserve blocker revision 1, its three stable IDs, attempt count 1, and history exactly; ChatGPT owns their resolution. Set `READY_FOR_REVIEW` only after every gate passes. Do not open or merge a pull request.

<!-- END:outreach-automation -->
