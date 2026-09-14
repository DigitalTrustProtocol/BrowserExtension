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
`user:id:<numeric-id>` and `post:id:<post-id>`. New X person-trust statements use
**`s=x.com`** and **`c=identity`**. Post kind `32009` trust and post kind `32014`
ratings omit `c`. Kind `32009` queries always use `identity` so Trust hops walk
the person-trust graph; empty post slots still resolve through identity→general
fallback. Rating queries stay exact-empty. Older empty-context user statements
remain valid and resolve through that fallback. Retract publishes a Delete to
the winning slot context so legacy global user statements stay deletable. See
[§ Scope policy](#scope-policy-attentionx-on-xcom).
Trust and misleading actions publish values `1` and `-1`; question is card-local
state and publishes no Nostr event.

### Background service worker

The service worker owns:

- key generation/import, public-key derivation, and signing;
- kind `32009` building, validation, replacement reduction, Neutral, and Delete;
- kind `10011` parsing, merge, verification, and publication;
- public X profile resolution and proof-post verification;
- IndexedDB persistence and GraphManager load/apply into the Trust Graph heap;
- relay queries, overlap cursors, provenance, bounded graph synchronization,
  and durable per-relay outbox retries;
- evidence-preserving local trust queries (backend asks GraphManager; GraphManager
  reads the heap).

`chrome.alarms` schedules maintenance every 15 minutes and after install or
startup. Maintenance retries due outbox entries and starts bounded incremental
WoT synchronization when a local identity is configured. The manifest includes
the `alarms` permission and `https://publish.twitter.com/*` so the background
can query public oEmbed proof-post data without credentials. The `identity`
and `identity.email` permissions are used only to detect whether the Chromium
profile is signed in for Easy-account onboarding (Chrome requires
`identity.email` for a non-empty profile id; not used for OAuth token exchange).
The `sidePanel` permission and `side_panel.default_path` configure the Chrome
Side Panel UI (Chromium MV3 Side Panel API). The toolbar action has no
`default_popup`; the service worker calls
`chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` so the
extension icon opens the panel.

### State broadcast topics

State-changing actions go through the background service worker. After a
successful mutation, the worker publishes the existing wire message through
the registry in `src/shared/state-topics.ts`. `publishStateChange` is the
single fanout: every topic reaches extension pages, while only topics marked
`tabs` reach X content scripts. Consumers use `subscribeStateTopic` so
filtering, payload validation, and cleanup stay consistent.

Viewer, profile-metadata, and activity topics are runtime-only because
content scripts must remain identity-blind (activity is Logs/outbox
freshness, not timeline). Trust-graph, X-identity, app-mode, WoT degree, and
selected-subject topics may reach X tabs. This is notification-only:
consumers request the current state they need rather than treating a
broadcast payload as their application store.

Application pages show a “new data available” banner on trust-graph,
activity, viewer, identity, profile-metadata, app-mode, and WoT-degree
notifications. Header Refresh clears the banner and reloads the current
page. Users stays live on identity (the table refreshes immediately) and
still shows the banner for other topics. Fullscreen Graph keeps its own
overlay banner on trust-graph, viewer, and identity. `GRAPH_VIEW` /
`GRAPH_FOCUS` stay as dedicated messages, not state topics.

### Side panel (extension UI)

The React side panel (same `index.html` entry as the former popup) configures
Nostr identity and relays. The UI presents a single active account (multi-account
vault logic remains in the background). NIP-07 signing works on any connected
site with the active account. **AttentionX X tools** appear only when the
focused browsing tab is x.com / twitter.com with a known numeric signed-in
`twitterId`.

### Operator binding (X ↔ Nostr)

Local **soft bind** (vault + Sync index, not NIP-39 / Identity Link):

- **1 X → 1 Nostr.** Each numeric `twitterId` has at most one bound vault
  pubkey. Auto-follow uses that.
- **1 Nostr → N X is allowed.** Reusing the same key on another X does not
  require Unbind first and does not drop the previous X from the index.
- **Cap 10** counts distinct X twitterIds per browser profile, not vault rows.
- On an X tab / `ENSURE_ACTIVE_X_ACCOUNT`, auto-select the Nostr bound to that
  `twitterId`. The popup header is **not** a Nostr switcher: it shows this X
  user. Clicking the avatar opens **this X user’s Bindings detail**. Off X,
  activate a key from Settings **Nostr Keys** for NIP-07.
- If this X has no binding: **do not silent auto-bind** a leftover unbound
  account. Home offers **Create new**, **bind an existing key** (including a
  key already bound to another X), or open Settings **Bindings**.
- Settings **Nostr Keys** lists vault Nostr keys (npub, kind 0 title, type
  nsec / readonly / derivative / NIP-46, roaming, bound X). Each key’s
  submenu is bound-X jump(s), **Profile (kind 0)**, **Security**, and
  **Browser Account Roaming**. Vault password / auto-lock live in that nested
  Security screen.
- Settings **Bindings** lists known operator X users (binding index + easy
  roaming blobs + the signed-in X — not the timeline `xIdentities` catalog)
  with X chrome. Each card has a Nostr dropdown, Bind, and a **missing
  summary**. The per-X detail page has three update rows: X bio contains this
  npub, kind 0 matches this X, kind `10011` claims this X. Completeness is
  derived from `xIdentities` (`xNpub` / `nip39Npub`) plus kind 0 — not vault
  setup stamps. The header avatar shows a check when all three pass, otherwise
  a warning.
- Bind / change / unbind is per X. Unbind removes this twitterId only; other X
  on the same key remain.
- Non-secret Sync index: `xNostrBindings`; Easy roaming may mirror per-X sealed
  blobs (`easyAccountBlobs`). Sync-only evidence is **not** a usable local
  binding: the panel treats it as `remoteOnly` and stays on the unbound gate
  until a local vault/mirror account is bound to that X.
- NIP-39 / `xIdentities` remain the protocol proof layer — separate from this
  operator session binding.

### Panel session machine

The side panel’s first paint is routed by a service-worker
`PanelSessionController`, not by React or `GET_STATE`. This is **operational
state** (current user, vault, focused tab, route). It is not Trust Graph data
and does not live on the Graph heap.

- **Fast path:** `GET_PANEL_SESSION` is handled in the service worker **before**
  IndexedDB / backend startup. It reads `chrome.storage.local`,
  `chrome.storage.session`, and cheap tab/window APIs only — no graph rebuild,
  cookies, or relays.
- **Snapshot:** a versioned `PanelSessionSnapshot` (integrity, vault, lifecycle,
  focused site, tab-scoped X session, binding, intents, derived `route`) with a
  monotonic `revision`. React ignores a lower revision. The latest snapshot is
  also kept in `chrome.storage.session` so a sleeping worker can answer
  immediately.
- **X session is tab-scoped.** Reports and logout are attributed to the sender
  tab. Panel routing and operator auto-follow use the **focused** product tab
  only. A background tab cannot pair or clear the focused tab’s identity. Cold
  start with no observation is first paint `xUnknown`; the worker then runs
  **one automatic `ENSURE_ACTIVE_X_ACCOUNT` per `(tabId, navigationEpoch)`**
  after paint (fire-and-forget, no retry timers). The panel does not poll.
  Manual Retry is the extra kick. The panel never claims logged out without an
  explicit tab observation.
- **Operator lifecycle** (`attentionxOperatorLifecycleV1`) is device-local:
  first persist sets `everHadAccounts`; last-key delete / logout / Forget vault
  keeps that flag and sets `restoreSuppressed` so roaming Sync blobs cannot
  recreate an empty vault. Delete All removes the lifecycle record (true
  first-run). `changedAt` is audit-only.
- **ENSURE_ACTIVE_X_ACCOUNT** runs after first paint as the worker identify
  path for `xUnknown`. It may commit
  only when `{ tabId, navigationEpoch }` still match, so a slow result for
  account A cannot overwrite a newer observation of account B.
- Timed lock shows Unlock. Never-lock service-worker startup is vault
  `starting`, then `ready` after empty-password unlock — not the Unlock
  surface. After keys are cleared, the panel does not auto-open first-run
  onboarding (`afterKeyClear`).
- **Supported-site and signed-in gates** sit immediately after integrity.
  A focused tab on a readable non-X http(s) page is `site.kind =
  unsupported` and route `unsupportedSite`; X product hosts are `x.com` /
  `www.x.com` / `twitter.com` / `www.twitter.com`. Tabs whose URL the
  extension cannot read — a new tab / NTP, `chrome://`, or a
  permission-stripped page without a host grant — are not a browsing
  domain: like extension application pages (Advanced Zone, WoT Graph, WoT
  Path, prompt), they keep the last X product tab that still exists so the
  side panel stays on that signed-in user. The panel only locks with the
  unsupported-site message on a readable external http(s) page.
  On an X host, `x.kind === 'loggedOut'` is `xLoggedOut`
  and `unknown` is `xUnknown` (identify only). A newly opened X tab is
  `xUnknown` until ENSURE identifies it; while a full panel is mounted the
  controller holds the previous snapshot instead of broadcasting
  `xUnknown`, so opening a new x.com tab does not reset the panel (cold
  start still shows `xUnknown` + Retry). Vault routing (`unlock`,
  `justWorks`, `firstRun`, `demoChoice`, `afterKeyClear`, bind, home) runs
  only after an identified X user. The popup mounts only
  `PanelSessionProvider` plus a message on `unsupportedSite`, `xLoggedOut`,
  and `xUnknown` (legacy `noSite` / `offXHome` snapshots render the same
  message). TopBar, vault, wizard, and approvals stay unmounted until the
  X user is identified. `maybeKickJustWorks` therefore cannot provision a
  key off X or while logged out.

`GET_STATE` remains for graph, settings, and cockpit data. It is not the
initial panel router. Locked-vault compatibility fields (`xBoundAccountId` /
`needsNostrForX`) use the local account mirror so a timed lock still sees a
local X binding.

### Identity Link (future)

**Identity Link** is a deferred concept: a mutual, double-signed npub↔npub
association (typically the same person controlling two Nostr identities). It
is not a WoT degree and does not replace 1 X → 1 Nostr operator binding (with
optional many-X on one key) in the extension. Not implemented yet.

The React side panel does not show or export a generated key by default. The raw key
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
other issuers; other issuers need trust-score percent at or above the green follow-trust knob.

**Future / generic servers**

A larger multi-site server may need richer scope handling. If AttentionX ever
needs scope in resolve without expanding graph slots, prefer treating scope as
the **first segment of context** (Resolver-side) rather than changing graph
reduction. That path is **not** required now.

The newest valid event per `(author, d)` wins by `created_at`, then lexically
lower event ID. Empty `v` Deletes the slot without reviving an older
statement. `"0"` is Neutral: an active statement kept in the graph, not a
hop. Signature, event ID, deterministic `d` tag, primary subject, optional
scope/context/labels, subject hints, value, activation, expiration, and
content limits are validated before an event enters indexes or the graph.

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

The database is Dexie `version(1)` (native IndexedDB version 10). Opening an
older `attentionx` IDB deletes it and recreates empty tables; events resync
from relays. The encrypted vault in `chrome.storage.local` is not touched.

Events can be exported and imported. On startup GraphManager loads identity
binds and winning kind `32009` / `32014` events into the Trust Graph heap.
**IndexedDB is the durable source of truth** (survives worker death). **The
Graph heap is the runtime source of truth** for queries and UI — see
[§ Trust graph heap](#trust-graph-heap-runtime-source-of-truth).

Identifier rules for users, posts, and trust connections (React keys =
numeric X id; npub only at the Nostr boundary) are in
[data-layers.md](data-layers.md).

### X content first (display chrome)

AttentionX shows trust **when a subject is visible on X** (timeline, TweetDetail,
and related allowlisted surfaces). Display chrome for users and posts is
captured from that X content path — not by taking an arbitrary Nostr event and
looking up what it means on x.com. Which **on-page** user/post chrome mounts
where (UserHero, UserAuthor, UserRow, UserRail, UserHover, PostFeed) is in
[x-page-chrome.md](x-page-chrome.md). X’s display-name/handle layout differs by
surface; each chrome keeps its own mount slot (Who to follow is not timeline
author chrome).

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

### The presented user

When an X session exists, **the presented user is the current signed-in X
user**, not the Nostr kind 0 profile. Popup AccountBar, Home bind
copy, permissions and activity labels, Settings Bindings rows, cockpit mapped
nodes, and content SubjectHeader use that X’s `xIdentities` (`displayName`,
`@handle`, `iconPath` / `bannerPath`).

- The header is not a Nostr account dropdown. Nostr keys are managed under
  Settings **Nostr Keys**; pairing is Settings **Bindings**.
- Nostr is the **signing key**, not the displayed identity, when an X session
  or a unique binding exists.
- Off X: if the active account has exactly one bound X, that X’s chrome is
  fine; if several, do not pick a rival X name — npub / generic until an X
  session exists.
- Kind 0 mismatch is **settings-only**, vs the X this key is bound to (the
  currently signed-in X when several). Nostr Keys → key → Profile offers Create if
  missing or Sync toward that X (explicit previewed kind 0 publish). Mapping is
  one-way X → kind 0 (`name` / `display_name` / `picture` / `banner`; `about`
  only from ephemeral `READ_ACTIVE_X_BIO` at publish time — never persist X bio
  text). Merge, don’t replace: do not delete nip05 / lud16 / website. A shared
  key has one kind 0; syncing toward X2 overwrites a profile previously synced
  from X1.
- Binding completeness (bio npub + kind 0 + kind `10011`) uses `xIdentities`
  plus kind 0. The AccountBar avatar shows a check when complete, a warning
  otherwise; click opens this X user’s Bindings detail.
- Unidentified hops are unchanged: X id without chrome = Unknown stub; `p:`
  only = optional kind 0 plus *“An external trusted user, X profile not
  identified.”* Never present kind 0 as X chrome for a mapped user.

### Timeline CPU and responsiveness (product rule)

AttentionX shares the tab with X's own renderer. **The timeline must stay
responsive.** CPU time spent in the extension is time stolen from scrolling,
video, and X's SPA. If AttentionX makes the feed janky or unresponsive,
nothing else the product does matters.

This is a first-class product goal, not an afterthought. Disk and memory
minimization ([§ Minimal data and memory](#minimal-data-and-memory-product-rule))
and the hot-graph query path
([§ Hot trust graph](#hot-trust-graph-and-scroll-performance)) are parts of
the same constraint.

Guidelines for contributors and AI assistants:

1. **Check every change for timeline cost.** New features, observers,
   parsers, messages, UI mounts, and background work must answer: will this
   run on or contend with the timeline hot path? If yes, is the work batched,
   deferred, bounded, and skippable? If it cannot be shown to be cheap, do
   not ship it.
2. **Content and page-world CPU is the scarcest resource.** Work on `x.com`
   (MAIN-world fetch wrapping, JSON clone/parse, MutationObserver, article
   scans, Shadow DOM mounts) competes with X for the same main thread.
   Prefer idle or coalesced scans, fail-open rewrite, and no per-article
   RPCs.
3. **Do not add per-cell or per-mutation work.** Batch visible IDs, debounce
   with the existing scan timer, and answer trust from the in-memory service-
   worker Graph heap. Do not mount React on X. Do not re-parse or re-query on
   every DOM mutation.
4. **Keep the service worker off the scroll critical path.** Heavy sync,
   graph rebuild, identity proof search, and IndexedDB belong off the paint
   path. Scroll queries must be in-memory lookups on the heap. See
   [§ Trust graph heap](#trust-graph-heap-runtime-source-of-truth) and
   [§ Hot trust graph](#hot-trust-graph-and-scroll-performance).
5. **Popup and cockpit may be richer; the timeline may not.** Settings and
   Application can pay more CPU. The feed cannot.
6. **When in doubt, skip or defer.** A missing chip for a frame is better
   than a stuck timeline. Prefer fail-open, bounds, and dropping work over
   catching every edge on the hot path.

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
3. **Delete (empty `v`) is current state, not junk.** Keep the Delete event
   as the slot winner so older trust is not revived. Neutral (`v=0`) is also
   current state — an active statement, not a tombstone. NIP-32009 forbids
   resurrecting replaced events when the winner is inactive or deleted.
4. **Ingest older-than-winner events by discarding them.** “Not in the DB”
   must not mean “store again” if an address winner already exists and is
   newer.
5. **Validate once on write; rebuild fast on read.** Signature and kind-32009
   validation belong on ingest/publish, which also fill EventRecord graph
   columns (`subject`, `subjectType`, `c_tag`, `nValue`, `addressableId`).
   Service-worker rehydrate is one Dexie `each` of stored winners into
   GraphManager (`applyTrustEvent` on the same EventRecord) without parsing
   tags, `reduceKind32009Events`, or re-validating signatures. The heap may
   stamp runtime fields (`index`) on that in-memory object; persist paths
   omit them — events are written from relay ingest or local publish, not
   from putting heap objects. Demo loads
   `state === 'demo'`; live loads kind 32009/32014 except demo. Tombstones
   (empty `v`) never enter the heap. Ingest and publish apply the slot winner
   into GraphManager without a Dexie rescan; full `load()` runs on worker
   start, mode flip, wipe, or verified-identity map change. Bound `user:id`
   nodes convert in place to pubkey nodes (`Graph.bindIdentity`).
6. **Signed fields are enough for re-publish.** Store and relay the seven
   NIP-01 fields; canonical serialization preserves signatures. Do not keep
   raw wire JSON solely for republish fidelity.
7. **Optimize before adding stores or caches.** New IndexedDB tables, in-memory
   indexes, or retained event copies need a clear hot-path or correctness
   reason. Default to pruning, bounds, and write-through reduction — not
   indefinite accumulation.

## Trust graph heap (runtime source of truth)

The Trust Graph heap — the `Graph` class in [`src/graph/trust`](../src/graph/trust) —
is the **single in-memory point of truth** for everything connected to trust.
Do not keep trust-graph data points, event lists, or identity/chrome catalogs
beside it. If you can inspect the Graph instance, you should be able to tell
whether the live picture is complete.

`src/graph/trust` is locked for a reason (DigitalTrustProtocol/Trust; fragile
under AI interference). **Do not write compensation code around it.** If the
heap, `IndexResolver`, `pathStrategyJson`, or `Graph` is missing a capability
the product needs, **stop and ask permission** to change Trust. State what is
missing, why AttentionX wrappers cannot do it, and which Trust file would
change. Wrappers (`src/graph/graph.ts`, `adapter.ts`, `query.ts`,
`ratings/`, [`graphManager.ts`](../src/background/graphManager.ts)) map
heap/`Score[]` onto AttentionX DTOs, attach chrome caches on the Graph
instance, and compose one round-trip payloads. They are not a second graph.

**Do not invent a Trust Graph resolver outside `src/graph/trust`.**
`IndexResolver` is the walk. It is complex and special on purpose. When scores
or hops look wrong, the fix is in Trust — a custom resolver outside that
folder cannot be diagnosed or repaired as the heap. Mapping `Score[]` to
`TrustQueryResult` in `query.ts` is allowed; cloning IndexResolver (including
growing `identity-index-resolver.ts`) is not.

Identity maps and chrome caches belong **on the Graph instance** (the same
place `bindIdentity` already keeps twitterId/`user:id` ↔ npub). Prefer
decorating that instance from AttentionX code over a second map on
`RuntimeContext` or `AttentionXBackend`.

### Durable vs runtime

| Layer | Role |
| --- | --- |
| IndexedDB (`events`, `xIdentities`, `xPosts`) | Durable source of truth. Survives service-worker death. Write-through on ingest and publish. |
| Graph heap | Runtime source of truth. What queries, timeline, Path View, Graph View, and the User/Post panel read. |

**Write path:** a data source updates IndexedDB **and** the heap in real time
(GraphManager `applyRecord` / identity bind / chrome cache on Graph). Do not
persist then wait for a full `load()` before the next query can see the change.

**Read path:** look at the Graph heap first. If the information is not there,
read IndexedDB (or another durable store) and fill the heap. Do not have
frontend or content-script code query IndexedDB for trust, identity chrome, or
relations that the heap should already hold.

### What lives on the Graph

- Heap nodes, edges, and context indexes (`nodesList`, `edgesList`,
  `bindIdentity` / `iToP` / `pToI`).
- **Person identity is the node index**, not the current `Node.id` string.
  Edges store peer indexes. `iToP` / `nodesIndex` look up `user:id` or pubkey
  hex → that index. When a verified npub appears, `bindIdentity` rewrites
  `Node.id` in place (`convertIToP`) and aliases both strings to the same
  index. Unbound `user:id` stays an `i` node until then. `post:id` and `e`
  do not bind — those strings are the heap id. In **demo**, `identityBindPubkey`
  always uses `demoActorPubkey(twitterId)` (unsigned local events); production
  binds a verified real npub and ignores leftover demo-actor `eventNpub`.
- **No event lists outside the Graph.** Winning kind `32009` / `32014` rows
  that are in RAM are the heap edges. Do not keep a second array of trust
  events on Backend, RuntimeContext, or a helper cache.
- **twitterId ↔ npub** (and `user:id` ↔ pubkey) on the Graph, as identity bind
  already does. Do not grow a sibling `twitterIdToPubkey` map as the source of
  truth.
- **`xIdentities` / `xPosts` RAM lists**, when needed, on the Graph instance —
  the same place as the identity lookup — so Graph View, the User/Post panel,
  and composed GraphManager replies can decorate nodes without a second
  catalog.

### What may live outside the Graph

Operational memory that is **not** graph data, including:

- active relay servers and outbox retry state;
- vault unlock and alarms;
- tab focus;
- **current user / operator session** and the **panel director**
  (`PanelSessionController`, `GET_PANEL_SESSION`, signed-in X routing). That
  is an operational pattern. It does not belong on the Graph.

Derived query memos (if any) belong in GraphManager and must invalidate on
`graphVersion`, not as a second event store in Backend.

### How surfaces read the heap

[`IndexResolver`](../src/graph/trust/IndexResolver.ts) and
[`pathStrategyJson`](../src/graph/trust/pathStrategyJson.ts) provide the data
needed to **resolve a trust score** for users and posts — timeline chips and
WoT Path View. AttentionX `query.ts` maps `Score[]` onto `TrustQueryResult`.
If resolve is incomplete (for example self-path or identity hops), ask to
change IndexResolver — do not add a second walk.

The **User/Post panel** and **WoT Graph View** walk the heap for relations
(`Graph.out` / `Graph.in`, neighborhood). They decorate from the
`xIdentities` / `xPosts` cache on the Graph when chrome is needed. They do not
build their own edge lists from IndexedDB.

### GraphManager is the query facade

[`src/background/graphManager.ts`](../src/background/graphManager.ts) is what
[`backend.ts`](../src/background/backend.ts) uses to query the heap.
Backend does not scrape `edgesList` or IndexedDB to assemble trust views.
GraphManager returns the object the frontend or content script needs in **one
round trip**.

Example: trusted users of a subject. GraphManager reads that user’s trusted
edges from the heap, looks up each subject in the Graph’s `xIdentities` cache,
and returns `{ edges, identities }` (or the equivalent typed DTO). The UI
renders from that payload. It does not follow up with N identity RPCs.

Kind `32014` claims stay on the same heap (never hops). Queries still return
trusted, distrusted, mixed, or no evidence plus direct evidence, paths, source
event IDs, graph version, computation time, and truncation state. No numerical
or universal Web-of-Trust score is produced.

## Local WoT and synchronization

Relay synchronization starts from the configured local pubkey and follows only
active positive `p` statements. Depth, fan-out, total authors, and event counts
are bounded. Each relay/scope cursor advances after EOSE and the next query
uses an overlap window; event IDs deduplicate overlap and multi-relay results.

Ingest writes the slot winner to IndexedDB and applies it to the heap in the
same pass. The graph performs deterministic bounded breadth-first traversal.
`p` subjects are traversable, while X account/post `i` subjects remain terminal
evidence.

## Hot trust graph and scroll performance

This section is the service-worker implementation of
[§ Timeline CPU and responsiveness](#timeline-cpu-and-responsiveness-product-rule)
and [§ Trust graph heap](#trust-graph-heap-runtime-source-of-truth):
scroll must stay an in-memory heap lookup. A slow graph rebuild or per-cell RPC
makes the timeline unresponsive; if that happens, nothing else matters.

AttentionX keeps one Graph heap in the service worker, shared by every `x.com`
tab. IndexedDB holds winning kind `32009` / `32014` events and identity/post
chrome so the heap can rehydrate after a worker kill. Kind `32014` claims sit
beside trust edges and are never hops.

```text
IndexedDB          winning 32009/32014 + xIdentities/xPosts   durable
SW Graph heap      personal WoT + binds + chrome caches       runtime truth
GraphManager       backend → one payload for UI / content
Content / panel    batched queries → heap lookup, not IDB
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
| Events | Current winning signed kind `32009` / `32014` — durable |
| `xIdentities` / `xPosts` | Durable chrome; load onto the Graph instance |
| Snapshot (optional) | Precomputed edges/adjacency for the active npub at sync depth (3–6 hops) |

On worker start: GraphManager rehydrates the Graph (binds, chrome caches, then
edges) so queries can run from the heap, optionally mark stale, then reconcile
newer events in the background.

### Query path under heavy scroll

- Batch visible post/account IDs (roughly 20–50 per message), not one RPC per
  cell.
- Debounce/coalesce with the content-script scan timer (~180 ms).
- Answer from the Graph heap on the hot path — no IndexedDB reads per lookup.
- On a heap miss, fill from IndexedDB onto the Graph, then answer. Do not leave
  chrome or identity in a sidecar cache.

### What not to use

- `chrome.storage.session` / `chrome.storage.local` for the graph — too small and
  slow for a large personal WoT.
- Per-tab content-script graph caches — not shared, multiply RAM, inconsistent.
- Worker memory alone with no durable rehydrate — every kill pays a multi-second
  rebuild.
- Sidecar event lists, identity maps, or `xIdentities`/`xPosts` catalogs on
  Backend / RuntimeContext — those belong on the Graph. See
  [§ Trust graph heap](#trust-graph-heap-runtime-source-of-truth).

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
