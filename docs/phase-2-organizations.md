# Outreach — Phase 2 Organizations

Phase 2 adds multi-tenant organizations, memberships, roles, invitations, offboarding, and audit events on top of Phase 1 authentication.

## Scope

Included:

- Organization creation with atomic owner membership
- Roles: `OWNER`, `ADMIN`, `MEMBER`
- Server-side organization authorization helpers
- Hashed, expiring, single-use invitations
- Invitation preview (GET does not accept) and intentional acceptance
- Membership listing, role changes, and offboarding
- Active-organization preference (validated every request)
- Tenant isolation
- Audit events for sensitive organization actions
- Unit, integration, concurrency, and Playwright coverage

Excluded (later phases): prospects/CRM, calling, Twilio, billing, MFA, social login. Business onboarding is covered in Phase 3A (`docs/phase-3a-business-onboarding.md`).

## Architecture

```text
valid Auth.js session
+ verified account
+ ACTIVE membership in the target organization
+ role permits the operation
+ resource scoped to that organization
= authorized Phase 2 operation
```

Authorization lives in `lib/orgs/authorization.ts` and `lib/orgs/permissions.ts`. UI controls are not enforcement.

JWT sessions never carry trusted organization roles. Every protected org read/mutation re-queries membership status so offboarding takes effect immediately.

## Data model

| Model | Purpose |
|---|---|
| `Organization` | Tenant root (`name`, unique `slug`) |
| `Membership` | One row per user per org (`role`, `status`) |
| `OrganizationInvitation` | Hashed invitation token + lifecycle timestamps |
| `OrganizationAuditEvent` | Minimal audit trail for sensitive actions |

Constraints of note:

- `Membership` unique on `(organizationId, userId)`
- Partial unique index: one usable invitation per `(organizationId, emailNormalized)`
- Invitation `tokenHash` is unique; raw tokens are never stored
- Inviter FK is `ON DELETE RESTRICT` to preserve attribution
- Organization/membership deletes cascade within the tenant; users are not deleted by offboarding

## Roles and permissions

| Action | Owner | Admin | Member |
|---|---:|---:|---:|
| View organization | Yes | Yes | Yes |
| View members | Yes | Yes | Yes |
| Invite members | Yes | Yes | No |
| Revoke invitations | Yes | Yes | No |
| Change `MEMBER` roles | Yes | Yes | No |
| Promote to `ADMIN` | Yes | Yes | No |
| Demote an `ADMIN` | Yes | No | No |
| Remove/deactivate members | Yes | Yes (not owners/admins) | No |
| Change or remove an owner | No (deferred) | No | No |
| Delete organization | Not in Phase 2 | No | No |

## Ownership safety

Phase 2 does **not** implement ownership transfer. An organization must never lose its active owner:

- Owner role cannot be assigned via invitation
- Owner cannot be demoted or offboarded
- Owners cannot offboard themselves
- Service-level checks enforce this even if the UI is bypassed

## Active-organization strategy

1. Organization-scoped routes (`/app/orgs/[slug]/…`) are the primary tenant context. Slug → membership is validated on every request.
2. `User.activeOrganizationId` is a soft preference for redirects/selectors.
3. Preference is re-validated whenever read; inactive/missing membership clears it.
4. Browser storage is never trusted for authorization.

## Invitation lifecycle

1. Owner/admin invites `ADMIN` or `MEMBER` by email
2. Cryptographic raw token is emailed once; only SHA-256 hash is stored
3. Concurrent re-invites for the same org+email revoke prior usable invites under an advisory lock
4. GET `/invitations/accept?token=…` previews only — scanners cannot accept
5. Authenticated, verified user whose normalized email matches submits acceptance
6. Membership create/reactivate + invitation consume happen atomically
7. Role always comes from the invitation row, never from client input

Invitation security mirrors Phase 1 tokens: no raw tokens in logs, audits, or error output; no open redirects; production mock-email guard preserved.

## Offboarding

Offboarding sets membership `status=INACTIVE` and records audit metadata. It does not delete the global `User` or credentials, and does not affect memberships in other organizations. Subsequent org authorization fails because membership is re-queried.

## Tenant isolation

Every org-owned query includes the authorized `organizationId`. Mutations look up target memberships/invitations with `organizationId` scope (`requireScopedMembership` / `requireScopedInvitation`). Cross-tenant IDs fail safely.

## Audit events

Recorded actions:

- `ORGANIZATION_CREATED`
- `INVITATION_CREATED` / `INVITATION_REPLACED` / `INVITATION_REVOKED` / `INVITATION_ACCEPTED`
- `MEMBER_ROLE_CHANGED`
- `MEMBER_DEACTIVATED`

Metadata is structured and minimal (ids, roles, email domain). Secrets and raw tokens are stripped.

## Environment

Copy placeholders:

```bash
cp .env.example .env.local
```

Phase 2 introduces no new required env vars beyond Phase 1.

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Pooled app connection (often Supabase pooler `:6543`) |
| `DIRECT_URL` | Direct connection for migrations (often `:5432` without pgbouncer) |
| `AUTH_SECRET` | Auth.js secret (≥32 chars) |
| `RESEND_API_KEY` | Required by schema; fake in local/CI |
| `AUTH_EMAIL_FROM` | From address |
| `AUTH_EMAIL_DELIVERY` | `mock` or `resend` |
| `EMAIL_PROVIDER_TIMEOUT_MS` | Optional live-send timeout |
| `NEXT_PUBLIC_APP_URL` | Public origin for links |
| `AUTH_TRUST_HOST` | Optional |

## Migrations

```bash
npm run prisma:generate
npm run prisma:validate
npm run prisma:migrate:deploy
```

Migrations:

- Phase 1: `20260810000000_phase_01_authentication`, `20260810010000_auth_token_active_unique`
- Phase 2: `20260810020000_phase_02_organizations`
- Phase 3A: see `docs/phase-3a-business-onboarding.md`

Apply only to disposable local/CI Postgres or a positively confirmed development Supabase project. Do not use `prisma db push` as a substitute. Do not apply to production from local machines.

### Development Supabase

1. Confirm the project is development (not production/staging)
2. Set pooled `DATABASE_URL` and direct `DIRECT_URL`
3. Run `npm run prisma:migrate:deploy`
4. Run `npm run db:crud-check` only against local disposable DBs (script aborts for remote hosts)

## Local CRUD check

```bash
# Requires local DATABASE_URL/DIRECT_URL (127.0.0.1 / localhost)
npm run db:crud-check
```

## Tests

```bash
npm run test
npm run test:integration
npm run test:e2e
```

Integration and CI use disposable Postgres with `AUTH_EMAIL_DELIVERY=mock`. They never contact Resend or Supabase.

## Manual setup still required

- Confirm and migrate a development Supabase project when credentials are known safe
- Configure live Resend for invitation email in non-mock environments
- Do not commit real connection strings or API keys
