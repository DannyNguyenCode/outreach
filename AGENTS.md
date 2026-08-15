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
cursor_implementation_sha: 2d8bd1983c23b8b461d8a616cc8545a3e81fc373
last_reviewed_sha: null
status: READY_FOR_REVIEW
previous_task_status: MERGED
previous_pr_number: 12
previous_develop_merge_sha: 01eb8b88a9b0cafa5bc07d0bd78359f9bc19ecad
cursor_attempt_count: 1
consecutive_unchanged_checks: 0
last_cursor_activity_sha: 2d8bd1983c23b8b461d8a616cc8545a3e81fc373
stop_reason: null
unchanged_check_times: []
cursor_claimed_at: "2026-08-15T14:07:20Z"
cursor_completed_at: "2026-08-15T14:20:38Z"
cursor_report: |
  Attempt 1 of 3 completed at implementation SHA 2d8bd1983c23b8b461d8a616cc8545a3e81fc373 (claim c4ba8ed2aa90da60e7dd7a640cea066ed2254464). Objective: implement KNOW-004 source classification and runtime composition over existing confirmed Phase 4A–4C domains without consuming CSV/XLSX previews.
  Requirements/acceptance: exhaustive RUNTIME_SOURCE_REGISTRY and RUNTIME_SOURCE_ADAPTERS (live adapters only for CUSTOMER_CONFIRMED_KNOWLEDGE and STRUCTURED_OFFERING; future classes explicit null). composeRuntimeContext enforces org.knowledge.read, rechecks organization IDs, bounds query/limit, keeps organization evidence separate from prospect/call classes, returns UNKNOWN with no fabricated data, and surfaces a narrow deterministic base-price mismatch as CONFLICT without arbitration. Prompt-facing text is delimited as untrusted source data. Inspector at /app/orgs/[slug]/knowledge/sources is a read-only Server Component evidence preview. Audit package is IDs-only and is not persisted. retrieveActiveKnowledge now exposes source title/inputKind; member-visible DOCUMENT versions require CLEAN+COMPLETE processing.
  Files changed: lib/orgs/runtime-evidence.ts; lib/orgs/runtime-source-adapters.ts; lib/orgs/runtime-composition-logic.ts; lib/orgs/runtime-composition.ts; lib/orgs/knowledge-retrieval.ts; lib/orgs/knowledge-visibility.ts; lib/orgs/offering-confirmation.ts; app/app/orgs/[slug]/knowledge/sources/page.tsx; components/orgs/knowledge/knowledge-nav.tsx; docs/phase-4d-source-runtime-composition.md; README.md. Tests: lib/orgs/runtime-evidence.test.ts; lib/orgs/runtime-composition.test.ts; lib/orgs/knowledge-visibility.test.ts; tests/integration/runtime-composition.test.ts; e2e/knowledge.spec.ts. No migrations added or changed. No new npm dependencies. Tabular parser not imported. MR-4D-OOXML-001 left OPEN.
  Tests added/updated: exhaustive registry/authority/bounds/prompt-boundary/JSON-bounding unit tests; ordering and narrow price-conflict unit tests; integration coverage for manual/document provenance, offering children, draft/future/expired/archived/failed exclusion, MEMBER/inactive/unverified/forged/cross-tenant denial, invalid input, deterministic audit IDs, CONFLICT without arbitration, prompt-injection treated as data, UNKNOWN future classes, missing prospect/call context; inspector E2E after confirmed knowledge. Existing CSV/XLSX, Phase 4A–4C, and document retrieval regressions preserved.
  Commands and exact results on this implementation head:
  - npm ci: added 553 packages, audited 554, 0 vulnerabilities
  - npm run format:check: All matched files use Prettier code style
  - npm run lint: exit 0
  - npm run typecheck: next typegen + tsc --noEmit succeeded
  - npm run prisma:validate: schema valid
  - fresh DROP/CREATE outreach_ci + npm run prisma:migrate:deploy: 11 migrations applied through Phase 4C
  - focused runtime/visibility unit tests: 3 files, 11 passed
  - npm test: 28 files, 241 passed
  - focused tests/integration/runtime-composition.test.ts: 1 file, 10 passed
  - npm run test:integration: 41 files, 487 passed
  - npm run build: Next.js 16.3.0 compiled successfully; /app/orgs/[slug]/knowledge/sources present
  - CI=true npm run test:e2e: 16 passed (29.7s)
  - npm audit --omit=dev: found 0 vulnerabilities
  - git diff --check: clean
  - exact-head GitHub Actions run 31889420552 on 2d8bd1983c23b8b461d8a616cc8545a3e81fc373: success (https://github.com/DannyNguyenCode/outreach/actions/runs/31889420552)
  Authorization/tenant isolation: composition independently requires active membership and org.knowledge.read; adapters reuse existing retrieval services. Inactive, unverified, forged, and cross-tenant actors are denied with payload-free reasons. MEMBERs can compose current confirmed same-tenant evidence.
  Security/privacy: no credentials, tokens, storage paths, checksums, or customer bodies in audit packages. Inspector reads are not persisted. Instruction-like source text remains labelled data. Formulas/links/tabular parsers are unused. No writer/promotion path from caller/CRM/note data into reusable knowledge.
  Failure/recovery: invalid source class/query/limit and missing prospect/call context return invalid_input; auth failures stay payload-free; empty support is UNKNOWN; conflicts remain visible. No jobs or storage objects are created.
  Manual configuration still required: none for this slice.
  Assumptions: rPh/tabular/XLSX preview remain out of scope; future source classes stay null until their domains exist; inspector audit persistence waits for an approved call/audit contract.
  Remaining risks: conflict detection is exact/narrow, not semantic; worksheet/CSV import mapping still later; KNOW-005 retrieval ranking is not implemented.
  Deferred work: CSV/XLSX mapping/persistence/activation, prospects, CRM, calls, transcription, AI generation, embeddings, information-gap persistence, and Phase 5. No PR opened; ChatGPT owns the develop merge gate. Manual review flag MR-4D-OOXML-001 left OPEN.
review_findings: |
  Phase 4D tabular validation and its OOXML correction were squash-merged through PR #12 at develop SHA 01eb8b88a9b0cafa5bc07d0bd78359f9bc19ecad.
  The unmerged branch feature/phase-04d-source-runtime-composition contains one stale implementation commit based on d06ec79f0d5ee7297e934aed2f692f13f472cfcf and is now two develop commits behind. It has no Outreach automation block and is reference material only.
  This task is independently safe under MR-4D-OOXML-001 because it composes only existing confirmed Phase 4A–4C sources and must not consume, expose, map, persist, activate, or reparse CSV/XLSX previews.
required_tests: |
  Require focused runtime evidence/composition unit and integration tests; authorization and cross-tenant regressions; inactive/draft/future/expired/archived/unsafe-source exclusion; deterministic conflict and UNKNOWN behavior; prompt-boundary and safe-output tests; source-inspector accessibility/E2E; npm ci; format:check; lint; typecheck; prisma:validate; fresh PostgreSQL prisma:migrate:deploy; npm test; test:integration; build; CI=true test:e2e; npm audit --omit=dev; git diff --check; and successful exact-head GitHub Actions.
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
