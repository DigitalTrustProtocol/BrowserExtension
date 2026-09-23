# Demo WoT data construction

Local **Demo** mode seeds a bounded Web-of-Trust graph for Panel, StatementScan,
and Application Graph — without publishing to relays. This document is the
contract for how that data must be built. Implementation lives in
`src/shared/demo-wot.ts` (plan) and `src/background/backend.ts` (`#seedDemoWot`).

## Goals

Demo data must let a human verify:

1. **Degree chain:** root → Elon (1) → SpaceX (2) → Tesla (3) → NASA (4).
2. **Named chrome:** chain accounts and hop authors show as real X identities in
   Panel and Graph — not “Unknown” pubkey stubs.
3. **Outgoing trust from Elon:** expanding Elon in Graph or StatementScan shows
   SpaceX (and downstream chain members at the right degrees).
4. **X content first:** user/post subjects resolve from `xIdentities` /
   `xPosts`, not invented ids.

## Pipeline

```text
observe xIdentities + xPosts
        ↓
planDemoWotNetwork()      ← deterministic plan (no signing)
        ↓
#seedDemoWot()            ← unsigned local records (sentinel root + derived X authors)
        ↓
graphManager.load()       ← one-pass Dexie each into the heap
        ↓
#pruneOrphanXPosts()      ← drop xPosts with no trust/proof evidence
```

**Re-seed** after planner or binding logic changes:

- Send `SEED_DEMO_WOT` (clears demo events, then ingests), or
- Leave Demo and re-enter when the demo store is empty.

Stay in Demo when the signed-in X id appears or changes:
`REPORT_ACTIVE_X_ACCOUNT` points Graph You at `demoActorPubkey(that id)`.
It does **not** re-seed and does **not** delete demo events. The previous
user's outs stay on their derived key. Later pings for the same id are no-ops.
With nobody signed in, Graph You is the sentinel backup.

Stale graphs keep old anonymous authors until re-seed.

## Authors (derived X-id pubkeys)

Demo authors are **not** anonymous Ada/Ben personas. Each author slot is bound
1:1 to an `xIdentities` row. Person hex is `demoActorPubkey(twitterId)`,
including the signed-in X. Bio / vault npubs are ignored in demo. Derived
keys are **not** stored on `xIdentities`.

The in-code **operator sentinel** (`demoOperatorPubkey()`) is Graph You only
when nobody is signed in. It is never stored in the vault, never signs, and
never exposed to NIP-07 or Browser Sync (`GET_STATE.pubkey` stays empty).
`GET_GRAPH_SNAPSHOT.rootPubkey` is `demoActorPubkey(signed-in X)`, or the
sentinel when there is no X. Root rows are always seeded (`rootIndex`
exists). `demoRootTwitterId` is only a RAM latch so a repeated report for
the same id does nothing.
Demo no longer requires an unlocked vault account.

| Author index | Identity | Hop | Role |
|-------------|----------|-----|------|
| `0` | Elon (`44196397`) | 1 | Trusts SpaceX (`user:id` + `p`) |
| `1` | SpaceX (`34743251`) | 2 | Trusts Tesla |
| `2` | Tesla (`13298072`) | 3 | Trusts NASA |
| `3` | NASA (`11348282`) | 4 | Chain leaf |
| `4…` | Recent non-chain `xIdentities` (up to 16) | 1 | Trust Elon + dense post ratings; **no** trust onto SpaceX/Tesla/NASA |

- `authorIndex === -1` is **Graph You**: `demoActorPubkey(signed-in X)`, or
  the sentinel when nobody is signed in. Not the vault.
- `plan.authors` lists every slot (`DemoWotAuthorSlot`: `twitterId`, handle,
  displayName, hop).
- `plan.fakeAuthorCount === plan.authors.length` (typically `4 + extras`, not 32).

### Seeder binding

For each author slot the seeder must:

1. Derive `demoActorPubkey(twitterId)` (pure function of the X id; not persisted).
2. Bind `user:id` to that hex in demo (`identityBindPubkey`) so hop `p` nodes
   and `user:id` share one heap index, including the signed-in X. Do **not**
   write `eventNpub`.
3. Ingest a tagged **kind 0** profile: `name` / `display_name` from identity
   chrome (`demoWotAuthorProfile(index, plan.authors[index])`), HTTPS `picture`
   placeholder only.
4. Ingest planned **kind 32009** / **kind 32014** as **unsigned** local records
   (`pubkey` set, dummy `sig`, `verifyEvent: false`). Root rows use the
   signed-in derived key, or the sentinel when nobody is signed in. Not the
   vault.

GraphManager demo bind is enough for `QUERY_OUTGOING_TRUST` on
`user:id:44196397` — no stored `eventNpub`.

## Chain accounts (`DEMO_WOT_CHAIN`)

Always present; resolved from observed handles when ids differ.

| Handle | Twitter id | Target degree |
|--------|------------|---------------|
| `elonmusk` | `44196397` | 1 |
| `spacex` | `34743251` | 2 |
| `tesla` | `13298072` | 3 |
| `nasa` | `11348282` | 4 |

`#ensureDemoWotChainIdentities()` inserts missing chain rows (handle +
displayName) before planning.

## Trust topology (required edges)

### Who issues trust

An X id is not an nsec and never authors a demo event. The issuer is always
`demoActorPubkey(twitterId)` (Graph You is that key for the signed-in X, or
the sentinel when nobody is signed in).

- One issuer, one event per account. You trusts Elon and other recent
  accounts (`DEMO_WOT_ROOT_DIRECT_USERS`, Elon included), each as a single
  `user:id` row from the derived key. No second event onto that same account.

### `p` hops (WoT traversal)

- Hop h → hop h+1 extras only. You does not `p`-trust those accounts;
  You's trusts are the `user:id` rows below.
- No lateral mesh onto SpaceX / Tesla / NASA. Extras do not `p`-trust those
  accounts.

### `user:id` rows (X account subjects, `s=x.com`)

Issued by the derived key. Subject is the X account. One row per issuer.

- Root → Elon and other recent accounts, one `user:id` each
  (`DEMO_WOT_ROOT_DIRECT_USERS`, Elon included).
- **Elon → SpaceX**, **SpaceX → Tesla**, **Tesla → NASA** (`v=1`).
- Each other witness at the hitting hop may trust, Neutral, or distrust
  that account, and does not also `p`-trust it.
- SpaceX / Tesla / NASA also receive Neutral (`v=0`) and distrust (`v=-1`) from
  non-predecessor **hitting-hop** witnesses (hop 1 / 2 / 3) so Graph polarity
  filters and StatementScan last-degree evidence show mixed polarities. Neutral
  and distrust are **not** traversal hops (`demoWotSubjectDegree` counts `v=1`
  only). Elon stays all `v=1`.

### Degrees must not shortcut

- Hop constraints apply to **every** `user:id` polarity. Hop-1 extras must not
  issue any statement on Tesla / NASA `user:id` (distrust would become the
  hitting degree; Neutral would be dropped by last-degree evidence).
- Tesla witnesses use hop ≥ 2; NASA witnesses use hop ≥ 3. Mixed Neutral /
  distrust that should appear in QUERY_TRUST live at the hitting hop only.
- Tests: `demoWotSubjectDegree` and backend `QUERY_TRUST` on chain ids.

## Subjects and chrome

### User subjects (`user:id`)

- May target: chain ids + recent observed `xIdentities` (capped by
  `DEMO_WOT_MAX_USER_SUBJECTS`).
- Every trusted `user:id` must already exist in `xIdentities` (or chain seed).

### Post subjects (`post:id`)

- **Observed** `xPosts` only, whose `authorTwitterId` is in the trusted user
  set.
- **Never** invent `post:id` values. There are no synthetic or fallback posts;
  if no posts were observed, the demo has no post subjects.

### Chain post ratings (panel evidence)

- Only the **latest observed** post per chain account is trusted and rated:
  - Elon + SpaceX latest: dense trust + ratings from every hop-1 author.
  - Tesla latest: hop 2 (SpaceX). NASA latest: hop 3 (Tesla) — preserves post
    degrees 2 / 2 / 3 / 4 without shortening user degrees.
- Non-latest chain posts and other users' posts are **never rated** — ratings
  stay on posts a reviewer can easily find and verify on X.

## Event rules

| Kind | Purpose | Notes |
|------|---------|--------|
| `32009` | Trust / distrust / Neutral | Non-empty `content` (StatementScan quotes); `test:attentionx-demo` tag; `state: demo`. SpaceX / Tesla / NASA emit all three polarities; Elon stays trust. |
| `32014` | Ratings | Latest observed chain posts only; `s=x.com` |
| `0` | Author profile | Demo tag; name from X identity |

- Account/post `32009`: `k` + `s=x.com`, no `c` on new X user trusts.
- `p` hops: no `s` tag; `d` = target pubkey hex.
- **Never** enqueue demo events to the outbox or relays.
- Caps: `DEMO_WOT_MAX_STATEMENTS` (2000), `DEMO_WOT_MAX_RATINGS` (600).

## UI / graph expectations

These are part of the data contract, not optional polish:

1. **Outgoing from `user:id`:** `#getGraphNeighborhood` passes
   `collectXIdentityPubkeyHexes(identity)` as `outboundPubkeys` so Elon’s
   `user:id` center shows edges signed by his bound key.
2. **Pubkey → X chrome:** `useGraphNodeEnrichment` calls
   `loadXIdentityDisplaysForPubkeys` so bound `p:` hops get X names, then
   draws those hops as `i:user:id:` when a twitterId is known. Unbound hops
   stay `p:` / `unidentifiedKind: external`. Graph You is labeled You plus
   the signed-in X handle/avatar (`keepLabel` + `rootXDisplay`).
3. **StatementScan:** `QUERY_OUTGOING_TRUST` for Elon must not be `unavailable`
   and must include SpaceX `user:id`.
4. **Looking at You is not a trust statement.** Binding `user:id:<signed-in>`
   onto the viewer hex does not mint self-trust. `QUERY_TRUST` is incoming
   WoT evidence only; with nobody issuing onto You the score is disconnected
   (honest empty), never a synthetic trusted-with-no-events.
5. **Expanding You** shows root outs (Elon and hop-1 extras) for whoever
   authored the seed. A later signed-in X becomes Graph You via
   `demoActorPubkey(that id)` and does not re-seed. The previous user's outs
   stay on their derived key. You after a switch may have no edge to Elon.

## Fill logic (non-chain bulk)

After the chain spine, the planner adds bounded noise from observed data:

- Root direct trusts: up to `DEMO_WOT_ROOT_DIRECT_USERS` recent non-chain users
  (never later chain members).
- Network trusts per user: `demoTrustsPerUser(twitterId)` capped by
  `DEMO_WOT_MAX_TRUSTS_PER_USER`, issued by hop-1 authors only.
- Other posts: root + hop-1 / later authors within statement budget; trust
  statements only — **no** kind `32014` ratings on non-chain posts.

All of this still respects the subject eligibility rules above.

## Continuous growth

After the seed, newly observed X accounts are woven in the background. The
signed-in X account (or the sentinel when nobody is signed in) authors one
`user:id` onto the new account. That account authors its own outgoing
`user:id` rows: Elon, then up to two already-woven peers. No `p` row is
added for the same person — demo bind already makes a `user:id` trust walk
as a pubkey hop.

Switching X accounts does not rewrite events already stored. The account you
are on now trusts the one you just left, unless that pair is already written.
An account never receives a statement from itself.

Growth stops at `DEMO_WOT_MAX_STATEMENTS` (2000). It does not run in Live.
`trustGraph` is published on a trailing debounce so x.com tabs are not redrawn
once per statement.

## Source files and tests

| Area | Location |
|------|----------|
| Constants, chain, planner | `src/shared/demo-wot.ts` |
| Planner unit tests | `src/shared/demo-wot.test.ts` |
| Seed, bind, ingest | `src/background/backend.ts` (`#seedDemoWot`, `#ensureDemoActorKind0`, `#adoptDemoRootTwitterId`) |
| Continuous growth | `src/shared/demo-wot.ts` (`planDemoWotUserGrow`), `src/background/demo-wot-grow.ts` |
| Integration test | `src/background/backend.test.ts` (“seeds and clears local-only demo WoT”, sentinel Graph root, late signed-in X adopt) |
| Neighborhood outbound | `src/graph/graph.ts` (`outboundPubkeys`) |
| Graph enrichment | `src/cockpit/graph/useGraphNodeEnrichment.ts` |

Run `npm run check` after changing demo construction.

## Anti-patterns (do not reintroduce)

1. **Anonymous author grid** (e.g. 4×4 spine + 16 chorus = 32 unrelated keys).
   Graph shows Unknown users; Elon never signs trust.
2. **Shortcuts onto later chain members.** Root → SpaceX/Tesla/NASA collapses
   them to degree 1; hop-1 extras → Tesla/NASA collapse them to degree 2. Only
   the chain predecessor may vouch for the next link.
3. **Trusting `user:id` / `post:id` without chrome.** Panel/Graph show stubs.
4. **Inventing `post:id` subjects.** No synthetic/fallback posts — observed
   `xPosts` only. Violates X content first.
5. **Elon only as subject, never as author.** Outgoing trust and StatementScan
   break for `user:id:44196397`.
6. **Writing a demo `eventNpub` on seed.** The derived hex is computed from the
   X id at bind time. Persisting it pollutes the 32009 projection column.
7. **Using the vault as a demo author.** Demo events must never carry a live
   pubkey. Root is `demoActorPubkey(signed-in X)`, or the sentinel when
   nobody is signed in. Skip the operator twitterId as an extra author
   **and** as a `user:id` / own-post subject so You is one node. After
   planner or bind changes, re-seed with `SEED_DEMO_WOT`. Do not re-seed on
   every signed-in X change.
8. **Signing demo events.** Demo ingest is unsigned local records. `finalizeEvent`
   / vault / derived secrets must not run on this path.

## Related docs

- [architecture.md § X content first](architecture.md#x-content-first-display-chrome)
- [data-layers.md](data-layers.md) — X-ID keys, unidentified display rules
- [NIP-32009.md](NIP-32009.md) — trust statement wire format
- [NIP-32014.md](NIP-32014.md) — ratings (never WoT hops)
