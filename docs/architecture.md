# AttentionX architecture

## Security and privacy boundaries

AttentionX is a Chrome Manifest V3 extension that augments X's rendered
interface. X and every value received from page code, public pages, and Nostr
relays are untrusted.

- The Nostr secret key stays in the background service worker. Content and page
  code never receive it.
- The extension does not modify X requests. X responses are left unchanged except
  for the intentional timeline JSON rewrite in page-world
  (`json-trust-filter.ts` / shared `timeline-json-filter`): when user hide/trust
  filters are active, allowlisted home/timeline GraphQL JSON may be filtered
  (hide-only) and optionally backfilled so X never mounts removed items. That
  path exists to optimize timeline rendering; prefer fail-open on rewrite
  failure. For NIP-39 proof discovery it may also initiate authenticated
  GraphQL calls (e.g. `SearchTimeline`) from page-world using the signed-in
  session (`ct0` CSRF + cookies) without navigating the UI. Auth cookies,
  bearer tokens, and raw GraphQL bodies stay in page-world; only validated
  proof matches cross the boundary. GraphQL proof search runs only when
  IndexedDB `xIdentities` lacks a verified binding for the target X account: on
  extension X-pane open (self CHECK with `scanPage`), or when the user clicks
  Trust on another account. The signed-in numeric X user id may also be derived
  from the public `twid` cookie (`u=<id>`).
- The page-world observer handles cloned allowlisted responses for identity
  extraction, Bio npub candidates from `legacy.description`
  (`REPORT_X_BIO_CANDIDATES`), opportunistic post-proof candidates from tweet
  bodies (loose wording; oEmbed-gated before `post*` writes), the optional
  timeline JSON rewrite above, and optional extension-initiated proof-search
  GraphQL. It discards raw payloads after use and forwards only validated
  public tuples. `xIdentities` prefers Bio (`xDate`) over post proof
  (`postDate`); older observations cannot overwrite newer source dates.
- Account and post trust use stable numeric subjects. A mutable handle alone
  cannot be used to publish profile trust.
- Proof-post submission must have a visible preview, explicit per-post
  confirmation, and active-account verification. That composer flow is not
  implemented yet, so the current extension performs no X account action.
- Trust results are subjective to the local Nostr root, context, and graph
  bounds. They are evidence summaries, not objective scores — a decentralized
  Community Report rooted in each user’s WoT, not a global platform ranking.

## Runtime components

### MAIN-world identity observer

A manifest-declared script starts at `document_start` on `x.com` and
`twitter.com` in the page's `MAIN` world. It wraps `fetch` and
`XMLHttpRequest` without changing requests. Successful JSON responses for
allowlisted X operation names are cloned and inspected for identity tuples.
Separately, when timeline hide filters are active, allowlisted home/timeline
GraphQL response bodies may be rewritten (hide-only, with optional page
backfill) so filtered items never enter X's renderer.

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

Profiles and posts use stable `i` subjects:
`user:id:<numeric-id>` and `post:id:<post-id>`. New X trust statements use
**`s=x.com`** (site scope; omit `c` for global trust). Older empty-scope user
statements remain valid and are handled by the X precedence policy. See
[§ Scope policy](#scope-policy-attentionx-on-xcom).
Trust and misleading actions publish values `1` and `-1`; question is card-local
state and publishes no Nostr event.

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
can query public oEmbed proof-post data without credentials. The `identity`
and `identity.email` permissions are used only to detect whether the Chromium
profile is signed in for Easy-account onboarding (Chrome requires
`identity.email` for a non-empty profile id; not used for OAuth token exchange).

### Popup

The React popup configures Nostr identity (multi-account vault) and relays.
NIP-07 signing works on any connected site with the user-selected active
account. **AttentionX X tools** appear only when the focused tab is x.com /
twitter.com with a known numeric signed-in `twitterId`.

### Operator binding (X ↔ Nostr)

Local vault accounts may carry `boundTwitterId` / `boundUpdatedAt` (1↔1):

- Each X numeric id binds at most one Nostr pubkey; each Nostr account binds at
  most one X id (cap 10 bindings per browser profile).
- On an X tab, the extension auto-selects the bound Nostr account and locks the
  account dropdown to that row. Off X, account selection and NIP-07 remain free.
- Rebinding requires **Unbind from X** in User settings first (binding move only;
  keys stay). Non-secret Sync index: `xNostrBindings`; Easy roaming may mirror
  per-X sealed blobs (`easyAccountBlobs`).
- NIP-39 / `xIdentities` remain the protocol proof layer — separate from this
  operator session binding.

### Identity Link (future)

**Identity Link** is a deferred concept: a mutual, double-signed npub↔npub
association (typically the same person controlling two Nostr identities). It
is not a WoT degree and does not replace 1 X ↔ 1 Nostr operator binding in the
extension. Not implemented yet.

The React popup does not show or export a generated key by default. The raw key
in browser storage remains a PoC limitation for Advanced paths; Easy mode uses
an encrypted vault plus optional Sync backup.

## Protocol and reducer

Current trust statements are addressable kind `32009` events. Account and post
subjects are, respectively:

```text
user:id:<numeric-id>
post:id:<numeric-post-id>
```

Publishers follow the [scope policy](#scope-policy-attentionx-on-xcom):
`s=x.com` for new X **user** and **post** subjects. Older empty-scope user
statements remain valid. Include `k` (`user:id` / `post:id`). The `d` tag is
always `sha256(material)` where
`material` is `subject:scope:context` with fixed `:` separators (empty
scope/context allowed).

### Scope policy (AttentionX on x.com)

Kind `32009` `s` is a domain/namespace facet (see [NIP-32009.md](NIP-32009.md)).
AttentionX on x.com uses these product rules:

| Subject | Default `s` | Why |
| --- | --- | --- |
| X user (`user:id:<digits>`) | **`x.com`** | New X statements are explicit about the platform; older empty-scope global statements remain valid |
| X post (`post:id:<digits>`) | **`x.com`** | Posts are site-targeted; the `i` value has no domain, so `s` carries it |

**What counts on x.com**

- Statements with **`s=x.com`** apply on X.
- Statements with **empty scope** (no `s` tags) also apply on X — and on every
  other site. Empty is the cross-site / universal scope and remains supported
  for older user statements.
- Other non-empty scopes (e.g. `github.com`) do **not** apply to X trust UI.

**Precedence when both exist**

For the same author / subject / context on X: an explicit **`x.com`** statement
takes precedence over an **empty-scope** statement. Empty is the broad default;
site-scoped overrides it when present.

**Relay sync**

WoT / discovery filters omit `#s` so both empty-scope (legacy user trusts) and
`s=x.com` (new user and post trusts) match — relays cannot select “missing `s`”
alone.
Unrelated scopes are dropped client-side (`isEligibleXTrustScope`) at sync
ingest and again when loading graph source events. An optional companion
`#s=x.com` filter helper remains for callers that want an explicit site pull.

**Local graph**

The in-memory trust graph does **not** key or store scope. That is intentional
for AttentionX: resolve stays subject + context (`c`) only. Scope is handled at
**publish**, **relay filter**, and **ingest / eligibility** — not inside graph
slot identity.

### Subject hints

The first value after the `p`, `e`, or `i` tag name is the primary subject.
Additional values are advisory: structured `<class>:<property>:<value>`, or a
bare `npub1…` (subject's linked Nostr pubkey). Hints are excluded from `d`,
addressable replacement, and graph slot identity. Raw signed tags are retained
with the event, but reduced trust statements do not copy advisory metadata into
the local graph.

AttentionX may use a WoT-gated bare-npub hint on `i=user:id` (`s=x.com`) as a
**fallback** identity source only when Bio, post-proof, and kind `10011` have
not already supplied an npub for that X user. Own 32009 statements rank above
other issuers; other issuers need trust ratio `> 0.75`.

**Future / generic servers**

A larger multi-site server may need richer scope handling. If AttentionX ever
needs scope in resolve without expanding graph slots, prefer treating scope as
the **first segment of context** (Resolver-side) rather than changing graph
reduction. That path is **not** required now.

The newest valid event per `(author, d)` wins by `created_at`, then lexically
lower event ID. Value `0` cancels the slot without reviving an older statement.
Signature, event ID, deterministic `d` tag, primary subject, optional
scope/context, subject hints, value, activation, expiration, and content limits
are validated before an event enters indexes or the graph.

Kind `1985` is retired and unsupported. It is not queried, ingested, or
published.

NIP-39 X links use replaceable kind `10011` with matching `twitter:<handle>` and
`twitter_id:<id>` tags. Kind `10011` is self-verified from its signature and
claimed `twitter_id` (AttentionX no longer requires oEmbed for the 10011 side).
Bio npub (from X profile description) and post-proof (oEmbed-revalidated)
outrank 10011/32009 per dated precedence. AttentionX stores durable Nostr↔X
bindings in IndexedDB `xIdentities` and does not auto-create `10011` when a
proof is discovered — the user publishes `10011` explicitly. Publishing merges
the X tags into the
current replacement event while preserving unrelated provider tags. A relay
claim is recorded as verified only after signature, proof text, proof author,
and public handle-to-numeric-ID checks pass.

## Durable storage

`chrome.storage.local` contains only the small `attentionx-state-v1` settings
object: relay URLs and, when configured, the PoC secret key.

IndexedDB database `attentionx` stores:

- signed Nostr event **fields** (the seven NIP-01 fields plus `firstSeenAt`,
  `addressKey`, and optional `state`) and kind/pubkey/time/`addressKey`/`state`
  indexes — not a byte-exact copy of the original wire JSON;
- relay observations and per-relay/per-scope synchronization cursors;
- X identity records in `xIdentities` (keyed by `twitterId`; singular latest
  `handle` / `displayName` / `iconPath`; no handle-alias or observation-cache
  tables);
- X post display chrome in `xPosts` (keyed by `postId`; trust-gated with a
  revalidated NIP-39 proof-post exception — see below);
- durable outbox entries with per-relay retry and delivery state.

Events can be exported and imported. On startup the in-memory graph is rebuilt
from replacement-reduced kind `32009` events. IndexedDB, not the graph cache or
service-worker lifetime, is the source of durable state.

### X content first (display chrome)

AttentionX shows trust **when a subject is visible on X** (timeline, TweetDetail,
and related allowlisted surfaces). Display chrome for users and posts is
captured from that X content path — not by taking an arbitrary Nostr event and
looking up what it means on x.com.

Principles:

1. **Subjects appear on X first.** `xIdentities` and `xPosts` rows are written
   from timeline / allowlisted GraphQL observations (and DOM headlines for
   posts) when the subject is in view. The local events DB answers trust
   *resolution* for those subjects; it is not a catalog that drives reverse
   lookups on X.
2. **No bulk Event → X fetches.** Do not issue GraphQL, oEmbed, or other X
   backend calls to decorate Application event lists or Graph nodes for unknown
   subjects. The only extension-initiated GraphQL exception remains NIP-39
   proof search under the triggers in the architecture rules / `x-identity`
   docs.
3. **`xPosts` is trust-gated with one provenance exception.** Persist a post
   chrome row when the post was observed on X **and** local WoT evidence exists
   for `post:id:<digits>` (resolution not `none`, or a direct statement), or
   when the post was independently revalidated as an NIP-39 proof post and is
   referenced by an `xIdentities.postId` (post-proof) or Bio-linked row. Do not
   store every scrolled
   post or an unvalidated GraphQL candidate. Rows may include a capped
   `headline`, author id/handle, optional GraphQL `role`
   (`root` / `reply` / `quote` / `repost`) and `parentPostId`; proof-post rows
   intentionally do not store proof text. Omit `role` when classification is
   unknown. Delete rows when neither trust evidence nor a current proof-post
   reference remains. Bare `post:id` from events is fine when chrome is
   missing.
4. **Forward only small normalized fields** across the content boundary — never
   raw GraphQL bodies, cookies, or bearer tokens.

### Minimal data and memory (product rule)

AttentionX is a browser extension: **keep only the minimum durable and in-memory
state required for trust queries, identity binding, sync, and publish.** Prefer
an optimized design over accumulating history “just in case.” Relays and other
clients remain the archive for superseded events.

Guidelines for contributors and AI assistants:

1. **Addressable / replaceable slots keep one winner.** For kind `32009`
   (`kind:pubkey:d`) and kind `10011` (`10011:pubkey:`), persist only the
   current winning event on the `events` row (`addressKey`). When a newer
   replacement is accepted, delete the superseded event and related
   `relayObservations` / outbox rows.
2. **Do not store losers for local history.** Local history of replaced
   statements is a minority need; do not grow IndexedDB or rebuild cost for it.
3. **Cancellation (`v=0`) is current state, not junk.** Keep the cancel event
   as the slot winner so older trust is not revived. NIP-32009 forbids
   resurrecting replaced events when the winner is inactive or cancelled.
4. **Ingest older-than-winner events by discarding them.** “Not in the DB”
   must not mean “store again” if an address winner already exists and is
   newer.
5. **Validate once on write; rebuild fast on read.** Signature and kind-32009
   validation belong on ingest/publish. Service-worker rehydrate should load
   already-accepted winners (or a reduced snapshot) into `LocalTrustGraph`
   without re-paying full crypto validation over the entire event set.
6. **Signed fields are enough for re-publish.** Store and relay the seven
   NIP-01 fields; canonical serialization preserves signatures. Do not keep
   raw wire JSON solely for republish fidelity.
7. **Optimize before adding stores or caches.** New IndexedDB tables, in-memory
   indexes, or retained event copies need a clear hot-path or correctness
   reason. Default to pruning, bounds, and write-through reduction — not
   indefinite accumulation.

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
IndexedDB          winning kind 32009 (+ indexes) durable (minimal)
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

Rebuild cost is the main risk: reloading a large graph from every stored event
alone can take several seconds. Mitigations:

| Store | Role |
|-------|------|
| Events | Current winning signed kind `32009` — durable source of truth |
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
