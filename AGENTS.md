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
status: READY_FOR_REVIEW
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
  Attempt 2 of 3 completed at implementation SHA eff1730efc3f9364abe6e9e6ce347737ae3947e7 (claim daf02a30f7cb983e245bdd8acbf073b8ebdda320). Objective: close the three attempt-1 KNOW-004 defects so price-conflict detection is genuinely narrow, conflict-aware truncation cannot hide a pair, and prompt-facing source boundaries are not forgeable.
  Requirements/acceptance: conflict evaluation uses the canonical offeringName from the price structured value with token/phrase boundaries, so a short name such as Pro does not match inside improve. Only the structured ISO code and reviewed compatible markers are relevant (CAD/C$/CA$, USD/US$, EUR/euro-sign, GBP/pound-sign); a bare dollar sign is never a marker because it cannot prove currency. Conflicts are detected on the bounded candidate pool before final truncation. selectConflictAwareEvidence keeps both cited items whenever CONFLICT is emitted, never exceeds limit, and does not emit CONFLICT when limit is below 2. promptSafeText JSON-encodes safeText on a single line between reserved header/footer markers; inspector safeText still preserves original bounded customer content. Phase document updated to match. Registry, adapters, authorization, UNKNOWN, audit privacy, and inspector behavior preserved. Tabular parser not imported. MR-4D-OOXML-001 left OPEN.
  Files changed: lib/orgs/runtime-composition-logic.ts; lib/orgs/runtime-composition.ts; lib/orgs/runtime-evidence.ts; lib/orgs/runtime-source-adapters.ts; docs/phase-4d-source-runtime-composition.md. Tests: lib/orgs/runtime-composition.test.ts; lib/orgs/runtime-evidence.test.ts; tests/integration/runtime-composition.test.ts. No migrations added or changed. No new npm dependencies.
  Tests added/updated: short offering name inside an unrelated word does not conflict; CAD/EUR/GBP prices ignore unrelated symbols and foreign codes including a bare dollar sign; explicit normalized names plus CAD/C$/euro-sign still detect a mismatch; enough higher-priority structured children filling the limit cannot hide a genuine conflict; conflict-safe selection is deterministic, bounded, pair-complete, and suppresses CONFLICT at limit 1; forged end-marker plus header cannot duplicate prompt boundaries while UI safeText is unchanged. Existing registry/order/match, authorization, provenance, UNKNOWN, audit, CSV/XLSX, and Phase 4A-4C regressions preserved. The five new negative cases failed on attempt-1 parser/selection/boundary behavior and passed after the fix.
  Commands and exact results on this implementation head:
  - npm ci: added 553 packages, audited 554, 0 vulnerabilities
  - npm run format:check: All matched files use Prettier code style
  - npm run lint: exit 0
  - npm run typecheck: next typegen + tsc --noEmit succeeded
  - npm run prisma:validate: schema valid
  - fresh DROP/CREATE outreach_ci + npm run prisma:migrate:deploy: 11 migrations applied through Phase 4C
  - focused runtime/visibility unit tests: 3 files, 17 passed (5 new negatives failed before the fix)
  - npm test: 28 files, 247 passed
  - focused tests/integration/runtime-composition.test.ts: 1 file, 11 passed
  - npm run test:integration: 41 files, 488 passed
  - npm run build: Next.js 16.3.0 compiled successfully; /app/orgs/[slug]/knowledge/sources present
  - CI=true npm run test:e2e: 16 passed (29.5s)
  - npm audit --omit=dev: found 0 vulnerabilities
  - git diff --check: clean
  - exact-head GitHub Actions run 31892074018 on eff1730efc3f9364abe6e9e6ce347737ae3947e7: success (https://github.com/DannyNguyenCode/outreach/actions/runs/31892074018)
  Authorization/tenant isolation: composition still independently requires active membership and org.knowledge.read; adapters reuse existing retrieval services. Inactive, unverified, forged, and cross-tenant actors remain denied with payload-free reasons. No auth or tenant-scope changes in this attempt.
  Security/privacy: prompt-facing source text can no longer forge reserved boundaries. Inspector safeText still shows bounded customer content. Audit packages remain IDs-only. No credentials, storage paths, checksums, or customer bodies logged. Formulas/links/tabular parsers unused. No writer/promotion path from caller/CRM/note data.
  Failure/recovery: false-name or unproven-currency mismatches no longer emit CONFLICT. Real mismatches remain visible after truncation when the pair fits. A limit too small to carry a pair returns the ordinary truncated slice without CONFLICT. Forged source markers stay labelled data. No jobs or storage objects are created.
  Manual configuration still required: none for this defect.
  Assumptions: phonetic rPh/tabular/XLSX preview remain out of scope; reviewed compatible markers are the ISO code plus the listed unambiguous national symbols; a bare dollar sign is always ambiguous; limit below 2 cannot emit a pair-complete CONFLICT without exceeding the advertised bound.
  Remaining risks: conflict detection is still exact/narrow, not semantic; worksheet/CSV import mapping still later; KNOW-005 retrieval ranking is not implemented.
  Deferred work: CSV/XLSX mapping/persistence/activation, prospects, CRM, calls, transcription, AI generation, embeddings, information-gap persistence, and Phase 5. No PR opened; ChatGPT owns the develop merge gate. Manual review flag MR-4D-OOXML-001 left OPEN.
review_findings: |
  BLOCKING 1 — The supposedly exact/narrow price-conflict detector can create false conflicts. lib/orgs/runtime-composition-logic.ts derives the offering name by splitting a display title and uses substring includes(), so a short offering such as "Pro" matches unrelated words such as "improve". Its money regex treats $, €, and £ as relevant markers for every currency code, so a CAD price can conflict with an explicitly euro- or pound-denominated passage. This violates the documented requirements that the passage explicitly name the offering and use the relevant currency marker.
  BLOCKING 2 — Global truncation can silently hide real conflicts and starve a requested source class. lib/orgs/runtime-composition.ts sorts all adapted items, slices to limit, and only then calls detectDeterministicConflicts. Structured offerings have higher authority order than knowledge and can expand into many child items, so they can fill the limit, discard the conflicting knowledge passage, and return SUPPORTED with no conflict. The contract requires conflicts to remain visible without silent arbitration.
  BLOCKING 3 — The prompt-facing source boundary is forgeable. lib/orgs/runtime-evidence.ts inserts untrusted safeText verbatim between fixed [SOURCE CONTENT — …] and [END SOURCE CONTENT] markers. A confirmed source containing the exact end marker plus a forged header produces an ambiguous promptSafeText boundary. This does not execute today, but it breaks the source-bounded contract being created for later KNOW-005 consumption.
  PASS — Implementation SHA 2d8bd1983c23b8b461d8a616cc8545a3e81fc373 is an ancestor of review handoff e60d5e99c58e7fc21700b4f2c50a9dbff2966e88; the two later commits modify AGENTS.md only. The branch is 0 behind develop.
  PASS — Exact implementation CI run 31889420552 independently succeeded for migration validation, format, lint, typecheck, unit/component, integration, production build, and E2E. Authorization, tenant isolation, current-source filtering, provenance, UNKNOWN behavior, and XLSX isolation otherwise match the task.
required_tests: |
  Add regressions that fail on attempt 1 and pass afterward: (1) a short offering name embedded inside an unrelated word does not count as an explicit name; (2) CAD/GBP/EUR prices do not treat unrelated currency symbols or explicit foreign currency markers as relevant; (3) normalized explicit offering names and compatible currency markers still detect a mismatch; (4) enough higher-priority structured child evidence to fill the result limit cannot hide a genuine cross-class conflict; (5) conflict-safe selection stays deterministic, never exceeds the advertised limit, and retains both cited evidence items whenever CONFLICT is emitted; (6) a source containing the exact end marker and a forged source header cannot escape or duplicate the rendered boundary, while UI safeText preserves bounded customer content.
  Preserve registry exhaustion, authorization/cross-tenant denial, inactive/draft/future/expired/archived/unsafe exclusion, UNKNOWN, audit privacy, accessibility, and all Phase 4A–4D regressions.
  Run focused runtime unit/integration/E2E tests; npm ci; npm run format:check; npm run lint; npm run typecheck; npm run prisma:validate; fresh PostgreSQL npm run prisma:migrate:deploy; npm test; npm run test:integration; npm run build; CI=true npm run test:e2e; npm audit --omit=dev; git diff --check; and obtain successful exact-head GitHub Actions.
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

## Cursor corrective prompt — attempt 2

Objective: preserve the approved KNOW-004 architecture while making conflict detection genuinely narrow, conflict-aware truncation deterministic, and prompt-facing source boundaries non-forgeable.

Required changes:

1. Carry the canonical offering name into conflict evaluation instead of reverse-parsing the display title. Match an explicit normalized name with token/phrase boundaries so short names do not match inside unrelated words. Keep matching deterministic and non-semantic.
2. Recognize only the structured price currency code and reviewed compatible symbols. Do not treat euro, pound, or dollar symbols as interchangeable. Document ambiguity handling for symbols such as `<!-- BEGIN:nextjs-agent-rules -->

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
status: READY_FOR_REVIEW
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
  Attempt 2 of 3 completed at implementation SHA eff1730efc3f9364abe6e9e6ce347737ae3947e7 (claim daf02a30f7cb983e245bdd8acbf073b8ebdda320). Objective: close the three attempt-1 KNOW-004 defects so price-conflict detection is genuinely narrow, conflict-aware truncation cannot hide a pair, and prompt-facing source boundaries are not forgeable.
  Requirements/acceptance: conflict evaluation uses the canonical offeringName from the price structured value with token/phrase boundaries, so a short name such as Pro does not match inside improve. Only the structured ISO code and reviewed compatible markers are relevant (CAD/C$/CA$, USD/US$, EUR/euro-sign, GBP/pound-sign); a bare dollar sign is never a marker because it cannot prove currency. Conflicts are detected on the bounded candidate pool before final truncation. selectConflictAwareEvidence keeps both cited items whenever CONFLICT is emitted, never exceeds limit, and does not emit CONFLICT when limit is below 2. promptSafeText JSON-encodes safeText on a single line between reserved header/footer markers; inspector safeText still preserves original bounded customer content. Phase document updated to match. Registry, adapters, authorization, UNKNOWN, audit privacy, and inspector behavior preserved. Tabular parser not imported. MR-4D-OOXML-001 left OPEN.
  Files changed: lib/orgs/runtime-composition-logic.ts; lib/orgs/runtime-composition.ts; lib/orgs/runtime-evidence.ts; lib/orgs/runtime-source-adapters.ts; docs/phase-4d-source-runtime-composition.md. Tests: lib/orgs/runtime-composition.test.ts; lib/orgs/runtime-evidence.test.ts; tests/integration/runtime-composition.test.ts. No migrations added or changed. No new npm dependencies.
  Tests added/updated: short offering name inside an unrelated word does not conflict; CAD/EUR/GBP prices ignore unrelated symbols and foreign codes including a bare dollar sign; explicit normalized names plus CAD/C$/euro-sign still detect a mismatch; enough higher-priority structured children filling the limit cannot hide a genuine conflict; conflict-safe selection is deterministic, bounded, pair-complete, and suppresses CONFLICT at limit 1; forged end-marker plus header cannot duplicate prompt boundaries while UI safeText is unchanged. Existing registry/order/match, authorization, provenance, UNKNOWN, audit, CSV/XLSX, and Phase 4A-4C regressions preserved. The five new negative cases failed on attempt-1 parser/selection/boundary behavior and passed after the fix.
  Commands and exact results on this implementation head:
  - npm ci: added 553 packages, audited 554, 0 vulnerabilities
  - npm run format:check: All matched files use Prettier code style
  - npm run lint: exit 0
  - npm run typecheck: next typegen + tsc --noEmit succeeded
  - npm run prisma:validate: schema valid
  - fresh DROP/CREATE outreach_ci + npm run prisma:migrate:deploy: 11 migrations applied through Phase 4C
  - focused runtime/visibility unit tests: 3 files, 17 passed (5 new negatives failed before the fix)
  - npm test: 28 files, 247 passed
  - focused tests/integration/runtime-composition.test.ts: 1 file, 11 passed
  - npm run test:integration: 41 files, 488 passed
  - npm run build: Next.js 16.3.0 compiled successfully; /app/orgs/[slug]/knowledge/sources present
  - CI=true npm run test:e2e: 16 passed (29.5s)
  - npm audit --omit=dev: found 0 vulnerabilities
  - git diff --check: clean
  - exact-head GitHub Actions run 31892074018 on eff1730efc3f9364abe6e9e6ce347737ae3947e7: success (https://github.com/DannyNguyenCode/outreach/actions/runs/31892074018)
  Authorization/tenant isolation: composition still independently requires active membership and org.knowledge.read; adapters reuse existing retrieval services. Inactive, unverified, forged, and cross-tenant actors remain denied with payload-free reasons. No auth or tenant-scope changes in this attempt.
  Security/privacy: prompt-facing source text can no longer forge reserved boundaries. Inspector safeText still shows bounded customer content. Audit packages remain IDs-only. No credentials, storage paths, checksums, or customer bodies logged. Formulas/links/tabular parsers unused. No writer/promotion path from caller/CRM/note data.
  Failure/recovery: false-name or unproven-currency mismatches no longer emit CONFLICT. Real mismatches remain visible after truncation when the pair fits. A limit too small to carry a pair returns the ordinary truncated slice without CONFLICT. Forged source markers stay labelled data. No jobs or storage objects are created.
  Manual configuration still required: none for this defect.
  Assumptions: phonetic rPh/tabular/XLSX preview remain out of scope; reviewed compatible markers are the ISO code plus the listed unambiguous national symbols; a bare dollar sign is always ambiguous; limit below 2 cannot emit a pair-complete CONFLICT without exceeding the advertised bound.
  Remaining risks: conflict detection is still exact/narrow, not semantic; worksheet/CSV import mapping still later; KNOW-005 retrieval ranking is not implemented.
  Deferred work: CSV/XLSX mapping/persistence/activation, prospects, CRM, calls, transcription, AI generation, embeddings, information-gap persistence, and Phase 5. No PR opened; ChatGPT owns the develop merge gate. Manual review flag MR-4D-OOXML-001 left OPEN.
review_findings: |
  BLOCKING 1 — The supposedly exact/narrow price-conflict detector can create false conflicts. lib/orgs/runtime-composition-logic.ts derives the offering name by splitting a display title and uses substring includes(), so a short offering such as "Pro" matches unrelated words such as "improve". Its money regex treats $, €, and £ as relevant markers for every currency code, so a CAD price can conflict with an explicitly euro- or pound-denominated passage. This violates the documented requirements that the passage explicitly name the offering and use the relevant currency marker.
  BLOCKING 2 — Global truncation can silently hide real conflicts and starve a requested source class. lib/orgs/runtime-composition.ts sorts all adapted items, slices to limit, and only then calls detectDeterministicConflicts. Structured offerings have higher authority order than knowledge and can expand into many child items, so they can fill the limit, discard the conflicting knowledge passage, and return SUPPORTED with no conflict. The contract requires conflicts to remain visible without silent arbitration.
  BLOCKING 3 — The prompt-facing source boundary is forgeable. lib/orgs/runtime-evidence.ts inserts untrusted safeText verbatim between fixed [SOURCE CONTENT — …] and [END SOURCE CONTENT] markers. A confirmed source containing the exact end marker plus a forged header produces an ambiguous promptSafeText boundary. This does not execute today, but it breaks the source-bounded contract being created for later KNOW-005 consumption.
  PASS — Implementation SHA 2d8bd1983c23b8b461d8a616cc8545a3e81fc373 is an ancestor of review handoff e60d5e99c58e7fc21700b4f2c50a9dbff2966e88; the two later commits modify AGENTS.md only. The branch is 0 behind develop.
  PASS — Exact implementation CI run 31889420552 independently succeeded for migration validation, format, lint, typecheck, unit/component, integration, production build, and E2E. Authorization, tenant isolation, current-source filtering, provenance, UNKNOWN behavior, and XLSX isolation otherwise match the task.
required_tests: |
  Add regressions that fail on attempt 1 and pass afterward: (1) a short offering name embedded inside an unrelated word does not count as an explicit name; (2) CAD/GBP/EUR prices do not treat unrelated currency symbols or explicit foreign currency markers as relevant; (3) normalized explicit offering names and compatible currency markers still detect a mismatch; (4) enough higher-priority structured child evidence to fill the result limit cannot hide a genuine cross-class conflict; (5) conflict-safe selection stays deterministic, never exceeds the advertised limit, and retains both cited evidence items whenever CONFLICT is emitted; (6) a source containing the exact end marker and a forged source header cannot escape or duplicate the rendered boundary, while UI safeText preserves bounded customer content.
  Preserve registry exhaustion, authorization/cross-tenant denial, inactive/draft/future/expired/archived/unsafe exclusion, UNKNOWN, audit privacy, accessibility, and all Phase 4A–4D regressions.
  Run focused runtime unit/integration/E2E tests; npm ci; npm run format:check; npm run lint; npm run typecheck; npm run prisma:validate; fresh PostgreSQL npm run prisma:migrate:deploy; npm test; npm run test:integration; npm run build; CI=true npm run test:e2e; npm audit --omit=dev; git diff --check; and obtain successful exact-head GitHub Actions.
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

; prefer no conflict over a false conflict when currency cannot be proven.
3. Detect conflicts over a bounded candidate pool before one source class can be removed by final ordering. Apply deterministic conflict-aware selection so a returned CONFLICT retains both cited evidence items, stays within `limit`, and cannot be silently converted to SUPPORTED by higher-priority child volume. Define and test deterministic behavior for limits too small to carry a pair without exceeding the limit.
4. Make `promptSafeText` unambiguous when customer text contains either reserved boundary marker or a forged source header. Use an escaped/encoded structured representation or neutralize reserved markers; do not remove the original bounded `safeText` used by the UI. Keep the documented requirement that future prompt builders use a source-data channel.
5. Update the phase document to match the exact name/currency, conflict-aware limit, and boundary behavior.

Explicit exclusions:

- Do not add semantic/AI conflict arbitration, embeddings, new source adapters, migrations, persistence, calls, CRM, tabular imports, or XLSX consumption.
- Do not alter main, rebase, force-push, merge, open a PR, or resolve MR-4D-OOXML-001.
- Preserve existing authorization, tenant isolation, provenance, UNKNOWN, audit privacy, and source-inspector behavior.

Completion:

- Prove every new regression fails against attempt 1 before the fix and passes afterward.
- Run and report every command in `required_tests`; missing or skipped evidence is not a pass.
- Increment `cursor_attempt_count` exactly once from 1 to 2 when claiming and set `CURSOR_WORKING`. On completion set `READY_FOR_REVIEW`, update `cursor_implementation_sha`, reset unchanged checks, and report changed files, exact tests/CI, security and tenant evidence, remaining risks, and exclusions.

<!-- END:outreach-automation -->
