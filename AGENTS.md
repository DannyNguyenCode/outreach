<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:outreach-automation -->

# Outreach Automation Handoff

```yaml
task_id: phase-04b-corrective-sync-001
phase: "Phase 4B corrective integration"
active_branch: feature/phase-04b-private-document-processing
base_develop_sha: d06ec79f0d5ee7297e934aed2f692f13f472cfcf
cursor_implementation_sha: 3f389873a05a7f214ddb57371651129697f16f66
last_reviewed_sha: 0df214b2975cde3e55b85f67f590a81c16a46284
status: READY_FOR_REVIEW
previous_task_status: null
previous_pr_number: null
previous_develop_merge_sha: null
cursor_attempt_count: 1
consecutive_unchanged_checks: 0
last_cursor_activity_sha: 3f389873a05a7f214ddb57371651129697f16f66
stop_reason: null
unchanged_check_times: []
cursor_claimed_at: "2026-08-15T02:32:00Z"
cursor_completed_at: "2026-08-15T02:36:30Z"
next_action: "ChatGPT must review the complete branch against current develop and decide whether a corrective PR may merge into develop."
```

## Why this task is required

The corrective Phase 4B commit `975f6464e4f3943a965376c839e501ea11e5ef1b` is present only on this branch. The remote branch is one commit ahead of its merge base and four commits behind current `develop` at `d06ec79f0d5ee7297e934aed2f692f13f472cfcf`.

Phase 4B was previously merged through PR #8 at an older head. Phase 4C was subsequently merged into `develop` through PR #9. The corrective Phase 4B work must therefore be integrated with current `develop` and fully reverified before ChatGPT can review or open a corrective pull request.

A separate branch named `feature/phase-04d-source-runtime-composition` already exists. It is outside this task. Do not check it out, modify it, merge it, open a pull request for it, or start Phase 4D.

## Cursor implementation prompt

### Objective

Bring this existing Phase 4B corrective branch current with `origin/develop`, preserve both the Phase 4B lifecycle/security fixes and the already-merged Phase 4C functionality, run complete verification against the combined tree, and push the result to this same branch for ChatGPT review.

### Required procedure

1. Fetch all remote refs and verify:
   - current branch is `feature/phase-04b-private-document-processing`;
   - remote branch head includes `975f6464e4f3943a965376c839e501ea11e5ef1b`;
   - `origin/develop` resolves to `d06ec79f0d5ee7297e934aed2f692f13f472cfcf` or a newer SHA.
2. Start from a clean working tree.
3. Read:
   - this entire `AGENTS.md`;
   - `requirements.md`;
   - `outreach-implementation-phases.md`;
   - `docs/phase-4b-private-document-processing.md`;
   - `docs/phase-4c-structured-offerings.md`;
   - relevant Next.js documentation under `node_modules/next/dist/docs/`;
   - affected implementation, migrations, CI configuration, and tests.
4. Change only the delimited Outreach block status to `CURSOR_WORKING`, commit that state, and push it before substantial work.
5. Merge `origin/develop` into this feature branch normally.
6. Do not rebase, force-push, reset shared history, squash existing commits, create a replacement branch, or modify `main`.
7. Resolve any conflicts by preserving the complete intended behavior of both Phase 4B and Phase 4C. Do not remove tests, migrations, authorization checks, tenant isolation, scan gates, storage-bucket checks, retry/lease behavior, structured-offering behavior, or audit evidence merely to resolve a conflict.
8. Do not add new Phase 4D functionality.
9. If integration exposes a functional regression or missing acceptance criterion, add the appropriate regression test before or with the fix. Use unit, integration, security, migration, or E2E coverage according to the affected boundary.
10. Keep fixes minimal, reusable, and consistent with existing repository patterns. Avoid unrelated refactors and speculative abstractions.
11. Push all merge, code, migration, test, and completion-report commits to this same branch only.

### Phase 4B behavior that must remain intact

Verify the combined tree continues to enforce:

- organization membership and `org.knowledge.manage` permission before multipart parsing;
- bounded upload reading and declared/detected file validation;
- private tenant-scoped document storage;
- persisted storage-bucket validation;
- fail-closed malware scanning and checksum matching;
- download denial until clean matching scan evidence and finalization exist;
- retry classification through wrapped error cause chains;
- terminalization of expired exhausted job leases;
- idempotent cleanup and upload compensation;
- safe worker authorization, leases, retry bounds, and lock ordering;
- cross-tenant denial and non-enumerating protected access;
- reproducible forward-only migrations.

### Required verification

Run the repository-defined equivalents of all applicable checks and report exact commands and results:

- `npm ci`
- `npm run format:check`
- `npm run lint`
- `npm run typecheck`
- `npm run prisma:validate`
- fresh-database migration deployment for all migrations through Phase 4C
- `npm test` or the repository's full unit-test command
- `npm run test:integration`
- `npm run test:e2e`
- `npm run build`
- `npm audit --omit=dev`
- `git diff --check`

Also run focused Phase 4B document security, storage, processing, upload-request, worker, lifecycle, compensation, and cross-tenant tests, plus Phase 4C integration/security coverage affected by the merge.

A missing, skipped, pending, unavailable, or failing required check is not a pass. If required infrastructure or configuration is unavailable, set `status: BLOCKED` and report the exact failure instead of claiming completion.

### Explicit exclusions

Do not:

- touch `main`;
- commit directly to `develop`;
- open or merge a pull request;
- work on `feature/phase-04d-source-runtime-composition`;
- implement CSV/XLSX imports or other Phase 4D work;
- use production credentials or run production migrations;
- weaken validation, authorization, tenant isolation, malware gates, storage privacy, migrations, or tests;
- remove code merely to make checks pass.

### Completion report

After all application, merge, migration, and test commits are complete:

1. Record the SHA of the last non-report implementation/merge commit as `cursor_implementation_sha`.
2. Update `cursor_report` below with:
   - resolved `develop` SHA merged;
   - merge/conflict outcome;
   - files and migrations changed;
   - regression tests added or changed;
   - every command executed and its exact result;
   - authorization, tenant-isolation, storage, malware-scan, job-lifecycle, migration, and Phase 4C compatibility evidence;
   - assumptions, manual staging work, deferred items, and remaining risks.
3. Set `status: READY_FOR_REVIEW`.
4. Set `next_action` to: `ChatGPT must review the complete branch against current develop and decide whether a corrective PR may merge into develop.`
5. Commit only the completion-report change with `chore: report Cursor task completion`.
6. Push and stop. Do not open a PR or start another phase.

## Review findings

- Blocking integration gate: branch is diverged from current `develop`.
- Required correction: merge current `develop` into this branch without rebasing or force-pushing.
- Required evidence: full verification for the exact combined remote head.
- Current GitHub status evidence for corrective head `975f6464e4f3943a965376c839e501ea11e5ef1b` contains no reported status checks or workflow runs, so prior results cannot satisfy the merge gate.
- No application-code review approval is granted by this handoff.

## Required tests

See the required verification and Phase 4B behavior sections above. Every functional issue discovered during integration requires an appropriate regression test.

## Cursor report

Attempt: 1 of 3. Claimed at 2026-08-15T02:32:00Z. Implementation/merge SHA `3f389873a05a7f214ddb57371651129697f16f66`.

### Task objective completed

Merged current `origin/develop` (`d06ec79f0d5ee7297e934aed2f692f13f472cfcf`) into `feature/phase-04b-private-document-processing` without rebasing. The Phase 4B corrective commit `975f6464e4f3943a965376c839e501ea11e5ef1b` remains an ancestor of the combined head. Phase 4C structured-offering code from PR #9 is present on the same tree. No application-code conflicts occurred. No Phase 4D work was added. No pull request was opened.

### Merge / conflict outcome

- Strategy: `git merge origin/develop --no-edit` (ort).
- Conflicts: none.
- Merge commit: `3f389873a05a7f214ddb57371651129697f16f66`.
- Preserved: Phase 4B lifecycle/security/compensation fixes, persisted storage-bucket checks, scan-gated downloads, manage-permission-before-multipart, retry cause-chain classification, expired-lease terminalization.
- Introduced from develop: Phase 4C offerings schema, UI, retrieval, backfill migration, and tests.

### Requirements and acceptance criteria addressed

- Organization membership and `org.knowledge.manage` before multipart parsing: preserved and covered by upload-route + document integration tests.
- Bounded upload reading and declared/detected file validation: preserved (`document-upload-request`, `document-validation` unit tests).
- Private tenant-scoped document storage and persisted bucket validation: preserved (`document-storage` unit tests, including mismatched-bucket rejection).
- Fail-closed malware scanning and checksum matching: preserved (`document-security-processing` unit tests; infected-file integration test).
- Download denial until clean matching scan evidence and finalization: preserved (integration: "denies private download until scan evidence is clean and matching").
- Retry classification through wrapped error cause chains: preserved (`httpStatus` cause walk in `document-processing.ts`).
- Terminalization of expired exhausted job leases: preserved (integration: "terminalizes expired leases after the final attempt").
- Idempotent cleanup and upload compensation: preserved (multiple compensation integration tests, including cross-tenant retry).
- Safe worker authorization, leases, retry bounds, lock ordering: preserved.
- Cross-tenant denial and non-enumerating protected access: preserved (document + offering security tests).
- Reproducible forward-only migrations through Phase 4C: verified on a fresh database.
- Phase 4C offerings remain confirmable, tenant-isolated, and backfill-compatible: verified by Phase 4C integration/security/migration tests.

### Files changed

Relative to `origin/develop` after the merge, remaining feature-branch deltas are the Phase 4B corrective files plus this automation handoff:

- `AGENTS.md` (Outreach automation block only)
- `app/api/orgs/[slug]/knowledge/documents/upload/route.ts`
- `app/api/orgs/[slug]/knowledge/documents/[versionId]/download/route.ts`
- `lib/orgs/document-processing.ts`
- `lib/orgs/document-security-processing.test.ts`
- `lib/orgs/document-storage.ts`
- `lib/orgs/document-storage.test.ts`
- `lib/orgs/knowledge-access.ts`
- `lib/orgs/knowledge-documents.ts`
- `tests/integration/knowledge.documents.test.ts`

Phase 4C files arrived via the merge and match `origin/develop`. No additional application files were edited in this attempt.

### Migrations added or changed

None in this attempt. Fresh deploy applied all 11 existing migrations, including:

- `20260814190000_phase_04b_private_document_processing`
- `20260814211500_phase_04b_upload_compensation`
- `20260815000000_phase_04c_structured_offerings`

### Tests added or updated

No new tests were required: merge introduced no functional regression. Existing Phase 4B corrective tests and Phase 4C tests were re-run against the combined tree.

### Commands actually executed and exact results

- `git fetch --all --prune` / `git fetch origin develop`: success. `origin/develop` = `d06ec79f0d5ee7297e934aed2f692f13f472cfcf`.
- `git checkout -B feature/phase-04b-private-document-processing origin/feature/phase-04b-private-document-processing`: success. Clean working tree. HEAD included `975f646`.
- `chore: mark Cursor task in progress` → `7111975c45a68109301a9013d49665d04ed906b4` pushed.
- `git merge origin/develop --no-edit`: success, no conflicts, merge SHA `3f389873a05a7f214ddb57371651129697f16f66`.
- `npm ci`: success. 553 packages. Prisma Client generated. `found 0 vulnerabilities`.
- `npm run prisma:validate`: success. `The schema at prisma/schema.prisma is valid`.
- `npm run prisma:migrate:deploy` on empty `outreach_fresh`: success. 11/11 migrations applied through Phase 4C.
- `npm run prisma:migrate:deploy` on `outreach_ci`: success. 11/11 migrations applied.
- `npm run format:check`: success. `All matched files use Prettier code style!`
- `npm run lint`: success. exit 0.
- `npm run typecheck`: success. `Types generated successfully`; `tsc --noEmit` exit 0.
- `npm test`: success. 23 files, 132 tests passed (includes document security, storage, upload-request, extraction, validation).
- `npm run test:integration`: success. 38 files, 466 tests passed (includes `knowledge.documents`, knowledge security/lifecycle, offerings security/lifecycle/pricing/retrieval/concurrency/migration-backfill).
- `npm run build`: success. Next.js 16.3.0 production build compiled; Phase 4B upload/download/worker routes and Phase 4C offering routes present.
- `npx playwright install --with-deps chromium`: success.
- `CI=true npm run test:e2e`: success. 16 passed (28.8s), including `knowledge-documents.spec.ts` and `offerings.spec.ts`. Expected `CredentialsSignin` logs from negative auth cases; not failures.
- `npm audit --omit=dev`: success. `found 0 vulnerabilities`.
- `git diff --check` (working tree and `origin/develop...HEAD`): success. no whitespace errors.

A required check that is skipped/pending/unavailable/incomplete/flaky is not reported as passing. None of the required checks were skipped.

### Authorization and tenant-isolation verification

- Document upload/download remain permission-gated; cross-tenant document status and compensation have no cross-tenant effects (`knowledge.documents` integration tests).
- Offering retrieval/search hide drafts and cross-tenant identifiers (`offerings.security` and pricing tenant-isolation tests).
- Phase 4C backfill stays tenant-scoped (`offerings.migration-backfill`).

### Security and privacy considerations

- Fake knowledge adapters and CI scanner metadata only; no production credentials or production migrations.
- Private bucket name remains `knowledge-documents-private`; mismatched persisted buckets are rejected before storage calls.
- Malware path remains fail-closed. Signed URLs, file bytes, and credentials were not logged.

### Failure and recovery behaviour

- Upload compensation, checksum-mismatch graph removal, restore-copy compensation, and exhausted-lease terminalization all passed on the combined tree.

### Manual configuration still required

Staging still needs the private Supabase bucket, scanner endpoint/credentials, and worker token as documented in `docs/phase-4b-private-document-processing.md`. Not performed in this run.

### Assumptions

- Local PostgreSQL 16 on this runner with `postgres:postgres@127.0.0.1:5432` is an acceptable stand-in for CI Postgres 16.
- `KNOWLEDGE_DOCUMENT_ADAPTER_MODE=fake` is the correct non-production verification mode.

### Remaining risks

- GitHub Actions has not yet run against merge SHA `3f38987`. This report is local/CI-equivalent evidence, not a GitHub check conclusion.
- Staging malware scanner and private bucket remain unexercised here by design.

### Deferred work

- Phase 4D CSV/XLSX import and `feature/phase-04d-source-runtime-composition` were not touched.
- ChatGPT owns review and any corrective PR into `develop`. Cursor did not open a pull request.

<!-- END:outreach-automation -->
