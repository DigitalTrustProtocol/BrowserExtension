# Data layers and X-ID identity

Page-facing identifiers, selection, and caches for content, the side panel, and
Application. This is discipline around existing stores — not a new IndexedDB
schema.

See also [architecture.md](architecture.md) (storage, X content first, scope)
and [NIP-32009.md](NIP-32009.md) / [NIP-32014.md](NIP-32014.md).

## Identifier rules

**Entities vs connections**

- **Users and posts** are entities. Their durable application id is the numeric
  X id (`twitterId` / `postId`).
- **Trusts and ratings** are connections. Their protocol slot is the `d` tag.
  Because `d` is not globally unique, the application key is
  `addressKey` = `kind:pubkey:d` (`eventAddress` / `events.addressKey`).

`d` is SHA-256 of kind `32009` / `32014` material (subject + scope + context).
A new signed event in the same slot **replaces** the connection; `eventId` is
only the current occupant. Delete (empty `v` / empty `score`) keeps the slot
winner with no active edge.

React controls on panel, Application, and content identify a user by
`twitterId` and a post by `postId`. Props, list `key`s, and hooks never take
npub, hex, or handle as the entity id.

| Kind | Page / React key | Backend |
|------|------------------|---------|
| User (entity) | `twitterId` | PK on `xIdentities`; `npubForTwitterId` / `twitterIdForNpub` when a binding exists |
| Post (entity) | `postId` | PK on `xPosts` |
| Trust / rating (connection) | `connectionKey` (= `events.addressKey`) | `d` tag = slot; winning `eventId` is occupant only |
| Handle | display only | secondary index |
| npub / hex | optional **field** on the full user record; hop node id when unbound | wire identity; never a user/post React key |

Protocol subjects stay `user:id:<digits>` / `post:id:<digits>` on kind `32009`
/ `32014` **wire**. Pages pass bare digits. The backend converts at event and
graph boundaries.

Until a numeric id is known, content may target DOM by handle but must not
publish selection, persist, or query trust.

Do **not** use `src/graph/trust` `Edge.addressableId` as `connectionKey`. That
internal slot string is `author|type:value|context`, not `events.addressKey`.

## Layers

```text
Content / Panel / Application
        │
        ▼
PageEntityStore (keyed useUser / usePost + selection prefetch)
        │
        ▼
SelectedSubject bus  (SELECT_SUBJECT / OPEN_SIDE_PANEL / SELECTED_SUBJECT_CHANGED)
        │
        ▼
AttentionXBackend
        │
        ├── AttentionXRepository → IndexedDB xIdentities / xPosts / events
        └── LocalTrustGraph (pubkey hops; do not edit src/graph/trust)
```

- **Storage:** [`AttentionXRepository`](../src/storage/repository.ts) is the
  only IndexedDB access. No `UserStorage` wrapper, no new object stores, no
  service-worker identity `MemoryCacheStore`.
- **Translation:** backend-only. Pages never call npub ↔ X id.
- **List/graph chrome:** [`XIdentityDisplay`](../src/shared/contracts.ts).
  Full [`XIdentityRecord`](../src/storage/types.ts) only for the focused
  identity. **Operator chrome** (popup AccountBar, Bindings rows, permissions /
  activity labels) is the **current signed-in X user** (`xIdentities`
  displayName / handle / iconPath) — not kind 0 `name` / `picture`. Kind 0 is
  not mapped-user chrome.
- **Selection:** keep [`SelectedSubject`](../src/shared/selected-subject.ts)
  and [`GRAPH_FOCUS`](../src/shared/graph-deeplink.ts). Do not dual-slot
  `{userId, postId}`.
- **Page cache:** TrustStore-shaped keyed maps, not “one selected user + one
  selected post.”

## Backend identity translation

Not a page RPC. Backend (and repository helpers) resolve either direction when
a binding exists:

```ts
npubForTwitterId(twitterId: string): Promise<string | undefined>
twitterIdForNpub(npub: string): Promise<string | undefined>
```

- Winning binding from [`evaluateXIdentityRow`](../src/identity/x-identity-row.ts)
  (bio / post / nip39 / 32009). Hex and bech32 normalize to the same lookup.
- Miss → `undefined`. Never invent an X id for unbound hops.
- `twitterIdForNpub` matches the **winning** npub, not every stale source
  column. The service worker keeps a small `npub/hex → twitterId` map rebuilt
  on identity/graph rehydrate and identity status updates. **No new object
  store.**
- `GET_X_IDENTITY_DISPLAYS_FOR_PUBKEYS` stays for graph/list chrome. React
  still keys by `twitterId` after that map.

## Selection

Keep `SELECT_SUBJECT` / `GET_SELECTED_SUBJECT` / `SELECTED_SUBJECT_CHANGED` /
history.

**Graph → panel:** canvas clicks keep `OPEN_SIDE_PANEL` (commit + broadcast +
open/update the panel). `SELECT_SUBJECT` remains for selection without opening.

| Node | Subject committed |
|------|-------------------|
| Known or stub X user | `{ type:'i', value:'user:id:<twitterId>' }` |
| X post | `{ type:'i', value:'post:id:<postId>' }` |
| Unidentified hop (no X id) | `{ type:'p', value:'<hex>' }` — never invented as a twitterId |

At the **backend** boundary, normalize a mapped `p:` to `user:id`; preserve
an unmapped `p:`. GraphPage / NeighborhoodView must not invent an X id for
unbound hops. After xIdentities chrome is known, bound `p:` hops may be
**drawn** as `i:user:id:` so Path and Graph do not show two copies of one
X identity. Root stays `p:<vault>` labeled You.

**Panel → graph:** `GRAPH_FOCUS` opens/centers the canvas. Do not live-mirror
every timeline chip into the graph.

Profile URL only when an X id exists: `canonicalTwitterProfileUrl` →
`https://x.com/i/user/<twitterId>`. Posts: `https://x.com/i/status/<postId>`.
New tab, user click only.

## Unidentified display

Query is unchanged. The canvas and panel **draw** two unidentified cases
(both selectable). Do not drop them from `QUERY_TRUST`. Do not scrape X to
fill chrome.

1. **Has X id, no `xIdentities` chrome** — Unknown stub. User-initiated
   `https://x.com/i/user/<twitterId>`. Copy: trusted, but the X profile is
   **not identified yet**.
2. **No X id, npub/`p:` only** — show available Nostr relay name/avatar plus
   *“An external trusted user, X profile not identified.”* No x.com link.
   Statements still load from Nostr. Never present Nostr name/avatar as X
   chrome.

When chrome later arrives (`X_IDENTITY_UPDATED`), upgrade Unknown stubs in
place.

**Outgoing list:** always `QUERY_TRUST` (trusted-by). `QUERY_OUTGOING_TRUST`
when an author pubkey is available (`p:` directly, or a binding for
`user:id`). If an id-only user has no npub binding, show incoming statements
and mark the outgoing list **unavailable** — do not show a misleading empty
list.

## Page keyed cache

One [`PageEntityStore`](../src/shared/page-entity-store.ts) instance per
document (content, popup, cockpit):

- `Map<twitterId, XIdentityRecord>` and `Map<postId, XPostRecord>` with
  in-flight coalesce.
- `useUser(twitterId)` / `usePost(postId)` (React) and content equivalents.
- Extract `twitterId` / `postId` from `SelectedSubject` for React; keep the
  bus as `SelectedSubject`.
- A single selection-prefetch owner coalesces `QUERY_TRUST` + eligible
  `QUERY_OUTGOING_TRUST` so Header, Notes, and StatementScan subscribe rather
  than triple-fetch.
- Lists/graph: `GET_X_IDENTITY_DISPLAYS` when chrome exists; else Unknown or
  external-unidentified.

## Scope ingest

| Kind | Eligible `s` | Helper |
|------|----------------|--------|
| `32009` trust | empty **or** `x.com` | `isEligibleXTrustScope` |
| `32014` rating | **`x.com` required** (not empty, not other domains) | `isEligibleXRatingScope` |

Empty-scope person-to-person trust still matters on X when both use the same
keys. Ratings never expand hops.

Do **not** tighten shared `selectXEligibleTrustEvents` (its per-subject
scope-rank, `x.com` over empty, is required for 32009 empty-scope fallback).
Ratings use a separate `selectXEligibleRatingEvents`. Existing ineligible
32014 winners become inert and are safely pruned. Demo seeds already emit
`s=x.com` via `defaultTrustPublishTags`.

## Connection UI keys

Kind `32009` / `32014` React rows, Notes, identity-panel statements, and graph
chrome that name “this trust” key by `connectionKey` copied from
`EventRecord.addressKey`. The backend enriches graph query responses by
resolving each winning `eventId` to the stored event row. Path evidence still
uses source `eventId`s.

Same `d` from two authors → two `connectionKey`s. Replacing an event
preserves the key and changes `eventId`.

## Future: central X user directory

A hosted, somewhat-trusted **verified X user ↔ npub** list is planned. When it
exists, the extension may resolve identities **off X** for people who appear
in Nostr events but are missing from local `xIdentities`.

- Lookups: npub → twitterId and twitterId → npub (and enough chrome to leave
  Unknown), keyed from event authors/subjects the operator has not scrolled
  into on X.
- Does **not** replace local `xIdentities` / `xPosts` as the store of
  *observed* timeline chrome. Directory results need explicit remote
  provenance and must not be written as locally observed X chrome without a
  later schema decision.
- Still never GraphQL/oEmbed-scrape X to grow the graph. User-initiated
  `x.com/i/user/<id>` stays allowed.
- Unknown / external-unidentified UI stays until the directory ships.
- Distinct from **Identity Link** (mutual npub↔npub), which remains out of
  scope.

Hook (not implemented): `resolveRemoteXIdentity({ npub?, twitterId? })`
behind the backend — never called from page-world, never a secret/token leak.

## Out of scope (this pass)

- Entire [`src/graph/trust/`](../src/graph/trust/) package.
- Fetching X profiles/posts for unknown subjects.
- New IndexedDB stores / `ATTENTIONX_DB_VERSION` bump.
- Identity Link.
- The central directory service.
