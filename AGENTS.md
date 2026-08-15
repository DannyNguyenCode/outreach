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
last_reviewed_sha: 6c668e44fae2da694e00478f15e431c9d96b2642
status: CURSOR_WORKING
previous_task_status: BLOCKED
previous_pr_number: 10
previous_develop_merge_sha: d446ca52c1c8397d8b24bf7c2dc009b14800808d
cursor_attempt_count: 2
consecutive_unchanged_checks: 0
last_cursor_activity_sha: ca0c1deef1fb2996be6002c08b4aed8b1664498d
stop_reason: null
unchanged_check_times: []
cursor_claimed_at: "2026-08-15T13:09:24Z"
cursor_report: |
  Cursor attempt 1 implementation is ca0c1deef1fb2996be6002c08b4aed8b1664498d.
  ChatGPT's review handoff commit is 6c668e44fae2da694e00478f15e431c9d96b2642.
  Exact-head GitHub Actions run 31884836260 passed migration validation, format, lint, typecheck, unit/component tests, integration tests, production build, and E2E smoke tests.
review_findings: |
  BLOCKING 1 — The documented 2,000 ms XML parse/validation bound is not enforced for documents with fewer than 256 parser events or for time spent in the declaration pre-scan. lib/orgs/tabular-xml.ts calls rejectProhibitedXmlDeclarations without deadline checks, checks the SAX parser only every 256 events, and performs no mandatory final deadline check. A minimal or few-event document can start or finish after the deadline and still be accepted; a large single text/attribute token has the same gap.
  BLOCKING 2 — Parent-scoped extraction is incomplete. lib/orgs/tabular-xlsx.ts accepts every SpreadsheetML <t> descendant of the current <si> or <c> except rPh, even when the text is nested under an invalid wrapper rather than a legal shared-string or inline-string path. Such incorrectly nested markup can still create normalized preview values, contrary to the corrective task and phase contract.
  WORKFLOW — PR #11 targets develop but its head is cursor/outreach-automation-process-9003 at cf45e228edca651ac64b2f064572c0d80ac45d94, not this authoritative feature branch. ChatGPT will replace or supersede that PR after the named branch passes; Cursor must not move work to the PR branch.
required_tests: |
  Add deterministic regression tests that fail on attempt 1 and pass after the fix: (1) deadline already expired at XML parser entry; (2) deadline crossed during a valid document with fewer than 256 SAX events; (3) bounded declaration pre-scan/final enforcement for a large or simulated long-running token; (4) sharedStrings <t> under an invalid wrapper inside <si>; (5) worksheet <t> outside legal <is>/<r> inline-string structure. Prove valid direct and rich-text shared strings and inline strings still parse, and preserve all root/namespace/DTD/entity/CDATA/PI regressions.
  Run npm ci; focused tabular structural/security tests; npm run format:check; npm run lint; npm run typecheck; npm run prisma:validate; fresh PostgreSQL npm run prisma:migrate:deploy; npm test; npm run test:integration; npm run build; CI=true npm run test:e2e; npm audit --omit=dev; git diff --check; and obtain successful exact-head GitHub Actions.
next_action: "Cursor must claim attempt 2 on this same named branch, implement only the two blocking fixes and regressions below, then report READY_FOR_REVIEW with the exact implementation SHA and complete command results."
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

<!-- END:outreach-automation -->
