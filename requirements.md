# Outreach — Product Requirements Baseline

Status: Draft for review  
Version: 0.4  
Prepared: 2026-08-09

## 1. Purpose

Build a Twilio-powered outreach workspace that prepares representatives before calls, provides source-backed assistance during conversations, and turns completed calls into accurate follow-up actions. Twilio supplies communication infrastructure. Outreach owns the information, workflow, permissions, compliance controls, and business records before, during, and after each interaction.

The first delivery is a hosted, multi-tenant SaaS. Outreach operates the application, Auth.js authentication system, Supabase project, database, storage, organization isolation, and background workflows. Customers create an account and configure their organization without installing a package, supplying a database, editing a schema, or managing environment variables.

This document is the source of truth for feature scope and acceptance. Phase planning, implementation tasks, and tests will reference the requirement IDs defined here.

## 2. Product definition and boundary

### 2.1 Product promise

> Outreach manages everything before, during, and after the communication while Twilio runs the communication layer.

The primary differentiator is **information continuity**. A representative should not need to switch among a CRM, document library, phone system, notes application, calendar, and email client to complete one customer interaction.

| Stage | Outreach manages |
|---|---|
| Before the call | Lead details, interaction history, consent and suppression status, assignment, qualification criteria, customer-confirmed business knowledge, prospect evidence, pre-call brief, and suggested talking points |
| During the call | Live transcript, customer intent, retrieval from business knowledge, prospect evidence and operational systems, source-attributed suggested answers, confidence warnings, required disclosures, notes, and appointment availability |
| After the call | Reviewable summary, outcome, confirmed commitments, follow-up tasks, draft email/SMS, appointment details, lead-status updates, and analytics |

Twilio is responsible for phone numbers, PSTN connectivity, browser voice transport, call routing primitives, audio streaming, SMS transport, recordings when enabled, and provider events. Outreach must not attempt to replace these infrastructure capabilities.

Outreach is responsible for hosting, authentication, organization isolation, roles, permissions, prospects, consent evidence, business knowledge, structured offerings, call workflow, call attribution, assistance, notes, summaries, approvals, follow-ups, scheduling, reporting, and auditability.

### 2.2 Human responsibility

The representative remains responsible for the conversation. AI output is assistance, not an autonomous authority. Outreach must require human confirmation before it books an appointment, sends a message, changes a material lead status, records a commitment, or initiates another external action.

### 2.3 Ownership and employee experience

- The business owns and pays for one Twilio account and one or more phone numbers.
- Outreach owns the hosted application and Supabase infrastructure. A customer never connects or manages an Outreach database.
- An organization owner connects Twilio through Twilio's OAuth Authorization Code flow. The owner does not paste an Account Auth Token, API-key secret, or Twilio password into Outreach.
- Employees receive individual website accounts and role-based permissions.
- Employees do not require Twilio accounts, hosting access, environment variables, database access, package installation, or desktop software.
- An employee signs in to Outreach, allows browser microphone access, and uses a short-lived Twilio Voice access token issued only after the server confirms an active session, active organization membership, calling permission, and a healthy organization Twilio connection.
- Every interaction is attributed to the authenticated employee even when employees share a business phone number.
- Deactivating an employee revokes Outreach sessions and prevents issuance or renewal of Twilio Voice tokens without disconnecting the organization's Twilio account.

## 3. Agreed technical direction

- Hosted Next.js App Router, React, TypeScript, and Node.js application.
- Tailwind CSS with optional DaisyUI integration.
- Next.js Route Handlers for the server API, OAuth callbacks, and Twilio webhooks.
- Auth.js for application authentication with an approved database adapter, Credentials sign-in, Argon2id password hashing, and database-backed sessions.
- Outreach-managed Supabase Postgres, Storage, backups, connection pooling, and PostgreSQL Row Level Security where used for defense in depth. Application identity and sessions remain exclusively under Auth.js.
- Twilio Voice JavaScript SDK in the browser and the Twilio Node SDK on the server.
- Outreach-managed customer and employee login; authentication is separate from Twilio authorization.
- All records are organization-scoped. Server authorization—not UI visibility—is the security boundary.
- Twilio OAuth access/refresh tokens and any automatically provisioned recoverable credentials remain encrypted and server-only. Browsers receive short-lived, identity-bound Voice tokens only.
- Customer-confirmed business knowledge is authoritative for the organization's business-specific claims. Prospect evidence, CRM history, live conversation, representative notes, and operational systems remain separate source classes.
- Business-type templates configure onboarding fields and guidance but never become organization facts until the customer supplies and confirms the information.
- External actions generated by AI are drafts until an authorized human confirms them.

## 4. Priority definitions

| Priority | Meaning |
|---|---|
| P0 | Required to onboard an organization and complete one secure outbound call end to end |
| P1 | Required for a usable first production release |
| P2 | Important expansion after the first production release |
| P3 | Future capability; architecture should allow it but initial delivery need not include it |

## 5. Test levels

| Test | Purpose |
|---|---|
| Unit | Validate isolated functions, schemas, state transitions, and authorization rules |
| Component | Validate React behavior, forms, accessibility, and interaction states |
| Integration | Validate Supabase, authentication, API, Twilio OAuth/webhooks, and calendar/provider boundaries |
| E2E | Validate complete user workflows in the hosted staging application |
| Contract | Validate service boundaries, OAuth/webhook payloads, imports, and provider interfaces |
| Security | Validate tenant isolation, permissions, secrets, signatures, rate limits, and abuse protections |
| Resilience | Validate retries, duplicates, delayed events, partial failure, and recovery |

## 6. Functional requirements

### A. Hosted platform and onboarding

#### PLAT-001 — Hosted multi-tenant SaaS (P0)

Provide one hosted Outreach application. Customers must not install code, connect a database, merge a schema, configure server environment variables, or manage Outreach infrastructure.

Acceptance: an owner can create an account, create an organization, complete onboarding, invite an employee, and reach the calling workspace entirely through the hosted UI.

Tests: clean-organization E2E; tenant-isolation suite; interrupted-onboarding recovery; responsive onboarding.

#### PLAT-002 — Guided business onboarding (P0)

Collect organization name, business model, timezone, contact details, team defaults, communication settings, and initial business-knowledge template selection. Permit the owner to skip nonessential steps and resume later.

Tests: required-field validation; resume behavior; template selection; organization ownership; audit events.

#### PLAT-003 — Business-type templates (P1)

Offer broad starting templates for professional services, home/trade services, physical products, recurring plans/subscriptions, appointment-based businesses, and custom/mixed businesses. Templates define questions, field presentation, suggested categories, import mappings, qualification prompts, and reminders; they do not create tenant-specific tables.

Acceptance: owners can customize or switch a template without losing confirmed knowledge; no template-provided example, price, policy, claim, or guarantee is treated as the customer's fact.

Tests: template application; customization; switch/migration; example-content exclusion; tenant isolation.

#### PLAT-004 — Platform administration and releases (P1)

Outreach manages schema migrations, service configuration, health checks, and releases without customer action. Migrations must be backward-compatible or have a tested rollback/recovery plan.

Tests: staging migration; rollback rehearsal; zero/low-downtime deployment; health/readiness checks.

#### PLAT-005 — Application routes (P0)

Provide hosted routes for login, onboarding, dashboard, prospects, business knowledge, team management, Twilio connection, call workspace, history, and settings, plus protected API, OAuth callback, and webhook endpoints.

Tests: navigation; deep links; authorization; callback state validation; error and empty states.

### B. Platform configuration and Supabase data

#### CFG-001 — Typed platform configuration (P0)

Expose validated platform server configuration and a safe client configuration. Customers do not supply platform environment variables.

Acceptance: missing or malformed configuration produces actionable messages; secrets cannot appear in client bundles, logs, or API responses.

Tests: schema unit tests; client-bundle secret scan; redacted logging test.

#### DB-001 — Outreach-managed Supabase data platform (P0)

Use an Outreach-managed Supabase project for Postgres, storage, backups, pooled connections, and tenant-aware data access. Customers never provide a database or Supabase project. Authentication is handled exclusively by Auth.js.

Acceptance: platform environments use controlled migrations, backups, and pooled connections; customer-facing clients receive no service-role credential.

Tests: migration integration; pooled connection; service-role exposure scan; backup/restore rehearsal.

#### DB-002 — Shared schema and Row Level Security (P0)

Use one flexible multi-tenant schema. Every organization-owned record includes `organization_id`. Protected organization data is accessed through authenticated server code that validates the Auth.js session, active membership, selected organization, and required permission. PostgreSQL Row Level Security may provide defense in depth using verified server-established request or transaction context; policies must not assume that a database-provider identity helper contains the Auth.js user identity.

Acceptance: a custom business template or offering field never requires a new per-customer schema; the browser cannot directly query protected organization tables; cross-tenant reads and writes are denied through every server path and any permitted database-access path.

Tests: RLS policy suite; server tenant escape suite; inactive membership; service-role boundary; custom-field persistence.

#### DB-003 — Core data model (P0)

Include organizations, profiles, memberships, business profiles, template assignments, prospects, contacts, calls, call events, notes, business-knowledge metadata, Twilio connections, and audit/activity events.

Acceptance: all business records carry organization ownership; required indexes and unique/idempotency constraints exist.

Tests: schema constraints; relation deletion behavior; tenant-scoped query tests.

#### DB-004 — Extended data model (P1)

Include tags, assignments, tasks/follow-ups, dispositions, callback requests, channel-specific consent/suppression records, recordings, transcripts, knowledge versions/passages, offerings, prices, variants, features, custom values, retrieval and suggestion audit records, prospect evidence, information gaps, appointments, messages, integrations, and notification preferences.

Tests: constraints; lifecycle retention; tenant scope; migration compatibility.

### C. Authentication, authorization, and accounts

#### AUTH-001 — Outreach-managed Auth.js authentication (P0)

Outreach owns customer and employee authentication through Auth.js connected to Supabase Postgres through one approved database adapter. Use database-backed sessions. Twilio authorization is a separate organization integration and is never used as an employee login mechanism.

Acceptance: owners and employees can sign in and out, recover access, and use protected routes and APIs without a Twilio account.

Tests: login/logout E2E; unauthenticated redirect; expired/revoked database session; password recovery; protected API test; adapter persistence; client-bundle secret scan.

#### AUTH-002 — Organization membership binding (P0)

Bind each authenticated profile to one or more explicit organization memberships. Authentication alone never grants access to organization data or telephony.

Acceptance: every protected request verifies a valid session, active membership, selected organization, and required permission; duplicate invitation acceptance cannot create conflicting memberships.

Tests: missing/inactive membership; organization switching; invitation race; cross-organization denial.

#### AUTH-003 — Roles and permissions (P0)

Support OWNER, ADMIN, MANAGER, AGENT, and VIEWER memberships with a documented permission matrix.

Acceptance: every server query and mutation checks authentication, organization, and permission; changing role takes effect without creating a new user. Calling uses explicit capabilities such as outbound call, inbound call, transfer, record, view team calls, and configure Twilio rather than assuming every non-viewer may call.

Tests: role matrix; cross-organization denial; direct API bypass attempts; UI visibility checks.

#### AUTH-004 — Account lifecycle (P1)

Support invitation, acceptance, suspension, revocation, membership removal, all-device session revocation, and organization switching.

Tests: invitation expiration/reuse; disabled user; last-owner protection; organization-switch isolation.

#### AUTH-005 — Authentication safeguards (P1)

For Credentials sign-in, validate passwords server-side, hash them with Argon2id, and store only the password hash in Supabase Postgres. Implement email verification, single-use expiring recovery tokens, throttling, enumeration-resistant responses, secure Auth.js cookies, database-session rotation and expiry, and administrative all-device session revocation. Raw passwords, verification tokens, recovery tokens, session tokens, and hashes must never be logged or returned to the browser. OAuth provider tokens, if added later, remain server-only and encrypted where recoverable storage is required.

Tests: Argon2id hash/verification; password policy; recovery expiry/reuse; verification-token hashing; enumeration resistance; rate limiting; cookie attributes; session rotation; all-device revoked-session denial; sensitive-log redaction.

#### AUTH-006 — Multi-factor authentication (P1)

Support an Auth.js-compatible MFA implementation with enrollment, challenge, recovery, and step-up authentication. Owners may require MFA by role or organization. MFA secrets must be encrypted at rest; recovery codes must be shown once and stored hashed.

Acceptance: setup requires reauthentication; recovery codes are shown once and stored hashed; admins can enforce MFA by role or organization.

Tests: enrollment/verification; invalid/replayed code; recovery-code one-time use; enforced-MFA route and API denial; clock-skew boundaries.

#### AUTH-007 — Hosted login UI (P1)

Provide accessible hosted login, invitation acceptance, verification, recovery, organization selection, and MFA interfaces.

Tests: accessibility; error states; expired invitation; organization selection; MFA challenge.

### D. Organization and team administration

#### ORG-001 — Organization setup (P0)

Create an organization during onboarding and assign the creator as its initial owner.

Tests: organization bootstrap; duplicate slug; owner assignment; interrupted transaction.

#### ORG-002 — Team management (P1)

Owners/admins can invite members, change permitted roles, disable access, and review team activity.

Tests: permission matrix; invitation flows; audit-event creation.

#### ORG-003 — Per-organization settings (P1)

Store timezone, locale, business hours, outbound caller identity, recording/consent policy, default dispositions, callback rules, and calendar settings.

Tests: validation; defaults; timezone/DST boundaries; tenant isolation.

### E. Prospect and lightweight CRM

#### CRM-001 — Prospect management (P0)

Create, view, update, archive, search, filter, and assign prospects. Store business/contact name, E.164 phone, email, website, status, owner, source, and timestamps.

Tests: CRUD; normalization; duplicate detection; filters; authorization; archive/restore.

#### CRM-002 — Import and export (P1)

Import prospects from validated CSV with field mapping, preview, duplicate handling, and row-level errors. Export permitted organization data.

Tests: valid/malformed/large CSV; formula-injection protection; duplicates; tenant-limited export.

#### CRM-003 — Notes and activity timeline (P0)

Allow timestamped notes and automatically record material prospect/call activity. Notes identify author and edit history.

Tests: create/edit authorization; ordering; audit history; sanitization.

#### CRM-004 — Tags, statuses, and assignments (P1)

Allow organization-configured tags, lead stages, dispositions, and agent assignment.

Tests: configuration constraints; filtering; reassignment; deleted-tag behavior.

#### CRM-005 — Consent and do-not-contact controls (P0)

Track consent and suppression independently for voice, email, and SMS. Store basis, source evidence, timestamp, expiry where applicable, jurisdiction, reason, and actor. Server-side enforcement must block prohibited communications even when a client calls the API directly.

Tests: channel-specific permission matrix; API bypass denial; organization/global suppression behavior; import matching; expiry; audit evidence.

### F. Business Knowledge and Call Context

#### KNOW-001 — Customer-managed business knowledge (P1)

Authorized customers can add, import, replace, archive, and categorize reusable information about their own organization. Supported inputs may include forms/manual entries, PDF/DOCX documents, CSV/XLSX imports, and approved URLs. Store organization, input type, title, version, effective/expiry dates, uploader, confirmation actor/time, checksum, access scope, and source locator.

Uploading does not require review by Outreach personnel. The customer is responsible for factual and legal accuracy. Outreach validates structure and requires the authorized customer to review an import preview and confirm that they are authorized to provide the information and have checked its accuracy.

Lifecycle: `PROCESSING → NEEDS_ATTENTION → ACTIVE → ARCHIVED`. Customer confirmation activates structurally valid information.

Tests: upload permission; structural failure; confirmation gate; tenant isolation; version replacement; expiry; duplicate detection; archived-source exclusion; audit trail.

#### KNOW-002 — Structural validation, extraction, and indexing (P1)

Validate supported format, required fields, data types, currency/date/frequency formats, column mappings, duplicates, unreadable content, and conflicting active records. Extract document content, split it into traceable passages, and index it asynchronously. Outreach does not independently verify that a customer's price, specification, policy, guarantee, or description is true.

Tests: supported/unsupported files; malformed input; invalid mappings; conflicting price/policy; duplicate job; changed source; deletion propagation; prompt-injection fixture.

#### KNOW-003 — Structured offering catalog (P1)

Store products, one-time services, plans, packages, subscriptions, and custom-quote offerings in shared tables. Core records support name, type, status, pricing model, prices, billing frequency, quote requirement, effective dates, features, variants, eligibility, and flexible organization-defined attributes.

Acceptance: products, services, and plans use one extensible schema; plan comparisons use structured values; a CSV/XLSX import requires customer-reviewed column mapping; no industry-specific table is generated.

Tests: each offering type; tier comparison; variants; custom fields; import mapping; conflicting price; effective-date selection; tenant isolation.

#### KNOW-004 — Source classification and runtime composition (P1)

Keep these evidence classes distinct in storage, prompts, UI, and audit records:

- customer-confirmed business knowledge;
- structured offerings and prices;
- prospect evidence such as website audits or public business information;
- CRM and prior-interaction facts;
- live caller statements from the transcript;
- representative notes and confirmations;
- live operational data such as calendar availability or inventory;
- AI inference;
- unknown or conflicting information.

The business knowledge describes the organization using Outreach; it does not establish facts about the prospect. Caller statements may become prospect-specific context but never universal organization knowledge automatically.

Tests: source-label integrity; prospect/business separation; caller-statement isolation; conflict display; audit provenance.

#### KNOW-005 — Source-attributed retrieval (P1)

Retrieve relevant current information using organization, representative permissions, prospect context, and source class. Suggested answers must expose citations or provenance labels that a representative can inspect.

Acceptance: no result is preferable to an unsupported business-specific claim; inactive, stale, cross-tenant, or unauthorized content is never returned; general model knowledge is clearly distinguished and cannot override customer-confirmed facts.

Tests: retrieval relevance; access filtering; inactive-version exclusion; zero-result behavior; citation integrity; source-priority conflict; tenant escape suite.

#### KNOW-006 — Information-gap workflow (P2)

When available information cannot support a question, Outreach displays an unknown/conflicting state, permits the representative to record the question, and reports recurring gaps to authorized managers. A representative correction remains a labelled call note until an authorized customer updates and confirms reusable business knowledge.

Tests: gap creation/deduplication; transcript linkage; correction isolation; manager permissions; resolved-gap lifecycle; analytics aggregation.

### G. Pre-call workflow

#### CALL-001 — Pre-call workspace (P0)

Show prospect details, qualification data, prior interactions, notes, applicable timezone/local time, channel-specific consent status, approved-source pre-call brief, suggested talking points, and call eligibility before enabling a call.

Tests: component states; missing number; DNC block; timezone display; authorization.

#### CALL-002 — Call readiness checks (P0)

Before placing a call, validate user permission, prospect eligibility, E.164 number, provider configuration, browser capability, microphone permission, network/device readiness, and no conflicting active call.

Tests: each failed precondition; permission denied; unsupported browser; duplicate-click/idempotency.

#### CALL-003 — Device selection (P1)

Allow microphone/output selection where browser APIs support it and remember non-sensitive preferences.

Tests: device changes/removal; permission state; unsupported output selection.

### H. Outbound and active call handling

#### CALL-010 — Browser outbound call (P0)

An authorized agent can place a single outbound PSTN call through Twilio from the pre-call workspace.

Acceptance: the server issues short-lived scoped capability tokens; creates an internal call record; initiates the provider call; and correlates provider SIDs safely.

Tests: mocked provider integration; Twilio test credentials where feasible; token expiry/scope; double-submit; end-to-end simulated call.

#### CALL-011 — Active-call controls (P0)

Display connecting, ringing, in-progress, reconnecting, ended, and failed states. Provide mute/unmute and disconnect controls, elapsed time, prospect context, and notes.

Tests: call-state component; mute state; disconnect once; provider error; refresh/navigation guard; accessibility/keyboard control.

#### CALL-012 — Call termination and cleanup (P0)

Agent, remote party, provider, timeout, or server may end a call. Cleanup must stop timers/media, finalize state idempotently, and preserve recoverable data.

Tests: termination by each actor; duplicate end events; network loss; tab close; stale active-call recovery.

#### CALL-013 — Status callbacks and state machine (P0)

Validate Twilio webhook signatures and process queued, initiated, ringing, in-progress, completed, busy, no-answer, failed, and canceled events. Handle duplicates, delay, and out-of-order delivery.

Tests: webhook signature; event idempotency; out-of-order property tests; terminal-state regression prevention; replay protection.

#### CALL-014 — Call notes during a call (P0)

Allow draft notes during the call with periodic safe persistence and recovery after refresh or transient failure.

Tests: autosave/debounce; concurrent edit policy; offline/error recovery; sanitization.

#### CALL-015 — Transfers, hold, and multi-party calls (P3)

Architecture may later support hold/resume, warm/cold transfer, supervisor join, and conference calls. These are explicitly outside the initial single-call MVP.

### I. Inbound calls, queues, and callbacks

#### INB-001 — Receive inbound calls (P2)

Route an inbound Twilio number to the correct organization and present an incoming-call interface to eligible available agents.

Tests: number-to-organization routing; accept/decline; timeout; no available agent; wrong-tenant denial.

#### INB-002 — Inbound call queue (P2)

Queue callers when no agent immediately answers. Support configurable greeting, wait audio, maximum wait, position/estimated wait where feasible, and overflow behavior.

Tests: enqueue/dequeue order; agent race; timeout/overflow; abandonment; duplicate delivery; queue metrics.

#### INB-003 — Agent presence (P2)

Agents can be offline, available, busy, wrap-up, or away. Routing selects only eligible available agents and changes presence atomically.

Tests: transition rules; stale heartbeat; simultaneous offers; busy agent exclusion.

#### INB-004 — Callback queue (P2)

Create callback requests manually, from an abandoned inbound queue, or from a post-call task. Store due time, timezone, priority, owner, reason, attempt count, and status.

Tests: creation sources; ordering; DST; claim race; retry; completion/cancellation; DNC recheck before dialing.

#### INB-005 — Scheduled callback execution (P2)

Notify or assign an agent when due; optionally support provider-assisted callback dialing after explicit policy/configuration.

Tests: due scheduler; idempotent dispatch; unavailable agent; expired request; consent and business-hours enforcement.

#### INB-006 — Voicemail (P2)

Support configurable voicemail fallback, recording metadata, notification, and callback-task creation.

Tests: recording callback validation; unavailable audio; retention; unauthorized playback.

### J. Post-call workflow

#### POST-001 — Mandatory wrap-up (P0)

After a call ends, show a post-call workspace for disposition, outcome, notes, confirmed commitments, prospect status, and optional follow-up date. AI-suggested facts and commitments must remain visibly distinct until reviewed.

Acceptance: configurable required fields prevent completion; the call remains in wrap-up until saved or explicitly abandoned under policy.

Tests: required fields; draft recovery; submit idempotency; status update; permissions.

#### POST-002 — Follow-up tasks and reminders (P1)

Create assigned follow-up tasks with due date/time, priority, status, and prospect/call linkage.

Tests: timezone; overdue state; reassignment; completion; notification trigger.

#### POST-003 — Call history and search (P1)

Authorized users can filter call history by date, agent, prospect, outcome, direction, and status and open a detailed timeline.

Tests: filters/pagination; tenant isolation; permission-based fields; large fixture performance.

### K. Recording, transcription, and AI assistance

#### MEDIA-001 — Recording policy and consent (P1)

Recording is disabled by default until organization policy, lawful consent handling, retention, and access permissions are configured. Persist consent evidence and provider recording identifiers, not public media URLs.

Tests: default-off; consent gates; webhook validation; signed/authorized playback; deletion/retention.

#### MEDIA-002 — Post-call transcription (P1)

Transcribe permitted recordings asynchronously. Store provider/job status, language, speaker labels where available, confidence metadata, timestamps, and failure reason.

Tests: job lifecycle; duplicate callback; retry; malformed result; authorized transcript access; recording deleted before processing.

#### MEDIA-003 — Live transcription (P2)

Stream audio through a persistent WebSocket-capable worker and display partial/final transcript segments with speaker separation, timestamps, and clear latency/confidence behavior.

Tests: media-stream contract; reconnect; ordering; partial replacement; backpressure; call-end cleanup.

#### AI-001 — AI call summary (P1)

Generate a reviewable post-call summary, outcome suggestion, action items, objections, and follow-up draft from the transcript and notes. Clearly label AI output and retain model/job metadata.

Acceptance: an agent reviews/edits before any customer-facing action; sensitive data handling is configurable.

Tests: job lifecycle; absent/short transcript; prompt injection fixture; schema validation; human approval gate.

#### AI-002 — Pre-call assistance (P2)

Generate a concise brief and talking points using stored prospect data, prior interactions, active customer-confirmed business knowledge, and optionally imported website-audit evidence. Show source class, provenance, freshness, and context and permit manual editing.

Tests: organization scope; missing data; stale suggestion; audit-package contract.

#### AI-003 — Live agent assistance (P3)

Detect customer intent from final transcript segments, retrieve approved current business information, and suggest answers with source citations and confidence/fallback state. Suggestions must never speak or send information automatically.

Acceptance:

- Each factual suggestion identifies the exact supporting business-knowledge passage, structured record, prospect evidence, caller statement, or operational source used.
- Low confidence, conflicting sources, or no adequate source produces a warning rather than a fabricated answer.
- The representative can open the cited source and dismiss or copy a suggestion.
- The system records the question/context, sources retrieved, suggestion, model/version, confidence state, and representative action for auditing.
- Retrieval and generation respect organization and document access permissions.

Tests: supported answer; conflicting sources; no source; stale source; prompt injection; rapid transcript updates; access denial; audit record; no autonomous speech/action.

#### AI-004 — Required disclosure assistance (P2)

Organizations can configure approved disclosure rules and scripts triggered by call direction, campaign, prospect attributes, or detected intent. The interface reminds the representative and records acknowledgment without claiming that detection alone proves legal compliance.

Tests: trigger rules; acknowledgment; missing/outdated script; permissions; audit timeline.

#### AI-005 — Structured post-call extraction (P1)

Extract summary, outcome, objections, confirmed facts, customer requests, representative commitments, and proposed next actions into a validated schema. Display provenance from transcript/notes and require human confirmation before material persistence or external action.

Tests: schema validation; unsupported claim; conflicting notes/transcript; edit/approval; rejection; provenance link; idempotent regeneration.

### L. Calendar and appointments

#### CAL-001 — Calendar provider interface (P1)

Define an adapter contract for availability lookup, event creation, update, and cancellation. Initial implementation may target Google Calendar, with Outlook added through the same contract.

Tests: adapter contract; token expiry; provider failure; timezone normalization.

#### CAL-002 — Book appointment during or after a call (P1)

An authorized agent can view available slots, collect attendee details and consent, confirm timezone, and create a linked calendar event without leaving the call workflow. AI may propose values, but event creation requires an explicit final confirmation.

Tests: slot conflict; duplicate submission; DST/timezone; provider success with local persistence failure and reconciliation; cancellation.

#### CAL-003 — Appointment records and reminders (P1)

Store provider-neutral event metadata, organizer, attendees, prospect/call links, status, and reminders. Never store provider access tokens in client-visible fields.

Tests: lifecycle synchronization; deleted external event; permissions; reminder trigger.

### M. Email and SMS follow-up communication

#### MSG-001 — Send approved follow-up email (P1)

Send a templated or AI-drafted email during or after a call only after agent review. Record delivery metadata and link it to the prospect/call.

Tests: recipient validation; approval gate; provider failure/retry; idempotency; HTML sanitization; tenant scope.

#### MSG-002 — Templates (P2)

Organizations can manage role-restricted, versioned email and call-script templates with merge-field validation.

Tests: permissions; missing merge values; version history; preview escaping.

#### MSG-003 — Draft and send approved SMS (P2)

Create an SMS draft linked to the call/prospect and send through Twilio only after an authorized representative reviews it and the server rechecks SMS-specific consent and suppression.

Tests: consent/suppression; approval gate; length/segmentation preview; provider failure; idempotency; STOP/opt-out processing; audit linkage.

#### MSG-004 — Unsubscribe and reply processing (P1 email, P2 SMS)

Process provider delivery events, bounces, email unsubscribes, and SMS opt-out keywords into permanent channel-specific suppression records. Employees cannot override suppression.

Tests: signed webhook; duplicate event; keyword variants; direct-send bypass; suppression audit; cross-channel independence.

### N. Dashboard, reporting, and notifications

#### DASH-001 — Agent dashboard (P1)

Show assigned prospects, due callbacks/tasks, recent calls, wrap-up items, appointments, information gaps, and current availability.

Tests: scoped aggregates; empty/error/loading states; timezone; accessible navigation.

#### DASH-002 — Manager dashboard (P2)

Show team call volume, answer/connect rate, outcomes, average duration, queue metrics, callbacks, and appointment conversion with clearly defined formulas.

Tests: metric formula fixtures; date boundaries; role access; large dataset.

#### NOTIF-001 — In-app notifications (P1)

Notify users about assignments, due callbacks, invitations, failed integrations, and appointments with read/unread state.

Tests: recipient scope; deduplication; read state; deep links.

#### NOTIF-002 — External notifications (P2)

Allow optional email/browser notifications with organization and user preferences.

Tests: preference enforcement; permission; retry; invalid endpoint cleanup.

### O. Integrations and administration

#### INT-001 — Twilio configuration (P0)

Only an organization owner with `MANAGE_TWILIO` permission can start Twilio's OAuth Authorization Code flow. Outreach validates OAuth `state`/PKCE protections as supported, exchanges the one-time code server-side, identifies the authorized account, and configures or discovers the required Twilio resources.

Acceptance:

- The customer never enters a Twilio password, Account Auth Token, or API-key secret into Outreach.
- Employees use individual Outreach logins and never connect Twilio themselves.
- OAuth access/refresh tokens and any automatically provisioned recoverable credential are encrypted with managed key storage, server-only, rotatable, auditable, and removed on disconnect.
- Hashing is used for passwords or verification tokens, not for credentials the server must later use.
- The server issues an identity-bound short-lived Voice token only after verifying session, active membership, calling permission, and connection health.

Tests: OAuth success/denial/state mismatch; expired code; token refresh; encryption/redaction; disconnect/reconnect; client exposure scan; unauthorized owner action.

#### INT-002 — Organization Twilio connection lifecycle (P0)

Store connection status (`CONNECTED`, `DEGRADED`, `EXPIRED`, `REVOKED`), Twilio account identifier, connector, timestamps, health results, and encrypted token/credential references. Support test, refresh, reconnect, and disconnect operations.

Acceptance: disconnect immediately blocks new calls and token issuance; it does not delete historical call attribution. One organization's Twilio connection can never be used by another organization.

Tests: status transitions; tenant isolation; revoked authorization; stale health; disconnect during active employee session; historical preservation.

#### INT-003 — Integration health and reconciliation (P1)

Track connection health, last successful callback/sync, error status, and reconciliation jobs for Twilio, calendar, transcription, and email providers.

Tests: outage simulation; retry/backoff; stale health; reconciliation idempotency.

#### ADMIN-001 — Audit log (P0)

Record security- and business-significant activity including login, role changes, prospect/DNC changes, calls, recordings, exports, integration changes, and deletions.

Tests: event creation; tamper-resistance expectations; tenant access; sensitive-field redaction.

### P. Background jobs and realtime behavior

#### JOB-001 — Durable job abstraction (P1)

Use an interface for transcription, summaries, notifications, callbacks, and calendar reconciliation. Jobs include idempotency key, attempts, status, schedule, and last error.

Acceptance: initial provider can change without changing feature-domain code; jobs are not assumed to complete within a request lifecycle.

Tests: retry/backoff; poison job; duplicate enqueue; worker restart; cancellation.

#### RT-001 — Realtime updates (P1)

Update active call state, job status, queue offers, and notifications without requiring manual refresh, with polling fallback where appropriate.

Tests: disconnect/reconnect; missed-event reconciliation; authorization; stale update rejection.

## 7. Non-functional requirements

#### NFR-001 — Security

- Server-only secrets and short-lived least-privilege browser tokens.
- Managed encryption and key rotation for Twilio OAuth refresh tokens and any automatically provisioned recoverable credential.
- Signature verification for every provider webhook before processing.
- CSRF protection where applicable, secure cookies, security headers, input validation, output encoding, and rate limiting.
- Auth.js session, active-membership, organization, and permission checks on every protected server query or mutation; deny by default.
- No direct browser access to protected organization tables. PostgreSQL RLS, where used for defense in depth, relies only on verified server-established context and never assumes a provider-specific database identity automatically identifies an Auth.js user.
- Encryption in transit and appropriate encryption at rest for sensitive fields.
- Dependency and secret scanning in CI.

Release gate tests: OWASP-oriented API tests; tenant escape suite; webhook forgery; privilege escalation; dependency/secret scan.

#### NFR-002 — Privacy and compliance readiness

- Data minimization, purpose-limited collection, configurable retention, export, and deletion workflows.
- Consent and recording rules must be configurable because legal requirements vary by jurisdiction.
- Sensitive call recordings/transcripts have stricter permissions than ordinary notes.
- Logs and AI inputs must support redaction.
- Consent and suppression are channel-specific; authorization to call does not imply authorization to email, text, or record.
- Product controls support compliance but must not claim to determine legal compliance automatically.

Tests: retention job; deletion/export; access matrix; redaction fixtures; consent evidence.

#### NFR-003 — Reliability

- Idempotent provider callbacks and user mutations.
- Explicit call state machine with terminal-state protection.
- Retry with bounded exponential backoff for transient provider failures.
- Reconciliation for missed callbacks and partial cross-provider failures.

Tests: duplicate/out-of-order events; injected timeouts; worker restart; partial failure recovery.

#### NFR-004 — Performance

- Initial dashboard target: useful content within 2.5 seconds under the documented reference dataset and test environment.
- User call controls react locally within 200 ms; provider confirmation may remain pending visibly.
- Paginate and index all unbounded collections.
- Package should avoid unnecessary client JavaScript and permit route-level code splitting.

Tests: bundle budget; database query plan checks; load fixture; Web Vitals smoke test.

#### NFR-005 — Accessibility

Target WCAG 2.2 AA for Outreach-owned UI. Calling controls, dialogs, status messages, forms, queue alerts, and error states must be keyboard and screen-reader usable; state may not depend on color alone.

Tests: automated accessibility checks plus documented manual keyboard/screen-reader checklist.

#### NFR-006 — Browser and responsive support

Support current stable Chrome, Edge, Firefox, and Safari where Twilio/browser APIs permit; document capability differences. Core dashboard and post-call workflows are responsive; active calling prioritizes supported desktop browsers for the first release.

Tests: browser matrix; responsive component tests; unsupported-capability messaging.

#### NFR-007 — Observability

Use structured, correlated logs across internal call ID, safe provider ID, request, job, and webhook. Expose health/readiness checks and actionable errors without logging secrets, raw credentials, or unnecessary call content.

Tests: correlation fixture; log redaction; health failure; error-boundary behavior.

#### NFR-008 — Maintainability and compatibility

Use strict TypeScript, documented internal service boundaries, controlled database migrations, formatter/linter, and automated tests. Pin and deliberately upgrade supported Next.js, React, Node.js, Supabase, Twilio, and Tailwind versions.

Tests: compatibility matrix in CI; type tests; API extractor/snapshot; migration fixtures.

#### NFR-009 — Testability without real calls

Provide provider interfaces, fakes, webhook fixtures, and a simulated call mode so contributors and customers can test most workflows without spending Twilio credits or calling real people.

Tests: full simulated E2E; fixture conformance against provider contracts.

#### NFR-010 — Documentation

Customer documentation must cover account creation, organization onboarding, employee invitations/offboarding, business-template selection, knowledge imports and confirmation responsibility, Twilio OAuth connection/disconnection, calling, troubleshooting, privacy/recording configuration, and data export/deletion. Internal documentation must cover Supabase migrations/RLS, secrets, OAuth callbacks, webhook exposure, deployment, recovery, and local simulation.

Tests: documentation link checks; clean-account onboarding from customer guide; operator recovery runbook rehearsal.

## 8. Required end-to-end journeys

Each journey receives its own automated E2E test before the corresponding feature is marked complete.

1. Owner creates an Outreach account → creates an organization → selects a business template → enters initial business knowledge → invites an employee.
2. Owner connects a customer-owned Twilio account through OAuth without entering credentials → connection health succeeds → employee signs in without a Twilio account → completes a simulated outbound workflow.
3. Unauthorized user attempts direct access to another organization's prospect, call, transcript, and API mutation → every request is denied.
4. Twilio sends duplicate and out-of-order call callbacks → the timeline is complete and the call never regresses from a terminal state.
5. Call ends during a network interruption → notes recover and post-call wrap-up remains completable.
6. DNC prospect is dialed through the UI and direct API → both paths block the call and create appropriate audit evidence.
7. Permitted recorded call → asynchronous transcript → reviewable AI summary → edited notes; no automatic customer-facing action.
8. Agent books an appointment → external event and internal record reconcile across retry/duplicate conditions.
9. Inbound caller waits in queue → available agent accepts → completes call → caller/agent outcome is recorded. (P2)
10. Due callback is assigned → eligibility rechecked → agent calls → callback closes or reschedules. (P2)
11. Owner revokes an employee → all Outreach sessions become unusable → no new Voice token is issued → organization Twilio connection remains active for other employees.
12. Customer uploads a document or spreadsheet → structural validation and preview complete → customer confirms accuracy → information becomes active → representative receives a cited suggestion.
13. A caller provides prospect-specific information absent from business knowledge → it is stored as a caller-stated fact for that prospect and is not promoted to reusable organization knowledge.
14. Transcript produces summary, commitments, and follow-up drafts → representative edits and approves selected items → only approved actions persist or send.
15. Prospect permits voice but is suppressed for SMS → call remains eligible → direct UI and API SMS attempts are blocked.
16. A service company, product seller, and recurring-plan business each use the same schema with different templates, offerings, prices, features, and custom attributes.
17. Question has no supported answer or sources conflict → Outreach warns instead of inventing an answer → representative records an information gap.

## 9. Definition of feature complete

A requirement is complete only when:

- acceptance criteria are implemented;
- unit/component tests cover core behavior and important boundaries;
- integration or E2E coverage exists where the requirement crosses systems;
- security, tenant isolation, accessibility, error, loading, and empty states are addressed where applicable;
- migrations and platform configuration changes are reversible or have documented recovery;
- customer behavior and internal operator procedures are documented;
- tests pass in CI on the declared platform matrix;
- no unresolved P0/P1 defect affects the feature;
- the requirement is demonstrated in the hosted staging application.
- AI-assisted features pass groundedness, no-source fallback, citation integrity, human-approval, and auditability fixtures.

## 10. Confirmed product decisions

1. Twilio supplies the communication infrastructure; Outreach supplies the business workflow and information continuity.
2. A business owns one Twilio account; an authorized owner connects it through Twilio OAuth without manually providing permanent credentials. Employees never connect Twilio.
3. Employees use individual Outreach logins, roles, permissions, and identity-bound short-lived Twilio tokens.
4. AI assistance is source-backed and advisory. It must not fabricate unsupported answers or autonomously speak, book, send, or commit.
5. Customer-confirmed business knowledge—not general model knowledge—is authoritative for organization-specific claims. The customer is responsible for accuracy; Outreach validates structure and confirmation, not truth.
6. Calls, email, SMS, recording, and other consent/suppression states are tracked and enforced separately.
7. Outreach is a hosted, plug-and-play multi-tenant SaaS using Auth.js for authentication and an Outreach-managed Supabase platform for Postgres, storage, backups, and related data services. Customers do not connect their own databases or install a module.
8. Business templates guide onboarding but do not create per-business schemas and do not become facts until the customer supplies and confirms the content.
9. Products, services, plans, subscriptions, packages, and custom quotes share a flexible structured offering model.
10. Business knowledge, prospect evidence, CRM history, live caller statements, representative notes, operational data, and AI inferences remain distinct source classes.
11. Deactivating an employee revokes Outreach access and Twilio token issuance without requiring any change to the organization's Twilio account.

## 11. Decisions still requiring product confirmation

These questions do not prevent documenting the baseline, but they must be resolved before the related implementation phase:

1. Is the first release strictly outbound calling, with inbound calling/queues remaining P2?
2. Will Auth.js launch with Credentials email/password only, or also a passwordless email and/or social OAuth provider, and which MFA methods are required at launch?
3. May one user belong to multiple customer organizations in the first UI, or only in the underlying schema initially?
4. Will call recording be omitted from the MVP and introduced only with a defined consent/retention policy?
5. Which first calendar and email providers should receive concrete adapters? Google Calendar remains the leading calendar candidate.
6. What subscription tiers, trials, usage limits, and Twilio-cost disclosures are required at launch?
7. Will the hosted application launch only on Vercel with one managed Supabase project, or require another deployment topology?
8. Does the website-audit package become an optional pre-call data adapter in the first production release or a later integration?
9. Which upload formats are required first: manual form, CSV/XLSX, PDF, DOCX, and/or approved URLs? Supabase Storage is the default file store.
10. Which AI and retrieval providers are permitted initially, and what data-retention terms are required?
11. Should email be enabled in P1 while SMS remains opt-in P2 follow-up only?

## 12. Explicit initial exclusions unless reprioritized

- Predictive, power, or automatic dialing.
- Automated robocalling or unsolicited prerecorded messages.
- Automatic sending of AI-generated messages without human review.
- Automatic speaking of AI-generated answers during live calls.
- Emergency-calling workflows.
- Customer-managed database connections or installation into customer codebases.
- Full enterprise contact-center functions such as skill-based routing, workforce management, supervisor monitoring, and complex IVR design.
- Multi-provider telephony beyond the provider interface and initial Twilio implementation.
- Autonomous AI agents that contact prospects or make commitments without a human representative.
- Treating public web content or model memory as customer-confirmed business knowledge without an explicit ingestion/confirmation process.
- Outreach personnel verifying the truth, legality, or commercial accuracy of customer-provided business knowledge.
- Default cold-SMS campaign automation.

## 13. Requirement tracking template

Use this template for each implementation issue:

```md
Requirement: CALL-010
Priority: P0
Status: Not started | In progress | Blocked | In review | Complete
Depends on: requirement IDs

Implementation:
- [ ] ...

Tests:
- [ ] Unit
- [ ] Component
- [ ] Integration/contract
- [ ] E2E
- [ ] Security/accessibility/resilience as applicable

Evidence:
- Pull request:
- Test run:
- Documentation:
- Demo:
```
