# Phase 5A — Prospect and contact core

Status: implemented on `feature/phase-05a-prospect-contact-core`.
Started from `develop` `cc5d1490ffbce817c86ac68a6809bea463fb5ead`.
Related: `requirements.md` CRM-001; `outreach-implementation-phases.md` Phase 5A.

Phase 5A establishes organization-scoped CRM identity. It does **not** decide whether Outreach may call, SMS, or email anyone. A stored phone or email is a record, not consent. Phase 5B owns contact policy.

## Schema

All CRM rows include `organizationId`. Child records use composite foreign keys `(id, organizationId)` / `(contactId, organizationId, prospectId)` so a user-supplied child ID cannot attach across tenants.

### Prospect

Canonical CRM record. Not every row is a business.

- `kind`: `BUSINESS` | `INDIVIDUAL` | `HOUSEHOLD` | `ORGANIZATION`
- `displayName` plus `searchName` (normalized for matching)
- website display + normalized hostname
- location/address/country/time zone
- `sourceKind` (`MANUAL` in Phase 5A) and nullable `sourceDetail` reserved for later provenance keys
- `lifecycle`: `ACTIVE` | `ARCHIVED` | `MERGED`
- OCC `version`
- archive/restore timestamps and actors
- `mergedIntoProspectId` when `MERGED` (never self; database check)

### Contact (`ProspectContact`)

People at a prospect. One prospect may have many contacts. Fields: names, display name, title/role, optional BCP 47 `preferredLanguage`, `isPrimary` (at most one active primary per prospect), independent OCC `version`, `ACTIVE`/`ARCHIVED` lifecycle.

### Communication channels (`ProspectChannel`)

Canonical phone and email points. `kind` is an enum (`PHONE`, `EMAIL`) so later channels can be added without a one-column redesign. `contactId` null means the channel belongs to the prospect (for example a main office number). Display value is preserved; `normalizedValue` is used for matching.

### Custom fields

Reuses Phase 3B `CustomFieldDefinition`. Phase 5A stores values in:

- `ProspectCustomValue` for `PROSPECT` scope
- `ProspectContactCustomValue` for `CONTACT` scope (enum value added in this migration)

Definitions remain organization-controlled. Browser-supplied definition documents are rejected. Wrong scope, inactive, foreign-org, and type/validation failures fail closed.

### Merge provenance

`ProspectMerge` is an immutable receipt: organization, survivor id, merged id, actor, timestamp, and canonical JSON text of explicit field resolutions. The losing `Prospect` row is kept with `lifecycle = MERGED` and `mergedIntoProspectId` pointing at the survivor.

## Lifecycle

1. **Create** — validate membership/`org.prospects.manage`, prospect/contacts/channels/custom values, then search duplicates under the org lock. If candidates exist and `acknowledgeDuplicates` is not set, return a review warning and create nothing. Otherwise insert atomically with `sourceKind = MANUAL`.
2. **Update** — OCC on prospect `version`. Archived and merged prospects are not independently editable.
3. **Archive** — non-destructive `ACTIVE → ARCHIVED`. Contacts, channels, custom values, and history remain. Child mutations are rejected until restore.
4. **Restore** — same row returns to `ACTIVE`. Duplicate candidates may be returned; restore never auto-merges.
5. **Merge** — explicit survivor, duplicate, and conflict resolutions. Contacts move; distinct channels are kept; identical prospect-level channels are not duplicated; non-conflicting custom values are copied; conflicting custom values require a choice. The loser remains as `MERGED`.

## Normalization

- **Phone** — `libphonenumber-js` (already in the repository). Display is the trimmed input; matching form is E.164 when a valid parse exists. Canadian/US numbers need `+` or an organization primary-location / `en-CA` locale country. Ambiguous national numbers without country context are rejected rather than guessed.
- **Email** — trim, max 254, existing `emailSchema`. Display keeps original case; matching form is lowercase. Gmail dot/plus equivalence is not applied. Mailboxes are not contacted.
- **Website** — http(s) only. Display is the trimmed input; matching form is lowercase hostname without a leading `www`. `javascript:` / `data:` / other schemes are rejected. Phase 5A never fetches customer websites. Rendered links use `safeWebsiteHref`.

## Search, filters, pagination

- Fields: prospect name/`searchName`, contact names, normalized phone, email, website hostname.
- Filters: `ACTIVE` (default) or `ARCHIVED`; optional `sourceKind`. Merged rows are excluded from those lists.
- Pagination: offset, default 20, max 50. Query text is sanitized (`%`, `_`, `\` stripped) and bounded to 200 characters. Filtering is database-side Prisma `contains` (parameterized). No Elasticsearch, vectors, or AI search.
- Order: `updatedAt DESC, id DESC`.

## Duplicate detection and merge

Deterministic candidates only (no LLM):

- exact normalized phone
- exact normalized email
- same normalized website hostname **and** strongly normalized name
- strongly normalized name **and** the same location key

A candidate is a warning. Creation continues only after explicit acknowledgment. Nothing is auto-merged.

Merge concurrency:

1. `organization-prospects:<organizationId>` advisory lock
2. Actor membership `FOR UPDATE` + `org.prospects.manage`
3. Both prospect rows `FOR UPDATE` in stable id order
4. Contacts, channels, custom values, then flatten `mergedIntoProspectId` pointers that previously targeted the loser so canonical resolution stays one hop

Self-merge, already-merged participants, cross-tenant ids, and stale OCC versions fail closed. `testBeforeCommit` throwing rolls back the entire merge.

## Authorization and tenant isolation

- `org.prospects.read` — OWNER, ADMIN, MEMBER
- `org.prospects.manage` — OWNER, ADMIN (create, update, archive, restore, merge, contacts, channels)

Every mutation rechecks active membership inside the transaction. Child IDs are always queried with `organizationId` (and `prospectId` where applicable). Foreign ids are indistinguishable from missing (`not_found`).

## Audit and privacy

Actions: `PROSPECT_CREATED`, `PROSPECT_UPDATED`, `PROSPECT_ARCHIVED`, `PROSPECT_RESTORED`, `PROSPECT_MERGED`, `CONTACT_CREATED`, `CONTACT_UPDATED`, `CONTACT_ARCHIVED`.

Metadata is identifiers, counts, and changed-field names. Full contact payloads, notes, raw custom values, phones, and emails are not written to audit metadata, logs, URLs, or error messages.

## UI

Routes under `/app/orgs/[slug]/prospects`:

- list with search, lifecycle filter, pagination
- create (duplicate warning + continue)
- detail (contacts, channels, custom values, recent audit, archive/restore)
- edit
- merge review (survivor choice, conflicts, explicit confirmation)

The UI states that a stored channel is not permission to contact. No Phase 5B consent, 5C queues/notes, or 5D CSV import.

## Testing

- Unit: phone/email/website/name/search sanitization
- RTL: create form second contact + duplicate warning does not auto-merge
- Integration: CRUD, OCC, archive/restore, channels, search/pagination/isolation, custom fields, authorization, audit privacy, merge, concurrent merge, update-vs-merge, rollback
- E2E: create with two contacts; search/edit; archive/restore; duplicate warning + merge review

## Exclusions / extension points

- **5B** — consent, suppression, calling windows, decision engine (channels exist; no permission flag)
- **5C** — assignment, queues, notes, CRM timeline UI (audit events are durable evidence)
- **5D** — CSV import/export (`sourceKind` / `sourceDetail` can grow without identity redesign)
- No Twilio, SMS, email sending, AI, crawling, or external CRM connectors

## Transaction lock order

Phase 5A writers never take Phase 3/4 advisory locks. If a future writer must take multiple families: readiness → config-3b → knowledge → offerings → csv-import → prospects.
