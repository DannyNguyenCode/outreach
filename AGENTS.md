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
last_reviewed_sha: aa8c0aae242f63c150ec8b92d7d623b08300df3c
status: BLOCKED
previous_task_status: MERGED
previous_pr_number: 10
previous_develop_merge_sha: d446ca52c1c8397d8b24bf7c2dc009b14800808d
cursor_attempt_count: 3
consecutive_unchanged_checks: 0
last_cursor_activity_sha: 40c2ea669fcc3d8f3520198c73fa36160ed2fda5
stop_reason: CURSOR_RETRY_LIMIT_EXHAUSTED
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
  BLOCKED after Cursor attempt 3 of 3. Exact remote review head aa8c0aae242f63c150ec8b92d7d623b08300df3c contains corrective implementation 40c2ea669fcc3d8f3520198c73fa36160ed2fda5 as an ancestor; the two later commits modify AGENTS.md only. The branch is current with develop d446ca52c1c8397d8b24bf7c2dc009b14800808d.
  Attempt 3 fixed the requested CDATA/PI injection, negative numeric XLSX, CSV extra-column accounting/classification, and namespace-prefixed content-type regressions.
  REMAINING BLOCKING DEFECT — lib/orgs/tabular-xlsx.ts still does not validate the required OOXML document structure. parseWorksheet accepts any text containing a <sheetData> fragment without requiring a single valid <worksheet> document root. parseWorkbookSheets similarly accepts a rootless <sheets> fragment, parseWorkbookRelationships explicitly falls back to scanning the entire payload when <Relationships> is absent, and hasCanonicalWorkbookMainType does not require a valid <Types> root. Consequently malformed XLSX XML parts can produce a ready normalized preview instead of failing closed with malformed/type_mismatch, violating the task's malformed-XLSX acceptance criterion.
  Required proof would include rootless/misrooted/multiple-root workbook.xml, workbook.xml.rels, [Content_Types].xml, sharedStrings.xml, and worksheet parts; malformed nesting/trailing root content; and valid namespace-prefixed controls. The validator must require one correctly rooted, structurally well-formed document for every consumed OOXML part before extracting business data.
  Cursor reported all local checks green on implementation 40c2ea669fcc3d8f3520198c73fa36160ed2fda5 (156 unit, 477 integration, 16 E2E, migrations, build, lint, formatting, typecheck, audit), but passing tests do not cover this defect. Implementation push CI run 31873868988 was cancelled. Review-handoff CI run 31874668017 remained in progress when the blocking decision was made, so exact-head CI was also not yet a pass.
  Retry budget is exhausted. No fourth Cursor prompt or implementation attempt is authorized. No PR may be opened and this branch must not be merged. Bao must decide whether to authorize a new human-designed task/branch with a real bounded XML structural-validation strategy or defer Phase 4D tabular XLSX support.
required_tests: |
  Outstanding before any future approval: structural well-formedness and exact-root tests for all consumed OOXML parts, including rootless, misrooted, multiple-root, malformed nesting, and trailing-root-content inputs, plus valid namespace-prefixed controls.
  Any newly authorized implementation must rerun npm ci, format:check, lint, typecheck, prisma:validate, fresh PostgreSQL prisma:migrate:deploy, focused tabular validation/security tests, npm test, test:integration, build, CI=true test:e2e, npm audit --omit=dev, git diff --check, and successful exact-head CI.
next_action: "STOP. Cursor must exit without changes. Retry limit is exhausted. Bao must decide whether to authorize a separately scoped human-designed OOXML structural-validation task or defer XLSX support."
```

## BLOCKED — retry limit exhausted

Cursor must not claim, implement, commit, or push further changes for this task. The third result still accepts malformed OOXML document structures because required XML roots and structural well-formedness are not validated before regex extraction. No fourth attempt is permitted.

Bao must choose one of these paths outside this loop:

1. Authorize a new, separately scoped task/branch using a real bounded XML structural-validation strategy for XLSX parts, with the outstanding tests above.
2. Defer XLSX support and redesign Phase 4D around CSV-only import until a safe XLSX parser strategy is approved.

Do not modify `develop` or `main`, open a PR, or continue automatically.


<!-- END:outreach-automation -->
