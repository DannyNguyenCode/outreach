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
cursor_implementation_sha: ca0c1deef1fb2996be6002c08b4aed8b1664498d
last_reviewed_sha: null
status: CHATGPT_REVIEWING_FOR_DEVELOP
previous_task_status: BLOCKED
previous_pr_number: 10
previous_develop_merge_sha: d446ca52c1c8397d8b24bf7c2dc009b14800808d
cursor_attempt_count: 1
consecutive_unchanged_checks: 0
last_cursor_activity_sha: ca0c1deef1fb2996be6002c08b4aed8b1664498d
stop_reason: null
unchanged_check_times: []
cursor_report: |
  Bao authorized a separate corrective branch from the blocked Phase 4D tabular-validation branch. Cursor pushed ca0c1deef1fb2996be6002c08b4aed8b1664498d and opened PR #11.
  Reported objective: add bounded in-repository XML structural validation before XLSX extraction so required OOXML parts are one well-formed document with the expected root, while preserving namespace-prefixed valid inputs and existing tabular protections.
  Reported verification in the PR: npm ci; formatting, lint, and typecheck; npm test with 26 files and 161 passing tests. Full integration, migration, build, E2E, audit, exact-head CI, authorization, privacy, and regression gates remain for ChatGPT review.
review_findings: |
  ChatGPT claimed the develop merge gate. Cursor must not modify or push while this status is active.
  Review the complete corrective branch against develop, including inherited Phase 4D tabular work, structural XML implementation, regression tests, documentation, dependency changes, PR metadata, and exact-head CI.
required_tests: |
  Require npm ci, focused tabular structural/security tests, format:check, lint, typecheck, prisma:validate, fresh PostgreSQL prisma:migrate:deploy, npm test, test:integration, build, CI=true test:e2e, npm audit --omit=dev, git diff --check, and successful exact-head GitHub Actions.
next_action: "ChatGPT must complete the full branch review and either return findings on this same branch or merge PR #11 into develop after every gate passes."
manual_review_flags:
  - id: MR-4D-OOXML-001
    status: OPEN
    title: Phase 4D XLSX OOXML structural validation
    phase: Phase 4D
    issue: Required XLSX OOXML parts were not proven structurally well-formed with the exact expected root and namespace before extraction.
    affected_branch: feature/phase-04d-tabular-validation-foundation
    reviewed_sha: aa8c0aae242f63c150ec8b92d7d623b08300df3c
    blocked_capability: XLSX import validation and any mapping, persistence, activation, or production path consuming its preview
    safe_continuation_scope: CSV-only and later work that does not consume, expose, or depend on XLSX import
    required_resolution: Verify this separate corrective branch, complete regression coverage and exact-head CI, merge safely, then await Bao's explicit instruction before removing the flag.
    created_at: "2026-08-15"
    resolution_evidence: null
```

## ChatGPT review in progress

Cursor must not modify code, update this file, push commits, merge, or begin another phase while `status: CHATGPT_REVIEWING_FOR_DEVELOP`.

<!-- END:outreach-automation -->
