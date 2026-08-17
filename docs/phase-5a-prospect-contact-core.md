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

People at a prospect. One prospect may have many contacts. Fields: names, display name, title/role, optional BCP 47 `preferredLanguage`, `isPrimary` (at most one **active** primary per prospect; partial unique index), independent OCC `version`, `ACTIVE`/`ARCHIVED` lifecycle, `archivedAt` / `restoredAt`.

Archiving a primary contact clears `isPrimary`. Remaining contacts are not auto-promoted. The prospect may have no primary until an authorized user sets one. Restore returns the same contact identity and does not restore primary status.

### Communication channels (`ProspectChannel`)

Canonical phone and email points. `kind` is an enum (`PHONE`, `EMAIL`) so later channels can be added without a one-column redesign. `contactId` null means the channel belongs to the prospect (for example a main office number). Display value is preserved; `normalizedValue` is used for matching.

Channels are non-destructively archived (`ACTIVE` / `ARCHIVED`) rather than deleted, so a later consent or suppression record can keep a stable identity. Re-adding the same normalized value for the same owner restores the archived row instead of inserting a duplicate. A partial unique index allows only one **active** row per prospect + owner + kind + normalized value.

### Custom fields

Reuses Phase 3B `CustomFieldDefinition`. Phase 5A stores values in:

- `ProspectCustomValue` for `PROSPECT` scope
- `ProspectContactCustomValue` for `CONTACT` scope

Definitions remain organization-controlled. Browser-supplied definition documents, data types, scopes, validation rules, and organization IDs are rejected. The server re-queries active definitions and validates scope, organization, required fields, types, allowed options, and active status. Wrong scope, inactive, foreign-org, and type/validation failures fail closed without deleting stored rows. Inactive definitions with stored values appear as read-only history on edit forms.

### Merge provenance

`ProspectMerge` is an immutable receipt: organization, survivor id, merged id, actor, timestamp, and canonical JSON text of explicit field resolutions. The losing `Prospect` row is kept with `lifecycle = MERGED` and `mergedIntoProspectId` pointing at the survivor. A PostgreSQL `BEFORE UPDATE` trigger rejects any receipt mutation, following the Phase 4 CSV immutable-record pattern. Organization cascade delete of the parent organization remains allowed.

## Lifecycle

1. **Create** — validate membership/`org.prospects.manage`, prospect/contacts/channels/custom values, then search duplicates under the org lock. If candidates exist and `acknowledgeDuplicates` is not set, return a review warning and create nothing. Otherwise insert atomically with `sourceKind = MANUAL`.
2. **Update (patch)** — OCC on prospect `version`. Omitted JSON keys are preserved. `null` or a blank string is an explicit clear for optional text fields. `customValues: []` or an omitted array preserves every stored custom value. A submitted `{ definitionKey, value: null | "" | [] }` pair clears that optional key. Archived and merged prospects are not independently editable.
3. **Archive** — non-destructive `ACTIVE → ARCHIVED`. Contacts, channels, custom values, and history remain. Child mutations are rejected until restore.
4. **Restore** — same row returns to `ACTIVE`. Duplicate candidates may be returned; restore never auto-merges.
5. **Merge** — explicit survivor, duplicate, and conflict resolutions. Contacts move; distinct channels are kept; identical active prospect-level channels are archived on the loser rather than deleted; non-conflicting custom values are copied; conflicting custom values require a choice. The loser remains as `MERGED`. Merge fails closed if combined contact or channel counts (including archived rows) would exceed the caps.
6. **Contact update / archive / restore** — independent contact OCC. Mutations recheck active membership and `org.prospects.manage` inside the transaction. Archived contacts remain visible as history and cannot be edited, given new channels, or retired-from until restored.
7. **Channel add / retire** — contact-owned channels bump the **contact** version; prospect-owned channels bump the **prospect** version. Retire archives the row.

Caps count every stored row, including archived: 50 contacts and 100 communication points per prospect, across create, later additions, restore, and merge.

## Prospect edit preservation versus explicit clearing

The update contract is a patch, not a full replacement:

| Client payload | Server behaviour |
| --- | --- |
| Key omitted | Keep the stored value |
| `null` or blank string | Clear that optional field |
| Non-empty value | Validate and replace that field |
| `customValues` omitted or `[]` | Keep every stored custom value |
| `{ definitionKey, value }` | Set or clear only that key after re-querying the definition |

The browser form still posts the current visible fields so a normal Save keeps addresses, website, timezone, location, and custom values. The server does **not** trust hidden fields as the only preservation mechanism: an API client that sends only `displayName` cannot blank the rest. Audit metadata records the names of fields that actually changed (`displayName`, `website`, `address`, `timeZone`, `customValues`, …). Raw custom values, addresses, phones, and emails are not written to audit metadata.

## Custom-field UI

Create and edit screens render typed controls for every Phase 3 data type already allowed by `validateCustomFieldValue`: `TEXT`, `LONG_TEXT`, `NUMBER`, `BOOLEAN`, `DATE`, `SINGLE_SELECT`, `MULTI_SELECT`, `URL`, `EMAIL`, `PHONE`.

The same `CustomFieldInputs` component is used for prospect create/edit and contact add/edit. The server supplies labels, help text, required state, choices, and constraints. The browser sends only `{ definitionKey, value }`. Required fields are marked visually and with `aria-required`. Field-specific errors use `customValues.<key>` and render next to the control. Optional fields have an explicit Clear action. Existing values populate edit forms.

## Contact editing, archive, restore, and primary rules

Authorized managers (`org.prospects.manage`) can open **Edit contact** from the prospect detail page and change first/last name, display name, title/role, preferred language, primary-contact state, and contact custom fields.

- At most one **active** primary contact exists per prospect (application transaction + partial unique index).
- Setting a contact primary atomically clears `isPrimary` on every other contact in that prospect.
- Archiving the primary clears `isPrimary` and does not promote another contact.
- Restore does not make the contact primary.
- Archived contacts stay on the detail page as history. Edit, add-channel, and retire-channel controls are hidden until restore.

## Contact-level communication points

Each active contact has its own add-channel form and retire action. Phone values are stored with E.164 matching forms when a valid parse exists; emails are stored with a lowercase matching form. The UI states that a stored channel is not permission to contact. Consent, suppression, calling windows, and contact-policy decisions are out of scope.

## Authorization and tenant isolation

- `org.prospects.read` — OWNER, ADMIN, MEMBER (list/detail; members do not see mutation controls)
- `org.prospects.manage` — OWNER, ADMIN (create, update, archive, restore, merge, contacts, channels)

Every mutation rechecks active membership inside the transaction. Child IDs are always queried with `organizationId` (and `prospectId` where applicable). Foreign ids are indistinguishable from missing (`not_found`).

## Audit and privacy

Actions: `PROSPECT_CREATED`, `PROSPECT_UPDATED`, `PROSPECT_ARCHIVED`, `PROSPECT_RESTORED`, `PROSPECT_MERGED`, `CONTACT_CREATED`, `CONTACT_UPDATED`, `CONTACT_ARCHIVED`, `CONTACT_RESTORED`.

Metadata is identifiers, counts, and changed-field names. Full contact payloads, notes, raw custom values, phones, emails, and addresses are not written to audit metadata, logs, URLs, or error messages.

## UI

Routes under `/app/orgs/[slug]/prospects`:

- list with search, lifecycle filter, pagination
- create (duplicate warning + continue; prospect and contact custom fields)
- detail (contacts, channels, custom values, recent audit, archive/restore, contact edit/archive/restore, contact-level channels)
- contact edit
- prospect edit (full address + custom fields; patch semantics)
- merge review (survivor choice, conflicts, explicit confirmation)

## Testing

- Unit: phone/email/website/name/search sanitization; update patch vs explicit clear
- RTL: create form second contact + duplicate warning; custom-field controls for every data type; required/optional labels and field errors; prospect vs contact fields on create
- Integration: CRUD, OCC, archive/restore, channels, search/pagination/isolation, custom fields of every type, authorization, audit privacy, merge, concurrent merge, update-vs-merge, rollback; name-only edit preservation; optional/required custom-value survival; explicit clear; stale update unchanged; failed update rollback; contact update/archive/restore; primary-contact change; archived-contact mutation denial; contact-level channel add/retire/restore-identity; member and foreign-ID denial; concurrent contact update and archive/update races; merge-receipt UPDATE rejected
- E2E: create with two contacts; search/edit prospect; edit contact; change primary; add a contact communication point; archive and restore that contact; archive/restore prospect; duplicate warning + merge review

## Exclusions / extension points

- **5B** — consent, suppression, calling windows, decision engine (channels exist; no permission flag)
- **5C** — assignment, queues, notes, CRM timeline UI (audit events are durable evidence)
- **5D** — CSV import/export (`sourceKind` / `sourceDetail` can grow without identity redesign)
- No Twilio, SMS, email sending, AI, crawling, or external CRM connectors
- XLSX / OOXML import remains out of scope (`MR-4D-OOXML-001` is unchanged)

## Remaining Phase 5A limitations

- Semantic duplicate / near-duplicate / factual-truth arbitration is not performed. Duplicate detection is a warning only.
- Custom-field PHONE values reuse the Phase 3 text validator (1–500 characters). E.164 normalization applies to `ProspectChannel` phones, not to custom-field strings.
- A prospect may have zero active primary contacts after the primary is archived.
- Channel retirement is archival, not a consent or suppression event.
- No background jobs, CSV prospect import, or contact-policy engine.

## Transaction lock order

Phase 5A writers never take Phase 3/4 advisory locks. If a future writer must take multiple families: readiness → config-3b → knowledge → offerings → csv-import → prospects.
