# Outreach — Feature-Driven Implementation Phases

Status: Draft for review  
Version: 0.1  
Prepared: 2026-08-09  
Related document: `requirements.md` version 0.3

## 1. Purpose

This document breaks Outreach into vertical implementation phases. Each phase delivers a usable feature from interface through database, authorization, validation, tests, and deployment verification. The phases are intentionally feature-focused so they can later be divided into small Cursor Automation tasks and reviewable pull requests.

## 2. Authoritative technical decisions

- Outreach is a hosted, multi-tenant SaaS.
- Next.js App Router, React, TypeScript, and Node.js provide the application layer.
- Auth.js provides application authentication and database-backed sessions.
- Email/password registration uses application-managed Argon2id password hashing because the Auth.js Credentials provider does not store or hash passwords.
- Supabase provides hosted PostgreSQL, file storage, backups, and optional Realtime capabilities—not Supabase Auth.
- The browser does not directly access protected organization data. Authenticated server operations validate the Auth.js session, active organization membership, and required permission.
- Twilio authorization is organization-level and separate from employee login.
- Employees never need individual Twilio accounts.
- Business knowledge is supplied and confirmed by the customer. Outreach validates structure and processing, not the truth of customer-provided claims.
- AI suggestions remain advisory. Material external actions require human confirmation.

> Required requirements correction: `requirements.md` sections 3, DB-001, AUTH-001, AUTH-005, AUTH-006, and any `auth.uid()`-based RLS assumptions must be revised from Supabase Auth to Auth.js before implementation begins.

## 3. Standard scope of every phase

Every phase must include, where applicable:

- User journeys and expected outcomes
- Pages, components, forms, and responsive states
- User inputs and server-side validation
- Database tables, indexes, constraints, and migrations
- Authentication, organization membership, and permission checks
- Server actions, route handlers, jobs, and provider integrations
- Loading, empty, success, error, retry, and recovery states
- Audit events and operational logging
- Unit, component, integration, security, and end-to-end tests
- Accessibility and keyboard behavior
- Environment variables and manual configuration instructions
- Definition of done and explicit exclusions

## 4. Phase summary

| Phase | Feature outcome |
|---|---|
| 0 | Repository and deployment foundation |
| 1 | Registration, login, verification, recovery, and sessions |
| 2 | Organizations, employees, roles, invitations, and offboarding |
| 3 | Business onboarding and organization configuration |
| 4 | Business Knowledge and structured offerings |
| 5 | Prospects, consent, assignments, and CRM history |
| 6 | Twilio account connection and telephony configuration |
| 7 | Browser calling: outbound, inbound, queue, transfer, and callback |
| 8 | Call events, recording, transcription, and recovery |
| 9 | Live AI assistance with sources and safety controls |
| 10 | Post-call outcomes, follow-ups, messages, and appointments |
| 11 | Management dashboards, reporting, and audit history |
| 12 | Notifications and operational automation |
| 13 | Billing, subscriptions, limits, and SaaS administration |
| 14 | Security, privacy, reliability, and production readiness |

---

## Phase 0 — Repository and deployment foundation

### Feature outcome

- A clean application can run locally, pass automated checks, create its database from migrations, and deploy safely to Preview and Staging.

### Application foundation

- Initialize the Next.js App Router project with TypeScript.
- Configure Tailwind CSS and the chosen component conventions.
- Create public, authentication, onboarding, and protected application layouts.
- Add global navigation placeholders, loading boundaries, error boundaries, not-found pages, and maintenance states.
- Establish server-only modules and prevent accidental client imports.
- Define consistent identifiers, timestamps, pagination, and error-response conventions.

### Data and infrastructure

- Connect the server to Supabase-hosted PostgreSQL using one selected ORM and adapter strategy.
- Choose Prisma or Drizzle for both Auth.js and application data; do not mix ORMs without a documented exception.
- Establish version-controlled database migrations, seed data, and generated TypeScript types.
- Configure Supabase Storage buckets privately; do not expose knowledge documents publicly.
- Establish local, Preview, Staging, and Production environment boundaries.
- Define backup, restore, migration rollback, and connection-pooling procedures.

### Quality and automation

- Configure linting, formatting, type checking, unit tests, component tests, integration tests, and Playwright E2E tests.
- Add continuous integration gates for build, lint, typecheck, tests, and migration validation.
- Add environment-variable validation with separate server-only and client-safe schemas.
- Add redacted structured logging, correlation IDs, and health/readiness endpoints.
- Add `.env.example` containing variable names and fake values only.

### Definition of done

- A fresh developer environment can install dependencies, apply migrations, seed test data, run the application, and execute all checks from documented commands.
- Preview deployment succeeds without exposing server secrets in client bundles or logs.
- Phase 0 contains no user login, organization, CRM, Twilio, or AI feature.

---

## Phase 1 — Registration, login, and account recovery

### Feature outcome

- A person can create an Outreach account, verify ownership of their email, sign in securely, remain signed in, recover access, sign out, and revoke all sessions.

### Registration

- First name and last name input
- Email normalization and case-insensitive uniqueness
- Password and password-confirmation input
- Password strength and compromised-pattern rules
- Terms and privacy acceptance with stored version and timestamp
- Enumeration-resistant duplicate-account response
- Email-verification message and resend flow
- Expired, invalid, reused, and already-completed verification states

### Password security

- Hash passwords server-side with Argon2id using reviewed parameters.
- Store only the password hash and hash metadata required for future upgrades.
- Never log, serialize, return, encrypt for recovery, or store the plaintext password.
- Compare hashes using the selected library's safe verification function.
- Rehash after successful login when parameters become outdated.
- Rate-limit registration, verification, login, and recovery attempts.

### Auth.js session behavior

- Configure the Auth.js Credentials provider and a PostgreSQL-compatible adapter.
- Use database-backed sessions to support immediate revocation.
- Store secure, HTTP-only, same-site cookies appropriate to the deployment.
- Protect against session fixation and rotate the session after authentication-sensitive changes.
- Provide “sign out this device” and “sign out all devices.”
- Reject expired, revoked, malformed, and unknown sessions on protected server operations.
- Define how long normal and remembered sessions remain valid.

### Login and recovery screens

- `/register`
- `/verify-email`
- `/login`
- `/forgot-password`
- `/reset-password`
- `/auth/error`
- Signed-out, session-expired, invalid-link, and rate-limited states
- Optional later-ready hooks for passkeys or external OAuth providers

### Database and audit data

- Auth.js users, accounts, sessions, and verification-token tables
- User profile and credential tables where required by the chosen adapter design
- Email-verification and password-reset token lifecycle
- Terms/privacy acceptance record
- Authentication security events without secrets or raw tokens

### Definition of done

- Registration, verification, login, session persistence, password reset, logout, and all-device revocation work in Staging.
- Tests prove passwords are hashed, reset tokens are one-time and expiring, protected routes reject unauthenticated users, and generic errors do not reveal whether an account exists.
- Organization creation and employee roles are excluded until Phase 2.

---

## Phase 2 — Organizations, employees, roles, and offboarding

### Feature outcome

- Outreach can determine which organization a user represents, what they may do, and whether access is still active.

### Organization lifecycle

- Create an organization after first login.
- Assign the creator as the initial OWNER in the same transaction.
- Support organization name, slug, status, timezone, and lifecycle timestamps.
- Support organization switching for users with multiple memberships.
- Protect against removing or demoting the final owner.
- Suspend or archive an organization without deleting historical attribution.

### Employee invitations

- Invite an employee by email and selected role.
- Use a random, hashed, single-use invitation token.
- Set invitation expiry, cancellation, resend, and replacement behavior.
- Allow an existing Outreach user to accept a new organization membership.
- Allow a new user to register and then accept the invitation.
- Prevent duplicate or conflicting invitation acceptance.
- Show pending, accepted, expired, cancelled, and failed invitation states.

### Roles and capabilities

- OWNER: organization control, billing, integrations, team, knowledge, and calling
- ADMIN: operational configuration without ownership/billing transfer unless granted
- MANAGER: team workflows, assignments, reports, and permitted call review
- AGENT: assigned prospects, calling, notes, and approved knowledge use
- VIEWER: explicitly permitted read-only areas
- Use explicit capabilities such as `MANAGE_TEAM`, `MANAGE_KNOWLEDGE`, `CONNECT_TWILIO`, `MAKE_OUTBOUND_CALL`, `RECEIVE_INBOUND_CALL`, `TRANSFER_CALL`, `VIEW_RECORDING`, and `EXPORT_DATA`.
- Check capabilities on the server; UI visibility is only a convenience.

### Employee offboarding

- Suspend access temporarily or revoke membership permanently.
- Revoke all Auth.js sessions immediately.
- Stop issuing or refreshing Twilio Voice tokens.
- Remove the employee from inbound availability and queues.
- Optionally terminate an active device registration or call according to policy.
- Reassign open prospects, callbacks, tasks, and queue responsibilities.
- Preserve historical call, note, and audit attribution under the former employee identity.
- Prevent employee identity reuse.

### Tenant isolation

- Every organization-owned record contains `organization_id`.
- Every protected server operation derives the user from Auth.js, then validates active membership and capability.
- Never authorize a request using only an `organization_id`, `user_id`, or role supplied by the browser.
- Use database constraints and transaction-scoped tenant controls as defense in depth.
- Test forged URLs, request bodies, identifiers, and cross-organization object references.

### Definition of done

- An owner can create an organization, invite an employee, assign permissions, and immediately revoke that employee's sessions and future organization access.
- Cross-tenant read/write tests fail safely from every supported access path.

---

## Phase 3 — Business onboarding and organization configuration

### Feature outcome

- An owner can configure a business sufficiently for Outreach to guide later knowledge, CRM, and calling workflows.

### Guided onboarding

- Organization identity, legal/display name, website, contact information, locale, and timezone
- Business model selection: professional services, home/trade services, products, subscriptions/plans, appointment-based, or custom/mixed
- Business-type template selection
- Service areas, operating hours, holidays, and default language
- Team and calling defaults
- Recording and consent-policy choices
- Default lead stages, dispositions, and callback rules
- Ability to skip nonessential steps, save automatically, resume, and see completion progress

### Template behavior

- Templates configure questions, field presentation, suggested categories, import mappings, and qualification prompts.
- Templates do not create separate tenant-specific tables.
- Template examples never become customer facts automatically.
- Owners can customize a template without changing the core schema.
- Switching templates preserves customer-entered information and previews mapping conflicts.
- A custom business can add supported custom fields with type, label, validation, and display rules.

### Organization settings

- Business hours and timezone-aware availability
- Default outbound caller ID and permitted numbers, once Twilio is connected
- Inbound queue defaults and after-hours behavior
- Default call outcomes and callback windows
- Recording, transcription, retention, and consent settings
- Notification preferences and escalation contacts
- Knowledge-management and prospect-management defaults

### Definition of done

- A new owner can complete or resume onboarding, select and customize a template, and reach a configured dashboard without any business-specific example becoming active knowledge.

### Delivery split

- **Phase 3A** delivered business profile, contact/location, weekly hours, catalogues, employee defaults, and onboarding lifecycle. See `docs/phase-3a-business-onboarding.md`.
- **Phase 3B** delivers business-template selection/switching, custom-field definitions, locale, service areas, holiday closures, and operational defaults (lead stages, dispositions, callback, recording/consent configuration, notifications). See `docs/phase-3b-business-templates-settings.md`.
- Phase 3B does **not** connect Twilio, make calls, create Business Knowledge, or create prospects. Template examples never become customer facts. Recording/consent settings are configuration, not legal approval.

---

## Phase 4 — Business Knowledge and structured offerings

### Feature outcome

- Authorized customers can upload or enter business information, preview the processed structure, confirm responsibility for accuracy, and make it available to employees and AI retrieval.

### Knowledge input methods

- Manual editor for policies, explanations, scripts, FAQs, disclosures, and objection handling
- Structured forms for products, services, plans, packages, subscriptions, and custom quotes
- CSV/XLSX import with column mapping and preview
- PDF, DOCX, TXT, and supported document upload
- Later-ready connector boundary for commerce, CRM, inventory, pricing, and scheduling systems

### Upload and processing pipeline

- File extension, MIME signature, size, and ownership checks
- Private storage using organization-scoped paths
- Malware-scanning integration boundary
- Text/table extraction with processing status and retry behavior
- Structural parsing into sections, passages, and source references
- Duplicate and near-duplicate detection
- Conflicting active price/policy warning
- Row-level or section-level processing errors
- Processing states: `PROCESSING`, `NEEDS_ATTENTION`, `ACTIVE`, `ARCHIVED`, `FAILED`

### Structured offerings

- Offering name, description, type, status, currency, and pricing model
- Fixed, starting-at, range, recurring, usage-based, free, and quote-required pricing
- Product SKUs, variants, availability references, shipping, returns, and warranty fields
- Service areas, prerequisites, timeline, inclusions, exclusions, and add-ons
- Plan tiers, billing frequency, included quantities, limits, and cancellation terms
- Feature comparison tables across plans or packages
- Custom typed attributes without a new table per customer
- Effective dates and version history for prices, policies, and offerings

### Customer confirmation

- Preview extracted and mapped information before activation.
- Require the customer to confirm authorization and responsibility for accuracy.
- Store confirmer user ID, timestamp, source version, and confirmation language version.
- Activate confirmed knowledge without review by Outreach personnel.
- Validate structure, recognized formats, conflicts, and processing—not whether a customer claim is true or legally valid.

### Knowledge source separation

- Customer-confirmed business facts
- Platform-maintained general guidance
- Prospect-specific evidence
- CRM interaction history
- Live caller statements
- Representative notes
- Live operational-system data
- AI inferences and suggestions
- Never silently convert caller statements, prospect evidence, or AI output into permanent business facts.

### Retrieval and lifecycle

- Search, filter, preview, archive, replace, and restore knowledge versions.
- Retrieve source passages with stable citations and effective dates.
- Exclude draft, failed, superseded, or archived sources from active assistance.
- Show which calls or suggestions used a knowledge version where retention permits.
- Identify missing, stale, or conflicting information for customer correction.

### Definition of done

- An authorized owner can upload a document and import structured offerings, resolve structural errors, confirm the preview, and retrieve the active information with traceable source references.

---

## Phase 5 — Prospects, consent, assignments, and CRM history

### Feature outcome

- Employees can manage prospects and understand whether, why, when, and through which channel they may be contacted.

### Prospect records

- Business/contact name, phone, email, website, location, timezone, source, status, and owner
- E.164 phone normalization and validated email format
- Multiple contacts and communication channels per prospect
- Custom fields from the organization's template
- Duplicate detection and controlled merge
- Archive, restore, search, filter, sort, and pagination

### Import and export

- CSV import with field mapping, preview, row-level errors, and duplicate choices
- Protection against spreadsheet formula injection
- Large-import background processing and progress
- Tenant-limited, permission-controlled export
- Import provenance and audit record

### Assignment and work management

- Assign prospects to individuals or teams.
- Bulk assignment with permission and audit controls.
- Unassigned work queue.
- Ownership transfer and former-employee reassignment.
- Tags, lead stages, priorities, and organization-defined statuses.
- Saved filters such as “callbacks today” or “uncontacted prospects.”

### Consent and suppression

- Channel-specific consent: voice, SMS, and email
- Consent source, scope, timestamp, expiry, and evidence
- Organization, contact, and channel-level do-not-contact state
- Internal suppression list and import-time matching
- Required pre-dial permission check
- Override only when policy explicitly permits, with reason and audit event
- Timezone-aware calling windows and organization business rules
- Record a caller's revocation request immediately during or after a call

### Notes and activity timeline

- Timestamped notes with author identity
- Controlled editing with history rather than silent replacement
- Calls, outcomes, assignments, messages, appointments, callbacks, and consent changes in one timeline
- Sanitization, mention behavior, and sensitive-data controls
- Pre-call brief assembled from current prospect and history data

### Definition of done

- An agent can find an assigned prospect, review history and consent, add a note, and be blocked from calling when suppression or policy disallows it.

---

## Phase 6 — Twilio account connection and configuration

### Feature outcome

- An authorized owner can connect the organization's Twilio account without manually sharing permanent Twilio credentials, select telephony resources, verify health, and disconnect safely.

### OAuth connection

- “Connect Twilio” available only to authorized roles
- Authorization Code flow with state, PKCE where supported/appropriate, redirect allowlist, and callback validation
- Exchange authorization code only on the server
- Encrypt access/refresh tokens and any recoverable provisioned credential using managed key storage
- Store account identifier, connection status, scopes, connector identity, and timestamps
- Never expose provider secrets or refresh tokens to the browser
- Do not invent scopes; verify required operations against official Twilio capabilities during the proof of concept

### Resource discovery and setup

- List eligible Twilio phone numbers and capabilities.
- Select outbound caller ID and inbound destination numbers.
- Configure or guide configuration of TwiML applications, webhook endpoints, and status callbacks.
- Determine whether dedicated API keys can be provisioned through delegated authorization.
- Securely retain any one-time API-key secret only if browser Voice-token signing requires it.
- Validate inbound, outbound, recording, transcription, and messaging capability separately.

### Connection health

- States: `NOT_CONNECTED`, `CONNECTING`, `CONNECTED`, `DEGRADED`, `EXPIRED`, `REVOKED`, `DISCONNECTED`
- Token refresh when necessary
- Lightweight provider health verification
- Last successful verification and most recent error
- Immediate check before sensitive operations when status is stale
- Retry with bounded backoff for transient failures
- Owner-facing test connection and actionable remediation

### Disconnect and reconnect

- Confirm impact before disconnecting.
- Stop new Voice-token issuance and new provider actions.
- Remove or disable Outreach-configured webhooks when appropriate.
- Revoke provider authorization where supported.
- Delete or cryptographically render stored tokens unusable.
- Preserve historical calls and audit records.
- Support reconnection and phone-number remapping without duplicating the organization.

### Definition of done

- An owner completes OAuth, Outreach makes an authorized test request, eligible numbers are displayed, health is visible, and disconnect makes the authorization unusable.
- Browser calling itself remains Phase 7.

---

## Phase 7 — Browser calling

### Feature outcome

- Authorized employees can reliably make and receive browser calls using the organization's connected Twilio account, including queue, transfer, callback, and interruption states.

### Shared call-state model

- `IDLE`
- `PREPARING`
- `QUEUED`
- `RINGING`
- `CONNECTING`
- `IN_PROGRESS`
- `ON_HOLD`
- `TRANSFERRING`
- `WRAP_UP`
- `COMPLETED`
- `FAILED`
- `CANCELLED`
- `MISSED`
- State transitions are server-authoritative and safe against duplicate or delayed provider events.

### Voice-token issuance and device registration

- Require valid Auth.js session, active membership, calling capability, healthy Twilio connection, and permitted organization number.
- Issue short-lived, identity-bound Twilio Voice tokens.
- Bind identity to both organization and user without trusting browser-supplied identity.
- Refresh before expiry only after repeating authorization checks.
- Initialize, register, unregister, recover, and destroy the browser device safely.
- Handle microphone permission granted, denied, dismissed, revoked, and unavailable.
- Show audio-device selection, input-level feedback, ringtone/output selection, and test audio.
- Recover from network changes, sleep/wake, token expiry, and SDK registration failure.

### Outbound calling

- Select or open a prospect.
- Validate number, consent, suppression, timezone, calling window, assignment, and permission before dialing.
- Select an allowed outbound caller ID.
- Show pre-call brief, previous attempts, and callback commitments.
- Support click-to-call and manual dial when policy permits.
- Show dialing, ringing, answered, busy, declined, no-answer, voicemail, invalid-number, carrier-error, and cancelled states.
- Prevent accidental duplicate calls from double clicks or retries.
- Provide mute, hold, keypad/DTMF, timer, notes, and hang-up controls.
- Decide and record voicemail outcome; scripted voicemail/drop can be a separately gated later feature.
- Enter mandatory wrap-up after disconnect.

### Inbound calling

- Route calls from connected business numbers into Outreach.
- Match the caller number to an existing contact/prospect where possible.
- Show caller identity, organization number dialed, history, consent notes, and relevant knowledge.
- Support known caller, unknown caller, blocked/private number, duplicate contact match, and multiple-prospect match states.
- Let an authorized employee accept or decline.
- Record missed and abandoned inbound calls.
- Create a new prospect/contact from an unknown caller after confirmation.
- Apply after-hours, holiday, unavailable-team, and overflow behavior.
- Support voicemail routing and later callback creation.

### Queue and availability

- Employee availability states: `OFFLINE`, `AVAILABLE`, `BUSY`, `WRAP_UP`, `AWAY`, `DND`.
- Queue states: waiting, offered, accepted, declined, timed out, abandoned, overflowed, and failed.
- Configure ring-all, longest-idle, round-robin, priority, or skills-ready routing boundaries.
- Prevent a revoked, offline, busy, or unregistered employee from receiving an offer.
- Show wait time, queue position where available, caller context, and SLA warning.
- Enforce maximum simultaneous calls per employee.
- Provide manager visibility into queued calls without exposing unauthorized content.
- Support overflow to another queue, voicemail, external number, or callback offer.

### Callback handling

- Create a callback from a missed call, voicemail, queue escape, prospect request, or employee follow-up.
- Record requested date/time, timezone, channel, contact, reason, assigned employee/team, and priority.
- Validate callback time against business rules and consent.
- Show due, upcoming, overdue, completed, cancelled, failed, and rescheduled states.
- Remind the assigned employee and surface callbacks in the work queue.
- Allow one-click outbound call from the callback record after repeating pre-dial checks.
- Link the completed call to the original inbound attempt or queue event.
- Prevent multiple employees from claiming the same callback concurrently.

### Hold, transfer, and consultation

- Local hold and resume with visible status to all permitted participants.
- Blind transfer to an employee, queue, department, or approved external number.
- Warm transfer with consultation before handoff.
- Cancel transfer and return to the original caller.
- Handle transfer target unavailable, decline, timeout, failure, or disconnect.
- Preserve prospect context, notes, transcript continuity, and call correlation across call legs.
- Record which employee controlled each call segment.
- Define permission and recording behavior for external transfers.

### Multi-tab, concurrency, and failure behavior

- Elect or identify the active calling tab and prevent duplicate device registrations where necessary.
- Warn when a call is active in another tab/device.
- Recover UI state after refresh without pretending a disconnected call remains active.
- Handle browser close, lost network, provider outage, server timeout, and webhook delay.
- Ensure hang-up is idempotent.
- Never mark a call completed solely from optimistic browser state.

### Definition of done

- Staging demonstrates one outbound call, one inbound call, one queued call, one callback, and one transfer with correct employee attribution, permissions, call states, and failure handling.

---

## Phase 8 — Call events, recording, transcription, and recovery

### Feature outcome

- Provider events produce one reliable, auditable call record and, when enabled, securely associated recording and transcript artifacts.

### Webhook intake

- Separate endpoints for required provider event types.
- Verify Twilio signatures using the exact externally visible URL and raw/required request representation.
- Reject unsigned, invalid, stale, or unsupported requests.
- Store provider event ID, call SID, parent call SID, event type, timestamp, and sanitized raw reference.
- Use unique constraints and idempotency keys.
- Return quickly and process expensive work asynchronously.

### Event ordering and call reconciliation

- Accept duplicate and out-of-order events safely.
- Model inbound, outbound, transfer, conference, and child call legs.
- Derive user-facing call state without destroying raw provider facts.
- Reconcile calls stuck in ringing, in-progress, transfer, or processing states.
- Retry transient failures with bounded backoff.
- Send permanently failed events to an inspectable dead-letter workflow.
- Provide a manual, audited replay or reconciliation action for administrators.

### Recording

- Respect organization policy, employee permission, and applicable consent workflow.
- Support recording disabled, always-on, employee-started, and policy-triggered modes where permitted.
- Capture recording started, paused, resumed, completed, failed, and deleted states.
- Store provider recording references and restricted metadata; avoid public URLs.
- Require explicit permission to play, download, or delete a recording.
- Apply retention, legal hold, and deletion rules.
- Keep call records when a recording is deleted unless policy requires otherwise.

### Transcription

- Support live partial transcript and final transcript as separate artifacts.
- Track speaker/participant attribution where available.
- Show interim, finalizing, complete, partial, failed, and unavailable states.
- Preserve timestamps and source call segments.
- Handle transcription retry without duplicating transcript passages.
- Permit authorized corrections as an overlay with edit history; do not silently rewrite provider output.
- Redact configured sensitive patterns and control search/indexing access.

### Call timeline

- Dial/arrival, queue, ring, answer, hold, transfer, participant changes, recording, disconnect, wrap-up, and processing events
- Separate provider timestamp from system-received timestamp
- Show gaps and uncertainty rather than inventing event order
- Link recordings, transcripts, notes, outcomes, and follow-ups to the correct call/call leg

### Definition of done

- Duplicate and delayed test webhooks still produce exactly one coherent call history, and recording/transcript access follows organization policy and permissions.

---

## Phase 9 — Live AI assistance

### Feature outcome

- During a call, an employee receives timely, source-backed suggestions that clearly distinguish known facts, caller statements, and AI inference.

### Context assembly

- Active customer-confirmed business knowledge
- Structured offerings, current prices, effective dates, and plan comparisons
- Prospect profile, evidence, consent, previous interactions, and open commitments
- Current call transcript and caller statements
- Representative notes explicitly marked as notes
- Live operational data when connected and freshness is known
- Role, policy, disclosure, and organization constraints
- Token-budget and relevance controls

### Assistance experiences

- Suggested answer to the caller's current question
- Relevant offering or plan comparison
- Qualification question suggestions
- Required disclosure reminder
- Objection-handling guidance
- Information-gap warning
- Unsupported-claim warning
- Next-best-action suggestion
- Search/open cited source without leaving the call workspace
- Employee feedback: useful, incorrect, outdated, or missing source

### Source and confidence behavior

- Cite each material factual claim to its source class and source version.
- Prefer exact structured values over document prose when both describe pricing or plan features.
- Display freshness for live or time-sensitive information.
- Mark inference separately from sourced fact.
- State when information is unavailable or conflicting.
- Never represent caller statements as organization facts.
- Never create new permanent business knowledge automatically.

### Safety and action boundaries

- AI cannot dial, transfer, hang up, send a message, book an appointment, change consent, or make a material CRM update without authorized human confirmation.
- Apply output schemas and server validation rather than trusting free-form model text.
- Defend retrieval and tools against prompt injection in uploaded or prospect-provided content.
- Filter inaccessible sources before context reaches the model.
- Log source IDs, model/config version, latency, and employee disposition without storing unnecessary hidden reasoning.
- Provide a degraded experience when AI or retrieval is unavailable; calling must still work.

### Performance and failure states

- Partial transcript arriving
- No relevant source
- Conflicting sources
- Stale operational data
- Model timeout or rate limit
- Retrieval failure
- Low-confidence suggestion
- Suggestion superseded by newer conversation context

### Definition of done

- An employee can ask for help during a test call and receive a structured suggestion with citations, confidence/limitations, and no unauthorized external action.

---

## Phase 10 — Post-call workflow

### Feature outcome

- After a call, the employee can review accurate outputs, record the outcome, and approve follow-up actions without re-entering the entire conversation.

### Wrap-up and outcomes

- Mandatory or configurable disposition selection
- Connected, no-answer, busy, voicemail, wrong number, not interested, qualified, callback requested, appointment proposed, sale/converted, do-not-contact, and custom outcomes
- Notes, tags, lead-stage update, and assignment change
- Wrap-up timer and manager-configurable requirements
- Prevent loss of unsaved wrap-up data
- Allow correction with edit history and permissions

### Summary and commitments

- Generate a structured draft summary after transcript finalization or available context.
- Separate facts discussed, customer needs, objections, decisions, commitments, and unanswered questions.
- Link summary statements to transcript timestamps where available.
- Require employee review before marking the summary confirmed.
- Treat AI-identified commitments as proposed until confirmed.
- Preserve employee edits and original generated version for audit where appropriate.

### Follow-up tasks and callbacks

- Create task title, owner, due date/time, timezone, priority, related prospect/call, and reminder.
- Create callback using the Phase 7 callback model.
- Support complete, reschedule, reassign, cancel, and overdue states.
- Prevent duplicate automatic tasks from webhook or AI retries.

### Email and SMS drafts

- Generate a draft from confirmed call context and approved business knowledge.
- Show recipients, sender identity, subject, content, channel consent, and cited basis where useful.
- Require employee confirmation before sending.
- Re-check consent and suppression at send time.
- Record sent, delivered, failed, bounced, replied, and opted-out states when integrations support them.
- Never send because a model merely suggested it.

### Appointments

- View permitted calendar availability through a later/provider interface.
- Propose time slots during or after the call.
- Confirm attendee, timezone, duration, purpose, location/link, and reminders.
- Require employee confirmation before booking.
- Handle conflicts, changed availability, declined invitation, cancellation, and rescheduling.
- Link the appointment to prospect, call, employee, and source commitment.

### Definition of done

- An employee completes wrap-up, reviews a summary, confirms a callback or task, and approves one draft external action with all consent and permission checks repeated at execution time.

---

## Phase 11 — Management dashboards, reporting, and audit history

### Feature outcome

- Authorized managers understand operations, employee activity, call outcomes, queue performance, follow-up completion, and knowledge gaps without crossing privacy or role boundaries.

### Operational dashboards

- Calls today by inbound/outbound and outcome
- Connected, missed, abandoned, failed, and callback rates
- Queue volume, wait time, answer time, abandonment, and overflow
- Employee availability, active calls, wrap-up, and workload
- Upcoming and overdue callbacks/tasks
- Twilio connection and webhook-processing health
- Recording/transcription/AI processing failures

### Performance reporting

- Filters by date, timezone, employee, team, campaign/source, number, queue, and disposition
- Call count, duration, answer rate, outcome distribution, and follow-up completion
- Conversion measures only when organizations define the relevant outcome
- Clear denominator and timezone definitions
- Export limited by role and organization
- Avoid misleading rankings when volume or data quality is insufficient

### Knowledge and AI reporting

- Most-used sources and offerings
- Unanswered questions and missing-information clusters
- Conflicting or stale knowledge warnings
- Employee feedback on suggestions
- Citation coverage and unsupported-claim warnings
- Model/retrieval failure and latency trends
- No use of AI confidence as an employee-performance score by itself

### Audit history

- Login security events
- Membership, role, and offboarding changes
- Twilio connect/disconnect/configuration changes
- Knowledge upload, confirmation, replacement, and archive events
- Consent, suppression, recording, and retention changes
- Calls, transfers, summaries, external-action approvals, exports, and deletions
- Actor, organization, action, target, time, result, and correlation ID
- Tamper-resistant access controls and permission-limited viewing

### Definition of done

- A manager can investigate an operational metric back to permitted source records, and an owner can audit material configuration and access changes.

---

## Phase 12 — Notifications and operational automation

### Feature outcome

- Outreach reliably reminds the right people about time-sensitive work and automates internal preparation without autonomously performing material external actions.

### Notifications

- In-app notification centre with unread/read state
- Email notification preferences
- Callback due, task due, appointment change, missed inbound call, voicemail, queue escalation, failed integration, and knowledge-processing alerts
- Role-targeted administrative alerts
- Digest versus immediate delivery preferences
- Quiet hours and timezone handling
- Deduplication and retry-safe delivery

### Background jobs

- Callback and task reminders
- Twilio connection health checks
- Stuck-call reconciliation
- Recording/transcript/knowledge processing
- Knowledge-staleness reminders
- Retention and deletion enforcement
- Failed-event retry and dead-letter escalation
- Metrics aggregation and scheduled reports

### Automation guardrails

- Idempotency key for every job that can create a record or notification.
- Lease/lock or claim model preventing two workers from executing the same job concurrently.
- Observable queued, running, succeeded, retrying, failed, cancelled, and dead-letter states.
- Bounded retry with jitter and non-retryable error classification.
- Human confirmation remains required for outbound messages, appointments, commitments, consent changes, and material CRM changes.

### Definition of done

- A due callback produces one notification, a failed job is inspectable and recoverable, and retries do not duplicate records or external actions.

---

## Phase 13 — Billing, subscriptions, and SaaS administration

### Feature outcome

- Outreach can operate commercially with controlled subscriptions, limits, organization lifecycle, and internal support tools.

### Plans and subscriptions

- Trial, active, past-due, grace-period, suspended, cancelled, and closed states
- Plan entitlements by seats, numbers, call usage, recordings, transcription, AI usage, storage, and retention
- Upgrade, downgrade, cancellation, renewal, and failed-payment behavior
- Proration and effective-date handling through the chosen billing provider
- Billing contact, invoice access, tax/business information, and payment-method management
- Never trust client-supplied plan or entitlement values

### Usage and enforcement

- Meter call minutes, recording/transcription usage, AI requests/tokens or chosen unit, storage, seats, and imports where required.
- Separate provider-reported usage from internal estimates.
- Idempotently process billing-provider webhooks.
- Warn before limits and define soft versus hard limits.
- Do not terminate an active emergency or customer call merely because a limit is reached; apply the documented policy safely.
- Preserve access to billing/export/closure functions during restricted states.

### Internal SaaS administration

- Search organization by stable identifiers
- View subscription, connection, and processing health
- Impersonation avoided by default; if later required, use explicit consent, banner, scope, expiry, and audit trail
- Support-triggered session revocation and integration reset through permission-controlled actions
- Organization suspension, restoration, export, and closure workflows
- Feature flags and controlled rollout by environment or organization
- No internal tool may bypass audit logging silently

### Definition of done

- A test organization can start a trial, subscribe, encounter a controlled payment failure, change plan, and cancel without losing required export or historical-account access.

---

## Phase 14 — Security, privacy, reliability, and production readiness

### Feature outcome

- The complete system is ready for controlled customer use with verified tenant isolation, provider security, recovery behavior, and operational ownership.

### Security review

- Threat model authentication, tenant boundaries, invitation flows, Twilio OAuth, Voice tokens, webhooks, uploads, retrieval, AI tools, exports, and internal administration.
- Penetration-test cross-tenant object access and privilege escalation.
- Scan client bundles, logs, error trackers, and build artifacts for secrets.
- Review CSRF, XSS, SSRF, SQL injection, open redirect, request smuggling boundary, and file-upload risks.
- Rotate secrets and encryption keys using documented procedures.
- Apply least privilege to database users, storage, Twilio scopes, job workers, and deployment credentials.
- Test employee revocation during active sessions and token refresh.

### Privacy and data governance

- Document data categories, purposes, access, retention, deletion, and subprocessors.
- Organization-configurable recording/transcript retention within supported policy bounds.
- Prospect access/export/correction/deletion workflow where applicable.
- Organization export and closure workflow.
- Legal hold or deletion exception handling where required.
- Sensitive-field redaction and restricted transcript/recording access.
- Customer-visible consent language and responsibility boundaries.

### Reliability and recovery

- Load test login, dashboards, queue offers, Voice-token issuance, webhook ingestion, and AI assistance.
- Simulate Twilio, database, storage, email, billing, and AI provider outages.
- Verify graceful degradation: core calling should not depend on AI availability.
- Verify database backup restoration and migration recovery.
- Establish recovery time and recovery point objectives.
- Add service-level indicators for authentication, call setup, webhook delay, queue delay, processing success, and notification delivery.
- Create runbooks for degraded Twilio connection, stuck calls, failed webhooks, compromised credential, tenant incident, and data restoration.

### Release readiness

- Complete accessibility review of primary workflows.
- Test supported browsers, microphones, headsets, network changes, and sleep/wake behavior.
- Complete staging E2E journeys for owner, manager, active employee, revoked employee, and unknown inbound caller.
- Verify monitoring, alert ownership, on-call/escalation path, and support documentation.
- Review all environment variables, OAuth callbacks, webhook URLs, phone numbers, domains, and retention settings for Production.
- Use a controlled pilot organization before broad availability.

### Definition of done

- Security and recovery findings are resolved or formally risk-accepted, production configuration is verified, pilot acceptance tests pass, and operational owners can follow documented incident runbooks.

---

## 5. Recommended Cursor Automation breakdown

- Do not assign an entire phase to one automation when it contains multiple independent deliverables.
- Convert each subsection into one or more tasks referencing exact requirement IDs.
- Merge database and authorization foundations before starting dependent UI or integrations.
- Require each task to state changed files, migrations, tests, commands executed, results, assumptions, manual configuration, and unresolved risks.
- Keep Twilio proof-of-concept work isolated until OAuth scopes and browser-token requirements are verified.
- Do not run parallel tasks that both change the core schema, Auth.js configuration, shared authorization helpers, generated database types, Twilio connection model, or global navigation.

Suggested initial task sequence:

1. Phase 0 application and test scaffold
2. Phase 0 PostgreSQL/ORM migration foundation
3. Phase 1 Auth.js schema and database sessions
4. Phase 1 registration and Argon2id credentials
5. Phase 1 email verification and password recovery
6. Phase 1 protected routes, session revocation, and security tests
7. Phase 2 organization bootstrap and membership authorization
8. Phase 2 invitation, role, and offboarding workflows
9. Phase 2 cross-tenant and privilege-escalation test suite

## 6. Phase gate rule

A phase is ready to close only when its definition of done is demonstrated in Staging, its migrations are reproducible, its server authorization is tested, known failures are documented, and the feature can be used without relying on an unimplemented later phase except where the phase explicitly declares an integration boundary.
