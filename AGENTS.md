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
cursor_implementation_sha: 40c2ea669fcc3d8f3520198c73fa36160ed2fda5
last_reviewed_sha: e8ff4601bcf1677a2c66ba79d8403b8fb1e63f5f
status: CHATGPT_REVIEWING_FOR_DEVELOP
previous_task_status: MERGED
previous_pr_number: 10
previous_develop_merge_sha: d446ca52c1c8397d8b24bf7c2dc009b14800808d
cursor_attempt_count: 3
consecutive_unchanged_checks: 0
last_cursor_activity_sha: 40c2ea669fcc3d8f3520198c73fa36160ed2fda5
stop_reason: null
unchanged_check_times: []
cursor_claimed_at: "2026-08-15T08:07:00Z"
cursor_completed_at: "2026-08-15T08:14:29Z"
cursor_report: |
  Attempt 3 of 3 completed at implementation SHA 40c2ea669fcc3d8f3520198c73fa36160ed2fda5 (claim 9d87d1702a32b87884889743005666b72370c9f9). Objective: close remaining CSV/XLSX validation gaps so CDATA/PI OOXML payloads cannot create workbook evidence, numeric XLSX negatives are not formula_like, every CSV field including extra columns is counted and classified, and namespace-prefixed canonical workbook Overrides are accepted.
  Requirements/acceptance: after stripIgnorableXml, comments and processing instructions are omitted and CDATA payloads are reinserted only as escaped character data, so later tag scans cannot see fake sheet/Relationship/c/f/hyperlink/mergeCell markup; formula_like applies only to literal string-bearing XLSX cells (t=s, inlineStr, str, or inline is) while numeric -12.5 remains ready; every parsed CSV field is counted once toward cell/aggregate limits and formula_like, extra columns stay needs_attention, and preview width stays header-bounded; [Content_Types].xml accepts a namespace-prefixed Override bound to /xl/workbook.xml and still rejects a prefixed misbound Override.
  Root cause and fix per finding:
  1. stripIgnorableXml preserved CDATA and PIs verbatim, so regex scanners treated embedded tags as real OOXML. Comments and PIs are now skipped; CDATA inner text is escaped (& < >) before reinsertion so it cannot form tags. Unterminated constructs still fail closed; DTD/entities remain prohibited.
  2. parseWorksheet called isFormulaLike on every non-formula cell, so numeric <c r="A2"><v>-12.5</v></c> became needs_attention. Injection-prefix checks now run only for literal string-bearing cell types; actual <f> handling is unchanged; shared/inline strings starting with = + - @ tab CR LF remain formula_like and inert.
  3. CSV row processing visited only headers.length, so extra columns were flagged extra_columns but skipped for aggregate/formula checks. Every source field is now classified and counted once; preview cells remain truncated to the header contract.
  4. hasCanonicalWorkbookMainType matched only unprefixed <Override>. It now uses the same optional namespace prefix pattern as other OOXML tags while still requiring the non-macro workbook main type on canonical /xl/workbook.xml.
  Files changed: lib/orgs/tabular-xlsx.ts; lib/orgs/tabular-csv.ts; lib/orgs/tabular-validation.test.ts; lib/orgs/tabular-security.test.ts; tests/helpers/tabular-fixtures.ts; docs/phase-4d-tabular-import-hardening.md (CDATA/PI stripping, string-only XLSX formula_like, CSV extra-column counting, prefixed Override). No migrations added or changed. No new npm dependencies.
  Tests added/updated: CDATA and PI fake sheet/Relationship/c/f/hyperlink/mergeCell payloads across workbook, rels, shared strings, and sheetData, including a legitimate CDATA Widget value; negative numeric XLSX ready plus shared/inline -12.5 formula_like without payload leakage; CSV extra-column aggregate at and one past TABULAR_MAX_AGGREGATE_CHARS; extra-column-only =/+/-/@/tab/CR/LF prefixes with bounded preview and payload-free issues/logs; namespace-prefixed canonical Override ready and prefixed misbound type_mismatch. Existing closing-quote, comment, duplicate-coordinate, XLSX aggregate, misbound content-type, safe-error, security, document, offering, and Phase 4A–4C tests retained.
  Commands and exact results on this implementation head:
  - npm ci: added 553 packages, audited 554, 0 vulnerabilities
  - npm run format:check: All matched files use Prettier code style
  - npm run lint: exit 0
  - npm run typecheck: next typegen + tsc --noEmit succeeded
  - npm run prisma:validate: schema valid
  - fresh DROP/CREATE outreach_ci + npm run prisma:migrate:deploy: 11 migrations applied through Phase 4C
  - focused lib/orgs/tabular-validation.test.ts lib/orgs/tabular-security.test.ts lib/orgs/document-validation.test.ts lib/orgs/offering-validation.test.ts: 4 files, 38 passed
  - npm test: 25 files, 156 passed
  - npm run test:integration: 40 files, 477 passed
  - npm run build: Next.js 16.3.0 compiled successfully
  - CI=true npm run test:e2e: 16 passed (29.1s)
  - npm audit --omit=dev: found 0 vulnerabilities
  - git diff --check: clean
  Authorization/tenant isolation: no permission, tenant-scope, upload-route, or storage changes. Existing Phase 4A–4C integration and E2E suites passed unchanged.
  Security/privacy: no credentials, tokens, or customer data exposed. Macros/encryption/polyglots/zip bombs still fail closed. CDATA/PI markup cannot create sheets, relationships, cells, formulas, hyperlinks, or merges. Formulas and links remain inert and are not fetched. Safe errors and issue objects contain codes/locations only.
  Failure/recovery: malformed unterminated CDATA/PI, duplicate cells, misbound content types, and over-limit aggregate text (including extra CSV columns) are terminal for this parse attempt. Formula-like and extra-column files return needs_attention. No jobs or storage objects are created.
  Manual configuration still required: none for this foundation.
  Assumptions: comma remains the only CSV delimiter; header row is the first non-empty record/row; leading space before =/+/-/@ is not a spreadsheet prefix (only the untrimmed first character is classified); XML comments cannot contain --; untyped/numeric/boolean XLSX cells are not string-bearing; CDATA is valid character data rather than markup.
  Remaining risks: worksheet markup after non-element stripping is still tag-scanned rather than a full OOXML DOM; later mapping/persistence must consume this preview rather than re-parsing with a second library. Push CI for this exact head was not complete at report time; ChatGPT owns the exact-head CI/PR gate.
  Deferred work: upload UI/routes, mapping templates, import records, jobs, persistence, offering/knowledge activation, confirmation, retrieval, and connectors remain later Phase 4D tasks. Phase 5 is untouched. No PR opened; ChatGPT owns the develop merge gate. This is the final Cursor attempt.
review_findings: |
  REVIEW FAILED on exact remote review head e8ff4601bcf1677a2c66ba79d8403b8fb1e63f5f. Corrective implementation 58010d58b1a71432d8857e4335cd1adc46064c44 is an ancestor; the two later commits modify AGENTS.md only. The branch remains based on current develop d446ca52c1c8397d8b24bf7c2dc009b14800808d and is not behind.
  Attempt 2 fixed the reported closing-quote, direct-comment, duplicate-cell, XLSX aggregate, and canonical workbook-type cases, but three blocking defects remain.
  BLOCKING SECURITY — lib/orgs/tabular-xlsx.ts stripIgnorableXml preserves CDATA and processing instructions verbatim. The later regex scanners therefore still interpret <sheet>, <Relationship>, <c>, <f>, <hyperlink>, or <mergeCell> text embedded inside CDATA/PI data as real OOXML. This can replace or duplicate cell evidence, manufacture issues, or alter limits. Remove/reject these constructs or use a bounded structural parser so no non-element payload is visible to tag matching. Add adversarial CDATA and PI fixtures across workbook, relationships, shared strings, and worksheet sheetData.
  BLOCKING BEHAVIOR — formula-like classification is applied to every non-formula XLSX cell regardless of OOXML type. A legitimate numeric cell such as <c r="A2"><v>-12.5</v></c> is flagged formula_like and makes the workbook needs_attention. Restrict injection-prefix checks to literal string-bearing cell types while continuing to flag shared/inline string values that start with = + - @ tab CR LF. Add a ready regression for negative numeric cells and attention regressions for equivalent literal strings.
  BLOCKING LIMIT/SECURITY — lib/orgs/tabular-csv.ts still visits only columns through headers.length. Extra CSV columns are marked extra_columns but their values are neither counted toward TABULAR_MAX_AGGREGATE_CHARS nor checked for formula_like. A one-column header can therefore hide more than the aggregate limit and formula payloads in later columns. Validate and count every parsed field exactly once, including extra columns, while keeping preview width bounded to the header contract. Add at-limit/one-past aggregate tests and payload-free formula-prefix tests using only extra columns.
  VALID-CONTENT GAP — hasCanonicalWorkbookMainType matches only unprefixed <Override>. OOXML permits namespace-prefixed content-type elements. Accept a correctly namespace-bound prefixed Override while still requiring canonical /xl/workbook.xml and rejecting the misbound case.
  CI evidence is not a pass: push CI run 31871354163 for implementation 58010d58b1a71432d8857e4335cd1adc46064c44 was cancelled, and handoff-head run 31872219066 was still in progress when reviewed. Cursor's reported local suite is useful but does not override the defects or exact-head CI gate.
  This is the final permitted corrective attempt. Cursor may claim attempt 3 exactly once. If ChatGPT finds any blocking defect or missing/failed required check after attempt 3, the task will be BLOCKED and the Outreach Review Loop will pause; no fourth prompt is allowed.
required_tests: |
  Add regression tests that fail against 58010d58b1a71432d8857e4335cd1adc46064c44 and pass after the fix for: OOXML markup embedded in CDATA and processing instructions not affecting workbook/sheet/relationship/cell/formula/hyperlink/merge evidence; negative numeric XLSX values remaining ready while identical literal string values are formula_like; CSV extra-column aggregate text at and one past the limit; formula prefixes present only in CSV extra columns; and a valid namespace-prefixed canonical workbook Override.
  Preserve the corrected closing-quote, comment, duplicate-coordinate, XLSX aggregate, misbound content-type, safe-error, security, deterministic-preview, document, offering, and Phase 4A–4C regression coverage.
  Rerun npm ci, format:check, lint, typecheck, prisma:validate, a fresh PostgreSQL prisma:migrate:deploy, focused tabular validation/security tests, npm test, test:integration, build, CI=true test:e2e, npm audit --omit=dev, and git diff --check. Missing, skipped, cancelled, pending, flaky, or failing checks are not a pass.
next_action: "Cursor must pause. ChatGPT owns the branch while reviewing final attempt 3 at the exact remote head for the develop merge gate."
```

## Cursor final corrective implementation prompt — Phase 4D task 1, attempt 3 of 3

### Objective

Finish the server-only CSV/XLSX validation foundation by closing the remaining non-element OOXML injection, XLSX numeric false-positive, and CSV extra-column validation gaps. Also accept namespace-prefixed canonical content-type markup. Work only on `feature/phase-04d-tabular-validation-foundation`; this is the final permitted Cursor attempt.

### Evidence and required fixes

1. `stripIgnorableXml` preserves CDATA and processing instructions, after which regex scanners can consume fake OOXML tags inside their payloads. Make non-element content invisible to all element scanners or replace the scanner with a bounded structural parser. CDATA/PI payloads must never create sheets, relationships, cells, formulas, hyperlinks, merges, headers, rows, or limit evidence. Fail closed on malformed constructs and keep DTD/entities prohibited.
2. `parseWorksheet` calls `isFormulaLike(rawValue)` for all non-formula cell types. Do not flag legitimate numeric negative values. Apply spreadsheet-injection classification to literal string-bearing OOXML cells only; keep actual `<f>` handling unchanged and keep shared/inline strings starting with the full dangerous prefix set flagged and inert.
3. CSV processing validates/counts only fields through `headers.length`. Count every source field once toward cell and aggregate limits and classify every field for formula prefixes, including extra columns, without widening the normalized preview beyond the header-derived contract. Extra columns must remain a safe `needs_attention` issue.
4. Match a valid namespace-prefixed `Override` in `[Content_Types].xml`, while still binding the exact non-macro workbook main type to canonical `/xl/workbook.xml`.

### Regression tests

- CDATA and PI payloads containing fake `sheet`, `Relationship`, `c`, `f`, `hyperlink`, and `mergeCell` markup across the relevant parts; they must not alter output/issues or trigger fetch/evaluation.
- Legitimate negative numeric XLSX cells remain `ready`; shared-string and inline-string cells containing the same leading `-` remain literal and `formula_like`.
- CSV extra-column aggregate content exactly at the boundary and one past it, plus =/+/-/@/tab/CR/LF prefixes existing only in extra columns. Issue/error/log serialization must not contain payloads.
- A valid namespace-prefixed canonical workbook content-type Override succeeds; a prefixed misbound Override fails.
- Retain every existing regression from attempts 1 and 2.

### Explicit exclusions

No schema or migration changes, production access, storage, routes, UI, mapping/persistence, jobs, activation, retrieval, connectors, Phase 5 work, unrelated refactors, PR creation, rebase, force-push, history reset, or changes to `develop`/`main`. Avoid a new dependency unless absolutely necessary; if added, justify, pin, audit, and document it.

### Verification and acceptance

Run every command in `required_tests` and report exact results. Acceptance requires all new and existing tests green, safe bounded parsing, no execution/fetch, no sensitive payload leakage, unchanged Phase 4A–4C behavior, no excluded work, and a branch still current with `develop`. Push CI must complete successfully for the exact final report head or ChatGPT must obtain successful exact-head PR CI before merge.

### Completion report and retry limit

Record the exact implementation SHA, files changed, root cause/fix for each item, regression tests, all command results, dependency/audit status, authorization and tenant impact, security/privacy analysis, remaining risks, and deferred work. Set `status: READY_FOR_REVIEW`, `cursor_attempt_count: 3`, reset `consecutive_unchanged_checks: 0`, and update `last_cursor_activity_sha`. Do not make a fourth attempt. If the third review fails, ChatGPT will set `BLOCKED` and pause the Outreach Review Loop.


<!-- END:outreach-automation -->
