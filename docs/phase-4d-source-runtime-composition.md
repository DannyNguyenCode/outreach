# Phase 4D — Source classification and runtime composition

Status: Implementation in progress on `feature/phase-04d-source-runtime-composition-v2`  
Requirement: `KNOW-004`  
Adjacent preparation: `KNOW-005`  
Depends on: develop SHA `01eb8b88a9b0cafa5bc07d0bd78359f9bc19ecad` (PR #12)

## Scope

This slice introduces a single server-side runtime evidence architecture. It
fully composes only the customer-confirmed knowledge and structured offering
domains delivered in Phases 4A–4C. It does not implement prospects, CRM,
calling, transcription, operational integrations, AI generation, calendar
integration, or the information-gap workflow.

It also does **not** consume CSV/XLSX preview output, add spreadsheet
upload/mapping/persistence/activation, or claim Phase 4D tabular import
completion. `MR-4D-OOXML-001` remains OPEN.

No database migration is required. Existing organization ownership,
confirmation, version, citation, and offering-child identifiers remain the
source of truth.

## Canonical source classes

`lib/orgs/runtime-evidence.ts` is authoritative. Every class has a label,
description, claim scope, authority classification, authority order, Phase 4D
implementation status, and an explicit declaration of whether it may support
an organization-specific claim.

- `CUSTOMER_CONFIRMED_KNOWLEDGE` — current confirmed manual or private-document
  knowledge about the organization.
- `STRUCTURED_OFFERING` — current confirmed offerings, prices, variants,
  features, eligibility, and custom values.
- `PROSPECT_EVIDENCE` — evidence about one prospect.
- `CRM_FACT` — prospect-specific CRM and prior-interaction facts.
- `CALLER_STATEMENT` — a statement attributed to a caller in one call.
- `REPRESENTATIVE_NOTE` — a labelled human note or confirmation.
- `OPERATIONAL_DATA` — current operational state for the exact fact it
  represents.
- `AI_INFERENCE` — explicitly labelled model inference.
- `UNKNOWN` — no current authorized evidence supports the claim.
- `CONFLICT` — current evidence disagrees and must not be silently arbitrated.

The exhaustive `RUNTIME_SOURCE_ADAPTERS` registry requires every source class
to declare an adapter or an explicit `null`. Adding a string alone cannot make
a future source silently composable.

## Authority semantics

| Classification | Source classes | Meaning |
| --- | --- | --- |
| Organization authoritative | Customer-confirmed knowledge, structured offerings | May support an organization-specific claim only while current, confirmed, and authorized. |
| Prospect-specific context | Prospect evidence, CRM facts, caller statements, representative notes | Describes a particular prospect/call. It cannot establish universal facts about the Outreach organization. |
| Operational current | Operational data | May supersede stale static data only for the exact operational fact represented. |
| Inference only | AI inference | Never authoritative and always labelled as inference. |
| No authority | Unknown, conflict | Requires a warning/zero-support outcome, not an invented answer. |

Authority order is guidance for deterministic presentation. It is not truth
arbitration. Operational data leads only for its exact operational question;
structured offering values lead other structured values; current confirmed
knowledge follows. Conflicts remain visible.

## Organization and prospect isolation

`OrganizationRuntimeEvidence` has organization claim scope and cannot carry a
prospect or call ID. `ProspectRuntimeEvidence` requires a prospect ID and is
limited to prospect/call source classes. Requests for prospect sources require
a prospect context; caller statements require both prospect and call context.

Composition is read-only. It has no writer that can promote a caller statement,
representative note, CRM fact, or prospect audit into a `KnowledgeSource`.
Promotion to reusable business knowledge remains a separate future,
permissioned customer confirmation workflow.

## Runtime evidence contract

Every evidence item includes:

- canonical `sourceClass`, organization ID, evidence ID, and claim scope;
- stable source entity, source version, and optional child ID;
- bounded safe text and source-bounded prompt text;
- a bounded client-safe structured value where applicable;
- current/effective, expiry, confirmation, and observation metadata;
- authority classification and presentation order;
- required organization visibility/permission;
- a discriminated provenance object;
- optional deterministic retrieval relevance metadata.

Internal storage paths, checksums, raw uploader internals, and arbitrary
database JSON are not copied to the public runtime item. Structured JSON is
recursively depth/key/string bounded before exposure.

## Current adapters

### Customer-confirmed knowledge

The knowledge adapter calls the existing `retrieveActiveKnowledge` service and
maps its output; it does not duplicate its retrieval query. Existing SQL
predicates enforce:

- organization ownership;
- active membership and `org.knowledge.read`;
- customer-confirmed source category;
- `ACTIVE`, confirmed versions only;
- effective start and expiry windows;
- non-archived sources;
- manual or document input only;
- for documents, `CLEAN` scan plus `COMPLETE` processing.

Each passage remains separately attributable. Manual and document sources
preserve source ID, version ID, section ID, passage ID, both stable citation
keys, source title, and input kind. Storage bucket/object keys never enter the
runtime contract.

### Structured offerings

The offering adapter calls the existing `retrieveActiveOfferings` service.
Offering values remain structured evidence items rather than flattened
document passages:

- offering summary — offering ID and version ID;
- current price — price ID, amount string, currency, billing frequency,
  canonical offering name, and optional variant ID;
- active variant — variant ID and bounded attributes;
- feature — feature ID and stable feature key;
- eligibility — eligibility ID and structured constraints;
- custom value — value ID, definition ID, and stable definition key.

Only IDs selected by the Phase 4C current-price logic are adapted. Inactive,
future, and expired prices are excluded. Draft, superseded, expired, and
archived offering versions remain excluded by the existing retrieval service.

## Composition behavior

`composeRuntimeContext` accepts an authenticated actor, organization ID,
optional prospect/call IDs, optional query, requested source classes, and a
bounded limit.

- Query length: at most 200 characters.
- Result limit: 1–50; default 20.
- Existing deterministic substring retrieval is used.
- Current source adapters execute in parallel.
- Results are organization-checked again, ordered by authority guidance,
  source-child kind, title, and stable evidence ID.
- Conflicts are detected over that bounded candidate pool before final
  truncation. Conflict-aware selection keeps both cited evidence items
  whenever `CONFLICT` is emitted, never exceeds the requested `limit`, and
  cannot be converted to `SUPPORTED` by higher-priority child volume. A
  limit too small to carry a pair (`limit < 2`) returns the ordinary
  truncated slice without emitting `CONFLICT`.
- Unsupported future source adapters return no fabricated data and are listed
  in `unavailableSourceClasses`.
- Empty support returns `supportState: UNKNOWN`.

No embeddings, vector database, LLM ranking, or generated answer is introduced.
Retrieval strategy may change later without changing evidence provenance.

## Conflict representation

Conflicts include a stable conflict ID, conflict kind, both evidence IDs,
source classes, and both provenance objects. Evidence records are retained;
neither source is overwritten or silently discarded.

This slice implements one deliberately narrow deterministic detector:

1. the structured item is a current base offering price;
2. the price carries the canonical offering name, which is matched as an
   explicit normalized token/phrase in the passage (short names such as
   `Pro` do not match inside unrelated words such as `improve`);
3. the passage contains an explicit money amount using the structured
   currency code or a reviewed compatible marker for that code only
   (`CAD`/`C$`/`CA$`, `USD`/`US$`, `EUR`/`€`, `GBP`/`£`, `AUD`/`A$`/`AU$`,
   `NZD`/`NZ$`);
4. that amount differs from the structured price.

Marker patterns follow the marker's leading and trailing character classes.
If a marker begins with a Unicode letter, number, or underscore, it requires
a left token boundary; if it ends with one, it requires a right token
boundary. Alphabetic-prefix markers such as `C$`, `CA$`, `US$`, `A$`, `AU$`,
and `NZ$` therefore cannot match inside identifiers such as `ABC$49` or
`BUS$49`, while a trailing `$` may still sit directly against the amount
(`C$49`). Symbol markers such as `€` and `£` keep amount adjacency on the
symbol side. Three-letter ISO codes remain bounded on both sides.

Bare `$` is never treated as a relevant marker because it cannot prove USD
versus CAD versus AUD. Prefer no conflict over a false conflict when currency
cannot be proven. Euro, pound, and dollar symbols are not interchangeable.

The result is `supportState: CONFLICT`. Variant-specific and semantic conflict
resolution are deferred; no AI arbitration occurs.

## Unknown state

No matching current evidence is a valid `UNKNOWN` outcome with an empty item
list. The source inspector states that no answer was invented. This slice
does not persist an information-gap record and does not ask an LLM to fill
the gap.

## Prompt-safety boundary

`renderRuntimeSourceText` strips null characters, normalizes line endings, and
bounds each item to 1,600 characters. Inspector `safeText` keeps that bounded
customer content, including any reserved marker text the customer wrote.

Prompt-facing text uses a three-line encoding:

1. `[SOURCE CONTENT — <class>]`
2. a JSON string of `safeText` (single line, reserved markers escaped)
3. `[END SOURCE CONTENT]`

A source that contains the exact end marker plus a forged header cannot
create a second real boundary. Instruction-like source text remains visible
as data and is never executed or interpreted as application code.

This is a source boundary, not a complete prompt-injection defense. Future
prompt builders must place these values in a source-data channel and must not
concatenate them into system instructions.

## Authorization and tenant isolation

Composition independently checks the actor's current database membership and
`org.knowledge.read` before invoking adapters. Each existing retrieval service
also enforces that permission and organization-scopes every query. Inactive
members, unverified actors, forged actors, and actors from another tenant are
denied. Unknown source-class input, overlong queries, and out-of-range limits
are rejected before retrieval.

The source-inspection page is a Server Component. The browser does not query
Prisma or protected organization tables directly.

## Auditability

Each successful composition returns a compact
`RuntimeCompositionAuditRecord` containing:

- organization and actor IDs;
- optional prospect/call IDs;
- requested source classes;
- returned evidence/source/version/child IDs;
- support state and conflict IDs;
- composition timestamp.

It intentionally excludes source bodies, prompt text, storage paths, raw JSON,
and secrets. Inspector page loads do not persist this package. A future
pre-call/live assistance operation can persist this contract when the product
has the corresponding call/audit lifecycle.

## Source inspector

`/app/orgs/[slug]/knowledge/sources` lets an authorized member:

- enter a deterministic query;
- select current Phase 4D source classes;
- set a bounded result limit;
- inspect source class, authority, freshness, evidence IDs, and citations;
- see conflicts or an explicit unknown state.

It is an evidence preview, not an AI answer generator or call workspace.

## Performance boundaries

Both current adapters reuse indexed, organization-scoped Phase 4A/4C queries.
They request bounded first pages and execute concurrently. Child graphs are
loaded by the existing offering include rather than per-child queries. Global
composition output is deterministically bounded. No organization-wide
in-memory knowledge load, Redis cache, embedding index, or vector database is
introduced.

## Relationship to KNOW-005

This slice establishes the source labels, adapter registry, safe evidence
shape, authorization boundary, provenance, conflicts, unknown state, and audit
package that KNOW-005 can consume. KNOW-005 still owns broader
source-attributed retrieval behavior, future retrieval relevance, and
representative assistance integration.

## Known limitations

- Only customer-confirmed knowledge and structured offerings have live
  adapters.
- Prospect, CRM, caller, representative-note, operational, and AI domains are
  contracts only; no data is fabricated.
- Conflict detection is exact and narrow, not semantic.
- Audit packages are returned but not persisted for inspector page loads.
- There is no AI answer, prompt execution, information-gap persistence, call
  workflow, telephony, transcription, CRM, or calendar integration.
- CSV/XLSX mapping, persistence, and activation remain later Phase 4D work.
