<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:outreach-automation -->

# Outreach Automation Handoff

```yaml
task_id: phase-04b-corrective-sync-001
phase: "Phase 4B corrective integration — attempt 2 requested"
active_branch: feature/phase-04b-private-document-processing
base_develop_sha: d06ec79f0d5ee7297e934aed2f692f13f472cfcf
cursor_implementation_sha: 3f389873a05a7f214ddb57371651129697f16f66
last_reviewed_sha: 8b63b5dfd68b3f335f449223b87996e5cab5aab9
status: READY_FOR_CURSOR
previous_task_status: null
previous_pr_number: null
previous_develop_merge_sha: null
cursor_attempt_count: 1
consecutive_unchanged_checks: 0
last_cursor_activity_sha: 503949db8ae8b0c34112a6a3c7b31b6d70e7595d
stop_reason: null
unchanged_check_times: []
cursor_claimed_at: "2026-08-15T02:32:00Z"
cursor_completed_at: "2026-08-15T02:36:30Z"
cursor_report: "Attempt 1 merged develop and passed Cursor's reported local suite, but ChatGPT review found blocking lock-order and regression-test gaps."
review_findings: |
  Blocking: expired-lease terminalization locks and updates KnowledgeDocumentJob before dependent document/version rows and without the organization knowledge advisory lock, contrary to the documented writer protocol.
  Scope audit required: claimKnowledgeDocumentJob and failOrRetryDocumentJob also perform multi-row job/document/version transitions in job-first order. Reconcile every worker transition with the documented two-stage claim and organization/source/version/document/job lock protocol.
  Missing regression proof: no test proves a user lacking org.knowledge.manage is rejected before the multipart body is read or parsed.
  Missing regression proof: the download test does not exercise CLEAN scan state with a scannedChecksum/binaryChecksum mismatch.
  CI run 31862058309 for reviewed head 8b63b5d was still in progress when review failed; CI success would not override these findings.
required_tests: |
  Deterministic integration/concurrency tests for worker claim, expired exhausted lease terminalization, failure/retry, and concurrent user mutation/sweeper behavior.
  Route-level test proving unauthorized upload returns the safe denial without consuming/parsing the multipart body.
  Download regression test proving CLEAN but checksum-mismatched scan evidence cannot create a signed URL or download bytes.
  Full unit, integration, E2E, migration, build, formatting, lint, typecheck, audit, and diff checks.
next_action: "Cursor must claim attempt 2, implement the lock-order correction and missing regression tests on this branch, run the full suite, and return READY_FOR_REVIEW."
```

## Cursor corrective implementation prompt

### Objective

Correct the Phase 4B background-worker transaction protocol so exhausted leases and all related multi-row worker transitions are race-safe, idempotent, and consistent with the documented lock order. Add regression tests for that protocol and for the two security assertions that attempt 1 changed without proving the exact unsafe cases.

Work only on `feature/phase-04b-private-document-processing`. Do not touch `main`, commit to `develop`, open or merge a PR, work on the existing Phase 4D branch, or add Phase 4D functionality.

### Evidence and exact problems

1. In `failExpiredExhaustedKnowledgeDocumentJobs`, the CTE selects and updates `KnowledgeDocumentJob` with `FOR UPDATE SKIP LOCKED`, then updates `KnowledgeDocument` and `KnowledgeVersion`. It does not acquire `organization-knowledge:<organizationId>`, does not lock the source/version/document in documented order, and begins with the job row.
2. `docs/phase-4b-private-document-processing.md` requires background writers that mutate the knowledge graph to acquire the organization knowledge lock first, then source → version → document → job. It separately permits a short job-claim transaction, but that claim stage must be released before the graph mutation waits on the organization lock.
3. Audit `claimKnowledgeDocumentJob`, `failOrRetryDocumentJob`, scan-state transitions, publication, retry, and terminalization. Any multi-row graph mutation must not invert the documented order. Preserve the intentional `SKIP LOCKED` short-claim behavior while separating or validating dependent graph transitions safely.
4. The current terminalization test is sequential. It cannot detect reverse lock ordering, duplicate terminalization/audit, a race with another sweeper, or a race with an authorized user lifecycle/retry mutation.
5. The upload route now checks `org.knowledge.manage` before `parseBoundedDocumentFormData`, but no regression test proves a lower-permission member is rejected before the request body is consumed.
6. The download test named “denies private download until scan evidence is clean and matching” covers pending then valid clean evidence, but not the dangerous state where `scanState = CLEAN` and `scannedChecksum !== binaryChecksum`.

### Required fixes

- Implement a consistent, documented two-stage worker protocol:
  - candidate reservation/claim may use a short, committed `SKIP LOCKED` job transaction;
  - release that transaction before waiting on the organization knowledge advisory lock;
  - for graph mutation, acquire the organization lock and then lock source → version → document → job in stable order;
  - revalidate job state, lease owner/expiry, attempt count, document state, version state, and tenant identifiers after locks are held;
  - make terminalization conditional and idempotent so concurrent sweepers produce one terminal result and one audit event;
  - never let a stale worker overwrite a newer retry, completed publication, archive, restore, or other lifecycle transition;
  - preserve bounded attempts, safe error codes, non-enumeration, tenant isolation, and existing audit metadata.
- Reuse the existing lock helpers where suitable. Add narrowly scoped helpers or deterministic test hooks only when they clarify the protocol. Do not weaken row predicates or remove concurrency checks to make tests pass.
- Update Phase 4B documentation if the exact two-stage transaction sequence needs clarification, while preserving its safety guarantees.
- Add a route-level regression test proving a verified organization member without `org.knowledge.manage` receives the existing safe denial before multipart parsing/body consumption. The test must fail against the pre-fix ordering; merely asserting a final 404 after a normal body is insufficient.
- Add a download regression test that persists `scanState: CLEAN`, a non-null `finalizedAt`, and deliberately mismatched scanned/binary checksums, then proves authorization returns safe denial and the storage adapter is never asked to sign or download the object.

### Required concurrency tests

Add deterministic integration tests with barriers/hooks rather than timing-only sleeps. At minimum prove:

1. Two simultaneous exhausted-lease sweepers terminalize one eligible job exactly once, leave job/document/version mutually consistent, and write one failure audit.
2. A stale exhausted-lease sweep cannot overwrite a newer valid job/document/version transition after revalidation.
3. Worker claim/failure/retry/terminalization paths do not take graph locks in reverse order relative to an authorized user mutation. Exercise a real competing lifecycle or retry path and assert both operations finish without deadlock while one valid serialized outcome wins.
4. Tenant-scoped predicates prevent a candidate or supplied identifier from mutating another organization's source, version, document, job, or audit history.
5. Existing successful processing, bounded retry, upload compensation, archive/restore, confirmation, and Phase 4C compatibility remain intact.

### Explicit exclusions

- No rebase, force-push, reset, history rewrite, or branch replacement.
- No production credentials, production storage, production scanner calls, or production migrations.
- No unrelated refactor, schema redesign, new general job framework, CSV/XLSX import, or Phase 4D work.
- Do not remove security, lifecycle, authorization, audit, tenant, or test assertions.

### Verification

Run and report exact results for:

- `npm ci`
- `npm run format:check`
- `npm run lint`
- `npm run typecheck`
- `npm run prisma:validate`
- fresh PostgreSQL migration deployment through Phase 4C
- `npm test`
- `npm run test:integration`
- `CI=true npm run test:e2e`
- `npm run build`
- `npm audit --omit=dev`
- `git diff --check`
- focused new route, checksum, lock-order, concurrent-sweeper, stale-worker, tenant-isolation, and lifecycle tests

A skipped, pending, unavailable, flaky, or failing required check is not a pass.

### Acceptance criteria

- The documented worker lock order and two-stage claim protocol match the implementation.
- No graph-mutating path locks a job and then waits for source/version/document locks.
- Exhausted final-attempt leases reach one durable terminal state with one audit event.
- Concurrent sweepers and competing lifecycle operations are deterministic, deadlock-free, tenant-scoped, and idempotent.
- Unauthorized upload is proven to stop before multipart body consumption.
- CLEAN-but-mismatched scan evidence is proven unable to create a signed URL or expose bytes.
- All existing Phase 4B and Phase 4C behavior and checks pass on the exact final branch head.
- No Phase 4D or unrelated code is added.

### Completion handoff

This is Cursor attempt 2 of a maximum 3. When claiming, increment `cursor_attempt_count` from 1 to 2 exactly once and set `CURSOR_WORKING`.

After code and tests are committed:

1. Record the last non-report implementation SHA in `cursor_implementation_sha`.
2. Update `cursor_report` with files, transaction protocol, tests, exact commands/results, migrations, authorization/tenant evidence, security/privacy impact, assumptions, and remaining risks.
3. Set `status: READY_FOR_REVIEW`.
4. Set `next_action` to require ChatGPT review of the complete branch against current `develop`.
5. Commit the report separately as `chore: report Cursor task completion`, push to this same branch, and stop.

## ChatGPT review result

Attempt 1 is not approved for merge. The branch was correctly synchronized with `develop`, and Cursor reported a complete passing local suite, but the new exhausted-lease transition violates the documented lock hierarchy and its tests do not exercise the required concurrency boundary. The exact upload pre-parse authorization and checksum-mismatch download cases also lack regression proof.

<!-- END:outreach-automation -->
