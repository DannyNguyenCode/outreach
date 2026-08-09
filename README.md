# Outreach

Outreach is a hosted, multi-tenant calling workspace that helps representatives prepare for conversations, use source-backed assistance during calls, and complete accurate follow-up work afterward.

Twilio provides the communication infrastructure. Outreach owns the business context, customer records, permissions, call workflow, AI assistance, follow-up actions, and audit history surrounding each interaction.

> Project status: Phase 0 foundation in progress. See [`docs/phase-0-setup.md`](./docs/phase-0-setup.md) for local setup, environment variables, Prisma, and verification commands.

## Product vision

Outreach brings the information and actions surrounding a customer conversation into one workspace:

| Stage | Outreach provides |
|---|---|
| Before | Prospect details, consent status, interaction history, business knowledge, evidence, qualification criteria, and a pre-call brief |
| During | Browser calling, live notes, transcript context, source-attributed suggestions, confidence warnings, disclosures, and appointment availability |
| After | Reviewable summaries, outcomes, commitments, follow-up tasks, message drafts, appointments, status updates, and analytics |

The representative remains responsible for the conversation. AI is an assistant, not an autonomous authority. Material actions require confirmation from an authorized person.

## Core product model

- Outreach is a plug-and-play SaaS; customers do not connect or manage their own database.
- Each customer has an organization with isolated users, roles, permissions, prospects, knowledge, calls, and settings.
- Owners connect the organization's Twilio account through OAuth. Employees do not need Twilio accounts.
- Customers upload or enter their own business knowledge and confirm its accuracy.
- Outreach validates uploaded knowledge for structure and usability, not whether the customer's claims are true.
- Business templates guide onboarding without creating a different database schema for each industry.
- Browser calling is authorized only when the user session, organization membership, calling permission, and Twilio connection are all active.

## Planned architecture

| Area | Technology or responsibility |
|---|---|
| Application | Next.js App Router, React, TypeScript, Node.js |
| Interface | Tailwind CSS with optional DaisyUI components |
| Authentication | Auth.js with Credentials sign-in and database-backed sessions |
| Passwords | Server-side Argon2id hashing; plaintext passwords are never stored |
| Data | Outreach-managed Supabase Postgres |
| Files | Private Supabase Storage buckets |
| Database access | One selected ORM and Auth.js adapter strategy; Prisma or Drizzle, not both by default |
| Telephony | Twilio Voice JavaScript SDK and Twilio Node SDK |
| Integration | Organization-level Twilio OAuth, signed webhooks, and short-lived employee Voice tokens |
| Authorization | Authenticated server operations with organization membership and capability checks |
| AI | Source-attributed assistance with confidence, unsupported-claim, and information-gap handling |

Supabase Auth is not part of the architecture. Auth.js is authoritative for application identity and sessions; Supabase provides hosted PostgreSQL, storage, backups, and related data services.

## Security boundaries

Authentication alone never grants access to organization data. Each protected server operation must establish:

```text
valid Auth.js session
+ active organization membership
+ requested organization matches the resource
+ required capability
= authorized operation
```

Additional rules:

- Every organization-owned record includes `organization_id`.
- The browser does not query protected tenant tables directly.
- IDs, roles, and organization values submitted by the browser are never trusted on their own.
- Twilio refresh tokens and other recoverable credentials are encrypted and remain server-only.
- The browser receives only short-lived, identity-bound Twilio Voice tokens.
- Offboarding revokes database sessions, calling access, queue presence, and future token issuance while preserving historical attribution.
- Provider webhooks require signature verification, idempotency, duplicate handling, retry safety, and reconciliation.
- AI-generated messages, appointments, commitments, and material status changes remain drafts until confirmed.

## Source-of-truth model

Outreach keeps these source classes distinct:

1. Customer-confirmed business knowledge
2. Structured offerings, prices, policies, and service details
3. Prospect-specific evidence
4. CRM and interaction history
5. Statements made during the current conversation
6. Representative notes
7. Live operational systems
8. AI inference

Business-type templates define what information to collect, but template examples never become customer facts. Customer confirmation activates uploaded knowledge after structural validation.

## Implementation roadmap

Development is divided into vertical feature phases. Each phase includes its interface, user input, database changes, authorization, validation, error states, tests, and deployment checks.

| Phase | Deliverable |
|---:|---|
| 0 | Repository, testing, database migration, and deployment foundation |
| 1 | Registration, verification, login, recovery, and database sessions |
| 2 | Organizations, employees, roles, invitations, and offboarding |
| 3 | Business onboarding and organization configuration |
| 4 | Business Knowledge, uploads, validation, and structured offerings |
| 5 | Prospects, consent, assignments, imports, and CRM history |
| 6 | Twilio OAuth connection, phone configuration, health, and disconnect/reconnect |
| 7 | Browser calling: outbound, inbound, availability, queues, callbacks, hold, and transfers |
| 8 | Call events, recordings, transcription, state recovery, and reconciliation |
| 9 | Live AI assistance with citations, confidence, and safety controls |
| 10 | Post-call outcomes, summaries, tasks, messages, and appointments |
| 11 | Agent and manager dashboards, reporting, and audit history |
| 12 | Notifications, durable jobs, retries, and operational automation |
| 13 | Plans, billing, usage limits, subscriptions, and SaaS administration |
| 14 | Security, privacy, reliability, accessibility, performance, and production readiness |

See [`outreach-implementation-phases.md`](./outreach-implementation-phases.md) for the detailed feature decomposition and phase gates.

## Development with Cursor Automation

Cursor Automation should implement small, reviewable tasks within one phase rather than attempt the complete platform in a single run.

Each task must define:

- Objective and requirement IDs
- Files or subsystems allowed to change
- Explicit exclusions
- Database migration and data implications
- Authentication and authorization requirements
- Failure, retry, and recovery behavior
- Tests and commands that must run
- Expected evidence and definition of done

Each completed task should report:

- Requirements addressed
- Files and migrations changed
- Tests added and actual results
- Screenshots for important interface states
- Assumptions and unresolved risks
- Manual configuration still required

Foundational areas such as the core schema, authentication middleware, authorization helpers, generated database types, Twilio connection model, and environment validation should not be modified by competing automation tasks at the same time.

## Phase completion rule

A phase is complete only when:

- Its end-to-end user journey works in Staging.
- Required migrations and recovery procedures are documented.
- Authorization and cross-tenant tests pass.
- Expected failure and retry states are implemented.
- Linting, type checking, automated tests, and builds pass.
- Important UI states have been reviewed.
- Known risks and deferred items are recorded.

Passing a build alone is not evidence that tenant isolation, OAuth, webhook verification, session revocation, call recovery, or AI attribution works correctly.

## Environments

The planned environments are:

| Environment | Purpose |
|---|---|
| Local | Development and automated testing |
| Preview | Branch and pull-request verification |
| Staging | Supabase, Twilio, migrations, and end-to-end integration testing |
| Production | Real organizations, employees, prospects, and calls |

Production credentials and customer data must never be used for agent experimentation or routine development tests.

## Configuration principles

- Secrets belong in the deployment platform's environment management, never in prompts, repository files, screenshots, fixtures, or logs.
- `.env.example` will contain variable names and fake values only.
- Server-only and client-safe configuration must be validated separately.
- Local, Preview, Staging, and Production should use separate provider resources and encryption keys where practical.
- Important schema changes must use version-controlled migrations rather than dashboard-only edits.

### Phase 0 stack decisions

| Area | Choice |
|---|---|
| Runtime | Node.js 22 LTS (`.nvmrc`) |
| Package manager | npm |
| Framework | Next.js App Router + React + TypeScript (strict) |
| Styling | Tailwind CSS (no DaisyUI in Phase 0) |
| ORM | Prisma → Supabase-hosted PostgreSQL |
| Env validation | Zod (`lib/env`) |
| Unit / component tests | Vitest + React Testing Library |
| End-to-end tests | Playwright |
| CI | GitHub Actions (`.github/workflows/ci.yml`) |

Database URLs:

- `DATABASE_URL` — pooled connection for application runtime
- `DIRECT_URL` — direct connection for Prisma migrations

Quick start:

```bash
npm ci
cp .env.example .env.local
npm run dev
npm run verify
npm run test:e2e
```

Full developer instructions: [`docs/phase-0-setup.md`](./docs/phase-0-setup.md).

## Project documents

- [`requirements.md`](./requirements.md) — product source of truth, acceptance criteria, priorities, and requirement IDs
- [`outreach-implementation-phases.md`](./outreach-implementation-phases.md) — detailed 15-phase feature plan and Cursor Automation boundaries
- [`docs/phase-0-setup.md`](./docs/phase-0-setup.md) — Phase 0 local setup and verification

If documents conflict, `requirements.md` defines product behavior. The implementation phases define build order and decomposition, and this README serves as the project entry point.

## Current next step

Complete Phase 0 review, then begin Phase 1 (Auth.js registration, verification, login, recovery, and database sessions).

