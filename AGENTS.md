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
cursor_implementation_sha: 975f6464e4f3943a965376c839e501ea11e5ef1b
last_reviewed_sha: 0df214b2975cde3e55b85f67f590a81c16a46284
status: CURSOR_WORKING
previous_task_status: null
previous_pr_number: null
previous_develop_merge_sha: null
cursor_attempt_count: 1
consecutive_unchanged_checks: 0
last_cursor_activity_sha: null
stop_reason: null
unchanged_check_times: []
cursor_claimed_at: "2026-08-15T02:32:00Z"
next_action: "Cursor is merging origin/develop into this branch, verifying the combined Phase 4B corrective work with already-merged Phase 4C code, and will report READY_FOR_REVIEW."
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

Pending Cursor integration and verification.

<!-- END:outreach-automation -->
