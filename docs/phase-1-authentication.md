# Outreach — Phase 1 Authentication

Phase 1 adds email/password authentication with Auth.js, verification, password reset, protected routes, rate limiting, and security logging. Organizations, CRM, Twilio, and later product features remain out of scope.

## Scope

Included:

- Registration, email verification, login, logout
- Forgot-password and reset-password
- Protected `/app` shell for verified users
- Argon2id password hashing
- Hashed, expiring, single-use tokens
- Database-backed rate limiting
- Structured security-event logging
- Prisma migration for auth models
- Unit, component, integration, and Playwright tests

Deferred to later phases: organizations, roles, invitations, CRM, calling, billing, MFA, social login, admin tooling.

## Auth.js version and configuration

- Package: `next-auth@5.0.0-beta.32` (Auth.js v5)
- Credentials provider only (email + password)
- Route handlers: `app/api/auth/[...nextauth]/route.ts`
- Server helpers: `auth.ts`, `lib/auth/session.ts`
- Early redirects: Next.js 16 `proxy.ts` (not `middleware.ts`)

### Session strategy: JWT

Auth.js Credentials sign-in does not create adapter database sessions. Phase 1 therefore uses:

```ts
session: { strategy: "jwt", maxAge: 7 days }
```

Cookies are HTTP-only, `SameSite=Lax`, and `Secure` in production (`__Secure-authjs.session-token`).

### Session revocation

JWT cookies cannot be deleted from the server alone. Phase 1 embeds `sessionVersion` in the JWT and stores `User.sessionVersion` in Postgres.

- Password reset increments `sessionVersion`
- `getCurrentSessionUser` / `requireVerifiedUser` compare JWT version to the database
- Mismatched or missing users are treated as unauthenticated
- Logout uses Auth.js `signOut` to clear the browser cookie

Protected server components and actions must call these helpers. Proxy redirects are not the only control.

## Password hashing

Module: `lib/auth/password.ts` (`@node-rs/argon2`)

- Algorithm: Argon2id
- memoryCost: 19456 KiB (~19 MiB)
- timeCost: 2
- parallelism: 1
- outputLen: 32

Chosen to align with OWASP interactive login guidance while remaining practical on serverless Node workers. Policy: minimum 12 characters, maximum 128, spaces/passphrases allowed, no silent truncation, no character-class mandates.

## Email verification

1. Registration creates an unverified user and issues an `EMAIL_VERIFICATION` token
2. Only the SHA-256 hash of the token is stored
3. Raw token is emailed via Resend (`lib/email/mailer.ts`)
4. GET `/verify-email?token=…` renders a confirmation page only — it does **not** consume the token or mark the user verified (protects against email scanners / link previews)
5. The user must submit the confirmation form (POST / server action) to consume the token atomically and set `emailVerifiedAt`
6. Resend is rate-limited and always returns a generic success message

Unverified users cannot sign in to protected areas.

## Password reset

1. `/forgot-password` always returns a generic success response
2. Reset email is sent only for verified accounts
3. `/reset-password?token=…` validates password + confirmation
4. Token consumption, password hash update, and `sessionVersion` increment occur in one transaction
5. Users are not auto-signed-in after reset

## One-time tokens

- Cryptographically random (`base64url`, 32 bytes)
- Purposes: `EMAIL_VERIFICATION` (24h), `PASSWORD_RESET` (1h)
- Stored as SHA-256 hex hashes
- Single-use via `consumedAt`
- Replacement issuance runs in a Postgres transaction under `pg_advisory_xact_lock(hashtext(userId:purpose))` so invalidate + create commit together
- A partial unique index (`AuthToken_userId_purpose_active_key`) enforces at most one active token per user+purpose
- If replacement creation fails, invalidation rolls back and the previous token remains usable

## Rate limiting

Module: `lib/auth/rate-limit.ts` — Postgres `RateLimitBucket` table.

- Keys are HMAC-SHA256 composites (route + hashed email and/or IP)
- Raw emails and IPs never appear in keys
- Missing proxy headers do **not** collapse into a shared `ip:unknown` bucket; email or token-derived salt is required
- Concurrent requests for the same bucket are serialized with `pg_advisory_xact_lock(hashtext(bucketKey))` inside a transaction; the admit/deny decision uses the count read under that lock
- If the rate-limit backend fails, requests are denied (fail closed)

Limitations: best-effort expiry cleanup outside the lock; advisory locks are Postgres-specific (CI uses Postgres).

## Email delivery

- `AUTH_EMAIL_DELIVERY=mock|resend`
- Live Resend sends use `EMAIL_PROVIDER_TIMEOUT_MS` (default `10000`, range 1000–60000)
- Timeouts and provider errors become controlled `EmailDeliveryError` values; auth flows still return generic success where required
- Production / Vercel production reject mock mode
- Mock is allowed when `NODE_ENV !== "production"`, `CI=true`, or Playwright’s localhost webServer (`PLAYWRIGHT_WEB_SERVER=true` + localhost app URL)
- Automated tests and CI always use mock delivery and never contact Resend
- The Resend SDK call may continue in the background after timeout; the app stops awaiting it

## Security-event logging

`lib/auth/security-log.ts` emits JSON lines for register/login/verification/reset/logout/rate-limit events. Passwords, hashes, raw tokens, full emails, and cookies are never logged.

## Environment variables

| Variable | Scope | Purpose |
|---|---|---|
| `DATABASE_URL` | Server | Pooled Postgres |
| `DIRECT_URL` | Server | Direct Postgres for migrations |
| `AUTH_SECRET` | Server | Auth.js JWT/cookie secret (≥32 chars) |
| `RESEND_API_KEY` | Server | Resend API key |
| `AUTH_EMAIL_FROM` | Server | From address for auth email |
| `AUTH_EMAIL_DELIVERY` | Server | `resend` (live) or `mock` (no network send) |
| `EMAIL_PROVIDER_TIMEOUT_MS` | Server | Live Resend deadline (default 10000) |
| `NEXT_PUBLIC_APP_URL` | Public + server link building | App origin |
| `AUTH_TRUST_HOST` | Server optional | Auth.js trust host (`true`/`false`) |

Copy `.env.example` → `.env.local`. Never commit real secrets.

## Local database and migrations

```bash
# Generate client / validate (placeholder URLs are fine for validate)
npm run prisma:generate
npm run prisma:validate

# Apply Phase 1 migrations to an isolated local/CI database only
npm run prisma:migrate:deploy
```

Migrations:

- `20260810000000_phase_01_authentication` — `User`, `AuthToken`, `RateLimitBucket`
- `20260810010000_auth_token_active_unique` — partial unique index for active tokens

Do not apply these migrations to production or shared Staging without an explicit release process.

### Development connectivity + CRUD check

Against a **local** disposable database only:

```bash
npm run db:crud-check
```

The script prints sanitized host/database classification, runs `SELECT 1`, creates uniquely prefixed temporary `User` / `AuthToken` / `RateLimitBucket` rows, updates them, then deletes only those IDs. It aborts if the host is not local.

### Manual Supabase apply (when safe credentials are confirmed)

1. Set `DATABASE_URL` (pooler) and `DIRECT_URL` (direct host) for the **development** project
2. Run `npm run prisma:migrate:deploy`
3. Confirm tables exist in the Supabase SQL editor
4. Do not run against production from local machines

## Isolated test database

Example local URL:

```text
postgresql://postgres:postgres@127.0.0.1:5433/outreach_test?schema=public
```

```bash
npm run prisma:migrate:deploy
npm run test:integration
```

CI starts Postgres 16 as a service container and applies migrations there only.

## Running authentication tests

```bash
npm run test                 # unit + component
npm run test:integration     # requires migrated test DB (includes concurrency + revocation)
npm run test:e2e             # Playwright auth smoke (migrated DB + fake secrets)
```

Email delivery is mocked in unit/integration tests via `setMailerForTests` / `AUTH_EMAIL_DELIVERY=mock`. CI never sends real email. Live Resend remains manually unverified unless genuinely configured and tested.

### E2E notes

- Visiting `/verify-email?token=…` alone does not verify; confirmation submit does.
- Password reset increments `sessionVersion` and rejects the previous browser session on `/app`.
- Inbox capture of verification links is not required; tokens are seeded in the test database.

## Seeding a verified development user

Against an isolated database only:

```bash
npm run prisma:seed
```

Defaults:

- `verified@example.com` / `CorrectHorseBatteryStaple`
- `unverified@example.com` / `UnverifiedUserPass1`

Override with `SEED_VERIFIED_EMAIL` and `SEED_VERIFIED_PASSWORD`.

## Live email delivery

1. Create a Resend account and API key
2. Verify a sending domain
3. Set `RESEND_API_KEY` and `AUTH_EMAIL_FROM`
4. Set `NEXT_PUBLIC_APP_URL` to the public origin used in links
5. Register a test user and confirm the message arrives

Until those steps are done, live delivery remains manually unverified. Do not log raw verification URLs as a substitute.

## Phase 1 limitations

- JWT sessions require DB `sessionVersion` checks for revocation
- Rate limiter is intentionally small and Postgres-backed
- No organization or role model yet
- No MFA, passkeys, or social login
- Live Supabase migration and live Resend delivery require manual setup
