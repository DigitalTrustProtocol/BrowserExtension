# AttentionX architecture

## Security and privacy boundaries

AttentionX is a Chrome Manifest V3 extension that augments X's rendered
interface. X and every value received from page code, public pages, and Nostr
relays are untrusted.

- The Nostr secret key stays in the background service worker. Content and page
  code never receive it.
- The extension does not modify X requests or responses. For NIP-39 proof
  discovery it may initiate authenticated GraphQL calls (e.g. `SearchTimeline`)
  from page-world using the signed-in session (`ct0` CSRF + cookies) without
  navigating the UI. Auth cookies, bearer tokens, and raw GraphQL bodies stay
  in page-world; only validated proof matches cross the boundary. GraphQL proof
  search runs only when IndexedDB `xIdentities` lacks a verified binding for the
  target X account: on extension X-pane open (self CHECK with `scanPage`), or
  when the user clicks Trust on another account. The signed-in numeric X user id
  may also be derived from the public `twid` cookie (`u=<id>`).
- The page-world observer handles cloned allowlisted responses and optional
  extension-initiated proof-search GraphQL, discards raw payloads, and forwards
  only validated public identity tuples or proof post matches.
- Account and post trust use stable numeric subjects. A mutable handle alone
  cannot be used to publish profile trust.
- Proof-post submission must have a visible preview, explicit per-post
  confirmation, and active-account verification. That composer flow is not
  implemented yet, so the current extension performs no X account action.
- Trust results are subjective to the local Nostr root, context, and graph
  bounds. They are evidence summaries, not objective scores.

## Runtime components

### MAIN-world identity observer

A manifest-declared script starts at `document_start` on `x.com` and
`twitter.com` in the page's `MAIN` world. It wraps `fetch` and
`XMLHttpRequest` without changing requests or responses. Only successful JSON
responses for allowlisted X operation names are cloned and inspected.

The parser has byte, depth, object, key, array, queue, rate, and batch limits.
Allowlisted reads include timeline feeds and `TweetDetail` (the conversation /
reply endpoint, including cursor pagination for more comments). It recognizes
user objects that pair a numeric `rest_id` with a username and may associate
numeric post IDs, including reply authors nested under
`VerticalConversation` modules. It posts only normalized
`{ twitterId, handle, postIds?, observedAt, sourceOperation }` records to the
isolated world. Unknown operations, malformed shapes, and oversized responses
are ignored.

### Isolated content script

The content script:

1. observes SPA navigation and inserted timeline articles;
2. discovers post IDs and handles from semantic attributes, Schema.org
   metadata, and stable status links, with `data-testid` as a compatibility
   fallback;
3. validates page-world messages, associates observed identities with rendered
   posts, and forwards bounded sanitized batches to the service worker;
4. mounts an idempotent Shadow DOM panel at the article boundary;
5. queries and publishes through the versioned background message API.

Profiles use `ext:twitter_id:<numeric-id>` in the `identity` context. Posts use
`ext:twitter_post:<post-id>` in `news:accuracy`. Trust and misleading actions
publish values `1` and `-1`; question is card-local state and publishes no
Nostr event.

### Background service worker

The service worker owns:

- key generation/import, public-key derivation, and signing;
- kind `32009` building, validation, replacement reduction, and cancellation;
- kind `10011` parsing, merge, verification, and publication;
- public X profile resolution and proof-post verification;
- IndexedDB storage and graph rebuilding;
- relay queries, overlap cursors, provenance, bounded graph synchronization,
  and durable per-relay outbox retries;
- evidence-preserving local trust queries.

`chrome.alarms` schedules maintenance every 15 minutes and after install or
startup. Maintenance retries due outbox entries and starts bounded incremental
WoT synchronization when a local identity is configured. The manifest includes
the `alarms` permission and `https://publish.twitter.com/*` so the background
can query public oEmbed proof-post data without credentials.

### Popup

The React popup configures a dedicated Nostr identity and relays. It does not
show or export a generated key. The raw key in browser storage remains a PoC
limitation; a production version needs encryption or an external signer.

## Protocol and reducer

Current trust statements are addressable kind `32009` events. Account and post
subjects are, respectively:

```text
ext:twitter_id:<numeric-id>
ext:twitter_post:<numeric-post-id>
```

The newest valid event per `(author, subject, context)` wins by `created_at`,
then lexically lower event ID. Value `0` cancels the slot without reviving an
older statement. Signature, event ID, deterministic `d` tag, subject, context,
value, activation, expiration, and content limits are validated before an
event enters indexes or the graph.

Kind `1985` is retired and unsupported. It is not queried, ingested, or
published.

NIP-39 X links use replaceable kind `10011` with matching `twitter:<handle>` and
`twitter_id:<id>` tags referencing the same proof post. The latest `10011` for a
Nostr key indicates which X account is claimed at that moment; the X proof post
is the real proof. AttentionX stores durable Nostr↔X bindings in the IndexedDB
`xIdentities` table and does not auto-create `10011` when a proof is discovered
— the user publishes `10011` explicitly. Publishing merges the X tags into the
current replacement event while preserving unrelated provider tags. A relay
claim is recorded as verified only after signature, proof text, proof author,
and public handle-to-numeric-ID checks pass.

## Durable storage

`chrome.storage.local` contains only the small `attentionx-state-v1` settings
object: relay URLs and, when configured, the PoC secret key.

IndexedDB database `attentionx` stores:

- complete raw signed events and kind/pubkey/time indexes;
- address winners and tag indexes used by the reducer;
- relay observations and per-relay/per-scope synchronization cursors;
- X identity records and expiring handle aliases;
- durable outbox entries with per-relay retry and delivery state.

Raw events can be exported and imported. On startup the in-memory graph is
rebuilt from validated, replacement-reduced kind `32009` events. IndexedDB, not
the graph cache or service-worker lifetime, is the source of durable state.

## Local WoT and synchronization

Relay synchronization starts from the configured local pubkey and follows only
active positive `p` statements. Depth, fan-out, total authors, and event counts
are bounded. Each relay/scope cursor advances after EOSE and the next query
uses an overlap window; event IDs deduplicate overlap and multi-relay results.

The graph performs deterministic bounded breadth-first traversal. `p` subjects
are traversable, while X account/post `i` subjects remain terminal evidence.
Queries return trusted, distrusted, mixed, or no evidence together with direct
evidence, paths, source event IDs, graph version, computation time, and
truncation state. No numerical or universal Web-of-Trust score is produced.

## Hot trust graph and scroll performance

AttentionX targets a single in-memory personal Web-of-Trust in the service
worker, shared by every `x.com` tab, with durable kind `32009` events in
IndexedDB as the source of truth.

```text
IndexedDB          all kind 32009 (+ indexes)     durable
SW LocalTrustGraph personal WoT, 3–6 hops         hot, shared
Content scripts    scroll → batched trust queries → SW memory lookup
```

Chrome may terminate the service worker at any time. “Keep the graph in memory
while on X” is therefore a **keep-warm + fast-rehydrate** strategy, not a
guarantee of immortal RAM.

### Keep-warm while the user is on X

- Content scripts on active `x.com` tabs can send a periodic keepalive message
  (for example every 20–25 seconds) so incoming traffic resets the worker idle
  timer. Multiple tabs still share one worker.
- `chrome.alarms` help when tabs are briefly backgrounded but are weaker than
  real message traffic alone.

### Fast rehydrate after worker restart

Rebuild cost is the main risk: reloading a large graph from raw events alone can
take several seconds. Mitigations:

| Store | Role |
|-------|------|
| Events | Raw signed kind `32009` — source of truth |
| Snapshot | Precomputed edges/adjacency for the active npub at sync depth (3–6 hops) |

On worker start: load the snapshot into `LocalTrustGraph` for sub-second queries,
serve immediately (optionally mark stale), then reconcile newer events in the
background.

### Query path under heavy scroll

- Batch visible post/account IDs (roughly 20–50 per message), not one RPC per
  cell.
- Debounce/coalesce with the content-script scan timer (~180 ms).
- Answer from in-memory maps on the hot path — no IndexedDB reads per lookup.
- Queue async identity or graph expansion for misses without blocking paint.

### What not to use

- `chrome.storage.session` / `chrome.storage.local` for the graph — too small and
  slow for a large personal WoT.
- Per-tab content-script graph caches — not shared, multiply RAM, inconsistent.
- Worker memory alone with no snapshot — every kill pays a multi-second rebuild.

### Optional escalation

If the in-memory graph is very large and the worker is evicted too often, an
offscreen document can hold the graph longer while `x.com` is open, with the
service worker as a thin router. Prefer heartbeat + IndexedDB snapshot first.

## Current limitations

The backend protocol, IndexedDB repository, reducer, cursor synchronization,
outbox, bounded graph, identity resolver, page observer, and proof
generation/verification paths are implemented and covered by automated tests.
The injected content UI consumes kind `32009` queries and publishing.

Phase D now includes the guarded proof-post composer flow: active-account
detection, preview and confirmation, session-scoped CreateTweet capture or
manual post-ID entry, `already_proven` handling, cancellation controls, and
popup sync/linking UI. Manual verification against live X remains outstanding;
X response and DOM changes remain compatibility risks.
