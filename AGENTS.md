<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:outreach-automation -->

# Outreach Automation Handoff

```yaml
task_id: phase-04d-tabular-validation-001
phase: "Phase 4D — tabular import validation foundation"
active_branch: feature/phase-04d-tabular-validation-foundation
base_develop_sha: d446ca52c1c8397d8b24bf7c2dc009b14800808d
cursor_implementation_sha: null
last_reviewed_sha: null
status: CURSOR_WORKING
previous_task_status: MERGED
previous_pr_number: 10
previous_develop_merge_sha: d446ca52c1c8397d8b24bf7c2dc009b14800808d
cursor_attempt_count: 1
consecutive_unchanged_checks: 0
last_cursor_activity_sha: null
stop_reason: null
unchanged_check_times: []
cursor_claimed_at: "2026-08-15T06:06:00Z"
cursor_completed_at: null
cursor_report: |
  Phase 4B was squash-merged through PR #10 into develop at d446ca52c1c8397d8b24bf7c2dc009b14800808d after exact-head push CI and PR CI passed. Post-merge develop CI run 31867499078 passed.
  A fresh Phase 4C audit against the merged develop tree found no blocking compatibility, authorization, migration, pricing, lifecycle, retrieval, or tenant-isolation issue. The complete 477-test integration suite and 16 E2E tests passed with Phase 4B and 4C combined.
  README project-status wording is stale and should be corrected in this Phase 4D task.
review_findings: |
  No blocking Phase 4C audit findings.
  Phase 4D begins with a bounded validation/preview foundation so later mapping and persistence work can consume one safe normalized tabular representation.
required_tests: |
  Unit fixtures for valid CSV and XLSX plus malformed, unsupported, mislabeled, oversized, excessive-row/column/cell, duplicate/blank-header, formula-like, hidden-sheet, and workbook ambiguity cases.
  Deterministic normalization tests for BOM, CRLF, quoted fields/newlines, whitespace, stable sheet/header/row ordering, and bounded safe error output.
  Security tests proving no formulas/macros/external links execute and no file content or sensitive row values enter logs/errors.
  Full format, lint, typecheck, unit, integration, Prisma validation, build, E2E, audit, and diff checks.
next_action: "Cursor has claimed Phase 4D task 1 (attempt 1 of 3) and is implementing the bounded tabular validation/preview foundation."
```

## Cursor implementation prompt — Phase 4D task 1

### Objective

Create the server-only, bounded validation and normalized-preview foundation for Phase 4D CSV/XLSX knowledge and offering imports. Authorized upload/UI, mapping persistence, database import records, activation, jobs, and final confirmation will be separate tasks. This task must make unsafe or ambiguous files fail closed before later import logic can consume them.

Work only on `feature/phase-04d-tabular-validation-foundation`, which was created from verified `develop` SHA `d446ca52c1c8397d8b24bf7c2dc009b14800808d`.

Read `requirements.md` KNOW-001, KNOW-002, KNOW-003, KNOW-004, KNOW-005 and required journey 12; read the Phase 4D section and Phase 4 completion gate in `outreach-implementation-phases.md`; read `docs/phase-4a-business-knowledge-core.md`, `docs/phase-4b-private-document-processing.md`, and `docs/phase-4c-structured-offerings.md`. Create `docs/phase-4d-tabular-import-hardening.md` for the Phase 4D contract and task boundaries.

### Deliverable

Implement a reusable server-only tabular validation module that accepts caller-supplied bytes plus original filename and declared MIME type, then returns a deterministic normalized preview model suitable for a later customer-reviewed column-mapping flow.

The normalized model should include only bounded metadata and cell values needed by later tasks, such as:

- validated file kind and byte size;
- workbook/sheet identity and visibility metadata;
- stable selected-sheet or explicit ambiguity result;
- normalized headers with source column positions;
- bounded preview rows with stable source row numbers;
- total row/column counts when safely known;
- warnings and row/cell validation issues using safe codes and locations;
- a deterministic file checksum suitable for idempotency in a later persistence task.

Keep the public contract explicit and provider-independent. Do not create fake connector abstractions or a general job framework.

### Required validation and security behavior

- Accept only `.csv` and non-macro `.xlsx`; reject legacy `.xls`, `.xlsm`, archives, encrypted/password-protected workbooks, executables, polyglots, and unsupported content.
- Validate extension, declared MIME, and server-detected signature/content consistently. Browser MIME and filename are untrusted.
- Apply explicit byte, workbook, worksheet, row, column, cell-length, aggregate-character, and processing-time limits before or during expansion. XLSX ZIP handling must be protected against excessive entries, expansion, compression ratios, nesting, and path traversal.
- Parse CSV deterministically, including UTF-8 BOM, CRLF/LF, quoted delimiters, quoted newlines, escaped quotes, and trailing blank rows. Reject invalid encoding, NUL/binary-heavy content, inconsistent structures where unsafe, and unbounded records.
- Treat formulas, cached formula results, hyperlinks, external workbook links, macros, hidden/very-hidden sheets, merged-cell ambiguity, duplicate/blank headers, and multiple candidate sheets explicitly. Never evaluate formulas or follow links. Formula-like values must remain inert and be identified for later mapping/export safety.
- Do not silently choose an ambiguous worksheet or header row. Return a safe validation/needs-attention result that a later UI can resolve.
- Preserve source row/column locations without exposing file bytes or full sensitive rows through exceptions, logs, audit metadata, or client-facing messages.
- Keep parsing server-only and independent from production storage or credentials.
- Reuse existing hashing, safe-error, document-validation, and size-boundary conventions where appropriate, but do not weaken Phase 4B validation or couple tabular formats to document extraction.

### Dependency requirements

Audit the current package set before adding dependencies. If a CSV/XLSX parser is required, choose the smallest maintained Node 22-compatible package(s) with acceptable license and current security posture; document why, pin through `package-lock.json`, and verify the production dependency audit. Do not add both overlapping libraries without a concrete need. Remove no unrelated dependency in this task.

### Tests

Add deterministic unit tests and small generated/checked-in fixtures that fail before implementation and pass afterward.

At minimum cover:

1. valid UTF-8 CSV and valid non-macro XLSX producing equivalent normalized headers and preview rows;
2. BOM, CRLF, quoted commas/newlines, escaped quotes, blank trailing rows, and stable row numbers;
3. extension/MIME/signature mismatch and unsupported `.xls`/`.xlsm`;
4. malformed CSV/XLSX, invalid encoding, NUL/binary payload, encrypted workbook, archive/polyglot input, traversal names, and decompression/entry/count limits;
5. byte, sheet, row, column, cell, aggregate text, and processing limits at the boundary and one past it;
6. blank/duplicate headers, hidden sheets, multiple candidate sheets, merged cells, formulas, cached formula values, hyperlinks, and external links;
7. deterministic checksum and output ordering across repeated parses;
8. safe errors containing codes and source locations but not full row content, file bytes, formulas, URLs, or secrets;
9. regression proof that existing PDF/DOCX/TXT document validation and Phase 4C offering behavior are unchanged.

Avoid timing-only assertions and fixtures large enough to burden the repository; generate bounded adversarial archives/workbooks in tests where practical.

### Documentation and stale wording

- Add `docs/phase-4d-tabular-import-hardening.md` describing accepted formats, limits, trust boundaries, normalized preview contract, formula/link behavior, safe errors, dependency choice, deferred tasks, and recovery expectations.
- Update the stale README project-status line and current-next-step section to state that Phases 4B and 4C are merged and Phase 4D tabular import hardening has begun on this branch.
- Add the Phase 4C and new Phase 4D documents to the README developer/project document lists.
- Do not claim the complete Phase 4D import journey or overall Phase 4 is finished.

### Explicit exclusions

- No database schema or Prisma migration.
- No storage bucket changes, production credentials, production migrations, or external services.
- No upload route, browser form, server action, mapping UI, saved mapping template, import record, background job, progress UI, retry workflow, persistence, offering creation, activation, confirmation, retrieval integration, or live commerce/CRM/inventory connector.
- No Phase 5 work and no unrelated refactor.
- Do not modify `main` or `develop`, open or merge a PR, rebase, force-push, reset history, or replace shared branches.

### Verification

Run and report exact results for:

- `npm ci`
- `npm run format:check`
- `npm run lint`
- `npm run typecheck`
- `npm run prisma:validate`
- a fresh PostgreSQL `npm run prisma:migrate:deploy` through the current Phase 4C migration
- focused tabular validation/security tests
- `npm test`
- `npm run test:integration`
- `npm run build`
- `CI=true npm run test:e2e`
- `npm audit --omit=dev`
- `git diff --check`

A skipped, pending, unavailable, flaky, or failing required check is not a pass.

### Acceptance criteria

- Valid CSV/XLSX inputs produce the same stable, bounded normalized preview contract.
- Unsupported, mismatched, ambiguous, malicious, or over-limit inputs fail closed with safe deterministic evidence.
- No formula, macro, external link, archive path, or spreadsheet content is executed or fetched.
- Parser resource use is bounded and sensitive file content is absent from logs and safe errors.
- Existing Phase 4A–4C behavior and full verification remain green.
- Documentation accurately states what this foundation implements and what later Phase 4D tasks must still add.
- No excluded persistence, UI, activation, connector, job, or schema work is introduced.

### Completion handoff

When claiming this task, set `status: CURSOR_WORKING`, increment `cursor_attempt_count` from 0 to 1 exactly once, set `cursor_claimed_at`, and commit that state before implementation.

After implementation and verification:

1. Commit application/tests/docs without the completion report.
2. Record the last non-report implementation SHA in `cursor_implementation_sha`.
3. Update `cursor_report` with files, dependencies, accepted formats/limits, validation behavior, tests, exact commands/results, migrations, security/privacy, assumptions, manual configuration, remaining risks, and deferred tasks.
4. Set `status: READY_FOR_REVIEW`, reset `consecutive_unchanged_checks` to 0, update `last_cursor_activity_sha`, and set the next action to ChatGPT complete-branch review against current `develop`.
5. Commit only the report/handoff as `chore: report Cursor task completion`, push this branch, and stop.

If blocked, set `status: BLOCKED`, record exact safe evidence and `stop_reason`, push the handoff when safe, and stop.

## ChatGPT Phase 4C audit result

Phase 4C has no blocking follow-up after Phase 4B integration. PR #10 merged Phase 4B into `develop` at `d446ca52c1c8397d8b24bf7c2dc009b14800808d`; post-merge CI run 31867499078 passed the combined Phase 4B/4C suite. Phase 4D may proceed.

<!-- END:outreach-automation -->
