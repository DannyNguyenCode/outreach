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
cursor_implementation_sha: eff1730efc3f9364abe6e9e6ce347737ae3947e7
last_reviewed_sha: b5b213b799e769439f38926941fe1d9d6c938347
status: CURSOR_WORKING
previous_task_status: MERGED
previous_pr_number: 12
previous_develop_merge_sha: 01eb8b88a9b0cafa5bc07d0bd78359f9bc19ecad
cursor_attempt_count: 3
consecutive_unchanged_checks: 0
last_cursor_activity_sha: eff1730efc3f9364abe6e9e6ce347737ae3947e7
stop_reason: null
unchanged_check_times: []
cursor_claimed_at: "2026-08-15T16:09:00Z"
cursor_completed_at: "2026-08-15T15:17:40Z"
cursor_report: |
  Attempt 2 implementation eff1730efc3f9364abe6e9e6ce347737ae3947e7 closed the three prior findings: canonical offering-name boundaries, currency-specific marker sets, conflict-aware pair-complete selection, and JSON-encoded single-line prompt content.
  Exact implementation GitHub Actions run 31892074018 passed migration validation, format, lint, typecheck, unit/component, integration, production build, and E2E. Cursor reported focused 17/17, unit 247/247, integration 488/488, E2E 16/16, npm audit 0 vulnerabilities, and clean diff.
  No migrations, dependencies, tabular/XLSX consumption, credentials, writers, jobs, or storage changes.
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
next_action: "Cursor may claim the final allowed attempt 3 on this same branch, implement only the currency-marker boundary correction and regressions, then return READY_FOR_REVIEW. A fourth attempt is prohibited."
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
