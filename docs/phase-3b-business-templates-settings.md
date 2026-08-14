# Phase 3B — Business templates and operational configuration

Status: Implemented on `feature/phase-03b-business-templates-settings`  
Depends on: Phase 3A final commit `36762b1b50dfafd5928d10494781104bfaedc413` merged into `develop`

## Scope

Phase 3B completes the remaining organization-configuration capabilities that were not included in Phase 3A:

1. Business-template selection and confirmed customization
2. Safe template switching with preview
3. Typed custom-field definitions (definitions only)
4. Locale and default language
5. Service areas
6. Holiday and temporary closures
7. Lead-stage defaults
8. Call-disposition defaults
9. Callback-policy defaults
10. Recording, transcription, retention, and consent-policy defaults
11. Notification and escalation defaults
12. Resumable Phase 3B configuration progress
13. Versioned, audited, authorized mutations

## Explicit exclusions

Phase 3B does **not**:

- Connect Twilio
- Make calls or issue browser tokens
- Create Business Knowledge or upload documents
- Create prospects or CRM records
- Activate template examples as customer facts
- Provide legal advice or claim recording/consent choices are lawful in every jurisdiction
- Add Slack, calendar, SMS, maps, geocoding, routing, or AI

Those capabilities remain reserved for later phases (4–7+).

## Domain model

| Concern | Persistence |
|---|---|
| Template definitions | Typed server registry (`lib/orgs/business-templates-registry.ts`) |
| Template selection | `OrganizationTemplateAssignment` (1:1 org) |
| Locale / display prefs | `OrganizationLocaleSettings` (1:1, versioned) |
| Custom fields | `CustomFieldDefinition` (org-scoped definitions only) |
| Service areas | `ServiceArea` |
| Holiday closures | `HolidayClosure` (separate from weekly hours) |
| Lead stages | `LeadStageDefault` |
| Call dispositions | `CallDispositionDefault` |
| Callback policy | `OrganizationCallbackPolicy` (1:1, versioned) |
| Recording/consent | `OrganizationRecordingConsentPolicy` (1:1, versioned; defaults OFF) |
| Notifications | `OrganizationNotificationDefaults` (1:1, versioned) |
| Phase 3B progress | `OrganizationConfigProgress` (independent of Phase 3A onboarding) |

Phase 3A tables (`BusinessProfile`, `OrganizationOnboarding`, weekly `OperatingHourInterval`, catalogues, employee settings) are preserved and not rewritten.

## Template registry

Platform keys:

- `PROFESSIONAL_SERVICES`
- `HOME_TRADE_SERVICES`
- `PRODUCT_BUSINESS`
- `SUBSCRIPTIONS_PLANS`
- `APPOINTMENT_BASED`
- `CUSTOM_MIXED`

Each definition includes versioned questions, presentation hints, suggested categories, suggested custom-field definitions, import-mapping hints, qualification-prompt metadata, applicable sections, and **example** offerings.

### Example-versus-customer-fact boundary

Template examples and suggestions **never** become:

- Active services or products
- Prices, policies, guarantees, scripts, or disclosures
- Business Knowledge
- Prospect information
- Persisted custom-field definitions without explicit confirmation

Only the organization’s explicit template selection and confirmed customization metadata are stored.

## Custom-field model

Supported types: `TEXT`, `LONG_TEXT`, `NUMBER`, `BOOLEAN`, `DATE`, `SINGLE_SELECT`, `MULTI_SELECT`, `URL`, `EMAIL`, `PHONE`.

Rules:

- Stable keys unique per organization + scope
- Reserved system keys rejected
- Bounded labels/options; unique deterministic options
- Deactivate instead of destructive delete
- Reorder rejects duplicates, omissions, unknown IDs, and foreign IDs
- No prospect/knowledge values in this phase

## Locale and service-area semantics

- Locale and default language use validated BCP 47 tags
- Formatting preferences are distinct from canonical stored values
- Existing Phase 3A `BusinessProfile.timeZone` (IANA) is not silently changed
- Service areas support country/region/city/postal prefix/remote labels without geometry
- Postal patterns reject unbounded wildcards
- Primary location behavior from Phase 3A is unchanged

## Holiday and DST behavior

- Closures store local calendar dates (`YYYY-MM-DD`) interpreted in the organization’s IANA timezone
- Optional bounded end dates and optional half-open replacement intervals
- Overlaps and contradictory intervals are rejected
- Weekly `OperatingHourInterval` rows are never mutated by closure writers
- No recurring-holiday automation in this phase

## Operational-default semantics

Lead stages and dispositions are organization-configured labels for later CRM/calling. Exactly one active default lead stage is required when a stage set is replaced. Callback settings are workflow defaults, not a scheduler.

## Recording and consent safety boundary

Safe defaults:

- recording disabled
- transcription disabled
- consent capture required
- review required
- no automatic legal-compliance claim

UI and docs state that these settings require customer review and are **not legal advice**. Enabling recording is never implied by a template suggestion.

## Phase 3B lifecycle and Phase 3A compatibility

`OrganizationConfigProgress` is a **separate** lifecycle from `OrganizationOnboarding`.

- Existing organizations that completed Phase 3A are **not** silently marked incomplete when Phase 3B deploys
- Phase 3B reads never initialize rows or bump Phase 3A versions
- `startConfigProgress` is an explicit authorized mutation
- Phase 3B does not redefine `isConfigurationReady`

## Versioning

Singular editable records use optimistic concurrency (`expectedVersion`). Missing, malformed, unsafe, or stale versions produce controlled conflicts and zero writes. Collection reorders use Phase 3B section advisory locks as the documented conflict mechanism (same class of guarantee as Phase 3A catalogue reorders).

## Transactions and lock ordering

Phase 3B writers use lock key `organization-config-3b:<organizationId>` and **do not** acquire the Phase 3A readiness lock.

Order:

1. Phase 3B config advisory lock
2. Actor membership row `FOR UPDATE` + permission recheck
3. Specialized section lock when required (`service-areas-order:`, `custom-fields-order:`, `closures:`, `lead-stages:`, `dispositions:`)
4. Tenant-scoped rows in stable deterministic order

Deadlock safety vs Phase 3A: the two families share only membership row locks; they never take each other’s advisory locks. If a future writer must take both advisory locks, acquire Phase 3A readiness **before** Phase 3B config.

Invalid input is rejected before the first write. Audit events roll back with failed mutations. No in-memory production locks. No post-commit authorization-dependent response building.

## Authorization

Centralized permissions:

- `org.templates.read` / `org.templates.manage`
- `org.config.read` / `org.config.manage`

OWNER and ADMIN may manage. MEMBER may read (where permitted) but cannot mutate. UI visibility is not authorization. Sensitive mutations recheck membership and permission inside the transaction after the membership lock. Demotion and deactivation immediately prevent future Phase 3B mutations.

## Audit events

Success-only events include:

`BUSINESS_TEMPLATE_SELECTED`, `BUSINESS_TEMPLATE_SWITCHED`, `CUSTOM_FIELD_*`, `SERVICE_AREA_*`, `HOLIDAY_CLOSURE_*`, `OPERATIONAL_DEFAULTS_UPDATED`, `LEAD_STAGES_UPDATED`, `CALL_DISPOSITIONS_UPDATED`, `ORGANIZATION_LOCALE_UPDATED`, `CONFIG_PROGRESS_UPDATED`

Metadata contains minimal identifiers and safe classification data only — never disclosure text, phones, personal emails, secrets, or full before/after objects.

## Migration

Forward-only migration:

`prisma/migrations/20260812000000_phase_03b_business_templates_settings`

- Additive audit enum values
- New enums and tenant-scoped tables with FKs and uniqueness
- Does not edit Phase 1–3A migrations
- Apply only to disposable local and CI PostgreSQL — not Supabase/production from this branch workflow

## UI routes

- `/app/orgs/[slug]/settings/business-template`
- `/app/orgs/[slug]/settings/service-areas`
- `/app/orgs/[slug]/settings/availability`
- `/app/orgs/[slug]/settings/operational-defaults`

## Test strategy

- PostgreSQL integration tests under `tests/integration/config-3b.*.test.ts`
- Playwright coverage in `e2e/config-3b.spec.ts`
- Phase 0–3A regression must remain green
- Concurrency evidence uses deterministic gates/held locks — not sleeps

## Manual setup

1. Use a disposable local Postgres
2. `npm ci`
3. `npm run prisma:migrate:deploy`
4. `npm run dev` / `npm run test:integration` / `npm run test:e2e`

No Twilio credentials are required.

## Deferred work

- Phase 4: Business Knowledge and advanced structured offerings
- Phase 5: Prospects, consent enforcement, CRM values for custom fields
- Phase 6: Twilio OAuth and telephony configuration
- Phase 7: Browser calling
- Recurring holiday automation, maps/geocoding, Slack/SMS delivery integrations
