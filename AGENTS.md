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
cursor_implementation_sha: 58010d58b1a71432d8857e4335cd1adc46064c44
last_reviewed_sha: 8b059037a9462efafa72adac0eec83e42b725d2a
status: READY_FOR_REVIEW
previous_task_status: MERGED
previous_pr_number: 10
previous_develop_merge_sha: d446ca52c1c8397d8b24bf7c2dc009b14800808d
cursor_attempt_count: 2
consecutive_unchanged_checks: 0
last_cursor_activity_sha: 58010d58b1a71432d8857e4335cd1adc46064c44
stop_reason: null
unchanged_check_times: []
cursor_claimed_at: "2026-08-15T07:06:00Z"
cursor_completed_at: "2026-08-15T07:16:30Z"
cursor_report: |
  Attempt 2 of 3 completed at implementation SHA 58010d58b1a71432d8857e4335cd1adc46064c44 (claim ee273dc3d89a7deaa76f06a8aaf9c4c39a6d79a7). Objective: harden the server-only CSV/XLSX validation foundation so malformed quoted CSV, spreadsheet-formula prefixes, OOXML comment injection, duplicate cell coordinates, extra-column aggregate bypasses, and misbound workbook content types fail closed or produce the required payload-free attention issue.
  Requirements/acceptance: post-quote CSV state allows only delimiter, CR/LF, or EOF; formula_like is classified from the untrimmed source for leading = + - @ tab CR LF on CSV headers/rows and XLSX string cells; OOXML comments are stripped with a bounded scanner that preserves quoted attributes and CDATA, and only real sheet/Relationship/sheetData elements are consumed; duplicate coordinates throw malformed; every populated XLSX cell is counted once toward the aggregate limit including extra columns and hidden sheets without enlarging preview output; [Content_Types].xml must bind the non-macro workbook main type to /xl/workbook.xml.
  Root cause and fix per finding:
  1. parseCsvRecords returned to the ordinary state after a closing quote, so "safe"attacker was accepted. A post-quoted-field state now rejects any byte other than comma/CR/LF/EOF.
  2. isFormulaLike required ()!| after +/- and CSV/XLSX trimmed before classification. Classification now uses the untrimmed first character; display values remain whitespace-normalized; issues stay payload-free.
  3. Regex scans treated XML comments as workbook markup and last-write won on duplicate cells. Comments/PIs/CDATA are scanned structurally; sheet, Relationship, and cell tags are read from required parents; duplicate coordinates throw malformed.
  4. addAggregate visited only header-width columns. Every stored populated cell is counted once before building the bounded preview.
  5. Any Override with the workbook main type was accepted. The canonical /xl/workbook.xml part must carry that type; an unrelated part carrying it while workbook.xml is misdeclared is type_mismatch.
  Files changed: lib/orgs/tabular-csv.ts; lib/orgs/tabular-helpers.ts; lib/orgs/tabular-xlsx.ts; lib/orgs/tabular-validation.test.ts; lib/orgs/tabular-security.test.ts; tests/helpers/tabular-fixtures.ts; docs/phase-4d-tabular-import-hardening.md (formula prefixes, comment stripping, aggregate counting, canonical content type). No migrations added or changed. No new npm dependencies.
  Tests added/updated: junk after closing quote, quotes in unquoted fields, escaped-quote and quoted delimiter/newline controls; CSV/XLSX formula prefixes including +1+1, -2+3, tab/CR/LF before trim, payload-free issues; commented fake sheet/Relationship/c/f/hyperlink/mergeCell markup plus duplicate A1; XLSX aggregate at and one past the limit for selected columns, extra columns, and hidden-sheet extra columns; misbound workbook content type on a worksheet Override. Existing tabular, document, offering, security, boundary, preview, and safe-error tests retained.
  Commands and exact results on this implementation head:
  - npm ci: added 553 packages, audited 554, 0 vulnerabilities
  - npm run format:check: All matched files use Prettier code style
  - npm run lint: exit 0
  - npm run typecheck: next typegen + tsc --noEmit succeeded
  - npm run prisma:validate: schema valid
  - fresh DROP/CREATE outreach_ci + npm run prisma:migrate:deploy: 11 migrations applied through Phase 4C
  - focused lib/orgs/tabular-validation.test.ts lib/orgs/tabular-security.test.ts lib/orgs/document-validation.test.ts lib/orgs/offering-validation.test.ts: 4 files, 34 passed
  - npm test: 25 files, 152 passed
  - npm run test:integration: 40 files, 477 passed
  - npm run build: Next.js 16.3.0 compiled successfully
  - CI=true npm run test:e2e: 16 passed (30.8s)
  - npm audit --omit=dev: found 0 vulnerabilities
  - git diff --check: clean
  Authorization/tenant isolation: no permission, tenant-scope, upload-route, or storage changes. Existing Phase 4A–4C integration and E2E suites passed unchanged.
  Security/privacy: no credentials, tokens, or customer data exposed. Macros/encryption/polyglots/zip bombs still fail closed. Formulas and links remain inert and are not fetched. Safe errors and issue objects contain codes/locations only.
  Failure/recovery: malformed quotes, duplicate cells, misbound content types, and over-limit aggregate text are terminal for this parse attempt. Formula-like and extra-column files return needs_attention. No jobs or storage objects are created.
  Manual configuration still required: none for this foundation.
  Assumptions: comma remains the only CSV delimiter; header row is the first non-empty record/row; leading space before =/+/-/@ is not a spreadsheet prefix (only the untrimmed first character is classified); XML comments cannot contain --.
  Remaining risks: worksheet markup after comment stripping is still tag-scanned rather than a full OOXML DOM; later mapping/persistence must consume this preview rather than re-parsing with a second library.
  Deferred work: upload UI/routes, mapping templates, import records, jobs, persistence, offering/knowledge activation, confirmation, retrieval, and connectors remain later Phase 4D tasks. Phase 5 is untouched. No PR opened; ChatGPT owns the develop merge gate.
review_findings: |
  REVIEW FAILED on exact remote review head 8b059037a9462efafa72adac0eec83e42b725d2a (Cursor implementation b1d9c35a44d71d008297acfa2a35d86ee91d3ae7 is an ancestor; the two later commits modify AGENTS.md only). The branch is based on current develop d446ca52c1c8397d8b24bf7c2dc009b14800808d and is not behind.
  BLOCKING — lib/orgs/tabular-csv.ts accepts malformed quoted fields. After a closing quote, parseCsvRecords returns to the ordinary state and accepts arbitrary bytes before a delimiter/end-of-record, so input such as Name\n\"safe\"attacker is normalized as a valid cell instead of failing closed. Track the post-quote state and permit only delimiter, CR/LF, or end-of-input after a closing quote. Add regression tests for junk after a closing quote, quotes in unquoted fields, escaped quotes, and valid delimiters/newlines after quoted fields.
  BLOCKING SECURITY — lib/orgs/tabular-helpers.ts and lib/orgs/tabular-csv.ts do not identify the full spreadsheet-formula injection prefix set. The current + / - regex requires one of ()!|, so values such as +1+1 and -2+3 return ready; normalizeCell trims leading tab/CR/LF before classification, erasing indicators. Classify from the untrimmed source and flag leading =, +, -, @, tab, CR, or LF conservatively while keeping values inert. Cover CSV headers and data cells and equivalent XLSX string cells. The issue object must remain payload-free.
  BLOCKING — lib/orgs/tabular-xlsx.ts scans XML with regular expressions without excluding comments, so well-formed OOXML comments containing fake <sheet>, <Relationship>, <c>, <f>, <hyperlink>, or <mergeCell> markup are treated as workbook data. A commented fake cell can overwrite a real coordinate or manufacture row/column/formula evidence. Sanitize/parse XML structurally within the existing resource limits so only real elements in the required OOXML locations are consumed; reject malformed or ambiguous duplicate cell coordinates instead of silently taking the last match. Add adversarial comment fixtures proving comments cannot alter sheets, cells, limits, or issues.
  BLOCKING — XLSX aggregate text accounting ignores occupied cells outside the header-derived width. parseWorksheet records those cells but addAggregate only visits headers and columns through headerColumnCount; a workbook can exceed TABULAR_MAX_AGGREGATE_CHARS in extra columns and return needs_attention instead of hard-failing text_too_large. Count every populated cell exactly once, including extra columns and hidden sheets, while preserving bounded output. Add at-limit and one-past tests for XLSX aggregate text in both selected and extra columns.
  BLOCKING CONTENT VALIDATION — the [Content_Types].xml test accepts any Override carrying the workbook main content type even when /xl/workbook.xml itself has a different type. Bind the required content type to the canonical workbook part and add a fixture where an unrelated part carries the main type; it must fail type_mismatch or malformed.
  Exact-head GitHub Actions evidence is absent because no PR exists yet. Cursor reported the full local suite green on b1d9c35a44d71d008297acfa2a35d86ee91d3ae7, but missing exact-head CI cannot satisfy the merge gate. Do not open a PR; ChatGPT will open it after the corrective review passes.
required_tests: |
  Add regression tests that fail against b1d9c35a44d71d008297acfa2a35d86ee91d3ae7 and pass after the fix for: malformed CSV bytes after a closing quote; complete formula-injection prefixes before normalization in CSV and XLSX; commented fake OOXML workbook/relationship/worksheet elements plus duplicate cell coordinates; XLSX aggregate text at and one past the limit including cells wider than the header; and workbook content type bound to /xl/workbook.xml.
  Retain all existing tabular, document, offering, security, boundary, deterministic-preview, and safe-error tests.
  Rerun npm ci, format:check, lint, typecheck, prisma:validate, a fresh PostgreSQL prisma:migrate:deploy, focused tabular tests, npm test, test:integration, build, CI=true test:e2e, npm audit --omit=dev, and git diff --check. Missing, skipped, pending, flaky, or failing checks are not a pass.
next_action: "ChatGPT must review the complete branch against the current develop branch."
```

## Cursor corrective implementation prompt — Phase 4D task 1, attempt 2

### Objective

Harden the existing server-only CSV/XLSX validation foundation so malformed CSV, spreadsheet-formula injection prefixes, OOXML comment injection, duplicate cell coordinates, aggregate-text bypasses, and misbound workbook content types all fail closed or produce the required safe attention issue. Work only on `feature/phase-04d-tabular-validation-foundation`. Do not broaden the task into upload, persistence, mapping UI, jobs, activation, connectors, schema, or migrations.

### Evidence and exact problems

1. `parseCsvRecords` has no post-closing-quote state. `"safe"attacker` is accepted as a field. Only delimiter, CR/LF, or EOF is legal after a quoted field closes.
2. `isFormulaLike` misses leading `+` and `-` unless later punctuation matches, while CSV trimming erases leading tab/CR/LF evidence. Classify the original value before destructive normalization and conservatively flag spreadsheet execution prefixes `=`, `+`, `-`, `@`, tab, CR, and LF. Keep values literal and issue objects payload-free.
3. Regex scans consume markup inside XML comments as real OOXML. Comments must not create/replace sheets, relationships, cells, formulas, hyperlinks, merged ranges, or limit evidence. Use a bounded structural parser or a rigorously validated preprocessing/parsing approach; reject malformed ambiguity and duplicate cell coordinates.
4. XLSX aggregate accounting skips populated cells beyond the header width. Enforce the aggregate character limit across every populated workbook cell exactly once, including extra columns and hidden sheets, without enlarging preview output.
5. The workbook main content type is accepted when attached to an unrelated Override. Require the exact canonical `/xl/workbook.xml` part to carry the non-macro XLSX workbook main type.

### Required fixes and regression tests

- Add failing-before/passing-after unit and security tests for every problem above.
- Include valid controls for escaped quotes and quoted-field delimiters/newlines.
- Include commented fake `sheet`, `Relationship`, `c`, `f`, `hyperlink`, and `mergeCell` markup and a duplicate-coordinate fixture.
- Cover formula prefixes in headers and rows for CSV and string cells for XLSX without leaking values into errors/issues/logs.
- Cover XLSX aggregate limit at the boundary and one past it, including text only in columns wider than the header.
- Cover an unrelated content-type Override carrying the workbook main type while `/xl/workbook.xml` is misdeclared.
- Preserve existing public types and deterministic output unless a minimal safe contract correction is necessary and documented.

### Explicit exclusions

No database/Prisma changes, production access, storage, routes, UI, mapping templates, import records, jobs, persistence, activation, retrieval, connectors, Phase 5 work, unrelated refactors, new PR, rebase, force-push, history reset, or changes to `develop`/`main`.

### Verification and acceptance

Run every command in `required_tests` and provide exact results. Acceptance requires all new regressions and the complete existing suite to pass, no new dependency without documented necessity and audit evidence, safe bounded failures, no formula/link execution or fetch, no sensitive payload in errors/issues/logs, unchanged Phase 4A–4C behavior, and a clean branch still based on current `develop`.

### Completion report

Record the exact corrective implementation SHA, files changed, root cause and fix for each finding, regression tests, exact command results, dependency/audit status, authorization/tenant impact, security/privacy analysis, remaining risks, and deferred work. Set `status: READY_FOR_REVIEW`, reset `consecutive_unchanged_checks: 0`, and set `last_cursor_activity_sha` to the corrective implementation/report head. Do not claim or push while ChatGPT owns the branch.


<!-- END:outreach-automation -->
