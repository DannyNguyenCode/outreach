<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:outreach-automation -->

# Outreach Automation Handoff

```yaml
task_id: phase-04b-corrective-sync-001
phase: "Phase 4B corrective integration — attempt 3 requested"
active_branch: feature/phase-04b-private-document-processing
base_develop_sha: d06ec79f0d5ee7297e934aed2f692f13f472cfcf
cursor_implementation_sha: 42429a482b65c72ebf6106d44f2968bfb4a9ad18
last_reviewed_sha: a2ab9520d5499cb96afdf5f2e6a809c88cdb2fbf
status: READY_FOR_REVIEW
previous_task_status: null
previous_pr_number: null
previous_develop_merge_sha: null
cursor_attempt_count: 3
consecutive_unchanged_checks: 0
last_cursor_activity_sha: 42429a482b65c72ebf6106d44f2968bfb4a9ad18
stop_reason: null
unchanged_check_times: []
cursor_claimed_at: "2026-08-15T05:06:00Z"
cursor_completed_at: "2026-08-15T05:14:00Z"
cursor_report: |
  Attempt 3 of 3 completed at implementation SHA 42429a482b65c72ebf6106d44f2968bfb4a9ad18 (claim 94881a9e9d12164553e6d9aa35730d990644d569). Objective: reject stale failOrRetryDocumentJob results after a newer archive or claim identity has won.
  Requirements/acceptance: after organization → source → version → document → job locks, failOrRetryDocumentJob now revalidates unarchived DOCUMENT source, PROCESSING version, live RUNNING job lease/owner/attempt identity, and worker-owned SCANNING/EXTRACTING document state. Stale results return outcome "stale" with no job/document/version overwrite, no runnable RETRY/QUEUED requeue, and no KNOWLEDGE_DOCUMENT_PROCESSING_FAILED audit. Leftover claims remain for bounded lease/recovery.
  Files changed: lib/orgs/knowledge-documents.ts; tests/integration/knowledge.documents.concurrency.test.ts; docs/phase-4b-private-document-processing.md (stale no-op sentence). No migrations added or changed.
  Tests added/updated: archive-first stale failure/retry race; worker-first/archive-second precise RETRY+ARCHIVED assertion; stale lease/attempt/owner replacement. Existing sweeper, claim/archive, tenant isolation, and retry tests preserved.
  Commands and exact results on this implementation head:
  - npm ci: added 553 packages, audited 554, 0 vulnerabilities
  - npm run format:check: All matched files use Prettier code style
  - npm run lint: exit 0
  - npm run typecheck: next typegen + tsc --noEmit succeeded
  - npm run prisma:validate: schema valid
  - fresh DROP/CREATE outreach_ci + npm run prisma:migrate:deploy: 11 migrations applied through Phase 4C
  - npm test: 23 files, 132 passed
  - npm run test:integration: 40 files, 477 passed
  - focused tests/integration/knowledge.documents.concurrency.test.ts: 8 passed (3 new/rewritten cases failed before the fix: archive-first returned retry; replaced claim threw ConflictError; worker-first error-code assertion then passed after using processing_remote)
  - npm run build: Next.js 16.3.0 compiled successfully
  - CI=true npm run test:e2e: 16 passed (29.5s)
  - npm audit --omit=dev: found 0 vulnerabilities
  - git diff --check: clean
  Authorization/tenant isolation: no permission or tenant-scope changes. Existing tenant-scoped exhausted-lease test still passed. Archive and failure/retry remain organization-lock serialized.
  Security/privacy: no credentials, tokens, or customer data exposed. Stale workers can no longer requeue archived document work or write a misleading terminal failure audit.
  Failure/recovery: stale no-op leaves RUNNING/SCANNING claim in place; later lease expiry/recovery can release or terminalize it. Worker HTTP route records outcome "stale" instead of 503.
  Manual configuration still required: none for this defect.
  Assumptions: MalwareScanUnavailableError remains retryable as processing_remote; archive still locks documents/jobs without changing their processing/job states.
  Remaining risks: adjacent scan/publish/terminalize paths were audited and left unchanged because they already reject archived/non-PROCESSING graphs or are outside this defect. Attempt 3 is the final Cursor attempt.
  Deferred work: none for this task. Phase 4D remains untouched.
review_findings: |
  BLOCKING attempt-2 defect: failOrRetryDocumentJob acquires the documented organization → source → version → document → job locks, but after locking it revalidates only the job state/owner/IDs. It does not reject an archived source, a non-PROCESSING version, a document no longer in the worker-owned in-flight state, an expired/replaced lease, or a changed attempt count. It can therefore update the job to RETRY and the document to QUEUED after a newer archive/lifecycle transition has already won.
  Evidence: lib/orgs/knowledge-documents.ts failOrRetryDocumentJob checks graph.job only, then updates the job and updates the document when leaseOwner matches OR the document is merely in any in-flight state. docs/phase-4b-private-document-processing.md explicitly requires retry/failure graph mutation to revalidate lease expiry, attempt count, document state, version state, and tenant identifiers, and forbids stale workers from overwriting archive/restore transitions.
  Missing regression proof: tests/integration/knowledge.documents.concurrency.test.ts "serializes worker failure/retry and archive without deadlock" deliberately holds the failure transaction first, so the worker always wins and archive runs second. It accepts RETRY or FAILED and never exercises archive-first followed by stale failure/retry. Thus it cannot fail on the defect above.
  Attempt-2 fixes for two-stage reservation, concurrent exhausted sweepers, upload authorization-before-parser, and CLEAN checksum-mismatch download denial are otherwise supported by code/test evidence. The temporary checksum-constraint test is serialized by fileParallelism:false and restores the exact migration constraint in finally.
required_tests: |
  Add a deterministic archive-first (or equivalent newer lifecycle-first) failure/retry race using barriers/hooks. Prove the stale worker does not change the newer source/version/document lifecycle, does not requeue runnable work, and does not write a misleading terminal failure audit.
  Add focused coverage for failOrRetryDocumentJob revalidation of job lease ownership/expiry and attempt identity plus source, version, and worker-owned document state after all graph locks are held.
  Preserve and rerun the existing concurrent sweeper, claim/archive, tenant isolation, upload pre-parse authorization, checksum mismatch, successful processing, retry, compensation, archive/restore, and Phase 4C tests.
  Run the full required format, lint, typecheck, Prisma validation/fresh migration deploy, unit, integration, build, E2E, audit, and diff checks.
next_action: "ChatGPT must review the complete branch against the current develop branch."
```

## Cursor corrective implementation prompt — final attempt

### Objective

Make the Phase 4B failure/retry graph mutation reject stale worker results after a newer archive or other lifecycle transition has won. Add deterministic regression coverage for the losing-worker ordering. This is attempt 3 of 3.

Work only on `feature/phase-04b-private-document-processing`. Do not touch `main` or `develop`, open or merge a PR, rebase, force-push, reset history, add Phase 4D work, or perform unrelated refactoring.

### Exact defect and evidence

- In `lib/orgs/knowledge-documents.ts`, `failOrRetryDocumentJob` correctly obtains `organization-knowledge:<organizationId>` and then source → version → document → job locks.
- Its post-lock guard validates only the job state, lease owner, and graph IDs.
- It does not validate that the source is still unarchived DOCUMENT knowledge, the version is still PROCESSING, the document is still in the precise worker-owned in-flight state, the lease is still valid for this worker/result, or the attempt identity is unchanged.
- The subsequent document predicate is too broad: `graph.document.leaseOwner === workerId || isInFlightDocumentProcessingState(...)`. A stale worker can therefore write `RETRY`/ `QUEUED` (or terminal failure state/audit) after archive or another newer lifecycle mutation.
- The new worker failure/archive test holds the failure transaction first and therefore covers only worker-first serialization. It must also cover archive/newer-lifecycle-first serialization.

### Required fix

- After all graph locks are held, revalidate the complete mutation precondition required by the documented protocol:
  - tenant and source/version/document/job ancestry all match;
  - source exists, is unarchived, and has DOCUMENT input kind;
  - version remains PROCESSING;
  - job remains RUNNING for this worker and the same claimed attempt, with the expected live lease semantics;
  - document remains in the expected worker-owned in-flight processing state and has not been superseded by archive, publication, retry, restore, or another worker/lifecycle transition.
- If any precondition is stale, do not overwrite source/version/document state, do not requeue work, and do not emit a misleading processing-failure audit. Return or surface a safe stale/no-op outcome consistent with the caller contract, and leave later durable cleanup to the existing bounded lease/recovery protocol if needed.
- Keep conditional update predicates aligned with the locked/revalidated values. Do not weaken tenant predicates or lock ordering.
- Audit the immediately adjacent scan/publish/terminalization paths only for the same stale-write pattern. Change them only if the same concrete defect exists; avoid scope growth.
- Update the Phase 4B worker documentation only if needed to describe the exact stale-result behavior.

### Required regression tests

Use deterministic gates/hooks, not sleeps:

1. Archive wins and commits before a previously claimed worker enters failure/retry mutation. Assert the source/version remain archived, the document is not changed back to runnable QUEUED work, the job does not become a runnable retry, and no misleading failure audit is added.
2. Preserve worker-first/archive-second coverage and assert its one valid serialized result precisely.
3. Exercise stale lease/attempt or ownership replacement after claim and before failure mutation; prove the old worker cannot overwrite the newer job/document state.
4. Keep all existing concurrent sweepers, claim/archive, tenant isolation, upload authorization-before-parser, checksum mismatch, processing, bounded retry, compensation, archive/restore, and Phase 4C compatibility checks passing.

Every functional fix must have a regression test that fails before the fix and passes afterward.

### Verification

Run and report exact results for:

- `npm ci`
- `npm run format:check`
- `npm run lint`
- `npm run typecheck`
- `npm run prisma:validate`
- fresh PostgreSQL `npm run prisma:migrate:deploy` through Phase 4C
- `npm test`
- `npm run test:integration`
- focused stale-worker/archive/lease tests
- `npm run build`
- `CI=true npm run test:e2e`
- `npm audit --omit=dev`
- `git diff --check`

Skipped, pending, unavailable, flaky, or failing checks are not passes.

### Acceptance and completion handoff

- A stale failure/retry result cannot overwrite a newer archive or lifecycle transition.
- The implementation now matches every post-lock revalidation guarantee documented for retry/failure mutation.
- Both worker-first and newer-lifecycle-first race orderings are deterministic, deadlock-free, tenant-scoped, and precisely asserted.
- No unrelated behavior, migration, or Phase 4D work changes.
- Full verification succeeds on the exact final implementation head.

When claiming, increment `cursor_attempt_count` from 2 to 3 exactly once and set `CURSOR_WORKING`. Cursor must never claim a fourth attempt.

After implementation and verification, record the last non-report SHA in `cursor_implementation_sha`, update `cursor_report` with exact evidence, set `status: READY_FOR_REVIEW`, set the next action to ChatGPT complete-branch review, commit the report separately, push this same branch, and stop. If blocked, set `BLOCKED` with exact evidence and stop.

## ChatGPT review result

Attempt 2 is not approved for merge. The two-stage lock-order corrections and the two security regression cases are materially improved, but failure/retry still lacks the required post-lock lifecycle revalidation and its concurrency test does not cover the stale-worker losing order. This final corrective attempt is limited to that defect and proof.

<!-- END:outreach-automation -->
