# Outreach — Feature-Driven Implementation Phases

Status: Draft for review  
Version: 0.4  
Prepared: 2026-08-09  
Updated: 2026-08-14  
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
- Audit events and metric-producing domain events must be added with the feature that creates them; later reporting phases expose and aggregate existing evidence rather than reconstructing it.
- Security, privacy, tenant isolation, failure recovery, and accessibility are implemented incrementally; Phase 14 performs final verification and hardening rather than introducing these controls for the first time.
- The first feature that requires durable asynchronous work must establish the minimum shared job contract, idempotency, leasing, bounded retry, and inspectable failure behavior. Phase 12 later generalizes the operational automation platform.

## 4. Phase tree

Main numbered phases are parent delivery groups. Indented lettered phases are the independently testable implementation sections that complete their parent.

- **Phase 0 — Repository and deployment foundation**
- **Phase 1 — Registration, login, verification, recovery, and sessions**
- **Phase 2 — Organizations, employees, roles, invitations, and offboarding**
- **Phase 3 — Business onboarding and organization configuration**
    - **Phase 3A — Business onboarding foundation:** business profile, locations, hours, catalogues, employee defaults, and onboarding lifecycle
    - **Phase 3B — Templates and operational settings:** template selection, custom fields, locale, service areas, holidays, and operating defaults
- **Phase 4 — Business Knowledge and structured offerings**
    - **Phase 4A — Manual Business Knowledge core:** confirmation, immutable versioning, and retrieval
    - **Phase 4B — Private document processing:** upload, extraction, processing states, and recovery
    - **Phase 4C — Structured offerings:** products, services, plans, packages, subscriptions, and pricing
    - **Phase 4D — Tabular imports and hardening:** CSV/XLSX mapping, conflicts, idempotency, and integrated Phase 4 verification
- **Phase 5 — Prospects, consent, assignments, and CRM history**
    - **Phase 5A — Prospect and contact core:** records, search, merge, archive, and restore
    - **Phase 5B — Contact policy:** consent, suppression, calling windows, evidence, and enforcement
    - **Phase 5C — Work management:** assignments, queues, notes, history, and pre-call brief
    - **Phase 5D — CRM data movement and hardening:** import, export, provenance, recovery, and integrated Phase 5 verification
- **Phase 6 — Twilio account connection and configuration**
    - **Phase 6A — OAuth proof and secure connection:** verified authorization capabilities and protected tokens
    - **Phase 6B — Resource configuration:** numbers, capabilities, TwiML applications, and callbacks
    - **Phase 6C — Connection lifecycle:** health, refresh, disconnect, revocation, and reconnect
- **Phase 7 — Browser calling**
    - **Phase 7A — Outbound call core:** call states, Voice tokens, browser device, and outbound calls
    - **Phase 7B — Inbound calling:** caller matching, inbound routing, unknown callers, and voicemail
    - **Phase 7C — Queues and availability:** employee state, routing, offers, overflow, and concurrency
    - **Phase 7D — Callbacks:** scheduling, claiming, completion, linkage, and concurrency
    - **Phase 7E — Advanced call control and hardening:** hold, transfer, consultation, multi-tab, and failures
- **Phase 8 — Call events, recording, transcription, and recovery**
    - **Phase 8A — Webhooks and reconciliation:** verification, idempotency, ordering, call legs, and repair
    - **Phase 8B — Recording governance:** policy, consent, access, retention, and deletion
    - **Phase 8C — Transcription:** live/final artifacts, attribution, correction, redaction, and retry
    - **Phase 8D — Timeline and recovery:** unified call history, replay, reconciliation, and integrated Phase 8 hardening
- **Phase 9 — Live AI assistance**
    - **Phase 9A — AI context and retrieval security:** source assembly, separation, permissions, and injection resistance
    - **Phase 9B — Live assistance:** source-backed suggestions, warnings, citations, and employee feedback
    - **Phase 9C — AI safety and quality:** schemas, action boundaries, evaluations, performance, and degradation
- **Phase 10 — Post-call workflow**
    - **Phase 10A — Wrap-up and summaries:** outcomes, notes, structured summaries, commitments, and history
    - **Phase 10B — Follow-up work:** tasks, callbacks, assignment, idempotency, and concurrency
    - **Phase 10C — Email and SMS:** provider connection, approval, policy rechecks, delivery, and opt-out handling
    - **Phase 10D — Appointments:** calendar connection, availability, approval, booking, and synchronization
- **Phase 11 — Management dashboards, reporting, and audit history**
    - **Phase 11A — Audit explorer:** protected investigation of material security and business events
    - **Phase 11B — Operational reporting:** call, queue, employee, workload, and follow-up metrics
    - **Phase 11C — Knowledge/AI reporting and hardening:** quality signals, exports, performance, and integrated Phase 11 verification
- **Phase 12 — Notifications and operational automation**
    - **Phase 12A — Durable jobs:** leasing, idempotency, retries, dead letters, replay, and operations
    - **Phase 12B — Notifications:** in-app/email delivery, preferences, quiet hours, and recipient security
    - **Phase 12C — Scheduled automation:** reminders, health checks, reconciliation, retention, and reporting jobs
- **Phase 13 — Billing, subscriptions, and SaaS administration**
    - **Phase 13A — Subscription lifecycle:** plans, trials, payments, invoices, changes, and cancellation
    - **Phase 13B — Usage and entitlements:** metering, reconciliation, limits, warnings, and enforcement
    - **Phase 13C — Internal SaaS administration:** support operations, organization lifecycle, feature flags, and audit controls
- **Phase 14 — Security, privacy, reliability, and production readiness**
    - **Phase 14A — Security and privacy verification:** integrated threat, tenant, credential, retention, and governance review
    - **Phase 14B — Reliability and recovery verification:** load, outages, backups, disaster recovery, and runbooks
    - **Phase 14C — Release and pilot readiness:** accessibility, production configuration, support ownership, and controlled pilot

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

Phase 4 is a delivery group rather than one implementation branch. It is divided into independently testable Phases 4A–4D because manual knowledge, file processing, structured offerings, and tabular imports have different data, security, recovery, and integration risks. Each subphase must satisfy the standard phase scope and leave the application usable without unfinished code paths from a later subphase.

### Shared Phase 4 outcome

- Authorized customers can enter, upload, or import business information, preview the processed structure, confirm authorization and responsibility for accuracy, and make confirmed information available to employees and later AI retrieval.
- Outreach validates ownership, structure, recognized formats, processing results, conflicts, and lifecycle state—not whether a customer claim is true or legally valid.
- Confirmation activates knowledge without requiring review by Outreach personnel.

### Shared knowledge and lifecycle rules

- Keep customer-confirmed business facts separate from platform-maintained guidance, prospect evidence, CRM history, caller statements, representative notes, live operational data, and AI inferences.
- Never silently convert prospect evidence, caller statements, representative notes, CRM data, operational data, or AI output into confirmed business facts.
- Use immutable source versions and retain the confirmer user ID, confirmation timestamp, confirmed source version, content identity/checksum, and confirmation-language version.
- Support lifecycle states appropriate to the source type, including `DRAFT`, `PROCESSING`, `NEEDS_ATTENTION`, `ACTIVE`, `SUPERSEDED`, `ARCHIVED`, and `FAILED`.
- Preview the exact version that will be confirmed before activation.
- Search, filter, preview, archive, replace, and restore versions without rewriting confirmation history.
- Retrieve active source passages with stable source, version, section, and passage references plus effective dates.
- Exclude draft, processing, needs-attention, failed, superseded, and archived content from active assistance.
- Identify missing, stale, duplicate, near-duplicate, or conflicting information for customer correction.
- Show which calls or suggestions used a knowledge version where retention policy permits.
- Apply organization-scoped authorization, tenant isolation, optimistic concurrency, safe error mapping, audit history, and the repository's documented transaction-lock order to every mutation.

### Phase 4A — Manual Business Knowledge core

#### Feature outcome

- Authorized users can create manual business knowledge, preview and confirm an immutable version, activate it, and retrieve it with traceable references.

#### Scope

- Manual editor for policies, explanations, scripts, FAQs, disclosures, objection handling, and other organization-authored reference content
- Organization-scoped logical knowledge sources and immutable source versions
- Version-scoped sections and passages with stable citation identifiers
- Draft update, preview, confirmation, activation, replacement, archive, and restore workflows
- Restore by creating a new current version rather than modifying a historical confirmed version
- Explicit server-controlled confirmation statement and confirmation-language version
- Search, filtering, deterministic ordering, pagination, effective dates, and freshness metadata
- Reusable server-side retrieval contract for active confirmed knowledge
- Permission-controlled knowledge list, editor, preview, confirmation, history, archive, and restore interfaces
- Deterministic concurrency coverage for same-version activation and membership demotion/deactivation races

#### Explicit exclusions

- File storage, document extraction, malware scanning, CSV/XLSX import, structured-offering expansion, external connectors, embeddings, and AI-generated knowledge

#### Definition of done

- An authorized owner can create and edit manual knowledge, preview the exact immutable version, explicitly confirm and activate it, retrieve it with stable source references, archive it, and verify that inactive versions are excluded from retrieval.
- Concurrent same-version activation produces exactly one success and one safe conflict without duplicate confirmations, audits, or partial writes.

### Phase 4B — Private document upload and processing

#### Feature outcome

- Authorized users can securely upload supported business documents, monitor processing, resolve structural errors, preview extracted knowledge, and confirm it through the Phase 4A lifecycle.

#### Scope

- Private organization-scoped storage paths with no public knowledge-document access
- PDF, DOCX, TXT, and explicitly supported document types
- File extension, MIME type, file-signature, size, ownership, and tenant checks
- Malware-scanning integration boundary with fail-safe activation behavior
- Text and table extraction with processing status, retry, idempotency, and recovery behavior
- Structural parsing into version-scoped sections, passages, and stable source references
- Section-level processing errors and `PROCESSING`, `NEEDS_ATTENTION`, and `FAILED` handling
- Duplicate and near-duplicate document warnings
- Replacement and archive behavior that preserves original files, extracted versions, confirmation history, and audit evidence according to retention rules
- Cleanup and recovery procedures for interrupted upload, storage, scanning, extraction, and database operations

#### Explicit exclusions

- CSV/XLSX mapping, structured-offering forms, live external connectors, embeddings, and AI-generated facts

#### Definition of done

- An authorized owner can upload a supported private document, observe its processing state, retry or correct recoverable failures, preview the extracted structure, confirm the exact processed version, and retrieve active passages with traceable references.
- Unsupported, unsafe, cross-tenant, failed, unconfirmed, and archived documents never become active knowledge.

### Phase 4C — Structured offerings and pricing

#### Feature outcome

- Authorized users can manage structured products, services, plans, packages, subscriptions, and quote-based offerings as versioned, confirmable business knowledge.

#### Scope

- Extend or reuse the Phase 3 product and service catalogues; do not introduce a second conflicting source of truth for the same organization offering
- Offering name, description, type, lifecycle status, currency, and pricing model
- Fixed, starting-at, range, recurring, usage-based, free, and quote-required pricing
- Product SKUs, variants, availability references, shipping, returns, and warranty fields
- Service areas, prerequisites, timeline, inclusions, exclusions, and add-ons
- Plan tiers, billing frequency, included quantities, limits, and cancellation terms
- Feature-comparison tables across plans and packages
- Custom typed attributes without generating a tenant-specific table
- Effective dates and immutable version history for offerings, prices, policies, and terms
- Preview, validation, conflict warnings, confirmation, activation, replacement, archive, restoration, citations, and retrieval through the shared Phase 4 lifecycle
- Deterministic ordering and concurrency behavior for offering and price changes

#### Explicit exclusions

- Spreadsheet import, live inventory/pricing synchronization, commerce connectors, and automated truth or legal review

#### Definition of done

- An authorized owner can create and version representative product, service, plan, subscription, and quote-required offerings; preview and confirm an effective version; compare supported plans; and retrieve only currently active offering facts with stable references.
- Phase 3 catalogue data remains consistent and is migrated or extended without duplicate canonical records or tenant leakage.

### Phase 4D — Tabular import and Phase 4 hardening

#### Feature outcome

- Authorized users can safely import structured knowledge and offerings from CSV/XLSX files, resolve mapping and data-quality problems, confirm the final preview, and use the complete Phase 4 workflow reliably.

#### Scope

- CSV/XLSX upload with workbook, worksheet, header, row-count, size, ownership, MIME, and signature validation
- Column mapping, saved mapping templates where appropriate, preview, and explicit unmapped-field handling
- Row-level validation and errors without partially activating invalid data
- Duplicate and near-duplicate detection across imported rows and existing active knowledge
- Warnings for conflicting active prices, policies, effective dates, identifiers, SKUs, or offering versions
- Retry and idempotency behavior that does not duplicate offerings, versions, confirmations, or audit events
- Later-ready interfaces for commerce, CRM, inventory, pricing, and scheduling connectors without implementing live connectors
- Integrated knowledge search, filtering, preview, archive, replacement, restoration, traceable retrieval, freshness, and conflict indicators across manual, document, and structured sources
- End-to-end security, tenant-isolation, concurrency, accessibility, recovery, performance, migration, and operational hardening for all Phase 4 source types

#### Definition of done

- An authorized owner can import representative CSV/XLSX offerings, map columns, resolve row and conflict errors, preview and confirm the exact resulting version, and retrieve only active data with traceable source references.
- Retrying the same import is idempotent, invalid rows cannot be partially activated, and no cross-tenant file, mapping, offering, version, or citation is accessible.

### Overall Phase 4 completion gate

- Phases 4A, 4B, 4C, and 4D meet their individual definitions of done in Staging.
- An authorized owner can enter manual knowledge, upload a supported document, and import structured offerings; resolve structural or mapping errors; confirm exact previews; and retrieve active information with stable source references.
- Draft, processing, needs-attention, failed, superseded, archived, unconfirmed, unsafe, and cross-tenant content is excluded from active assistance.
- Migrations, storage recovery, processing retries, tenant isolation, authorization, concurrency, confirmation immutability, audit behavior, and end-to-end workflows are documented and verified.

---

## Phase 5 — Prospects, consent, assignments, and CRM history

Phase 5 is delivered as Phases 5A–5D so the core CRM model, policy enforcement, work management, and bulk data movement can be migrated, secured, and reviewed independently.

### Shared Phase 5 outcome

- Employees can manage organization prospects and contacts, understand their history and assignment, and determine whether, why, when, and through which channel they may be contacted.
- Prospect identity, consent evidence, activity history, and assignments remain tenant-scoped, auditable, and safe under concurrent updates.

### Phase 5A — Prospect and contact core

#### Feature outcome

- Authorized employees can create, find, update, archive, restore, and safely merge organization prospects and their contacts.

#### Scope

- Business/contact name, phone, email, website, location, timezone, source, lifecycle status, and owner
- Multiple contacts and communication channels per prospect
- E.164 phone normalization and validated email formats while retaining appropriate display values
- Custom fields from the organization's Phase 3 template
- Duplicate and near-duplicate detection with controlled, auditable merge
- Archive and restore without destructive history loss
- Tenant-scoped search, filters, stable sorting, and pagination
- Optimistic concurrency and deterministic tests for competing updates, archive/restore, and merges
- Permission-controlled prospect list, detail, create, edit, merge, archive, and restore interfaces

#### Definition of done

- An authorized employee can manage a prospect with multiple contacts, locate it through deterministic search, safely merge a duplicate, and restore an archived record without cross-tenant access or history loss.

### Phase 5B — Consent, suppression, and contact policy

#### Feature outcome

- Outreach can make an explainable, server-authoritative decision about whether a contact may be reached through voice, SMS, or email at a given time.

#### Scope

- Channel-specific consent with source, scope, timestamp, expiry, evidence, and history
- Organization-, prospect/contact-, address/number-, and channel-level do-not-contact state
- Internal suppression lists and matching rules
- Timezone-aware contact windows and organization business rules
- Immediate revocation capture without silently rewriting earlier evidence
- A reusable server-side contact-permission decision service for later dialing and messaging
- Decision output containing allow/deny, applicable channel, evaluated time, reason codes, policy/evidence references, and permitted override requirements
- Override only when policy explicitly allows it, with authorization, reason, expiry where applicable, and audit evidence
- Concurrent consent, revocation, suppression, and override tests proving deny-safe behavior

#### Definition of done

- An authorized employee can review the evidence behind a contact decision, and the policy service blocks voice, SMS, or email when consent, suppression, time, or organization rules disallow it.
- A concurrent revocation wins safely over a stale contact attempt or override.

### Phase 5C — Assignments, work management, notes, and timeline

#### Feature outcome

- Employees can organize prospect work, collaborate through controlled notes, and understand the prospect's permitted activity history.

#### Scope

- Assignment to an employee or team, bulk assignment, and an unassigned queue
- Ownership transfer and former-employee reassignment
- Tags, lead stages, priorities, and organization-defined statuses
- Saved filters such as callbacks due, uncontacted prospects, priorities, and assigned work
- Concurrent claim/assignment protection so two employees cannot silently own the same exclusive work item
- Timestamped notes with author identity, sanitization, mention rules, and sensitive-data controls
- Controlled note correction with edit history rather than silent replacement
- Timeline contract for calls, outcomes, assignments, messages, appointments, callbacks, consent changes, and notes as those source features become available
- Pre-call brief assembled only from currently permitted prospect, consent, assignment, and history data

#### Definition of done

- An employee can claim or receive assigned work, update controlled CRM state, add and correct a note with history, and view a tenant-safe timeline and pre-call brief.
- Offboarding or reassignment cannot leave work inaccessible or assigned to an inactive member.

### Phase 5D — CRM import/export and hardening

#### Feature outcome

- Authorized users can import and export prospect data without bypassing validation, consent, suppression, tenant isolation, or audit requirements.

#### Scope

- CSV import with field mapping, preview, row-level errors, and explicit duplicate/merge choices
- Import-time normalization and suppression-list matching
- Protection against spreadsheet formula injection on import and export
- Large-import background processing, progress, retry, cancellation, and idempotency using the shared durable-job contract introduced when asynchronous processing first appears
- Import provenance, source identifiers, immutable result summary, and audit evidence
- Tenant-limited, permission-controlled exports with documented sensitive-field handling
- Phase 5 performance, accessibility, recovery, authorization, cross-tenant, and end-to-end hardening

#### Definition of done

- An authorized owner can preview and import representative prospect data, resolve invalid and duplicate rows, confirm that suppressed contacts remain blocked, and export only permitted organization data.
- Retrying an import does not duplicate prospects, consent evidence, assignments, or audit events.

### Overall Phase 5 completion gate

- Phases 5A–5D meet their individual definitions of done in Staging.
- An employee can find an assigned prospect, review its history and contact-policy decision, add a controlled note, and be blocked from calling or messaging when suppression or policy disallows it.
- All CRM reads, writes, bulk operations, exports, merges, and decisions are tenant-scoped, permission-controlled, auditable, and concurrency-safe.

---

## Phase 6 — Twilio account connection and configuration

Phase 6 is delivered as Phases 6A–6C because delegated authorization, provider-resource configuration, and credential lifecycle have different security and recovery boundaries.

### Shared Phase 6 outcome

- An authorized owner can connect the organization's Twilio account without manually sharing permanent account credentials, select permitted telephony resources, verify connection health, and disconnect safely.
- Browser calling remains Phase 7.

### Phase 6A — Twilio OAuth proof and secure connection

#### Feature outcome

- Outreach proves the supported Twilio authorization model and stores delegated authorization without exposing recoverable provider secrets to the browser.

#### Scope

- Time-boxed proof against current official Twilio capabilities before production schema and UI are finalized
- Verified scopes and operations for number discovery, Voice, messaging, recording, transcription, webhook configuration, token signing, refresh, and revocation
- “Connect Twilio” restricted to authorized organization roles
- Authorization Code flow with state, redirect allowlist, callback validation, and PKCE where supported and appropriate
- Server-only authorization-code exchange
- Managed encryption for access/refresh tokens and any recoverable provisioned credential
- Account identifier, connector identity, granted scopes, connection status, and timestamps
- CSRF, callback replay, account-substitution, cross-tenant, secret-leakage, and error-redaction tests
- No invented scopes or undocumented assumption that a delegated token can provision every required resource

#### Definition of done

- An authorized owner completes the verified authorization flow, Outreach performs an organization-bound test request, and provider secrets remain absent from browser payloads, logs, errors, and client bundles.

### Phase 6B — Resource discovery and telephony configuration

#### Feature outcome

- An owner can select verified Twilio resources and configure Outreach's inbound and outbound telephony boundaries.

#### Scope

- Eligible Twilio phone numbers and their verified capabilities
- Selection of allowed outbound caller IDs and inbound destination numbers
- TwiML application, webhook endpoint, status-callback, and environment configuration or guided setup
- Dedicated API-key provisioning only where the verified delegated authorization permits it
- Secure one-time handling and managed retention of an API-key secret only if browser Voice-token signing requires it
- Separate validation of inbound Voice, outbound Voice, recording, transcription, and messaging capabilities
- Environment-specific callbacks and prevention of Preview/Staging/Production resource confusion
- Configuration replacement and number remapping using optimistic concurrency and audit history

#### Definition of done

- An owner can view eligible numbers, select permitted resources, configure or verify required callbacks, and see an accurate capability result for each supported telephony function.

### Phase 6C — Health, refresh, disconnect, and reconnect

#### Feature outcome

- Outreach can detect, explain, recover, revoke, and replace a Twilio connection without corrupting tenant configuration or historical records.

#### Scope

- States: `NOT_CONNECTED`, `CONNECTING`, `CONNECTED`, `DEGRADED`, `EXPIRED`, `REVOKED`, and `DISCONNECTED`
- Token refresh where supported, with concurrency-safe rotation and reuse detection where applicable
- Lightweight health verification, last success, stale threshold, and sanitized recent error
- Immediate provider verification before sensitive operations when cached health is stale
- Bounded retry for transient failures and owner-facing remediation
- Disconnect impact confirmation and immediate prevention of new Voice-token issuance/provider actions
- Removal or disabling of Outreach-managed webhooks where appropriate
- Provider revocation where supported and deletion or cryptographic destruction of stored authorization
- Preservation of historical calls and audit evidence
- Reconnection and number remapping without duplicating the organization or silently reactivating old resources

#### Definition of done

- Health and degradation are visible, concurrent refresh is safe, disconnect makes authorization unusable, and reconnection restores only explicitly remapped resources while retaining permitted history.

### Overall Phase 6 completion gate

- Phases 6A–6C meet their individual definitions of done in Staging using environment-safe Twilio resources.
- An owner can connect, test, configure, monitor, disconnect, and reconnect Twilio without exposing credentials or crossing organization boundaries.

---

## Phase 7 — Browser calling

Phase 7 is delivered as Phases 7A–7E because outbound calling, inbound routing, queues, callbacks, and multi-leg transfer behavior are independently testable telephony systems.

### Shared Phase 7 outcome and call-state contract

- Authorized employees can reliably make and receive browser calls using the organization's connected Twilio account.
- Shared call states include `IDLE`, `PREPARING`, `QUEUED`, `RINGING`, `CONNECTING`, `IN_PROGRESS`, `ON_HOLD`, `TRANSFERRING`, `WRAP_UP`, `COMPLETED`, `FAILED`, `CANCELLED`, and `MISSED`.
- State transitions are server-authoritative, organization-scoped, attributable to the controlling employee, and safe against duplicate or delayed provider events.
- The browser may display optimistic progress but may not declare a provider-side terminal state without authoritative confirmation.

### Phase 7A — Call core, browser device, and outbound calling

#### Feature outcome

- An authorized employee can safely initialize a browser calling device and complete a policy-permitted outbound call.

#### Scope

- Core call, participant, call-leg, employee-control, and state-transition contracts required for outbound calls
- Voice-token issuance requiring a valid Auth.js session, active membership, calling permission, healthy Twilio connection, and permitted organization number
- Short-lived Twilio Voice tokens bound to server-derived organization and user identity
- Reauthorization before token refresh without trusting browser-supplied identity
- Safe browser-device initialization, registration, unregistration, recovery, and destruction
- Microphone granted, denied, dismissed, revoked, and unavailable states
- Audio input/output/ringtone selection, level feedback, and test audio
- Recovery from network changes, sleep/wake, token expiry, and SDK registration failure
- Prospect selection and required Phase 5 contact-policy, suppression, timezone, assignment, number, and calling-window checks immediately before dialing
- Allowed outbound caller-ID selection, pre-call brief, previous attempts, and callback commitments
- Click-to-call and policy-permitted manual dialing
- Dialing, ringing, answered, busy, declined, no-answer, voicemail, invalid-number, carrier-error, cancelled, and failed states
- Duplicate-call prevention across double clicks, retries, tabs, and idempotency keys
- Mute, keypad/DTMF, timer, notes, hang-up, voicemail outcome, and mandatory wrap-up transition

#### Definition of done

- Staging demonstrates one authorized outbound call and representative denied/failed attempts with correct policy checks, employee attribution, idempotency, device cleanup, and server-authoritative terminal state.

### Phase 7B — Inbound calling

#### Feature outcome

- Connected business numbers can route inbound calls to Outreach and present permitted caller context to an authorized employee.

#### Scope

- Inbound routing from configured organization numbers
- Caller-number matching against tenant-scoped contacts/prospects
- Known caller, unknown caller, blocked/private number, duplicate match, and multiple-match states
- Caller identity, dialed organization number, permitted history, consent notes, and relevant active knowledge
- Authorized accept/decline and caller-safe ringing behavior
- Missed, declined, abandoned, failed, and voicemail outcomes
- Confirmed creation of a new prospect/contact from an unknown caller
- After-hours, holiday, unavailable-team, and initial overflow boundaries
- Voicemail routing and handoff to the Phase 7D callback workflow when available
- Cross-tenant caller-match and simultaneous inbound-offer tests

#### Definition of done

- Staging demonstrates known and unknown inbound callers, permitted caller context, accept/decline, missed/voicemail behavior, and no cross-tenant caller or knowledge exposure.

### Phase 7C — Availability, queues, routing, and overflow

#### Feature outcome

- Outreach can offer inbound work to eligible employees through deterministic, concurrency-safe queue rules.

#### Scope

- Employee availability states: `OFFLINE`, `AVAILABLE`, `BUSY`, `WRAP_UP`, `AWAY`, and `DND`
- Queue states: waiting, offered, accepted, declined, timed out, abandoned, overflowed, and failed
- Configurable ring-all, longest-idle, round-robin, and priority routing; skills-based routing remains an explicit extension boundary until skill data exists
- Prevention of offers to revoked, inactive, offline, busy, unregistered, or otherwise ineligible employees
- Wait time, queue position where available, permitted caller context, and SLA warnings
- Maximum simultaneous calls per employee
- Permission-limited manager queue visibility
- Overflow to another queue, voicemail, approved external number, or callback offer
- Deterministic tests proving only one employee accepts an exclusive offer and routing remains correct during membership/availability changes

#### Definition of done

- Staging demonstrates a queued call offered and accepted exactly once, an abandoned/overflowed call, and immediate exclusion of an ineligible or revoked employee.

### Phase 7D — Callback lifecycle

#### Feature outcome

- Employees can create, claim, schedule, complete, cancel, and reschedule callbacks linked to the original customer context.

#### Scope

- Callback creation from missed call, voicemail, queue escape, prospect request, or employee follow-up
- Requested date/time, timezone, channel, contact, reason, assigned employee/team, and priority
- Validation against current business rules and contact policy
- Due, upcoming, overdue, completed, cancelled, failed, and rescheduled states
- Work-queue visibility and later notification integration
- One-click outbound call only after repeating all pre-dial checks
- Link from completed callback call to the originating call, queue event, or commitment
- Optimistic concurrency and deterministic claim tests preventing multiple employees from owning or completing the same exclusive callback

#### Definition of done

- An employee can claim and complete a callback from the work queue, while stale claims, concurrent completion, invalid times, and newly denied contact policy fail safely.

### Phase 7E — Hold, transfer, multi-tab, and call hardening

#### Feature outcome

- Active calls remain coherent and attributable through hold, consultation, transfer, browser interruption, and provider failure.

#### Scope

- Local hold/resume with visible permitted participant status
- Blind transfer to an employee, queue, department, or approved external number
- Warm transfer with consultation, cancellation, and return to the original caller
- Unavailable, declined, timed-out, failed, and disconnected transfer-target behavior
- Prospect context, notes, transcript continuity boundary, and correlation across call legs
- Employee control attribution for every call segment
- Explicit permission, consent, and recording behavior for external transfers
- Active-tab/device election and duplicate-device-registration protection where required
- Warning and recovery when a call is active in another tab/device
- Refresh recovery without presenting a disconnected call as active
- Browser close, lost network, provider outage, server timeout, token expiry, and webhook-delay behavior
- Idempotent hang-up and transfer commands
- End-to-end telephony accessibility and failure hardening

#### Definition of done

- Staging demonstrates hold/resume, blind transfer, warm transfer or documented supported equivalent, transfer failure recovery, multi-tab protection, and correct call-leg/employee attribution.

### Overall Phase 7 completion gate

- Phases 7A–7E meet their individual definitions of done in Staging.
- Staging demonstrates one outbound call, one inbound call, one queued call, one callback, and one transfer with correct tenant isolation, employee attribution, permissions, call states, and failure handling.

---

## Phase 8 — Call events, recording, transcription, and recovery

Phase 8 is delivered as Phases 8A–8D so provider event correctness, recording governance, transcription processing, and operational recovery can be proven separately.

### Shared Phase 8 outcome

- Provider events produce one reliable, auditable organization call record with correctly associated call legs and, when enabled, restricted recording and transcript artifacts.
- Raw provider facts remain distinguishable from derived user-facing state.

### Phase 8A — Verified webhook intake and reconciliation

#### Feature outcome

- Outreach verifies, records, deduplicates, orders, and reconciles Twilio call events without blocking provider delivery.

#### Scope

- Separate endpoints for required provider event types
- Twilio signature verification using the exact externally visible URL and required raw request representation
- Rejection of unsigned, invalid, stale, unsupported, oversized, or malformed requests
- Provider event ID, call SID, parent call SID, event type, provider timestamp, received timestamp, and sanitized raw reference
- Unique constraints, idempotency keys, quick acknowledgement, and asynchronous processing through the shared durable-job contract
- Safe handling of duplicate and out-of-order events
- Inbound, outbound, transfer, conference, and child-call-leg relationships
- Derived user-facing call state without mutation or destruction of provider facts
- Reconciliation of calls stuck in ringing, in-progress, transfer, or processing states
- Bounded retry, classified terminal failures, and inspectable dead-letter state
- Deterministic tests for duplicates, reordering, replay, concurrent workers, and cross-tenant/provider-identifier confusion

#### Definition of done

- Duplicate, delayed, and reordered test webhooks produce one coherent call and call-leg state, invalid signatures are rejected, and processing retries do not duplicate events or transitions.

### Phase 8B — Recording governance

#### Feature outcome

- Call recording follows organization policy, consent, employee permission, retention, and restricted-access requirements.

#### Scope

- Recording disabled, always-on, employee-started, and policy-triggered modes only where permitted
- Organization policy, employee permission, and applicable consent rechecks at recording commands
- Started, paused, resumed, completed, failed, unavailable, retained, and deleted states
- Restricted provider recording references and metadata without public URLs
- Separate permission checks for playback, download, retention override/legal hold, and deletion
- Retention, legal-hold, deletion, and provider-deletion reconciliation rules
- Preservation of required call records and audit evidence when recording media is deleted
- Concurrency and idempotency for start/pause/resume/delete commands and callbacks

#### Definition of done

- Authorized users can access a permitted recording while unauthorized, cross-tenant, expired, deleted, or policy-blocked access fails safely, and retention/deletion is demonstrably recoverable and auditable.

### Phase 8C — Transcription

#### Feature outcome

- Authorized users can follow live partial transcription and later use a correctly attributed, recoverable final transcript.

#### Scope

- Separate live partial and final transcript artifacts
- Speaker/participant attribution where available, with uncertainty represented explicitly
- Interim, finalizing, complete, partial, failed, unavailable, and deleted/retained states as policy requires
- Timestamps and source call-leg/segment references
- Idempotent retry without duplicate transcript passages
- Authorized correction overlays with author, timestamp, reason, and edit history; provider output remains immutable
- Configured sensitive-pattern redaction and permission-controlled search/indexing
- Transcript retention and deletion aligned with organization policy and recording relationships
- Backpressure, provider outage, partial-result, and late-final-result tests

#### Definition of done

- A test call produces usable partial and final transcript states, retries do not duplicate passages, corrections preserve original output, and access/redaction follows organization policy.

### Phase 8D — Unified timeline, replay, and recovery

#### Feature outcome

- Authorized users can understand and recover the complete call lifecycle without Outreach inventing certainty that provider evidence does not support.

#### Scope

- Dial/arrival, queue, ring, answer, hold, transfer, participant, recording, disconnect, wrap-up, and processing events
- Separate provider occurrence time, system receipt time, and derived ordering
- Explicit gaps, conflicts, and uncertainty
- Correct association of recordings, transcripts, notes, outcomes, and follow-ups with call and call leg
- Permission-controlled manual replay/reconciliation with reason and audit evidence
- Repair of stuck or partially processed calls using idempotent jobs
- Operational inspection of retries, dead letters, reconciliation decisions, and artifact failures
- Phase 8 performance, retention, tenant-isolation, recovery, and end-to-end hardening

#### Definition of done

- An authorized administrator can inspect and safely reconcile a deliberately disrupted call, while the final timeline preserves raw event evidence, uncertainty, attribution, and artifact permissions.

### Overall Phase 8 completion gate

- Phases 8A–8D meet their individual definitions of done in Staging.
- Duplicate and delayed webhooks still produce one coherent call history, and recording/transcript processing and access follow organization policy, consent, permissions, retention, and tenant boundaries.

---

## Phase 9 — Live AI assistance

Phase 9 is delivered as Phases 9A–9C so retrieval/security, the live employee experience, and model safety/evaluation can be validated independently.

### Shared Phase 9 outcome

- During a call, an employee receives timely, source-backed suggestions that clearly distinguish confirmed business facts, other source classes, caller statements, and AI inference.
- Calling remains usable when AI, retrieval, transcription, or a model provider is degraded or unavailable.

### Phase 9A — Context assembly, retrieval, and source security

#### Feature outcome

- Outreach can assemble a tenant-safe, relevance-controlled context package whose claims remain traceable to permitted sources.

#### Scope

- Active customer-confirmed business knowledge from Phase 4
- Structured offerings, current prices, effective dates, and plan comparisons
- Prospect profile, evidence, consent, previous interactions, and open commitments from Phase 5
- Current permitted call transcript and caller statements from Phase 8
- Representative notes explicitly labeled as notes
- Live operational data only when connected, permitted, and accompanied by freshness
- Role, policy, disclosure, consent, and organization constraints
- Token-budget, relevance, recency, conflict, and deterministic source-priority controls
- Exact structured values preferred over document prose for supported pricing/plan fields, without hiding conflicts
- Filtering of inaccessible sources before context reaches the model
- Prompt-injection-resistant treatment of uploaded, prospect-provided, caller-provided, CRM, and operational content as untrusted data
- Context manifest containing source class, stable source/version/passage reference, freshness, effective date, and access decision
- Cross-tenant, revoked-access, archived-source, stale-source, and malicious-source tests

#### Definition of done

- Given representative business knowledge, prospect evidence, transcript statements, and an injected malicious instruction, the context service returns only permitted source material with traceable classifications and does not execute or elevate source text as system instruction.

### Phase 9B — Live assistance experience

#### Feature outcome

- An employee can request and use live assistance without leaving the call workspace or confusing suggestions with authoritative facts.

#### Scope

- Suggested answers to the caller's current question
- Offering or plan comparisons
- Qualification-question suggestions
- Required-disclosure reminders
- Objection-handling guidance
- Information-gap, unsupported-claim, stale-source, and conflicting-source warnings
- Next-best-action suggestions that remain advisory
- Search and open cited sources without leaving the call workspace
- Employee feedback: useful, incorrect, outdated, missing source, or unsafe
- Clear sourced-fact, caller-statement, representative-note, operational-data, and inference presentation
- Material factual claims linked to source class and source version
- Freshness display for time-sensitive information
- Supersession when newer conversation context makes a suggestion obsolete
- Accessible streaming/loading, cancellation, empty, partial, and error states

#### Definition of done

- During a Staging test call, an employee requests assistance, receives a structured suggestion with usable citations and limitations, opens the cited source, and records feedback without interrupting the call.

### Phase 9C — AI safety, evaluations, performance, and degradation

#### Feature outcome

- AI assistance is schema-constrained, measurable, resistant to unsafe source content, and incapable of silently performing material external actions.

#### Scope

- Explicit model/provider configuration, data-handling boundary, supported regions, timeout, rate limit, and fallback policy
- Server-validated output schemas instead of trusted free-form model text
- AI cannot dial, transfer, hang up, send a message, book an appointment, change consent, or make a material CRM update without a separate authorized human-confirmed operation
- No automatic promotion of caller statements, prospect evidence, representative notes, or AI output into permanent business knowledge
- Logs for source IDs, model/config version, latency, outcome, and employee disposition without unnecessary hidden reasoning or prohibited sensitive content
- Evaluation fixtures for citations, source separation, conflicts, unsupported claims, required disclosures, injection attempts, and action-boundary violations
- Partial transcript, no-source, conflict, stale data, timeout, rate-limit, retrieval failure, low-confidence, and superseded-suggestion behavior
- Cost/token-budget controls, cancellation, bounded retries, and circuit-breaker/degraded behavior
- AI unavailability must not prevent core calling, wrap-up, or manual knowledge access

#### Definition of done

- Safety/evaluation tests demonstrate valid structured output, citation coverage, source separation, injection resistance, no unauthorized action, and a usable degraded calling experience during model/retrieval failure.

### Overall Phase 9 completion gate

- Phases 9A–9C meet their individual definitions of done in Staging.
- An employee can request help during a test call and receive a structured, timely suggestion with citations and limitations, while unsafe or unavailable AI cannot perform an external action or block calling.

---

## Phase 10 — Post-call workflow

Phase 10 is delivered as Phases 10A–10D because internal wrap-up, work records, outbound communications, and calendar booking have distinct authorization and provider side-effect boundaries.

### Shared Phase 10 outcome

- After a call, the employee can review accurate outputs, record the outcome, and explicitly approve follow-up actions without re-entering the entire conversation.
- AI-generated content and inferred commitments remain drafts until an authorized employee confirms them.

### Phase 10A — Wrap-up, outcomes, summaries, and commitments

#### Feature outcome

- An employee can complete an auditable wrap-up and confirm a structured summary without losing original call evidence or confusing AI proposals with facts.

#### Scope

- Mandatory or configurable disposition selection
- Connected, no-answer, busy, voicemail, wrong number, not interested, qualified, callback requested, appointment proposed, sale/converted, do-not-contact, and organization-defined outcomes
- Notes, tags, lead-stage update, assignment change, wrap-up timer, and manager-configurable requirements
- Autosave/recovery and prevention of unsaved wrap-up loss
- Permission-controlled correction with edit history
- Structured draft summary after transcript finalization or from explicitly available context
- Separate facts discussed, customer needs, objections, decisions, proposed commitments, confirmed commitments, and unanswered questions
- Transcript timestamps and source references where available
- Employee review before summary confirmation
- Original generated version, employee edits, and confirmation metadata retained where policy permits
- Idempotency for transcript/provider/AI retries and optimistic concurrency for competing wrap-up edits

#### Definition of done

- An employee completes wrap-up, reviews and edits a source-linked summary, confirms valid commitments, and later corrections preserve the original generated and confirmed history.

### Phase 10B — Follow-up tasks and callbacks

#### Feature outcome

- Confirmed follow-up work becomes an assigned, trackable task or Phase 7 callback without duplication from retries.

#### Scope

- Task title, owner, due date/time, timezone, priority, related organization/prospect/call, reminder, and source commitment
- Callback creation through the Phase 7D model rather than a parallel callback implementation
- Due, upcoming, overdue, complete, rescheduled, reassigned, cancelled, and failed states
- Active-member assignment and former-employee reassignment behavior
- Idempotency keys linking automatic proposals and confirmed task creation to call/commitment versions
- Deterministic concurrency for claim, completion, reschedule, reassignment, and cancellation
- Work-queue and later notification integration

#### Definition of done

- An employee confirms one task and one callback from a call, retries create no duplicates, and concurrent reassignment/completion resolves safely with full attribution.

### Phase 10C — Approved email and SMS delivery

#### Feature outcome

- An employee can review and explicitly send a permitted email or SMS through a documented provider connection with execution-time policy checks.

#### Provider prerequisite

- Before implementation, select and document the supported email provider, SMS provider, account ownership, delegated authorization or credential model, required scopes, webhook verification, environment separation, disconnect behavior, data handling, and delivery limitations.
- Reuse the verified Twilio connection for SMS only if Phase 6 proves the required messaging capability and authorization. Do not assume Voice authorization automatically permits messaging.

#### Scope

- Draft generation only from confirmed call context and permitted business knowledge
- Recipients, server-derived sender identity, subject where applicable, content, channel, current consent decision, and cited basis where useful
- Explicit employee confirmation immediately before sending
- Server-side membership, permission, recipient, sender, consent, suppression, and idempotency rechecks inside the external-action boundary
- Sent, accepted, delivered, failed, bounced, replied, and opted-out states where supported
- Verified and idempotent provider callbacks with tenant-safe correlation
- Immediate opt-out/revocation propagation into Phase 5 contact policy
- Retry classification that never duplicates a successfully accepted external message
- No send solely because a model, webhook, retry, or browser claims it was approved

#### Definition of done

- In Staging, an employee reviews and sends one permitted draft, a denied or revoked contact cannot be sent to, duplicate execution is prevented, and provider status/opt-out callbacks update the correct tenant record.

### Phase 10D — Approved appointments and calendar integration

#### Feature outcome

- An employee can view permitted availability and explicitly book, reschedule, or cancel an appointment tied to the prospect and confirmed call commitment.

#### Provider prerequisite

- Before implementation, select and document supported calendar provider(s), OAuth/delegated authorization, whether connections belong to an organization or employee, required scopes, calendar selection, webhook/synchronization behavior, token storage/refresh/revocation, environment separation, and disconnect behavior.

#### Scope

- Permission-limited calendar availability without exposing unrelated private event details
- Proposed time slots during or after a call
- Confirmed attendee, timezone, duration, purpose, location/link, calendar, and reminders
- Explicit employee confirmation before provider booking
- Execution-time membership, permission, consent, attendee, calendar, and availability rechecks
- Conflict, changed availability, provider failure, declined invitation, cancellation, and rescheduling behavior
- Prospect, call, employee, source commitment, provider event, and version linkage
- Idempotent provider commands and verified callbacks/synchronization
- Safe disconnect and former-employee calendar reassignment behavior

#### Definition of done

- In Staging, an employee views permitted availability, explicitly books and reschedules an appointment, a concurrent conflict fails safely, and provider records remain correctly correlated without exposing unrelated calendar data.

### Overall Phase 10 completion gate

- Phases 10A–10D meet their individual definitions of done in Staging.
- An employee completes wrap-up, confirms a summary and follow-up work, and approves representative external communication and appointment actions with all authorization, consent, idempotency, and provider checks repeated at execution time.

---

## Phase 11 — Management dashboards, reporting, and audit history

Phase 11 is delivered as Phases 11A–11C. Earlier phases must already emit their audit and metric-producing domain events; Phase 11 provides permission-controlled investigation, aggregation, and presentation rather than recreating missing evidence.

### Shared Phase 11 outcome

- Authorized managers understand operations, employee activity, call outcomes, queue performance, follow-up completion, and knowledge gaps without crossing privacy, retention, or role boundaries.
- Every displayed metric has a documented definition, timezone, denominator, freshness, and permitted route back to supporting records.

### Phase 11A — Audit-history explorer

#### Feature outcome

- Authorized owners and auditors can investigate material activity using immutable, tenant-scoped audit evidence produced by earlier phases.

#### Scope

- Login and session-security events
- Membership, role, invitation, and offboarding changes
- Twilio connection, disconnection, credential lifecycle, and configuration changes
- Knowledge creation, upload, processing, confirmation, replacement, restoration, and archive events
- Prospect merge, consent, suppression, override, recording, retention, and deletion changes
- Calls, transfers, summaries, external-action approvals, provider callbacks, imports, exports, and organization closure events
- Actor, effective actor, organization, action, target type/ID, time, result, reason, and correlation ID
- Permission-limited search, filters, pagination, export boundary, and sensitive-field redaction
- Tamper-resistant write/access controls and no browser-authored audit identity or result
- Trace from audit entry to a permitted current or historical target without bypassing target authorization

#### Definition of done

- An owner can investigate representative security, membership, knowledge, consent, calling, and external-action changes while an unauthorized or cross-tenant user cannot enumerate audit metadata.

### Phase 11B — Operational dashboards and performance reporting

#### Feature outcome

- Managers can view explainable operational and workload metrics whose totals reconcile to permitted source records.

#### Scope

- Calls by inbound/outbound direction and outcome
- Connected, missed, abandoned, failed, and callback rates
- Queue volume, wait time, answer time, abandonment, overflow, and SLA indicators
- Employee availability, active calls, wrap-up, workload, and follow-up completion
- Upcoming and overdue callbacks/tasks
- Twilio connection, webhook, job, recording, transcription, and AI processing health
- Filters by date, organization timezone, employee, team, campaign/source, number, queue, and disposition
- Call count, duration, answer rate, outcome distribution, and follow-up completion
- Conversion measures only when the organization defines the qualifying outcome and denominator
- Explicit timezone, inclusion/exclusion, late-event, backfill, freshness, and denominator definitions
- Role-limited drill-down and export
- Suppression of misleading comparisons or rankings when volume, attribution, permissions, or data quality is insufficient
- Aggregation/backfill jobs that are idempotent and reconcile against authoritative records

#### Definition of done

- A manager can filter and reconcile representative call, queue, workload, and follow-up metrics to permitted source records with documented definitions and no cross-tenant or restricted-employee exposure.

### Phase 11C — Knowledge/AI reporting and reporting hardening

#### Feature outcome

- Managers can identify knowledge quality and AI-assistance gaps without treating model confidence as an employee-performance verdict.

#### Scope

- Most-used sources and offerings
- Unanswered-question and missing-information clusters
- Conflicting, stale, failed, or superseded knowledge indicators
- Employee feedback on suggestions
- Citation coverage and unsupported-claim warnings
- Model/retrieval failure, latency, cancellation, and degraded-mode trends
- Explicit prohibition on using AI confidence alone as an employee-performance score
- Privacy/retention-aware aggregation of transcript and suggestion evidence
- Permission-controlled reporting exports with spreadsheet-injection protection
- Query performance, caching, freshness, late-event correction, backfill, accessibility, and Staging-volume hardening

#### Definition of done

- A manager can investigate a knowledge/AI quality signal back to permitted sources and feedback, exports are safe and tenant-scoped, and the UI clearly communicates freshness, limitations, and insufficient data.

### Overall Phase 11 completion gate

- Phases 11A–11C meet their individual definitions of done in Staging.
- A manager can investigate an operational metric back to permitted source records, and an owner can audit material configuration, access, consent, provider, and external-action changes.

---

## Phase 12 — Notifications and operational automation

Phase 12 is delivered as Phases 12A–12C. Earlier asynchronous features must already use a minimum shared job contract; Phase 12A consolidates, generalizes, and operationally hardens that contract rather than postponing reliable background execution until this phase.

### Shared Phase 12 outcome

- Outreach reliably reminds the right people about time-sensitive work and automates internal preparation and maintenance without autonomously performing material external actions.

### Phase 12A — Durable job platform

#### Feature outcome

- All supported background work uses one observable, concurrency-safe execution contract with reliable retry and recovery behavior.

#### Scope

- Inventory and migration of job primitives introduced by document processing, imports, webhooks, transcription, provider callbacks, and reporting
- Stable job type, versioned payload schema, tenant context, correlation ID, priority, schedule, attempt count, and idempotency key
- Lease/lock or claim model preventing two workers from executing the same job concurrently
- Observable queued, scheduled, running, succeeded, retrying, failed, cancelled, and dead-letter states
- Heartbeat/lease expiry and recovery from worker termination
- Bounded retry with jitter, provider-aware backoff, and retryable/non-retryable classification
- Inspectable failure details with secret and sensitive-data redaction
- Permission-controlled replay, cancellation, dead-letter handling, and operational dashboards
- Per-tenant fairness, concurrency limits, backpressure, and environment isolation
- Transactional enqueue/outbox or equivalent protection where a database write must reliably cause asynchronous work
- Idempotency for every job that can create or mutate a record, artifact, notification, metric, or provider action

#### Definition of done

- Concurrent workers execute one logical job once, worker termination recovers after lease expiry, a terminal failure is inspectable/replayable, and retries do not duplicate database or provider effects.

### Phase 12B — Notification centre and delivery

#### Feature outcome

- The correct user receives one timely, permission-safe notification through configured channels and preferences.

#### Scope

- In-app notification centre with unread/read state, deterministic pagination, and retention behavior
- Email notification delivery and preferences through a documented provider boundary
- Callback due, task due, appointment change, missed inbound call, voicemail, queue escalation, failed integration, knowledge-processing, billing, and administrative alerts
- Role-targeted and organization-targeted administrative notifications
- Immediate versus digest preferences
- Quiet hours, timezone, locale, and accessibility behavior
- Recipient membership/permission recheck before displaying sensitive content or delivering external notification details
- Deduplication, retry-safe delivery, provider status, bounce/failure, and preference-change races
- Safe links that reauthorize access to the target rather than embedding protected data

#### Definition of done

- A due callback creates one notification for the correct eligible recipient, quiet-hour/digest preferences are respected, retries do not duplicate delivery, and revoked users cannot open protected targets.

### Phase 12C — Scheduled operational automation

#### Feature outcome

- Outreach runs recurring internal maintenance and preparation jobs predictably while preserving human approval for material external actions.

#### Scope

- Callback and task reminders
- Twilio connection health checks
- Stuck-call reconciliation
- Recording, transcript, and knowledge processing/repair
- Knowledge-staleness reminders
- Retention, deletion, and legal-hold enforcement
- Failed-event retry and dead-letter escalation
- Metrics aggregation, backfill, and scheduled reports
- Appointment synchronization and provider-health maintenance where configured
- Per-organization schedules, timezone rules, pause/resume, and safe configuration changes
- Human confirmation remains required for outbound messages, appointments, commitments, consent changes, and material CRM changes
- No automation may silently broaden permissions, bypass suppression, or transform AI/caller/prospect content into confirmed facts

#### Definition of done

- Representative scheduled jobs run at the correct tenant-local time, are idempotent and observable, recover from failure, and never perform a material external action without the required approval boundary.

### Overall Phase 12 completion gate

- Phases 12A–12C meet their individual definitions of done in Staging.
- A due callback produces exactly one correct notification, a failed job is inspectable and recoverable, and retries or recurring schedules do not duplicate records or external actions.

---

## Phase 13 — Billing, subscriptions, and SaaS administration

Phase 13 is delivered as Phases 13A–13C because payment lifecycle, usage enforcement, and internal platform administration have separate financial, authorization, and operational risks.

### Shared Phase 13 outcome

- Outreach can operate commercially with controlled subscriptions, entitlements, limits, organization lifecycle, and internal support tools.
- Billing-provider facts, internal usage estimates, and effective entitlements remain distinguishable and server-authoritative.

### Phase 13A — Plans, subscriptions, and payment lifecycle

#### Feature outcome

- An organization can start a trial, subscribe, change plan, recover from payment failure, cancel, and retain required account access.

#### Provider prerequisite

- Select and document the billing provider, account/environment ownership, product/price mapping, checkout/customer-portal approach, webhook signatures, event versions, tax responsibility, supported currencies/regions, idempotency, reconciliation, and disconnect/migration strategy before implementation.

#### Scope

- Trial, active, past-due, grace-period, suspended, cancelled, and closed states
- Server-owned plan and price identifiers
- Upgrade, downgrade, cancellation, renewal, failed-payment, and reactivation behavior
- Proration and effective-date behavior through the chosen provider
- Billing contact, invoice access, tax/business information, and payment-method management through provider-safe interfaces
- Verified, idempotent, duplicate/out-of-order-safe billing webhooks
- Reconciliation between provider subscription state and Outreach state
- Customer self-service and owner authorization without exposing billing secrets
- Preservation of required billing, export, and closure access during restricted states
- No trust in browser-supplied customer, subscription, plan, price, payment, or entitlement values

#### Definition of done

- A Staging organization starts a trial, subscribes, experiences a controlled payment failure/grace state, changes plan, and cancels with webhook retries/reordering producing one coherent subscription history.

### Phase 13B — Usage, entitlements, and limit enforcement

#### Feature outcome

- Outreach measures selected usage and enforces plan entitlements consistently without unsafe interruption of active customer interactions.

#### Scope

- Entitlements for seats, connected numbers, call usage, recordings, transcription, AI usage, storage, retention, and imports where commercially required
- Metering for the selected billable units with stable event identity and effective time
- Separation of provider-reported usage, internally observed usage, adjustments, and estimates
- Idempotent aggregation, correction, late-event, backfill, and reconciliation behavior
- Server-side entitlement checks at every protected feature boundary
- Warning thresholds and documented soft versus hard limits
- Safe downgrade behavior when existing resources exceed new limits
- No termination of an active emergency or customer call solely because a limit is crossed; apply the documented post-call/restricted-state policy
- Access to billing, permitted export, support, and closure functions during restricted states
- Concurrency tests for seat claims, usage increments, plan changes, and entitlement refresh

#### Definition of done

- A test organization receives accurate usage and warnings, concurrent usage is not double-counted, plan changes update effective entitlements safely, and limits cannot be bypassed through browser or stale-session values.

### Phase 13C — Internal SaaS administration

#### Feature outcome

- Explicitly authorized Outreach operators can support organization lifecycle and platform health without silently bypassing tenant controls or audit evidence.

#### Scope

- Organization search by stable identifiers without broad sensitive-data exposure
- Subscription, connection, job, processing, and provider-health views
- Support-triggered session revocation and integration reset through permission-controlled, reason-required actions
- Organization suspension, restoration, export, and closure workflows
- Feature flags and controlled rollout by environment or organization
- Separation of internal platform roles from customer organization roles
- Just-in-time/high-risk confirmation for destructive or access-affecting actions
- Impersonation avoided by default; if later approved, require customer consent or documented authority, visible banner, limited scope, short expiry, revocation, and immutable audit trail
- No internal tool may query or mutate tenant data outside its explicit support purpose or bypass audit logging
- Concurrency, mistaken-target, cross-tenant, revoked-operator, export, suspension, restoration, and closure recovery tests

#### Definition of done

- An authorized operator can diagnose a test organization and perform a reasoned support action, while unauthorized operators, stale approvals, mistaken targets, and silent tenant access fail safely and remain auditable.

### Overall Phase 13 completion gate

- Phases 13A–13C meet their individual definitions of done in Staging.
- A test organization can start a trial, subscribe, encounter a controlled payment failure, change plan, reach a usage limit, and cancel without losing required billing, export, support, or historical-account access.

---

## Phase 14 — Security, privacy, reliability, and production readiness

Phase 14 is delivered as three final verification workstreams rather than ordinary feature branches. Security, privacy, reliability, recovery, accessibility, and audit controls must already exist in the phases that introduced each feature; Phase 14 validates the integrated system, closes findings, and proves operational readiness.

### Shared Phase 14 outcome

- The complete system is ready for controlled customer use with verified tenant isolation, provider security, privacy governance, recovery behavior, production configuration, and operational ownership.
- A failed Phase 14 finding is fixed in the owning feature or shared foundation, then retested here; it is not hidden by changing acceptance criteria.

### Phase 14A — Final security and privacy verification

#### Feature outcome

- Independent integrated review verifies that protected data, credentials, actions, and tenant boundaries remain secure across the complete application.

#### Scope

- Threat models for authentication, tenant boundaries, invitations, offboarding, Twilio OAuth, Voice tokens, webhooks, uploads, retrieval, AI tools, jobs, provider callbacks, exports, billing, and internal administration
- Penetration testing of cross-tenant object access, privilege escalation, confused-deputy behavior, stale sessions, callback substitution, and internal-role boundaries
- Client bundle, log, error tracker, job payload, provider metadata, database snapshot, export, and build-artifact secret/sensitive-data review
- CSRF, XSS, SSRF, SQL injection, open redirect, request-smuggling boundary, webhook forgery, prompt injection, file upload, and spreadsheet-injection review
- Least privilege for database users, storage, Twilio/provider scopes, model access, job workers, support tools, billing, and deployment credentials
- Documented secret and encryption-key rotation with recovery and rollback behavior
- Employee/operator revocation during active sessions, token refresh, call activity, queued work, provider actions, and notification access
- Data inventory covering category, purpose, legal/customer responsibility boundary, access, region, retention, deletion, export, and subprocessors
- Organization-configurable recording/transcript retention within supported policy bounds
- Prospect and organization access/export/correction/deletion/closure flows where applicable
- Legal-hold and deletion-exception behavior where required
- Sensitive-field redaction and restricted transcript/recording/knowledge access
- Customer-visible consent, recording, AI, and business-knowledge responsibility language

#### Definition of done

- High/critical security and privacy findings are resolved; remaining findings have explicit owner, severity, evidence, deadline, and formal risk acceptance where permitted.
- Integrated tenant, privilege, revocation, secret, retention, deletion, export, and provider-boundary tests pass against the release candidate.

### Phase 14B — Reliability, load, backup, and disaster recovery

#### Feature outcome

- Outreach meets documented reliability targets and can recover predictably from infrastructure, provider, processing, and deployment failures.

#### Scope

- Load and concurrency tests for login, dashboards, prospect search, queue offers, Voice-token issuance, call commands, webhook ingestion, document/import processing, reporting, notifications, and AI assistance
- Simulated Twilio, database, storage, email, SMS, calendar, billing, job-worker, and AI/retrieval outages
- Graceful degradation proving core calling does not depend on AI availability and protected data does not become less secure during failure
- Database backup restoration, point-in-time recovery where configured, storage/database consistency recovery, and migration roll-forward/rollback procedures
- Recovery time and recovery point objectives for critical data and workflows
- Service-level indicators and objectives for authentication, call setup, webhook delay, queue delay, job success, document/transcript processing, provider action, and notification delivery
- Capacity thresholds, alerting, backpressure, circuit breakers, retry storms, dead-letter growth, and tenant fairness
- Runbooks for degraded Twilio/provider connections, stuck calls, failed webhooks/jobs, compromised credentials, tenant incidents, mistaken deletion, and data restoration
- Game-day exercises with recorded timestamps, decisions, gaps, owners, and follow-up fixes

#### Definition of done

- The release candidate meets agreed load and recovery targets, backup restoration is demonstrated, provider outages degrade safely, and operational owners successfully execute representative incident runbooks.

### Phase 14C — Accessibility, production configuration, and controlled pilot

#### Feature outcome

- Production configuration and primary user journeys are verified, support ownership is ready, and a controlled pilot can proceed with explicit go/no-go criteria.

#### Scope

- Accessibility review of primary owner, manager, employee, and support workflows
- Supported browsers, microphone/headset combinations, permission changes, network transitions, multiple tabs/devices, and sleep/wake behavior
- Staging E2E journeys for owner, manager, active employee, revoked employee, unknown inbound caller, consent denial, provider degradation, and recovery
- Production review of environment variables, encryption keys, OAuth callbacks, webhook URLs, phone numbers, sender identities, calendar/billing configuration, domains, storage, retention, and feature flags
- Monitoring, alert ownership, on-call/escalation path, status/support communication, and customer-support documentation
- Migration order, rollback point, deployment smoke tests, release checklist, and responsible approvers
- Controlled pilot organization, isolated resources, representative data, acceptance scenarios, feedback path, support coverage, rollback criteria, and expansion criteria
- Explicit go/no-go decision record and no broad availability before pilot acceptance

#### Definition of done

- Production configuration is independently verified, accessibility and supported-device findings meet the release threshold, pilot acceptance tests pass, support owners can follow documented procedures, and the go/no-go decision is recorded.

### Overall Phase 14 completion gate

- Phases 14A–14C meet their individual definitions of done against one identified release candidate.
- Security and recovery findings are resolved or formally risk-accepted, production configuration is verified, controlled-pilot acceptance passes, and operational owners can execute documented incident, recovery, support, and rollback procedures.

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

Recommended delivery order after Phase 3:

1. Phase 4A → 4B → 4C → 4D
2. Phase 5A → 5B → 5C → 5D
3. Phase 6A proof and secure connection → 6B resources → 6C lifecycle
4. Phase 7A outbound core → 7B inbound → 7C queues → 7D callbacks → 7E transfer/hardening
5. Phase 8A events/reconciliation → 8B recording → 8C transcription → 8D timeline/recovery
6. Phase 9A context/security → 9B assistance experience → 9C safety/evaluations
7. Phase 10A wrap-up → 10B tasks/callbacks → 10C email/SMS → 10D calendar
8. Phase 11A audit explorer → 11B operations reporting → 11C knowledge/AI reporting
9. Phase 12A shared job hardening → 12B notifications → 12C scheduled automation
10. Phase 13A subscriptions → 13B metering/entitlements → 13C SaaS administration
11. Phase 14A security/privacy, Phase 14B reliability/recovery, and Phase 14C release/pilot against the same release candidate

The sequence describes dependency order, not a requirement that one automation implement an entire subphase. Split a subphase further when it contains independent migrations, provider proofs, high-risk authorization boundaries, background processing, or concurrency protocols. Do not create empty future abstractions merely to match later phases.

## 6. Phase gate rule

A numbered subphase is ready to close only when its definition of done is demonstrated in Staging, its migrations are reproducible, its server authorization is tested, known failures are documented, and the feature can be used without relying on an unimplemented later subphase except where it explicitly declares an integration boundary.

An umbrella phase is ready to close only when every included subphase and the umbrella's overall completion gate pass against compatible merged code. Phase 14 workstreams must assess the same identified release candidate.
