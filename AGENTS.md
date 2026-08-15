<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:outreach-automation -->

# Outreach Automation Handoff

```yaml
task_id: phase-04d-ooxml-structural-validation-001
phase: "Phase 4D — XLSX OOXML structural validation corrective task"
active_branch: feature/phase-04d-ooxml-structural-validation
base_develop_sha: d446ca52c1c8397d8b24bf7c2dc009b14800808d
cursor_implementation_sha: f49e3a54847a5317cde2fc1187b301da78636b0e
last_reviewed_sha: 7ce15baa5c55cfa772dee33f2a5405828af9c2ed
status: APPROVED_TO_MERGE
previous_task_status: BLOCKED
previous_pr_number: 10
previous_develop_merge_sha: d446ca52c1c8397d8b24bf7c2dc009b14800808d
cursor_attempt_count: 2
consecutive_unchanged_checks: 0
last_cursor_activity_sha: f49e3a54847a5317cde2fc1187b301da78636b0e
stop_reason: null
unchanged_check_times: []
cursor_claimed_at: "2026-08-15T13:09:24Z"
cursor_completed_at: "2026-08-15T13:25:12Z"
cursor_report: |
  Attempt 2 of 3 completed at implementation SHA f49e3a54847a5317cde2fc1187b301da78636b0e (claim 68dff449a15ea12bd379b05bc9ef2a1317c0bbb9). Objective: close remaining OOXML fail-closed gaps so the 2,000 ms parse bound cannot be bypassed by few-event documents or declaration pre-scan, and so shared-string/inline-string text is consumed only from legal parent paths.
  Requirements/acceptance: parseOoxmlDocument now enforces the shared tabular deadline before and after declaration pre-scan, periodically every 4,096 characters during comment/CDATA/PI/tag scans, every 256 SAX events, and after parser completion. Timeout errors remain code "timeout" with no XML or saxes causes. Shared-string text is consumed only from si/t and si/r/t; inline-string text only from c/is/t and c/is/r/t. Phonetic rPh text is ignored. Same-namespace t under any other parent inside those consumed structures fails as malformed. Valid direct, rich-text, prefixed, CDATA, comment, and PI workbooks still parse.
  Files changed: lib/orgs/tabular-xml.ts; lib/orgs/tabular-xlsx.ts; lib/orgs/tabular-xlsx-structure.test.ts; lib/orgs/tabular-validation.test.ts (15s timeout on the existing million-character aggregate fixture); docs/phase-4d-tabular-import-hardening.md (deadline polling and legal t paths). No migrations added or changed. No new npm dependencies.
  Tests added/updated: deadline already expired at XML parser entry; few-event valid document after deadline crossing; large comment pre-scan token; large text token with few SAX events; sharedStrings t under an invalid wrapper inside si; worksheet t under an invalid is wrapper and t directly under c; positive direct/rich-text/prefixed shared-string and inline-string cases with rPh ignored. Existing root/namespace/DTD/entity/CDATA/PI, CSV, Phase 4B document, and Phase 4C offering regressions preserved. The six new negative cases failed on attempt-1 parser behavior (accepted instead of timeout/malformed) and passed after the fix.
  Commands and exact results on this implementation head:
  - npm ci: added 553 packages, audited 554, 0 vulnerabilities
  - npm run format:check: All matched files use Prettier code style
  - npm run lint: exit 0
  - npm run typecheck: next typegen + tsc --noEmit succeeded
  - npm run prisma:validate: schema valid
  - fresh DROP/CREATE outreach_ci + npm run prisma:migrate:deploy: 11 migrations applied through Phase 4C
  - focused lib/orgs/tabular-xlsx-structure.test.ts lib/orgs/tabular-validation.test.ts lib/orgs/tabular-security.test.ts: 3 files, 100 passed (6 new negatives failed before the fix)
  - npm test: 26 files, 232 passed
  - npm run test:integration: 40 files, 477 passed
  - npm run build: Next.js 16.3.0 compiled successfully
  - CI=true npm run test:e2e: 16 passed (30.6s)
  - npm audit --omit=dev: found 0 vulnerabilities
  - git diff --check: clean
  - exact-head GitHub Actions run 31886878705 on f49e3a54847a5317cde2fc1187b301da78636b0e: success (format, lint, typecheck, unit/component, integration, production build, E2E)
  Authorization/tenant isolation: no permission, tenant-scope, upload-route, or storage changes. Existing Phase 4A–4C integration and E2E suites passed unchanged.
  Security/privacy: no credentials, tokens, or customer data exposed. Timeout and malformed errors stay payload-free. Macros/encryption/polyglots/zip bombs/DTD/entities still fail closed. Incorrectly nested t text cannot create preview values. Formulas and links remain inert and are not fetched.
  Failure/recovery: expired XML work returns timeout; illegal t nesting returns malformed. No jobs or storage objects are created.
  Manual configuration still required: none for this defect.
  Assumptions: rPh remains ignorable phonetic text rather than a malformed wrapper; SAX deadline polls remain every 256 events because entry/pre-scan/final checks close the few-event and large-token gaps.
  Remaining risks: worksheet markup after non-element stripping is still tag-scanned rather than a full OOXML DOM; later mapping/persistence must consume this preview rather than re-parsing with a second library. PR #11 still points at cursor/outreach-automation-process-9003; ChatGPT owns replacing that PR from this named branch.
  Deferred work: upload UI/routes, mapping templates, import records, jobs, persistence, offering/knowledge activation, confirmation, retrieval, and connectors remain later Phase 4D tasks. Phase 5 is untouched. No PR opened; ChatGPT owns the develop merge gate. Manual review flag MR-4D-OOXML-001 left OPEN.
review_findings: |
  PASS — Attempt 2 closes both blocking defects. Deadline checks now run at XML entry, across declaration/tag scanning, after pre-scan, during SAX events, and after parser completion; expired/few-event/large-token regressions return the safe timeout code.
  PASS — Shared-string and inline-string text is consumed only from the legal si/t, si/r/t, c/is/t, and c/is/r/t paths, with invalid wrapper/direct-cell regressions failing malformed and valid direct/rich/prefixed/rPh cases preserved.
  PASS — The implementation SHA f49e3a54847a5317cde2fc1187b301da78636b0e is an ancestor of review handoff 7ce15baa5c55cfa772dee33f2a5405828af9c2ed; both later commits modify AGENTS.md only. The branch is 0 commits behind develop d446ca52c1c8397d8b24bf7c2dc009b14800808d.
  PASS — GitHub Actions run 31886878705 succeeded on the exact implementation SHA with migration validation, format, lint, typecheck, unit/component, integration, production build, and E2E. Cursor also reported focused 100/100, unit 232/232, integration 477/477, E2E 16/16, npm audit 0 vulnerabilities, and clean diff.
  WORKFLOW — PR #11 is superseded because it points to cursor/outreach-automation-process-9003 at cf45e228edca651ac64b2f064572c0d80ac45d94. ChatGPT will close it and open the merge PR from the authoritative named branch.
required_tests: |
  Add deterministic regression tests that fail on attempt 1 and pass after the fix: (1) deadline already expired at XML parser entry; (2) deadline crossed during a valid document with fewer than 256 SAX events; (3) bounded declaration pre-scan/final enforcement for a large or simulated long-running token; (4) sharedStrings <t> under an invalid wrapper inside <si>; (5) worksheet <t> outside legal <is>/<r> inline-string structure. Prove valid direct and rich-text shared strings and inline strings still parse, and preserve all root/namespace/DTD/entity/CDATA/PI regressions.
  Run npm ci; focused tabular structural/security tests; npm run format:check; npm run lint; npm run typecheck; npm run prisma:validate; fresh PostgreSQL npm run prisma:migrate:deploy; npm test; npm run test:integration; npm run build; CI=true npm run test:e2e; npm audit --omit=dev; git diff --check; and obtain successful exact-head GitHub Actions.
next_action: "ChatGPT must close superseded PR #11, open the authoritative PR to develop, require exact final-head CI and no unresolved threads, then squash-merge with the expected-head guard."
manual_review_flags:
  - id: MR-4D-OOXML-001
    status: OPEN
    title: Phase 4D XLSX OOXML structural validation
    phase: Phase 4D
    issue: Required XLSX OOXML parts were not proven structurally well-formed with the exact expected root and namespace before extraction; attempt 1 still has boundedness and parent-scoped text extraction gaps.
    affected_branch: feature/phase-04d-tabular-validation-foundation
    reviewed_sha: aa8c0aae242f63c150ec8b92d7d623b08300df3c
    blocked_capability: XLSX import validation and any mapping, persistence, activation, or production path consuming its preview
    safe_continuation_scope: CSV-only and later work that does not consume, expose, or depend on XLSX import
    required_resolution: Verify this separate corrective branch, complete regression coverage and exact-head CI, merge safely, then await Bao's explicit instruction before removing the flag.
    created_at: "2026-08-15"
    resolution_evidence: null
```

## Cursor corrective prompt — attempt 2

Objective: close the two remaining fail-closed OOXML validation gaps without broadening Phase 4D task 1.

Evidence:

- `lib/orgs/tabular-xml.ts`: declaration pre-scan at lines 65 and 195–255 has no deadline; SAX deadline checks occur only every 256 events at lines 80–85; lines 148–161 do not enforce the deadline at parser entry or completion.
- `lib/orgs/tabular-xlsx.ts`: shared strings accept any `<t>` descendant while an `<si>` is active at lines 380–415; worksheets accept any `<t>` descendant while a `<c>` is active at lines 513–529.
- `docs/phase-4d-tabular-import-hardening.md` promises a 2,000 ms parse/validation limit, fail-closed structural locations, and no preview evidence from expected elements under an incorrect parent.

Required changes:

1. Enforce the shared tabular deadline before and after the XML pre-scan and SAX parse, and periodically inside the declaration scan/tag scan so long inputs cannot bypass checks. Keep safe `timeout` errors and do not expose XML or library causes.
2. Consume shared-string text only from legal `si/t` and `si/r/t` structures, excluding `rPh`; consume inline-string text only from legal `c/is/t` and `c/is/r/t` structures, excluding `rPh`. Same-namespace value-bearing `<t>` elements in other locations within the consumed structure must fail closed as `malformed`, not be silently normalized into preview data.
3. Preserve namespace-aware parsing, default and prefixed valid OOXML, rich text, CDATA character data, comments/PIs, frozen predefined entities, depth/ZIP/size limits, safe errors, and existing CSV/Phase 4B/Phase 4C behavior.

Explicit exclusions:

- Do not add mapping, persistence, upload UI/routes, jobs, activation, Prisma migrations, storage, or production credentials.
- Do not add another XLSX/XML/CSV library or evaluate formulas/fetch links.
- Do not move implementation to `cursor/outreach-automation-process-9003`, alter main, rebase, force-push, or merge.

Regression tests and acceptance:

- Add the deterministic deadline and invalid-parent tests listed in `required_tests`; prove they fail against attempt 1 before the fix and pass afterward.
- Add positive direct/rich-text shared-string and inline-string cases so the fix does not reject valid namespace-prefixed workbooks.
- Run and report every command in `required_tests`. Missing, skipped, pending, or failed required checks are not a pass.
- When claiming this task, increment `cursor_attempt_count` exactly once from 1 to 2 and set `CURSOR_WORKING`. On completion, set `READY_FOR_REVIEW`, set `cursor_implementation_sha` to the implementation commit, summarize changed files and behavior, and report exact test/CI evidence. Do not push while a ChatGPT-owned status is active.

## Approved for guarded develop merge

Cursor must not modify code, update this file, push commits, merge, or begin another task while `status: APPROVED_TO_MERGE`.

<!-- END:outreach-automation -->
