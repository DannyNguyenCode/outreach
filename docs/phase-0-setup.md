# Outreach — Developer Setup (Phase 0)

This guide covers local setup for the Phase 0 project foundation. Product features (authentication, organizations, calling, and so on) are intentionally excluded until later phases.

## Required software

- **Node.js** 22.x LTS only (see `.nvmrc`; `package.json` engines require `>=22.12.0 <23`)
- **npm** 10+ (ships with Node; do not introduce Yarn or pnpm lockfiles)
- Access to an Outreach-managed **Supabase** PostgreSQL project (for live database work)

## Install

```bash
npm ci
```

`postinstall` runs `prisma generate` so the Prisma Client is available after install.

## Environment variables

1. Copy `.env.example` to `.env.local`.
2. Replace placeholder values with your local or Staging Supabase credentials.

| Variable | Scope | Purpose |
|---|---|---|
| `DATABASE_URL` | Server only | Pooled Postgres URL used by the application at runtime |
| `DIRECT_URL` | Server only | Direct Postgres URL used by Prisma migrations and some CLI operations |
| `NEXT_PUBLIC_APP_URL` | Browser-safe | Public origin of the app (for example `http://localhost:3000`) |

Validation lives in `lib/env/`. Server modules that need secrets call `getServerEnv()` and fail with a clear message when values are missing.

Never commit `.env`, `.env.local`, or real connection strings.

## Prisma and Supabase

- ORM: **Prisma** (`prisma/schema.prisma`)
- Host: Supabase-hosted PostgreSQL
- App traffic: `DATABASE_URL` (prefer the Supabase pooler / PgBouncer URL)
- Migrations: `DIRECT_URL` (Supabase direct database host)

### Generate client

```bash
npm run prisma:generate
```

### Validate schema

```bash
npm run prisma:validate
```

Requires `DATABASE_URL` and `DIRECT_URL` to be set (placeholder URLs are enough for schema validation).

### Migration workflow

```bash
# Create / apply migrations during local development (uses DIRECT_URL)
npm run prisma:migrate:dev

# Apply existing migrations in shared environments (non-interactive)
npm run prisma:migrate:deploy
```

Phase 0 ships a migration lock file and an empty product schema (no Auth.js or domain tables). Do not apply destructive resets against shared Staging or Production databases without explicit authorization.

### Seed

`prisma/seed.ts` is only a future foundation placeholder.

- Prisma seeding is **not** configured in Phase 0 (no `prisma.seed` entry and no seed npm script).
- There are no Phase 0 domain models or seed records to insert.
- Seeding will be configured only when a later phase introduces appropriate fake development data.

Do not run `prisma db seed` expecting application data in Phase 0.

## Development

```bash
npm run dev
```

Open `http://localhost:3000`.

## Testing

```bash
npm run test          # Vitest unit / component tests
npm run test:watch    # Vitest watch mode
npm run test:e2e      # Playwright smoke tests (builds/starts as configured)
npm run test:e2e:ui   # Playwright UI mode
```

E2E smoke tests exercise the home page against a local server on port **3100** by default and do not require a live Supabase database for the Phase 0 shell.

## Quality checks and production build

```bash
npm run format:check
npm run lint
npm run typecheck
npm run build
npm run start
```

Full non-destructive verification (no remote migrations):

```bash
npm run verify
```

Then run Playwright separately:

```bash
npm run test:e2e
```

## Continuous integration

GitHub Actions workflow: `.github/workflows/ci.yml`

Runs format, lint, typecheck, unit/component tests, Prisma validate, production build, and Playwright Chromium smoke tests using fake database URLs.

## Phase 0 limitations

Not included:

- Auth.js, registration, login, sessions
- Organizations, roles, invitations
- CRM, Twilio, AI, billing
- Production deployment or production migrations
- DaisyUI or other component libraries

## Manual steps still required

1. Create or obtain Supabase project credentials for Local/Staging.
2. Set `DATABASE_URL` and `DIRECT_URL` in `.env.local`.
3. When the first real schema migration lands (later phase), run `npm run prisma:migrate:dev` locally and `prisma:migrate:deploy` in Staging.
4. Confirm Preview/Staging hosting env vars separately from Local.
