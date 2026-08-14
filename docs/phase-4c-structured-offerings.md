# Phase 4C — Structured Offerings

Status: Implemented on `feature/phase-04c-structured-offerings`  
Depends on: Phase 4B merge commit on `develop` (`b4c14037e9dffe9b87e9dbda6392207e660f9a40`)

## Scope

1. Organization-scoped structured offering catalog (`KNOW-003`)
2. Shared tables for products, one-time services, plans, packages, subscriptions, and custom-quote offerings
3. Versioned drafts with explicit customer confirmation before runtime authority
4. Decimal money amounts, ISO currency, billing frequency, effective-dated prices
5. Structured features suitable for deterministic plan comparison
6. Variants with optional price overrides and organization-defined attributes
7. Conservative eligibility notes (not a business-rules engine)
8. Custom attribute values reusing Phase 3B `CustomFieldDefinition` (`OFFERING` scope)
9. Deterministic ACTIVE offering retrieval with stable provenance IDs
10. Catalog management UI under `/app/orgs/[slug]/knowledge/offerings`

## Explicit exclusions

Phase 4C does **not**:

- Implement CSV/XLSX import (Phase 4D)
- Auto-activate imported or Phase 3 catalogue rows
- Build a full eligibility/rules engine
- Flatten offerings into document passages as the authoritative representation
- Add embeddings, AI comparison, commerce connectors, or live inventory sync
- Create industry-specific schemas or per-tenant columns
- Mark Phase 4D started

## Relationship to Phase 3 catalogues

Phase 3A `BusinessService` / `BusinessProduct` remain **operational onboarding catalogues**. They satisfy onboarding readiness and employee catalogue defaults, but they are not customer-confirmed Business Knowledge.

Phase 4C introduces confirmable `Offering` records as the authoritative structured-offering source class for later retrieval and call assistance.

Reconciliation rules:

- Existing Phase 3 rows are backfilled into linked `Offering` + `DRAFT` `OfferingVersion` rows (never auto-ACTIVE).
- Linked legacy IDs preserve provenance (`legacyServiceId` / `legacyProductId`).
- Free-form Phase 3 `priceDescription` text is preserved as a review note in `OfferingEligibility`; it is never interpreted as a numeric price.
- Backfilled versions use the same canonical structured checksum as application-created drafts and can be confirmed without an intermediate edit.
- Runtime retrieval returns only confirmed ACTIVE offerings.
- Phase 3 catalogue CRUD continues to serve onboarding; it does not silently overwrite ACTIVE offering facts.
- Future import (4D) and onboarding consolidation must populate the same Offering schema.

## Relationship to Phase 4A / 4B knowledge

Structured offerings are a **distinct source class**: `STRUCTURED_OFFERING`.

A PDF passage that says “Premium Plan costs $49/month” and a structured offering with `$49 CAD MONTHLY` may both exist. Phase 4C never silently merges or overwrites one with the other. Stable offering/version/price/feature/variant IDs support later conflict display and citations.

## Domain model

| Concern | Persistence |
|---|---|
| Logical offering | `Offering` (org-scoped, OCC `version`) |
| Immutable version | `OfferingVersion` (draft OCC `draftRevision`; confirmation frozen after activation) |
| Prices | `OfferingPrice` (version-scoped; `Decimal` amount) |
| Features | `OfferingFeature` (version-scoped; key/name/value/unit/order) |
| Variants | `OfferingVariant` + optional `OfferingVariantPrice` |
| Eligibility | `OfferingEligibility` (structured notes + quantity bounds) |
| Custom values | `OfferingCustomValue` → `CustomFieldDefinition` (`scope=OFFERING`) |
| Lifecycle | `OfferingLifecycleState`: `DRAFT` → `ACTIVE` → `SUPERSEDED` / `ARCHIVED` |

### Offering types

`PRODUCT`, `SERVICE`, `PLAN`, `PACKAGE`, `SUBSCRIPTION`, `CUSTOM_QUOTE`

No industry-specific enum values.

### Pricing models

`NONE`, `QUOTE_REQUIRED`, `FIXED_ONE_TIME`, `RECURRING`, `MULTI_OPTION`, `TIERED`

Money is stored as PostgreSQL `NUMERIC(19, 4)` via Prisma `Decimal`. JavaScript `number` is never the authoritative money type.

## Lifecycle and confirmation

Writers follow the Phase 4 confirmation pattern:

1. Authorized user creates/edits a draft
2. Customer previews structured values
3. Explicit confirmation activates exactly that draft revision
4. Prior ACTIVE version becomes `SUPERSEDED` (history preserved)
5. Archive excludes the offering from normal retrieval
6. Restore copies historical confirmed content into a **new** auditable draft

Confirmation language version: `offering.confirm.v1`.

Server-controlled confirmer identity, timestamp, and language version cannot be supplied by the browser.

Optimistic concurrency:

- Source-level archive/restore/replacement: `Offering.version`
- Draft edits/confirmation: `OfferingVersion.draftRevision`

## Authorization

Reuses existing knowledge permissions:

| Permission | Capability |
|---|---|
| `org.knowledge.read` | View ACTIVE offerings / compare / retrieve |
| `org.knowledge.manage` | Create and edit drafts |
| `org.knowledge.confirm` | Confirm/activate |
| `org.knowledge.archive` | Archive and restore |

UI visibility is not authorization. Every query/mutation scopes `organizationId` and rechecks active membership in-transaction for writers.

## Tenant isolation

Every offering-owned row includes `organizationId` and composite tenant FKs where needed. Cross-tenant IDs return the same safe `not_found` behavior as unknown IDs. Never query solely by globally supplied ID without organization scoping.

## Effective-date rules

Authoritative timezone is server-loaded `BusinessProfile.timeZone` (IANA), matching Phase 4A.

For CURRENT price selection at instant `now`:

- `effectiveFrom` null or `<= now`
- `effectiveUntil` null or `> now`
- `isActive = true`
- Future and expired prices are excluded
- If more than one current price remains for the same offering scope (base or same variant), confirmation and retrieval reject the ambiguous state rather than arbitrarily choosing one

## Plan comparison

`compareActiveOfferings` deterministically compares ACTIVE plans/packages from the same organization using structured records only (no AI):

- name, type, quote-required
- currently applicable price + billing frequency
- features (aligned by feature key)
- variants/tiers
- eligibility

## Custom attributes

Definitions remain Phase 3B `CustomFieldDefinition` with `scope=OFFERING`.

Phase 4C stores validated values on `OfferingCustomValue`:

- organization ownership
- stable definition key snapshot
- typed primitives (string/number/boolean/date/select)
- size/count limits
- prototype-pollution and executable-data rejection

## Audit events

Success-only:

- `OFFERING_DRAFT_CREATED`
- `OFFERING_DRAFT_UPDATED`
- `OFFERING_REPLACEMENT_DRAFT_CREATED`
- `OFFERING_PRICE_CHANGED` (recorded when draft prices change)
- `OFFERING_VERSION_CONFIRMED`
- `OFFERING_SUPERSEDED` (metadata on confirmation when replacing)
- `OFFERING_ARCHIVED`
- `OFFERING_RESTORED`

Metadata is limited to identifiers, checksum, language version, and related version/price ids. No secrets, large descriptions, or raw import payloads.

## Lock order

Offerings writers use advisory lock `organization-offerings:<organizationId>` and **do not** acquire Phase 3A readiness, Phase 3B config, or Phase 4A/4B knowledge locks.

Order:

1. Offerings advisory lock
2. Actor membership `FOR UPDATE` + permission recheck
3. Offering row `FOR UPDATE`
4. Version row(s) `FOR UPDATE` in stable id order
5. Child rows (prices, features, variants, eligibility, custom values) in stable order

Deadlock-safe vs other families because they share only membership row locks. If a future writer must take multiple advisory families, acquire Phase 3A readiness → Phase 3B config → Phase 4A knowledge → Phase 4C offerings.

## Retrieval interface

`retrieveActiveOfferings({ actor, organizationId, ... })` returns currently effective ACTIVE offerings with provenance:

- `sourceClass: "STRUCTURED_OFFERING"`
- offering ID / version ID
- current price ID(s)
- feature IDs / variant IDs
- confirmation metadata and checksum

Excludes `DRAFT`, `SUPERSEDED`, `ARCHIVED`, inactive, future, expired, and cross-tenant rows.

## Routes / UI

- `/app/orgs/[slug]/knowledge/offerings`
- `/app/orgs/[slug]/knowledge/offerings/new`
- `/app/orgs/[slug]/knowledge/offerings/compare`
- `/app/orgs/[slug]/knowledge/offerings/[offeringId]`
- `/app/orgs/[slug]/knowledge/offerings/[offeringId]/edit`
- `/app/orgs/[slug]/knowledge/offerings/[offeringId]/versions/[versionId]`

## Testing

- Unit: offering validation, money/currency, effective-date selection, feature comparison helpers
- Integration: lifecycle, pricing, variants/features, custom attributes, eligibility, permissions, tenant isolation, OCC, audit, schema integrity, retrieval
- Concurrency: confirm/archive/OCC races with deterministic gates
- Playwright: create → price/features → confirm → compare → archive → restore draft

## Migration

Forward-only:

`prisma/migrations/20260815000000_phase_04c_structured_offerings`

- Additive audit enum values
- Offering enums/tables/indexes/checks
- Backfill canonically checksummed DRAFT offerings from existing `BusinessService` / `BusinessProduct` rows with legacy links and preserved free-form pricing notes
- Does not destroy or rewrite Phase 0–4B knowledge records

## Future import integration (Phase 4D)

Catalog schema is import-ready. Phase 4D must require:

1. upload
2. structural validation
3. mapping preview
4. customer-reviewed column mapping
5. validation preview
6. explicit confirmation
7. activation

Never activate imported prices automatically.

## Known Phase 4C limitations

- No spreadsheet import UI
- Eligibility is descriptive, not executable policy
- Phase 3 onboarding catalogues are not yet fully replaced by the offerings UI
- No automatic conflict resolution against document-derived knowledge
- No AI-assisted comparison or enrichment
