# AttentionX backend specification

## 1. Purpose

AttentionX is a TypeScript Chrome Manifest V3 extension that adds a
decentralized trust and context layer to X timelines, profiles, search results,
and post pages.

The backend is responsible for:

- Nostr identity and signing;
- relay synchronization and publishing;
- stable X account and post identification;
- NIP-39 identity-proof verification;
- kind `32009` validation and replacement;
- durable local event storage;
- construction and bounded traversal of a local Web-of-Trust (WoT) graph;
- fast query results for the content-page UI.

The initial system is local-first. Nostr relays provide public transport and
storage, while IndexedDB provides the local event database. No central
AttentionX service is required. A specialized service may be added later, but
its output must remain independently verifiable from signed source events.

## 2. Architectural boundaries

X is an untrusted and frequently changing host page.

- The extension may read rendered semantic page data.
- A dedicated page-world observer may passively inspect allowlisted X JSON
  responses to extract public post IDs, handles, and numeric user `rest_id`
  values that X uses to render the current page.
- The observer clones responses; it never blocks, modifies, or fabricates X
  network traffic.
- Only normalized identity observations are forwarded to the isolated content
  script. Raw response bodies, request headers, cookies, authorization tokens,
  and unrelated fields are never forwarded or stored.
- Interception is an extraction adapter, not a protocol dependency. X response
  shapes and operation names are undocumented, so semantic DOM, public profile
  JSON-LD, verified NIP-39 mappings, and unresolved states remain required
  fallbacks.
- The extension may request public profile and proof-post pages to resolve and
  verify identities.
- A future composer integration may publish a NIP-39 proof post on behalf of
  the user only after an explicit user action, preview, confirmation, and
  active-account check. It must report the resulting post ID and any failure;
  it must never post silently. No such posting path exists currently.
- The Nostr secret key never enters the content script or page context.
- Signing, relay access, storage, identity verification, and graph computation
  run in the background service worker.
- The service worker can be suspended at any time. Durable state belongs in
  IndexedDB; the in-memory graph is a rebuildable cache.

Although X account IDs and public posts are public identifiers, intercepted
responses can also contain personalized, protected, or unrelated data. The
implementation therefore uses operation and field allowlists and immediately
discards everything except the minimum public identity tuple.

## 3. Protocols and identifiers

### 3.0 Event kinds

AttentionX uses these Nostr kinds:

| Kind | Role |
|------|------|
| `10011` | NIP-39 X ↔ Nostr identity links (`twitter` + `twitter_id`) |
| `32009` | Single-subject trust, distrust, and cancellation statements |

**Kind `1985` (NIP-32 labels) is unsupported.** The early design used
`attentionx` namespace labels on kind `1985`, but that format is retired: it
keys targets by mutable URLs, lacks addressable replacement per subject and
context, and does not fit the WoT graph model. The implemented backend neither
queries, ingests, migrates, nor publishes kind `1985`. It publishes and queries
kind `32009` for trust-related statements and kind `10011` for identity
linking.

See `docs/NIP-32009.md` and `docs/NIP-39.md`.

### 3.1 Nostr identity

The extension uses a Nostr public key as its local identity. The current PoC
retains a dedicated secret key in `chrome.storage.local`; content and
page-context code never receive it. Production should use an encrypted store or
external signer.

### 3.2 X accounts

An X handle is mutable and must never be the canonical identity of an account.
The canonical X account identifier is the decimal numeric user ID:

```text
twitter_id:11348282
```

The normalized kind `32009` subject for an X account is:

```text
ext:twitter_id:11348282
```

Rules:

- Accept only non-empty decimal digits.
- Preserve the decimal string exactly; do not convert it to a JavaScript
  `number`.
- Store the current lowercase handle only as an alias/display value.
- A handle change updates the alias but not the canonical subject.
- If the numeric ID cannot be resolved, profile trust publishing is disabled.
  AttentionX must not publish a durable profile statement keyed only by handle.

Resolution order:

1. Numeric ID already present in trusted local cache.
2. A sanitized observation from an allowlisted X JSON response containing both
   `rest_id` and the corresponding username.
3. Semantic metadata in the rendered page, when present.
4. Public profile JSON-LD at `https://x.com/<handle>`; read
   `mainEntity.identifier`.
5. A verified NIP-39 mapping containing `twitter_id`.
6. Otherwise return an unresolved state and retry with backoff.

Timeline post DOM normally contains the handle and post ID, but not the numeric
user ID. Avatar asset IDs, React IDs, generated classes, and accessibility IDs
must not be treated as account IDs. An intercepted `rest_id` is accepted only
when it occurs in a recognized user object together with the matching
username.

### 3.3 X posts

The numeric status ID is stable across handle changes. The normalized kind
`32009` subject for a post is:

```text
ext:twitter_post:2080659774136291424
```

The canonical display/link URL is handle-independent:

```text
https://x.com/i/web/status/2080659774136291424
```

### 3.4 NIP-39 identity links

NIP-39 uses replaceable kind `10011`, not kind `10111`.

AttentionX publishes the standard handle claim and an AttentionX extension:

```json
{
  "kind": 10011,
  "tags": [
    ["i", "twitter:nasa", "2080659774136291424"],
    ["i", "twitter_id:11348282", "2080659774136291424"]
  ],
  "content": ""
}
```

Both tags use the same proof-post ID. The handle is informational; AttentionX
uses `twitter_id` as the canonical account identifier.

The first implementation supports one primary X account per Nostr key. When
publishing an updated kind `10011` event, it:

1. queries the author's current kind `10011`;
2. preserves unrelated provider tags;
3. replaces the existing `twitter` and `twitter_id` tags;
4. signs and publishes the complete replacement event.

### 3.5 NIP-39 proof

The extension generates the NIP-39 proof text:

```text
Verifying my account on nostr My Public Key: "<npub>"
```

The backend currently generates this text, verifies existing proof posts, and
can return `already_proven` after rechecking the current kind `10011`
replacement for the same Nostr key and numeric X account. It does not currently
submit a post to X.

Phase D must add the composer workflow. The complete text and destination
account must be shown first; the active numeric X account must be verified; and
submission must require explicit confirmation for each proof post. After a
successful submission, AttentionX must capture the resulting post ID, verify
the post, then merge and publish the replacement kind `10011` event. A posting
or verification failure must leave the NIP-39 claim unpublished.

Before accepting an X/Nostr link, the verifier checks:

1. the kind `10011` event signature;
2. both X tags contain the same proof-post ID;
3. the proof post exists;
4. the proof text contains the event author's Nostr public key in the required
   form;
5. the proof post's author matches the declared handle;
6. public profile identity resolution maps that handle to the declared numeric
   ID.

Verification states are:

```text
unresolved | pending | verified | invalid | conflict
```

Unavailable X pages or relays produce `pending`, not `invalid`. Claims that
cannot be independently verified must not create graph aliases.

Multiple Nostr keys may validly prove control of the same X account over time.
AttentionX preserves provenance and does not silently choose one key as the
account's unique owner.

### 3.6 Trust statements

Direct trust inputs use addressable kind `32009` defined in
`docs/NIP-32009.md`. Do not use NIP-32 kind `1985` or the
`attentionx-assessment-v1` label schema for new trust or feedback data.

- `v = "1"` means trust.
- `v = "0"` cancels the slot.
- `v = "-1"` means distrust.
- `c` scopes trust to a canonical context.
- One newest valid event is resolved per
  `(author pubkey, normalized subject, context)`.

An X-account statement always targets the stable numeric ID:

```json
{
  "kind": 32009,
  "tags": [
    ["d", "<sha256-of-ext:twitter_id:11348282>:identity"],
    ["i", "ext:twitter_id:11348282"],
    ["c", "identity"],
    ["v", "1"]
  ],
  "content": ""
}
```

An X-post statement targets the stable post ID:

```json
{
  "kind": 32009,
  "tags": [
    ["d", "<sha256-of-ext:twitter_post:2080659774136291424>:news:accuracy"],
    ["i", "ext:twitter_post:2080659774136291424"],
    ["c", "news:accuracy"],
    ["v", "-1"]
  ],
  "content": "The cited source does not support the claim."
}
```

An `i` subject is a terminal reputation subject. It does not itself create a
traversable WoT edge. If an X account has a verified NIP-39 link, the UI may
separately offer to trust the linked Nostr identity. That action publishes a
second kind `32009` statement with a `p` subject. Only positive `p` statements
are graph-expansion edges. The account statement and Nostr-key statement are
independent and must never be double-counted as two people.

## 4. Backend components

### 4.1 Page-world observer and content adapter

The page-world observer starts before X initializes its network clients. It
wraps `fetch` and `XMLHttpRequest` only to inspect cloned successful JSON
responses from an allowlist of X operation names and response content types.
Original requests and responses continue unchanged.

The observer recognizes versioned user-object shapes, including objects that
pair `rest_id` with `legacy.screen_name` or an equivalent username field. It
emits only:

```ts
interface ObservedXIdentity {
  twitterId: string
  handle: string
  observedAt: number
  sourceOperation: string
  postIds?: string[]
}
```

The isolated content script validates `window.postMessage` source and schema,
combines observed and rendered post IDs, and forwards bounded sanitized batches
to the background. The bridge never receives extension secrets or gives page
code direct access to extension APIs.

All values received from the page are untrusted and validated again in the
background. Unknown operations and response shapes are ignored. Parsing has
strict byte, depth, object-count, and rate limits.

### 4.2 Identity resolver

Responsibilities:

- normalize handles;
- resolve handle aliases to numeric X IDs;
- ingest sanitized `rest_id` and username observations;
- cache successful and failed resolutions with timestamps;
- parse public profile JSON-LD;
- query and validate kind `10011` claims;
- verify proof posts;
- expose resolution state and provenance;
- detect conflicting mappings.

Handle aliases have a short TTL because handles can move between accounts.
Numeric-ID mappings and proof records remain durable but retain `verifiedAt`
and source metadata so they can be rechecked.

### 4.3 Event validator and reducer

Responsibilities:

- verify Nostr IDs and signatures before storage;
- enforce all kind `32009` validation rules;
- validate supported kind `10011` tags;
- calculate and verify deterministic `d` tags;
- resolve addressable-event replacement using `created_at`, then lexical event
  ID for ties;
- retain cancelled and expired newest events without reviving older events;
- preserve unknown tags in raw events.

Invalid events may be counted for diagnostics but never enter indexes or the
graph.

### 4.4 Relay synchronizer

The synchronizer uses user-configured relays and stores relay provenance.

Bootstrap:

1. Start from the user's configured root Nostr pubkey or pubkeys.
2. Query kind `32009` events authored by the roots.
3. Validate and store the events.
4. Follow positive, active `p` statements up to configured bounds.
5. Query newly discovered authors and repeat.
6. Query relevant kind `10011` mappings for X identity resolution.

Incremental synchronization:

- Store a cursor per relay and query scope.
- Use `since = lastSeenCreatedAt - overlapSeconds` to avoid missing events
  sharing a timestamp or arriving late.
- Deduplicate by event ID.
- Advance a cursor only after end-of-stored-events (EOSE).
- Periodically re-query current addressable slots to detect replacements.
- Retry relays independently with exponential backoff and jitter.
- Never interpret absence from one relay as deletion or distrust.

Bounds are required:

```ts
interface GraphLimits {
  maxDepth: number
  maxAuthorsPerLevel: number
  maxTotalAuthors: number
  maxEvents: number
}
```

Defaults must be conservative and user-configurable later.

### 4.5 Local event repository

IndexedDB is the durable backend store. Raw signed events are retained so they
can be revalidated, reindexed, exported, or shared later.

Required object stores:

```text
events
  key: event id
  value: complete raw Nostr event plus firstSeenAt
  indexes: kind, pubkey, created_at

addresses
  key: kind:pubkey:d
  value: winning event id

tagIndex
  key: kind:tagName:tagValue:eventId
  value: event id

relayObservations
  key: relayUrl:eventId
  value: firstSeenAt, lastSeenAt

syncCursors
  key: relayUrl:scopeHash
  value: lastSeenCreatedAt, lastEoseAt, retry state

xIdentities
  key: twitterId
  value: handles, verified Nostr claims, proof state, timestamps

handleAliases
  key: normalized handle
  value: twitterId, source, observedAt, expiresAt

outbox
  key: event id
  value: per-relay publish status and retry state
```

`chrome.storage.local` remains for the small settings object, relay
configuration, and the PoC signing key. It is not used as the WoT event
database.

Database migrations are explicit and versioned. An interrupted migration must
be restartable.

### 4.6 In-memory graph

The graph is built from reduced local events, not directly from relay results.

Node types:

- Nostr pubkey: traversable;
- X account numeric ID: terminal;
- X post ID: terminal.

Edge and statement rules:

- only active `v = "1"` statements with `p` subjects create traversal edges;
- `v = "-1"` is evidence about a subject, not a negative traversal edge;
- `v = "0"` contributes no active statement;
- context resolution follows exact context, nearest parent, then general;
- expired or not-yet-active newest events contribute nothing;
- path depth, fan-out, authors, and total events are capped;
- every result retains paths and source event IDs for explanation.

The service worker lazily rebuilds the graph after startup and updates affected
nodes after event ingestion. No correctness assumption depends on the graph
remaining in memory.

### 4.7 Trust query engine

The backend returns evidence, not an unexplained universal score:

```ts
interface TrustQueryResult {
  subject: string
  context: string
  resolution: 'trusted' | 'distrusted' | 'mixed' | 'none'
  direct?: ResolvedStatement
  statements: ResolvedStatement[]
  paths: TrustPath[]
  sourceEventIds: string[]
  computedAt: number
  graphVersion: number
  truncated: boolean
}
```

The initial evaluator may report direct and reachable statements plus graph
distance. A numerical weighting formula must be specified and tested before
the UI presents a derived score. A raw count of statements must never be
labelled a Web-of-Trust score.

### 4.8 Publisher and outbox

Publishing is write-through:

1. validate and sign in the service worker;
2. atomically store the event and per-relay outbox entry;
3. update the address winner, reducer, and graph;
4. publish independently to configured relays;
5. retain per-relay success and retry status.

Local success does not imply relay delivery. The UI receives both the event ID
and delivery status.

## 5. Background message API

The frontend depends on background messages rather than relay or IndexedDB
details. New backend APIs carry schema version `1`; compatibility popup and
assessment requests remain accepted without a request version, while every
response identifies version `1`:

```text
GET_STATE
GENERATE_IDENTITY
IMPORT_IDENTITY
CLEAR_IDENTITY
SAVE_RELAYS

RESOLVE_X_IDENTITY
GET_X_IDENTITY
GENERATE_X_PROOF
VERIFY_X_PROOF
PUBLISH_X_IDENTITY

PUBLISH_TRUST_STATEMENT
CANCEL_TRUST_STATEMENT
QUERY_TRUST

START_WOT_SYNC
GET_WOT_SYNC_STATUS
STOP_WOT_SYNC
```

Messages use serializable data. The background rejects other extension origins
and validates each newer request's version plus relevant lengths, numeric IDs,
contexts, and Nostr identifiers.

## 6. Startup and runtime flow

1. The service worker opens and migrates IndexedDB.
2. It loads settings and the configured Nostr root, rebuilds the in-memory
   graph, and retries due outbox entries.
3. Startup and 15-minute `chrome.alarms` maintenance runs bounded incremental
   relay synchronization when an identity is configured.
4. New valid events update local indexes; the graph is rebuilt after ingestion
   and synchronization.
5. The page observer reports sanitized user-ID observations in batches.
6. The content script associates observations with visible posts.
7. Trust queries return currently stored evidence immediately, including
   truncation and computation metadata.

The current UI shows evidence resolution and truncated/partial state but does
not yet expose a complete cached-versus-fresh sync lifecycle.

## 7. Security, privacy, and abuse controls

- Treat page messages, relay events, profile HTML, and proof posts as untrusted.
- Apply strict size limits before parsing or storing data.
- Never expose secret-key material to content scripts.
- Observe only explicitly allowlisted X JSON operations and successful JSON
  responses needed to render public users or posts.
- Copy only `{twitterId, handle, postIds?, observedAt, sourceOperation}` from
  intercepted data; discard raw payloads immediately.
- Never collect request headers, cookies, authorization tokens, direct
  messages, protected-post bodies, or unrelated personalized timeline data.
- Never modify X requests or responses.
- Proof-post submission requires a preview and a fresh explicit confirmation.
- Never submit any other X post or account action.
- Verify the active X account matches the intended numeric account before
  submitting a proof.
- Rate-limit identity resolution and cache negative results.
- Use multiple relays; record provenance and partial failures.
- Preserve evidence for every displayed conclusion.
- Make clear that trust is subjective to the selected roots and contexts.
- Provide local deletion/export controls before production release.

## 8. Optional future services

A future AttentionX service may provide:

- relay aggregation;
- precomputed graph snapshots;
- identity-proof monitoring;
- abuse and spam heuristics;
- availability for constrained clients.

Such a service is an optimization, not an oracle. Responses should include
signed source event IDs, graph parameters, and enough provenance for local
verification. A peer-to-peer transport may also be added later without changing
the event model or local query API.

## 9. Backend implementation phases and status

### Phase A — protocol core: implemented

- kind `32009` builder, parser, validator, deterministic `d` calculation,
  replacement reducer, cancellation, and activation/expiration handling;
- canonical `ext:twitter_id` and `ext:twitter_post` subjects;
- kind `10011` merge, parse, signature validation, proof verification, and
  publication;
- unit tests with valid and adversarial fixtures.

Kind `1985` is not a compatibility reader: it is unsupported and discarded.

### Phase B — durable local backend: implemented

- versioned IndexedDB schema and restartable atomic upgrades;
- raw event repository, address and tag indexes, relay provenance, X identity
  records, and repository-level raw import/export;
- relay synchronizer with EOSE cursor advancement, overlap windows,
  deduplication, retry, and conservative graph-sync limits;
- durable per-relay outbox with retry and partial-delivery state;
- `chrome.alarms` maintenance for sync and due outbox work.

### Phase C — identity and WoT: implemented, with validation still needed

- allowlisted `MAIN`-world JSON observer and sanitized isolated-world bridge;
- public X identity resolver with expiring aliases and explicit unresolved,
  pending, and conflict states;
- NIP-39 proof generation, verification, `already_proven` handling, and
  verified-claim persistence;
- replacement-reduced in-memory graph rebuilt from IndexedDB;
- deterministic bounded traversal and evidence-preserving trust query API.

These paths have fixture and unit coverage. Large-scale performance
characterization and manual compatibility verification against live X have not
been completed or claimed.

### Phase D — frontend integration: partially implemented

Implemented:

- visible-post identity observation batches;
- stable profile and post descriptors with default `identity` and
  `news:accuracy` contexts;
- kind `32009` trust/distrust publishing and local evidence display;
- local-only question state;
- Shadow DOM mounting, SPA rescanning, accessibility labels, and English/Danish
  strings.

Remaining:

- proof-post composer integration with a visible preview, active-account
  verification, explicit confirmation, result capture, and the complete
  `already_proven` identity-linking workflow;
- richer cancellation, context selection, evidence explanation, sync freshness,
  and outbox delivery UI;
- manual end-to-end testing on current live X layouts and responses.

## 10. Backend definition status

Implemented in source and covered by automated tests:

- canonical X account/post identifiers and default contexts;
- kind `32009` and supported kind `10011` validation;
- durable raw events, reducer indexes, cursor state, identity data, and outbox
  state in IndexedDB;
- overlap-based relay synchronization and event-ID deduplication;
- minimized, bounded identity extraction with no raw page payload persistence;
- bounded graph expansion reproducible from reduced stored events;
- evidence results with paths, source event IDs, and truncation state.

The proof-post safety boundary is preserved because no X posting path currently
exists. Definition-of-done for proof posting is therefore still open until
Phase D adds preview, explicit confirmation, and active-account verification.
Likewise, automated passing status does not establish live-relay or live-X
compatibility; those require separate manual verification.

## 11. Current implementation gap

The backend described in sections 3 through 7 is now present: kind `32009`
publishing and validation, kind `10011` merge and verification, IndexedDB raw
event storage, reducer indexes, cursor synchronization, outbox retry, bounded
local WoT traversal, identity resolution, and the minimized page-world observer
are wired into the service worker and content adapter.

The primary gap is Phase D workflow and product validation, not backend
replacement. The extension still needs the guarded proof-post composer flow and
identity-linking UI, richer trust controls/explanations, and manual end-to-end
verification against live X and real relay failure modes. No statement in this
document should be read as evidence that current live-X behavior has been
manually verified.

UI and workflow inspiration:

https://github.com/nostr-wot/nostr-wot-extension















