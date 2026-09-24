# Attention backend specification

## 1. Purpose

Attention is a TypeScript Chrome Manifest V3 extension that adds a
decentralized trust and context layer to X timelines, profiles, search results,
and post pages.

**Product analogy:** Attention is a *decentralized Community Report* — people
mark accounts and posts they trust or distrust, optionally with a short human
reason, and others see that evidence through their own web of trust. Like
Community Notes–style crowdsourced context, the goal is shared judgment on
what deserves attention; unlike a platform-run notes system, there is no
central scorer or bridge ranking. Each user roots the filter in their Nostr
identity, signed kind `32009` edges travel on public relays, and X is the
bootstrap surface (stable `user:id` / `post:id` subjects plus NIP-39 links),
not the authority.

The backend is responsible for:

- Nostr identity and signing;
- relay synchronization and publishing;
- stable X account and post identification;
- NIP-39 identity-proof verification;
- kind `32009` validation and replacement;
- durable local event storage;
- construction and bounded traversal of a local Web-of-Trust (WoT) graph;
- fast query results for the content-page UI.

A standing product constraint: take as little CPU as possible so X's timeline
stays responsive. New work must be checked for timeline cost; if the feed
gets slow, nothing else matters. See
[architecture.md § Timeline CPU](architecture.md#timeline-cpu-and-responsiveness-product-rule).

The initial system is local-first. Nostr relays provide public transport and
storage, while IndexedDB provides the local event database. No central
Attention service is required. A specialized service may be added later, but
its output must remain independently verifiable from signed source events.

## 2. Architectural boundaries

X is an untrusted and frequently changing host page.

- The extension may read rendered semantic page data.
- A dedicated page-world observer may passively inspect allowlisted X JSON
  responses to extract public post IDs, handles, and numeric user `rest_id`
  values that X uses to render the current page.
- The observer clones responses for identity extraction. It does not modify X
  requests. The only intentional response rewrite is the timeline JSON trust
  filter (hide-only + optional backfill on allowlisted home/timeline GraphQL)
  so filtered items never mount — required for timeline render performance.
- Only normalized identity observations are forwarded to the isolated content
  script. Raw response bodies, request headers, cookies, authorization tokens,
  and unrelated fields are never forwarded or stored.
- Interception is an extraction adapter, not a protocol dependency. X response
  shapes and operation names are undocumented, so semantic DOM, public profile
  JSON-LD, verified NIP-39 mappings, and unresolved states remain required
  fallbacks.
- The extension does not fetch public X profile pages or oEmbed proof posts.
  A kind `10011` claim is taken from its tags. A linking post counts only
  when that post was already loaded by X.
- Linking an X account uses the bio workflow. Attention does not open X's
  compose window to publish a proof post.
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

Attention uses these Nostr kinds:

| Kind | Role |
|------|------|
| `10011` | NIP-39 X ↔ Nostr identity links (`twitter` + `twitter_id`) |
| `32009` | Single-subject trust, Neutral, distrust, and Delete statements |
| `32014` | Subject ratings (never a Web-of-Trust hop) |

Optional `l` tags on kind `32009` and kind `32014` augment the statement with
further human clarification. They are not hops and are not part of `d`.

See `docs/NIP-32009.md`, `docs/NIP-32014.md`, and `docs/NIP-39.md`.

### 3.1 Nostr identity

The extension uses a Nostr public key as its local identity. Secret keys live
in an encrypted vault (AES-256-GCM, PBKDF2 210k iterations) in
`chrome.storage.local`. Keys are decrypted only in the background service
worker while the vault is unlocked; content and page-context code never receive
them. Supported account types include BIP-39 generated keys, imported nsec /
mnemonic / ncryptsec, watch-only npub, NIP-46 bunker, and external NIP-07
delegation. The extension also exposes a NIP-07 `window.nostr` provider to
other sites (optional `<all_urls>` host permission). Legacy unencrypted
`secretKeyHex` settings are migrated into the vault on startup.

Planned Easy onboarding (“Use this browser account”) hides key handling for
casual users and mirrors a sealed vault blob via Chrome Sync (later optional
third-party lockers and passkey unlock). Advanced wizard methods stay available.
See [easy-account-roaming.md](easy-account-roaming.md).

### 3.2 X accounts

An X handle is mutable and must never be the canonical identity of an account.
The canonical X account identifier is the decimal numeric user ID:

```text
twitter_id:11348282
```

The normalized kind `32009` subject for an X account is:

```text
user:id:11348282
```

Publishers SHOULD include `k` = `user:id` and `s` = `x.com`. New person trust
statements use `c=identity`. Post trust and ratings omit `c`.

Rules:

- Accept only non-empty decimal digits.
- Preserve the decimal string exactly; do not convert it to a JavaScript
  `number`.
- Store the current lowercase handle only as a mutable display / URL value on
  the `xIdentities` row (keyed by `twitterId`).
- A handle change updates that column but not the canonical subject.
- If the numeric ID cannot be resolved, profile trust publishing is disabled.
  Attention must not publish a durable profile statement keyed only by handle.

Resolution order:

1. Numeric ID already present in local `xIdentities` (lookup by `twitterId`).
2. A sanitized observation from an allowlisted X JSON response containing both
   `rest_id` and the corresponding username.
3. Semantic metadata in the rendered page, when present.
4. Public profile JSON-LD at `https://x.com/<handle>`; read
   `mainEntity.identifier`.
5. A verified NIP-39 mapping containing both `twitter` and `twitter_id`.
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
post:id:2080659774136291424
```

Publishers SHOULD include `k` = `post:id` and `s` = `x.com`. New post trust
omits `c` (global).

The canonical display/link URL is handle-independent:

```text
https://x.com/i/web/status/2080659774136291424
```

### 3.4 NIP-39 identity links

NIP-39 uses replaceable kind `10011`, not kind `10111`.

Attention publishes the standard handle claim and an Attention extension:

```json
{
  "kind": 10011,
  "tags": [
    ["i", "twitter:nasa", "2080659774136291424", "post:id:2080659774136291424"],
    ["i", "twitter_id:11348282", "2080659774136291424", "post:id:2080659774136291424"]
  ],
  "content": ""
}
```

Both tags retain the raw proof-post ID in element 3 and may include the
structured `post:id:<same-id>` hint in element 4. The handle is informational;
Attention uses `twitter_id` as the canonical account identifier. Legacy
three-element tags remain accepted for interoperability.

The first implementation supports one primary X account per Nostr key (aligned
with local vault `boundTwitterId` operator binding — see architecture). When
publishing an updated kind `10011` event, it:

1. queries the author's current kind `10011`;
2. preserves unrelated provider tags;
3. replaces the existing `twitter` and `twitter_id` tags, preserving the raw
   proof-post ID in element 3 and adding the matching structured hint in
   element 4;
4. signs and publishes the complete replacement event.

### 3.5 NIP-39 proof

The extension generates the NIP-39 proof text:

```text
Linking my account to Nostr: <npub>
```

The product link is the X bio. Attention does not generate a proof post or
open X compose. Kind `10011` is published from the signed-in X account's
handle and numeric ID. A proof post already present in a loaded timeline may
still be recorded as a secondary source.

Before accepting an X/Nostr link, the verifier checks:

1. the kind `10011` event signature;
2. both X tags contain the same proof-post ID;
3. any fourth structured hint is `post:id:<same-id>` on both tags;
4. the proof post exists;
5. the proof text contains the event author's Nostr public key in the required
   form;
6. the proof post's author matches the declared handle.

Verification states are:

```text
unresolved | pending | verified | invalid | conflict
```

Unavailable X pages or relays produce `pending`, not `invalid`. Claims that
cannot be independently verified must not create graph aliases.

Multiple Nostr keys may validly prove control of the same X account over time
on the network. Attention preserves provenance and does not silently choose one
key as the account's unique owner. Locally, the extension still enforces one
operator vault binding per X id (see architecture); future **Identity Link** may
associate npubs without collapsing X trust subjects.

### 3.6 Trust statements

Direct trust inputs use addressable kind `32009` defined in
`docs/NIP-32009.md`. Optional `l` labels augment the statement with further
human clarification; they are not hops and are not part of `d`.

- `v = "1"` means trust.
- `v = "0"` means Neutral (active; not a hop; may carry a reason).
- `v = "-1"` means distrust.
- empty `v` Deletes the slot.
- `c` optionally scopes trust to a canonical context (omit for global).
- One newest valid event is resolved per `(author pubkey, d)`.

An X-account statement always targets the stable numeric ID:

```json
{
  "kind": 32009,
  "tags": [
    ["d", "<sha256(user:id:11348282:x.com:)>"],
    ["i", "user:id:11348282"],
    ["k", "user:id"],
    ["s", "x.com"],
    ["v", "1"]
  ],
  "content": "Maintains the library and reviews security reports."
}
```

An X-post statement targets the stable post ID (fast path; usually empty
`content`):

```json
{
  "kind": 32009,
  "tags": [
    ["d", "<sha256(post:id:2080659774136291424:x.com:)>"],
    ["i", "post:id:2080659774136291424"],
    ["k", "post:id"],
    ["s", "x.com"],
    ["v", "-1"]
  ],
  "content": ""
}
```

An `i` subject is a terminal reputation subject. It does not itself create a
traversable WoT edge. If an X account has a verified NIP-39 link, the UI may
separately offer to trust the linked Nostr identity. That action publishes a
second kind `32009` statement with a `p` subject. Only positive `p` statements
are graph-expansion edges. The account statement and Nostr-key statement are
independent and must never be double-counted as two people.

#### Trust statement `content` (human reasons)

Kind `32009` `content` is an **optional** human-readable reason. The ternary
`v` tag remains the only machine-primary trust input. Prose is augmentation for
humans (and later AI), not structured protocol data and not part of graph
scoring.

**Product decision (Attention):**

- **Optional, never required.** Empty `content` is a complete statement.
- **Ternary-first UX.** Timeline chips and quick actions show polarity and
  evidence counts only — not reasons.
- **Show reasons in path / detail views**, not on every chip. Keep reasons on
  the signed event in IndexedDB; load them when a detail surface needs them.
  Do not put free text on the in-memory graph hot path (`ReducedTrustStatement`
  stays free of `content`).
- **Accounts over posts.** Free text is more valuable for `user:id` trust /
  distrust (social judgment) than for `post:id`. Prefer one-tap publish for
  posts; offer an optional short reason in a confirm dialog for accounts.
  Post-level reasons overlap X replies and quote-posts; do not turn trust into
  a second comment timeline.
- **Attention write cap ~144 Unicode characters** (SMS-sized). Protocol /
  validation may still allow up to 1024 for interop; the composer must stay
  stricter.
- **Strict plain text only.** No required markup language, no Markdown/HTML
  rendering. Trim, normalize whitespace, strip control characters and
  injection shapes (`<>`, `javascript:`, `data:`, `vbscript:`, `on*=`) via
  `sanitizeTrustContent` **before** the event is built and signed (content
  script + authoritative service-worker pass). Display as escaped text /
  React text children only — never `innerHTML`. Machine meaning belongs in
  tags (`c`, subject type), not in prose dialects.

**Relay regret hold:** after local store, relay publish waits about 5 minutes
(`OUTBOX_HOLD_MS`) so the user can replace or remove the event from the
Outbox Manager. The local graph updates immediately; superseded addressable
winners drop the prior outbox row so replaced events are never published.

**Why this shape:** As a decentralized Community Report, Attention needs a
portable filter that is not centrally controlled. It bootstraps on X by
publishing ternary edges on stable `user:id` / `post:id` subjects (plus NIP-39
identity links). Bootstrap stays cheap when publish is a tap; optional short
reasons are the human “note” layer on top of the machine edge, without
slowing publish or bloating the hot graph.

## 4. Backend components

### 4.1 Page-world observer and content adapter

The page-world observer starts before X initializes its network clients. It
wraps `fetch` and `XMLHttpRequest` only to inspect cloned successful JSON
responses from an allowlist of X operation names and response content types.
That allowlist includes timeline feeds and `TweetDetail`, which is how X loads
post conversations and paginated replies. Original requests and responses
continue unchanged.

The observer recognizes versioned user-object shapes, including objects that
carry identity under `core` when `legacy` is null, and reply authors nested in
`VerticalConversation` timeline modules. It pairs `rest_id` with
`legacy.screen_name` or an equivalent username field. It emits only:

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

- normalize handles for URLs;
- ingest sanitized `rest_id` and username observations into `xIdentities`
  (keyed by `twitterId`);
- keep a singular latest `handle`, `displayName`, and `iconPath` per row;
- bump `lastSeen` on ingest; set `updatedAt` only when row data changes;
- query and validate kind `10011` claims from their `twitter` and `twitter_id` tags;
- verify proof posts;
- expose resolution state and provenance;
- detect conflicting mappings.

Backend lookups are always by `twitterId`. The handle column is mutable and
may change when an account renames; it is not a durable key. Numeric-ID
mappings and proof records remain durable and retain `verifiedAt` and source
metadata so they can be rechecked.

### 4.3 Event validator and reducer

Responsibilities:

- verify Nostr IDs and signatures before storage;
- enforce all kind `32009` validation rules;
- validate supported kind `10011` tags;
- calculate and verify deterministic `d` tags;
- resolve addressable-event replacement using `created_at`, then lexical event
  ID for ties;
- retain deleted (empty `v`) and expired newest events without reviving older events;
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

IndexedDB is the durable backend store. Attention optimizes for **minimal disk
and memory**: persist the current winning signed event per addressable /
replaceable slot, not a local archive of superseded replacements. Relays remain
the historical source. See
[architecture.md § Minimal data and memory](architecture.md#minimal-data-and-memory-product-rule).

Store the seven NIP-01 event fields plus `firstSeenAt` (canonical re-serialize
on publish). Validate on ingest; do not retain losers after a newer winner for
the same `(kind, pubkey, d)` is accepted. Keep Delete (empty `v`) and Neutral
(`v=0`) winners.

Required object stores:

```text
events
  key: event id
  value: signed Nostr fields plus firstSeenAt, addressKey (kind:pubkey:d),
         optional state (e.g. demo)
  indexes: kind, pubkey, created_at, addressKey (unique), state

relayObservations
  key: relayUrl:eventId
  value: firstSeenAt, lastSeenAt

syncCursors
  key: relayUrl:scopeHash
  value: lastSeenCreatedAt, lastEoseAt, retry state

xIdentities
  key: twitterId
  value: latest handle, displayName, iconPath, NIP-39 / X-proof columns,
         state, createdAt, updatedAt (data changed), lastSeen (ingest touch)

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
- `v = "0"` is Neutral: stored in the graph, shown in evidence lists, not a hop;
- empty `v` Deletes the slot and contributes no active statement;
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

Publishing is local-first with a relay regret hold:

1. validate, sanitize optional `content`, and sign in the service worker;
2. atomically store the event and per-relay outbox entry with
   `nextAttemptAt = now + OUTBOX_HOLD_MS` (~5 minutes);
3. update the address winner, reducer, and **local** graph immediately;
4. after the hold (or Outbox Manager “Publish now”), publish independently to
   configured relays;
5. retain per-relay success and retry status; schedule `chrome.alarms` for hold
   release so delivery is not stuck on the 15-minute maintenance cadence.

Local success does not imply relay delivery. Replacing an addressable slot
deletes the superseded event and its outbox row so replaced events are never
published. The Application **Outbox** tab (`?page=outbox`) lists held/queued
items, can publish now, or remove (local `deleteEvent` + graph rebuild; does
not recall already-delivered relay copies).

The UI receives the event ID, delivery status, and optional `heldUntil`.

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

INGEST_X_IDENTITIES
GET_X_IDENTITY
GENERATE_X_PROOF
VERIFY_X_PROOF
PUBLISH_X_IDENTITY
REPORT_ACTIVE_X_ACCOUNT
GET_ACTIVE_X_ACCOUNT
PREPARE_X_PROOF_COMPOSER
CONFIRM_X_PROOF_COMPOSER
GET_PROOF_COMPOSER_SESSION
CAPTURE_X_PROOF_POST
CANCEL_PROOF_COMPOSER

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
- Never modify X requests. Do not modify X responses except the intentional
  timeline JSON rewrite (hide/filter + optional backfill) used to optimize
  timeline rendering.
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

A future Attention service may provide:

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
  replacement reducer, Neutral, Delete, and activation/expiration handling;
- canonical `user:id` and `post:id` subjects with optional `k` / `s`;
- kind `10011` merge, parse, signature validation, proof verification, and
  publication;
- unit tests with valid and adversarial fixtures.

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
- public X identity resolver (`xIdentities` by `twitterId`) with explicit
  unresolved, pending, and conflict states;
- NIP-39 proof generation, verification, `already_proven` handling, and
  verified-claim persistence;
- replacement-reduced in-memory graph rebuilt from IndexedDB;
- deterministic bounded traversal and evidence-preserving trust query API.

These paths have fixture and unit coverage. Large-scale performance
characterization and manual compatibility verification against live X have not
been completed or claimed.

### Phase D — frontend integration: implemented for the guarded proof workflow

Implemented:

- visible-post identity observation batches;
- stable profile and post descriptors with global default context;
- kind `32009` trust/distrust/Neutral publishing, Delete, and local evidence
  display with path counts and truncation hints;
- centered trust dialog with optional sanitized note (~144 chars), demo notice,
  and Outbox Manager link;
- Outbox Manager (Application tab) with 5-minute relay hold, publish-now, and
  local remove;
- local-only question state;
- Shadow DOM mounting, SPA rescanning, accessibility labels, and English/Danish
  strings;
- active-account detection and reporting;
- proof-composer preview, active-account gate, explicit confirmation,
  `already_proven` refresh, intent-based compose open, session-scoped
  CreateTweet capture, manual post-ID capture, and kind `10011` publication;
- popup sync start/stop and proof-linking controls.

Remaining:

- richer context selection UI beyond the default contexts;
- manual end-to-end testing on current live X layouts and responses.

## 10. Backend definition status

Implemented in source and covered by automated tests:

- canonical X account/post identifiers and default contexts;
- kind `32009` and supported kind `10011` validation;
- durable current-winning events, reducer indexes, cursor state, identity data,
  and outbox state in IndexedDB (minimal; no superseded addressable history);
- overlap-based relay synchronization and event-ID deduplication;
- minimized, bounded identity extraction with no raw page payload persistence;
- bounded graph expansion reproducible from reduced stored events;
- evidence results with paths, source event IDs, and truncation state.

The proof-post safety boundary requires preview, explicit confirmation, and
active-account verification before a proof session can capture a post ID and
publish kind `10011`. Automated passing status does not establish live-relay or
live-X compatibility; those require separate manual verification.

## 11. Current implementation gap

The backend described in sections 3 through 7 is now present: kind `32009`
publishing and validation, kind `10011` merge and verification, IndexedDB raw
event storage, reducer indexes, cursor synchronization, outbox retry, bounded
local WoT traversal, identity resolution, and the minimized page-world observer
are wired into the service worker and content adapter.

The primary remaining gap is live product validation, not the guarded
proof-post workflow itself. The extension now has preview, active-account
matching, explicit confirmation, post-ID capture, and identity-linking
publication paths. It still needs clearer outbox delivery detail and
manual end-to-end verification against live X and real relay failure modes. No statement in this document should be read as
evidence that current live-X behavior has been manually verified.

UI and workflow inspiration:

https://github.com/nostr-wot/nostr-wot-extension















