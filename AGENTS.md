<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:outreach-automation -->

# Outreach Automation Handoff

```yaml
task_id: phase-04d-source-runtime-composition-001
phase: "Phase 4D — Source classification and runtime composition"
active_branch: feature/phase-04d-source-runtime-composition-v2
base_develop_sha: 01eb8b88a9b0cafa5bc07d0bd78359f9bc19ecad
cursor_implementation_sha: 404ea8deff482d27416cbd05dfe62e22a5480909
last_reviewed_sha: b5b213b799e769439f38926941fe1d9d6c938347
status: READY_FOR_REVIEW
previous_task_status: MERGED
previous_pr_number: 12
previous_develop_merge_sha: 01eb8b88a9b0cafa5bc07d0bd78359f9bc19ecad
cursor_attempt_count: 3
consecutive_unchanged_checks: 0
last_cursor_activity_sha: 404ea8deff482d27416cbd05dfe62e22a5480909
stop_reason: null
unchanged_check_times: []
cursor_claimed_at: "2026-08-15T16:09:00Z"
cursor_completed_at: "2026-08-15T16:16:33Z"
cursor_report: |
  Attempt 3 of 3 completed at implementation SHA 404ea8deff482d27416cbd05dfe62e22a5480909 (claim 7eb2abfb72a0003e185e6a73332ae87fca6f1e07). Objective: close the remaining false-positive path so alphabetic-prefix national currency markers cannot match inside a larger Unicode letter/number/underscore token.
  Requirements/acceptance: markerPattern now adds a left token boundary when a marker begins with a Unicode letter/number/underscore and a right token boundary when it ends with one. C$, CA$, US$, A$, AU$, and NZ$ therefore cannot match inside identifiers such as ABC$49 or BUS$49, while C$49 and amount-before-marker forms such as 49 C$ still prove their exact currencies. ISO codes remain case-insensitive and bounded on both sides. Bare dollar stays ambiguous. Reviewed marker sets are unchanged. Conflict-aware selection, prompt encoding, adapters, authorization, inspector UI, migrations, dependencies, and tabular imports were not altered.
  Files changed: lib/orgs/runtime-composition-logic.ts; lib/orgs/runtime-composition.test.ts; docs/phase-4d-source-runtime-composition.md (explicit leading/trailing character-class boundaries). No migrations added or changed. No new npm dependencies.
  Tests added/updated: table-driven negatives for CAD ABC$49/ABCA$49/ABCAU$49, USD BUS$49, AUD ABCAU$49/ABCA$49, underscore-prefixed C$49, bare dollar, and foreign euro vs USD; positives for standalone C$49, CA$49, US$49, A$49, AU$49, NZ$49, amount-before-marker forms, parenthesized C$49, and adjacent 49 euro. The six embedded-marker negatives failed on attempt-2 parser behavior (false STRUCTURED_PRICE_MISMATCH) and passed after the fix (31/31). Existing offering-name, ISO, conflict-safe selection, and Phase 4A-4D regressions preserved.
  Commands and exact results on this implementation head:
  - npm ci: added 553 packages, audited 554, 0 vulnerabilities
  - npm run format:check: All matched files use Prettier code style
  - npm run lint: exit 0
  - npm run typecheck: next typegen + tsc --noEmit succeeded
  - npm run prisma:validate: schema valid
  - fresh DROP/CREATE outreach_ci + npm run prisma:migrate:deploy: 11 migrations applied through Phase 4C
  - focused lib/orgs/runtime-composition.test.ts: 31 passed after the fix; 6 embedded negatives failed before the fix
  - focused tests/integration/runtime-composition.test.ts: 11 passed
  - npm test: 28 files, 270 passed
  - npm run test:integration: 41 files, 488 passed
  - npm run build: Next.js 16.3.0 compiled successfully
  - CI=true npm run test:e2e: 16 passed (30.5s)
  - npm audit --omit=dev: found 0 vulnerabilities
  - git diff --check: clean
  - exact-head GitHub Actions run 31894834873 on 404ea8deff482d27416cbd05dfe62e22a5480909: success (format, lint, typecheck, unit/component, integration, production build, E2E)
  Authorization/tenant isolation: no permission, tenant-scope, upload-route, or storage changes. Existing runtime composition integration authorization/tenant/source-filtering/provenance/UNKNOWN/audit coverage passed unchanged.
  Security/privacy: no credentials, tokens, or customer data exposed. Inspector safeText is unchanged. promptSafeText encoding is unchanged. Identifiers that merely contain a national marker suffix cannot create a price conflict.
  Failure/recovery: unmatched or unproven currency still yields no conflict rather than a false STRUCTURED_PRICE_MISMATCH. No jobs or storage objects are created.
  Manual configuration still required: none for this defect.
  Assumptions: a trailing dollar on C$/CA$/US$/A$/AU$/NZ$ remains a symbol side that may sit directly against the amount; a leading letter/number/underscore still requires a left token boundary, so 49C$ without a separator is not treated as a proven marker.
  Remaining risks: the detector remains deliberately non-semantic and still ignores unreviewed markers. MR-4D-OOXML-001 remains OPEN pending Bao's explicit removal instruction.
  Deferred work: future source classes, embeddings, vector retrieval, generated answers, and tabular/XLSX consumption remain later Phase 4D tasks. Phase 5 is untouched. No PR opened; ChatGPT owns the develop merge gate. This is the final Cursor attempt.
review_findings: |
  BLOCKING — National currency abbreviations with a trailing dollar sign are not token-bounded. lib/orgs/runtime-composition-logic.ts markerPattern() applies Unicode token boundaries only to three-letter ISO codes; C$, CA$, US$, A$, AU$, and NZ$ are raw alternatives. Therefore a confirmed passage such as "Premium plan uses SKU ABC$49" can match the C$ marker inside ABC$ and falsely conflict with a CAD 59 structured price; "BUS$49" can similarly match US$ for USD. This violates the task's exact/narrow and proven-currency contract.
  PASS — The prior short-name substring, foreign/ambiguous currency, truncation-hidden conflict, pair completeness, limit-below-two, and forged prompt-boundary defects are fixed with direct regressions.
  PASS — Implementation SHA eff1730efc3f9364abe6e9e6ce347737ae3947e7 is an ancestor of review handoff b5b213b799e769439f38926941fe1d9d6c938347; later commits modify AGENTS.md only. The branch is 0 commits behind develop.
  PASS — Authorization, tenant isolation, active/current source filtering, provenance, UNKNOWN behavior, audit privacy, inspector behavior, and MR-4D-OOXML-001 isolation remain intact.
  WORKFLOW — The previously duplicated/corrupted corrective-prompt text in AGENTS.md was repaired in ChatGPT's review handoff without changing application code.
required_tests: |
  Add a table-driven regression proving alphabetic-prefix national currency markers cannot match inside a larger Unicode letter/number/underscore token: at minimum CAD with ABC$49/ABCA$49/ABCAU$49 and USD with BUS$49. Prove standalone C$49, CA$49, US$49, A$49, AU$49, and NZ$49 still work for their exact currencies, including amount-before-marker forms where supported. Keep bare dollar ambiguous and foreign markers non-matching.
  Preserve all attempt-2 offering-name, exact ISO currency, true/false conflict, conflict-safe selection, prompt-boundary, authorization, tenant, source-filtering, provenance, UNKNOWN, audit, accessibility, and Phase 4A–4D regressions.
  Run focused runtime unit/integration tests; npm ci; format:check; lint; typecheck; prisma:validate; fresh PostgreSQL prisma:migrate:deploy; npm test; test:integration; build; CI=true test:e2e; npm audit --omit=dev; git diff --check; and successful exact-head GitHub Actions.
next_action: "ChatGPT must review the complete branch against the current develop branch."
manual_review_flags:
  - id: MR-4D-OOXML-001
    status: OPEN
    title: Phase 4D XLSX OOXML structural validation
    phase: Phase 4D
    issue: The original XLSX validation branch allowed structurally invalid OOXML fragments to produce previews. The corrective implementation is merged, but Bao has not yet explicitly authorized removal of this persistent flag.
    affected_branch: feature/phase-04d-tabular-validation-foundation
    reviewed_sha: aa8c0aae242f63c150ec8b92d7d623b08300df3c
    blocked_capability: XLSX tabular import mapping, persistence, activation, or any production path consuming its preview until Bao authorizes flag removal
    safe_continuation_scope: Source classification/runtime composition using only existing confirmed Phase 4A manual/document knowledge and Phase 4C structured offerings; CSV-only work and later work that does not consume XLSX preview
    required_resolution: Bao must explicitly request removal after the independently verified corrective PR #12 merge; ChatGPT must then mark the flag RESOLVED with evidence rather than deleting its history.
    created_at: "2026-08-15"
    resolution_evidence: "Corrective implementation f49e3a54847a5317cde2fc1187b301da78636b0e; exact final-head CI run 31887553240; PR #12 squash-merged to develop at 01eb8b88a9b0cafa5bc07d0bd78359f9bc19ecad. Awaiting Bao explicit removal instruction."
```

## Cursor corrective prompt — final attempt 3

Objective: close the remaining false-positive path in the deterministic currency matcher without broadening KNOW-004 conflict semantics.

Evidence:

- `lib/orgs/runtime-composition-logic.ts` lines 172–199 define alphabetic currency abbreviations such as `C$`, `CA$`, `US$`, `A$`, `AU$`, and `NZ$`.
- `markerPattern()` adds token boundaries only when the entire marker is a three-letter ISO code. Alphabetic-prefix symbol markers are escaped but otherwise unbounded, so suffixes inside larger tokens can be consumed as currency evidence.
- Existing attempt-2 tests cover foreign symbols/codes and bare dollar ambiguity, but do not cover national markers embedded in identifiers or words.

Required fix:

1. Generate marker patterns based on the marker's leading and trailing character classes. If a marker begins with a Unicode letter/number/underscore, require a left token boundary; if it ends with one, require a right token boundary. Preserve direct adjacency between a trailing symbol and its amount, such as `C$49`, and between an amount and a leading marker where supported.
2. Ensure a shorter marker cannot match as a suffix inside a longer token or malformed national marker. Sorting alternatives by length is not sufficient without boundaries.
3. Keep ISO codes case-insensitive, bare `$` ambiguous/unrecognized, reviewed currency sets unchanged, and all matching deterministic/non-semantic.
4. Update the Phase 4D documentation if its exact marker-boundary behavior is not already explicit.

Regression tests and acceptance:

- Add the table-driven negative and positive cases listed in `required_tests`. The embedded-marker negatives must fail against attempt 2 before the fix and pass afterward.
- Do not alter conflict-aware selection, prompt encoding, adapters, authorization, inspector UI, migrations, dependencies, tabular imports, or future source classes.
- Run and report every command in `required_tests`; missing/skipped/pending evidence is not a pass.
- When claiming, increment `cursor_attempt_count` exactly once from 2 to 3 and set `CURSOR_WORKING`. On completion set `READY_FOR_REVIEW`, update `cursor_implementation_sha`, reset unchanged checks, and report the exact implementation SHA, changed files, before/after regression proof, full tests/CI, security/tenant evidence, remaining risks, and exclusions.
- This is attempt 3 of 3. Do not claim or perform a fourth attempt.

<!-- END:outreach-automation -->
