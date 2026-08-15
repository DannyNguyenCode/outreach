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
last_reviewed_sha: e60d5e99c58e7fc21700b4f2c50a9dbff2966e88
status: CHATGPT_REVIEWING_FOR_DEVELOP
previous_task_status: MERGED
previous_pr_number: 12
previous_develop_merge_sha: 01eb8b88a9b0cafa5bc07d0bd78359f9bc19ecad
cursor_attempt_count: 2
consecutive_unchanged_checks: 0
last_cursor_activity_sha: eff1730efc3f9364abe6e9e6ce347737ae3947e7
stop_reason: null
unchanged_check_times: []
cursor_claimed_at: "2026-08-15T15:06:40Z"
cursor_completed_at: "2026-08-15T15:17:40Z"
cursor_report: |
  Attempt 2 implementation is eff1730efc3f9364abe6e9e6ce347737ae3947e7; claim commit daf02a30f7cb983e245bdd8acbf073b8ebdda320.
  Cursor reports canonical offering-name token/phrase matching; currency-specific markers with ambiguous bare dollar excluded; conflict detection before final truncation with deterministic pair-complete selection; and JSON-encoded single-line prompt source content between reserved markers while UI safeText remains unchanged.
  Changed runtime composition logic, evidence/adapters, focused unit/integration tests, and Phase 4D documentation. No migrations, dependencies, tabular consumption, credentials, writers, jobs, or storage changes.
  Reported verification: focused runtime/visibility 17 passed; npm test 247 passed; focused integration 11 passed; all integration 488 passed; E2E 16 passed; format, lint, typecheck, Prisma validation, fresh migrate, build, npm audit 0 vulnerabilities, and git diff --check passed.
  Exact implementation GitHub Actions run 31892074018 is reported successful.
review_findings: |
  ChatGPT claimed the develop merge gate. Cursor must not modify or push while this status is active.
  Review attempt 2 against all prior blockers and the complete branch diff: exact offering/currency matching, conflict-safe bounded selection, unforgeable prompt-source representation, authorization, tenant isolation, source filtering, provenance, UNKNOWN/CONFLICT semantics, inspector accessibility, docs, XLSX isolation, and exact-head CI.
  Workflow validation must also confirm implementation ancestry, AGENTS-only completion/review commits, current develop base, no secrets/migrations, and no unresolved PR threads.
required_tests: |
  Require focused runtime unit/integration/E2E tests; regressions for short-name false matches, foreign/ambiguous currency markers, true same-currency conflicts, conflict visibility under truncation, pair-complete deterministic limits, limit below two, forged prompt markers, and unchanged UI safeText.
  Preserve registry exhaustion, authorization/cross-tenant denial, inactive/draft/future/expired/archived/unsafe exclusion, UNKNOWN, audit privacy, accessibility, and all Phase 4A–4D regressions.
  Require npm ci; format:check; lint; typecheck; prisma:validate; fresh PostgreSQL prisma:migrate:deploy; npm test; test:integration; build; CI=true test:e2e; npm audit --omit=dev; git diff --check; and successful exact-head GitHub Actions.
next_action: "ChatGPT must complete the full branch review and either return focused attempt-3 findings or open and execute the guarded develop merge."
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

## ChatGPT review in progress

Cursor must not modify code, update this file, push commits, merge, or begin another task while `status: CHATGPT_REVIEWING_FOR_DEVELOP`.

<!-- END:outreach-automation -->
