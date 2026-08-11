# Outreach — Phase 3A Business Onboarding

Phase 3A adds tenant-isolated business onboarding and organization configuration on top of Phase 2 organizations, memberships, invitations, authorization, and audit events.

## Scope

Included:

- Business profile (legal name, display name, description, industry, website, logo URL)
- Contact information and primary business address
- IANA organization time zone
- Weekly operating hours (normalized, transactional replacement)
- Services catalogue
- Products catalogue
- Employee-access defaults (typed settings)
- Persisted onboarding progress and intentional completion
- Reopening completed onboarding
- Configuration readiness tracking
- Audit events for sensitive configuration changes
- Unit, PostgreSQL integration, concurrency, tenant-isolation, and Playwright coverage

Excluded (later / Phase 3B+):

- Twilio, browser calling, phone provisioning, call queues
- SMS, email campaigns, prospects, leads, CRM
- AI agents, document uploads, vector search, transcription
- Appointment booking, Google Calendar, Slack
- Billing/Stripe, analytics dashboards
- Social login, MFA, passkeys
- Multi-location management UI (schema is forward-compatible only)

## Architecture decisions

### Business-profile model

Singular configuration lives in `BusinessProfile` (1:1 with `Organization`).

- `Organization.name` / `slug` remain the system identity.
- `BusinessProfile.displayName` is the customer-facing business name.
- Contact fields and IANA `timeZone` live on the profile.
- Optional `logoUrl` stores an https/http URL only (no file upload).

### Primary-location strategy

Address fields live on `BusinessLocation` with `isPrimary=true`.

- Phase 3A manages one primary location per organization (partial unique index).
- Future multi-location support can add non-primary rows without destructive redesign.
- Phase 3A does not ship a multi-location management UI.

### Business-type strategy

`BusinessType`:

- `SERVICES` — requires ≥1 active service to complete
- `PRODUCTS` — requires ≥1 active product to complete
- `BOTH` — requires ≥1 active service and ≥1 active product

Service-only businesses are not forced to create products, and vice versa.

## Operating-hours representation

Table: `OperatingHourInterval`

| Field | Meaning |
|---|---|
| `dayOfWeek` | `MONDAY`…`SUNDAY` |
| `isClosed` | Closed day marker |
| `startMinute` / `endMinute` | Minutes from local midnight |
| `sortOrder` | Interval position within a day |

Semantics:

- Start is **inclusive**, end is **exclusive** (half-open interval).
- Example: 09:00–17:00 → `[540, 1020)`.
- Overnight intervals (`end <= start`) are **rejected**.
- Zero-length intervals are rejected.
- Overlapping open intervals on the same day are rejected.
- Weekly replacement is transactional (delete + insert under advisory lock).
- Holiday / temporary closures are out of scope.

Times are interpreted in the organization’s IANA time zone. Raw UTC offsets are never stored as the authoritative zone.

## Service model

`BusinessService`: name, description, active flag, display order, optional price description, optional duration (positive minutes, ≤ 24h), optional category.

- Duplicate names **are allowed** within a tenant (deliberate).
- Prefer deactivation (`isActive=false`) over destructive deletion.
- Reordering is organization-scoped; foreign IDs are rejected.

## Product model

`BusinessProduct`: name, description, active flag, display order, optional SKU, optional price description, optional category.

- SKU uniqueness is organization-scoped when SKU is non-null (partial unique index).
- Multiple `NULL` SKUs are allowed.
- Prefer deactivation over deletion.

## Employee-default settings

`OrganizationSettings` (typed, not free-form JSON permissions):

- `membersCanViewServices` (default `true`)
- `membersCanViewProducts` (default `true`)
- `membersCanViewBusinessInfo` (default `true`)
- `futureCallingAccessDefault` (`DISABLED` \| `STANDARD`) — reserved label only; grants no telephony

Settings never override server permission policy and cannot elevate a `MEMBER` to owner/admin capabilities. Member catalogue/business reads are additionally gated by these flags.

Deferred: granular custom roles / permission builder UI.

## Concurrency and readiness locking

All readiness-affecting mutations acquire a shared transaction advisory lock:

```text
organization-readiness:<organizationId>
```

Lock ordering (deadlock prevention):

1. Acquire `organization-readiness:<organizationId>` first.
2. Only then acquire specialized locks (`hours:`, `services-order:`, `products-order:`) when needed.
3. Reorder-only operations that do not affect completion readiness may use specialized locks alone.

Versioned writes use atomic conditional `updateMany` scoped by organization and expected version.

## GET non-mutation

Read helpers never create defaults, onboarding rows, or audit events. Intentional initialization uses `startOrganizationOnboarding()` via POST (`startOnboardingAction`).

## Onboarding-state lifecycle

`OrganizationOnboarding` is authoritative (not URL or localStorage).

Statuses:

1. `NOT_STARTED`
2. `IN_PROGRESS`
3. `COMPLETED`

Steps:

1. Business basics
2. Contact and location
3. Operating hours
4. Catalogue (services and/or products)
5. Employee defaults
6. Review and completion

Fields include current step, completed steps, completion actor/timestamp, reopen actor/timestamp, optimistic `version`, and `isConfigurationReady`.

## Completion-readiness rules

Completion is an intentional POST/server mutation. GET never completes.

Server computes readiness. Required at minimum:

- Customer-facing display name
- Industry/category
- Business type
- Primary email + E.164 phone
- Valid IANA time zone
- Valid country on primary location
- Full weekly hours configuration
- Active catalogue items per business type

Client-supplied `isComplete: true` is ignored.

## Reopening and invalidation behavior

- Explicit reopen → `IN_PROGRESS`, records actor/timestamp, clears ready flag.
- Ordinary edits remain allowed after completion.
- If an edit invalidates completion requirements, the server sets `isConfigurationReady=false` and transitions status back to `IN_PROGRESS` so the org is not falsely presented as ready for Phase 3B.

## Active-organization strategy

Unchanged from Phase 2:

1. Route slug `/app/orgs/[slug]/…` is primary tenant context.
2. Membership is re-validated on every request.
3. `User.activeOrganizationId` is a soft preference only.
4. Inactive membership loses access immediately (no JWT-cached roles).

## Role-permission rules

| Action | Owner | Admin | Member |
|---|---:|---:|---:|
| View business profile | Yes | Yes | Yes\* |
| Edit business profile | Yes | Yes | No |
| View operating hours | Yes | Yes | Yes |
| Edit operating hours | Yes | Yes | No |
| View services | Yes | Yes | Yes\* |
| Manage services | Yes | Yes | No |
| View products | Yes | Yes | Yes\* |
| Manage products | Yes | Yes | No |
| View onboarding progress | Yes | Yes | No |
| Modify / complete onboarding | Yes | Yes | No |
| Reopen onboarding | Yes | Yes | No |
| Manage employee defaults | Yes | Yes | No |

\*Subject to organization settings defaults.

Permissions live in `lib/orgs/permissions.ts` (`org.business.*`, `org.hours.*`, `org.services.*`, `org.products.*`, `org.onboarding.*`, `org.settings.manage`).

## Tenant authorization

Every mutation:

1. Validates input
2. Requires verified session
3. Loads ACTIVE membership from PostgreSQL
4. Evaluates centralized permission
5. Scopes records by `organizationId`
6. Rechecks membership/permission inside sensitive transactions
7. Writes audits only on success

Cross-tenant IDs fail safely and do not write audits in either tenant.

## Transactions and concurrency

- Weekly hours replacement uses advisory lock + deleteMany + createMany
- Catalogue reordering uses advisory lock + org-scoped updates
- Onboarding completion uses advisory lock + readiness recompute
- Profile/settings use optimistic `version` where applicable
- Concurrent onboarding init converges via unique `organizationId` + P2002 handling

No in-memory production locks.

## Audit events

New actions:

- `BUSINESS_PROFILE_UPDATED`
- `OPERATING_HOURS_UPDATED`
- `SERVICE_CREATED` / `SERVICE_UPDATED` / `SERVICE_DEACTIVATED`
- `PRODUCT_CREATED` / `PRODUCT_UPDATED` / `PRODUCT_DEACTIVATED`
- `ORGANIZATION_SETTINGS_UPDATED`
- `ONBOARDING_STARTED` / `ONBOARDING_COMPLETED` / `ONBOARDING_REOPENED`

Metadata is minimal (ids, section names, counts, country/timeZone codes). No full addresses, phones, secrets, or tokens.

## Data normalization

- Emails: trim + lowercase
- Phones: E.164 via `libphonenumber-js` when country context exists
- URLs: http/https only
- Time zones: IANA identifiers via `Intl.supportedValuesOf('timeZone')`
- Country: ISO 3166-1 alpha-2
- Names preserve intentional capitalization after trim

## Routes

- `/app/orgs/[slug]/onboarding` — entry / resume
- `/app/orgs/[slug]/onboarding/{basics,contact,hours,catalogue,defaults,review}`
- `/app/orgs/[slug]/settings` — post-completion edits

## Environment

```bash
cp .env.example .env.local
```

No new required env vars beyond Phase 1/2.

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Pooled app connection (often Supabase pooler `:6543`) |
| `DIRECT_URL` | Direct connection for migrations (often `:5432`) |
| `AUTH_SECRET` | Auth.js secret (≥32 chars) |
| `RESEND_API_KEY` | Fake in local/CI |
| `AUTH_EMAIL_DELIVERY` | `mock` or `resend` |
| `NEXT_PUBLIC_APP_URL` | Public origin |

## Migrations

```bash
npm run prisma:generate
npm run prisma:validate
npm run prisma:migrate:deploy
```

Phase 3A migration: `20260811000000_phase_03a_business_onboarding`

Do **not** use `prisma db push` or destructive reset commands against shared/production databases.

Apply only to disposable local PostgreSQL, CI PostgreSQL, or a positively confirmed development Supabase database.

### Local PostgreSQL verification

1. Start disposable Postgres
2. Point `DATABASE_URL` / `DIRECT_URL` at it
3. `npm run prisma:migrate:deploy`
4. `npm run test:integration`

### Safe Supabase development migration

1. Confirm the target is a development project (not production)
2. Use `DIRECT_URL` for migrate deploy
3. Keep pooled `DATABASE_URL` for the app
4. Never commit real credentials

## Testing

```bash
npm run test
npm run test:integration
npm run test:e2e
```

Focused coverage includes schema uniqueness, hours atomicity, readiness rules, authorization, tenant isolation, concurrency (init/hours/reorder/completion races), actor demotion races, and Playwright onboarding workflow.

## Remaining manual setup

- Confirm development database target before applying the Phase 3A migration
- No Twilio / telephony setup in this phase

## Deferred Phase 3B functionality

Telephony connection, browser calling, phone numbers, call records, queues, and related UI remain out of scope.
