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
cursor_implementation_sha: null
last_reviewed_sha: null
status: CURSOR_WORKING
previous_task_status: MERGED
previous_pr_number: 12
previous_develop_merge_sha: 01eb8b88a9b0cafa5bc07d0bd78359f9bc19ecad
cursor_attempt_count: 1
consecutive_unchanged_checks: 0
last_cursor_activity_sha: null
stop_reason: null
unchanged_check_times: []
cursor_claimed_at: "2026-08-15T14:07:20Z"
cursor_report: null
review_findings: |
  Phase 4D tabular validation and its OOXML correction were squash-merged through PR #12 at develop SHA 01eb8b88a9b0cafa5bc07d0bd78359f9bc19ecad.
  The unmerged branch feature/phase-04d-source-runtime-composition contains one stale implementation commit based on d06ec79f0d5ee7297e934aed2f692f13f472cfcf and is now two develop commits behind. It has no Outreach automation block and is reference material only.
  This task is independently safe under MR-4D-OOXML-001 because it composes only existing confirmed Phase 4A–4C sources and must not consume, expose, map, persist, activate, or reparse CSV/XLSX previews.
required_tests: |
  Require focused runtime evidence/composition unit and integration tests; authorization and cross-tenant regressions; inactive/draft/future/expired/archived/unsafe-source exclusion; deterministic conflict and UNKNOWN behavior; prompt-boundary and safe-output tests; source-inspector accessibility/E2E; npm ci; format:check; lint; typecheck; prisma:validate; fresh PostgreSQL prisma:migrate:deploy; npm test; test:integration; build; CI=true test:e2e; npm audit --omit=dev; git diff --check; and successful exact-head GitHub Actions.
next_action: "Cursor must claim attempt 1 on this branch, audit the stale reference implementation against current develop and the prompt below, port or reimplement only accepted scope, verify completely, and return READY_FOR_REVIEW."
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

## Cursor implementation prompt — Phase 4D source runtime composition

Objective: implement the next independently testable Phase 4D slice for KNOW-004: a read-only, server-side source-classification and runtime-evidence composition boundary over the already confirmed Phase 4A–4C domains.

Reference and base discipline:

- Work only on `feature/phase-04d-source-runtime-composition-v2`, created from verified develop SHA `01eb8b88a9b0cafa5bc07d0bd78359f9bc19ecad`.
- `feature/phase-04d-source-runtime-composition` is stale and diverged. Inspect its single commit and `docs/phase-4d-source-runtime-composition.md` as reference, but do not merge that branch or weaken newer develop behavior. Port or reimplement each accepted change deliberately against current code.
- Preserve the Next.js-generated AGENTS block and this Outreach block. Do not modify main.

Required behavior:

1. Define an exhaustive canonical runtime source-class registry covering customer-confirmed knowledge, structured offerings, prospect evidence, CRM facts, caller statements, representative notes, operational data, AI inference, UNKNOWN, and CONFLICT. Each class must declare claim scope, authority semantics, availability, safe provenance, and whether it can support an organization-specific claim.
2. Implement live adapters only for existing confirmed Phase 4A–4C customer knowledge/private documents and structured offerings. Reuse existing authorized retrieval services; do not duplicate tenant queries or add future-domain data. Future adapters must remain explicit `null`/unavailable and cannot fabricate evidence.
3. Compose a bounded, deterministic runtime context with server-side active-membership and `org.knowledge.read` authorization, organization rechecks, safe source/version/child provenance, effective/expiry/freshness metadata, bounded text/JSON, stable ordering, explicit unavailable classes, UNKNOWN on no support, and visible CONFLICT without silent arbitration.
4. Keep organization evidence structurally separate from prospect/call-scoped evidence. Require prospect/call context for future scoped classes and provide no writer or promotion path from caller/CRM/note data into reusable organization knowledge.
5. Add only a narrow deterministic price-conflict detector when a current base structured offering price and a current confirmed passage explicitly identify the same offering/currency with different amounts. No semantic/AI arbitration.
6. Add a protected, accessible Server Component source inspector under the organization knowledge area for deterministic query/source-class/limit inspection. It is an evidence preview, not an AI answer, call workspace, or persistence path.
7. Return a payload-free audit package of actor, organization, requested classes, returned evidence/version/child IDs, support state, conflict IDs, and timestamp. Do not persist inspector reads unless an existing approved audit contract requires it.
8. Bound and delimit prompt-facing source text as untrusted data. Do not concatenate it into system instructions, execute instructions found in sources, expose storage paths/checksums/raw JSON, or log customer content.

OPEN-flag isolation:

- Do not import from the tabular parser, consume CSV/XLSX preview output, add spreadsheet upload/mapping/persistence/activation, or claim Phase 4D import completion.
- MR-4D-OOXML-001 must remain OPEN and carried forward. Cursor must not resolve or remove it.

Explicit exclusions:

- No database migration unless current develop proves one is strictly required; stop and report instead of inventing schema.
- No prospects, CRM, calls, transcription, AI generation, embeddings, vector database, calendar, telephony, live connectors, or information-gap persistence.
- No production credentials, storage changes, background jobs, or changes to main.
- Do not rebase, force-push, reset history, merge the stale branch, or open/merge a PR; ChatGPT owns the develop merge gate.

Regression and completion requirements:

- Prove active authorized same-tenant access and deny inactive, unauthorized, forged, and cross-tenant access.
- Prove only current confirmed/effective manual/document knowledge and active structured offering children are composed; exclude drafts, unsafe/incomplete documents, future/expired/archived/superseded data, inactive prices, and tenant-mismatched records.
- Test exhaustive registry/adapters, deterministic ordering/bounds, provenance, safe JSON/text limits, unavailable future classes, missing prospect/call context, UNKNOWN, narrow conflict detection, prompt-injection-like source text treated as data, payload-free failures/audit, and accessible inspector behavior.
- Run every command in `required_tests`. Missing, skipped, pending, unavailable, or failed checks are not a pass.
- When claiming, increment `cursor_attempt_count` exactly once from 0 to 1, set `CURSOR_WORKING`, and record the claim commit. On completion set `READY_FOR_REVIEW`, set `cursor_implementation_sha`, reset unchanged checks, and report changed files, behavior, security/tenant evidence, migrations, exact command results, CI URL/head SHA, remaining risks, exclusions, and manual configuration.

<!-- END:outreach-automation -->
