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
#seedDemoWot()            ← keys, xIdentities.eventNpub, kind 0/32009/32014
        ↓
graphManager.load()       ← one-pass Dexie each into the heap
        ↓
#pruneOrphanXPosts()      ← drop xPosts with no trust/proof evidence
```

**Re-seed** after planner or binding logic changes:

- Send `SEED_DEMO_WOT` (clears demo events, then ingests), or
- Leave Demo and re-enter when the demo store is empty.

Stale graphs keep old anonymous authors until re-seed.

## Authors (signing keys)

Demo authors are **not** anonymous Ada/Ben personas. Each author slot is bound
1:1 to an `xIdentities` row.

| Author index | Identity | Hop | Role |
|-------------|----------|-----|------|
| `0` | Elon (`44196397`) | 1 | Trusts SpaceX (`user:id` + `p`) |
| `1` | SpaceX (`34743251`) | 2 | Trusts Tesla |
| `2` | Tesla (`13298072`) | 3 | Trusts NASA |
| `3` | NASA (`11348282`) | 4 | Chain leaf |
| `4…` | Recent non-chain `xIdentities` (up to 16) | 1 | Trust Elon + dense post ratings; **no** trust onto SpaceX/Tesla/NASA |

- `authorIndex === -1` is the **operator root** (unlocked vault account).
- `plan.authors` lists every slot (`DemoWotAuthorSlot`: `twitterId`, handle,
  displayName, hop).
- `plan.fakeAuthorCount === plan.authors.length` (typically `4 + extras`, not 32).

### Seeder binding

For each author slot the seeder must:

1. Generate an ephemeral Nostr keypair (demo-only; never published).
2. Write `eventNpub` on the matching `xIdentities` row (lowest-precedence npub
   column; sufficient for `collectXIdentityPubkeyHexes` and Graph enrichment).
3. Ingest a tagged **kind 0** profile: `name` / `display_name` from identity
   chrome (`demoWotAuthorProfile(index, plan.authors[index])`), HTTPS `picture`
   placeholder only.
4. Sign planned **kind 32009** / **kind 32014** rows with that key (or root for
   `authorIndex === -1`).

Without `eventNpub`, `QUERY_OUTGOING_TRUST` for `user:id:44196397` returns
`unavailable` and Graph shows no outgoing edges from Elon’s user node.

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

### `p` hops (WoT traversal)

- Root → every hop-1 author (Elon + extras).
- **Chain only:** Elon → SpaceX → Tesla → NASA (indices `0→1→2→3`).
- No lateral mesh. Extras have **no** outgoing `p` edges — only root points at
  them, so they stay at hop 1 and cannot shorten the chain.

### `user:id` hops (X account subjects, `s=x.com`)

- Root → Elon (`v=1`).
- Each hop-1 extra → Elon (StatementScan density).
- **Elon → SpaceX** (`v=1`, author `0` — this is the fix for “Elon trusts nobody”).
- SpaceX → Tesla (`v=1`, author `1`).
- Tesla → NASA (`v=1`, author `2`).
- Root never issues any polarity on SpaceX, Tesla, or NASA (preserves degrees 2–4).
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
   stay `p:` / `unidentifiedKind: external`. Root stays labeled You.
3. **StatementScan:** `QUERY_OUTGOING_TRUST` for Elon must not be `unavailable`
   and must include SpaceX `user:id`.

## Fill logic (non-chain bulk)

After the chain spine, the planner adds bounded noise from observed data:

- Root direct trusts: up to `DEMO_WOT_ROOT_DIRECT_USERS` recent non-chain users
  (never later chain members).
- Network trusts per user: `demoTrustsPerUser(twitterId)` capped by
  `DEMO_WOT_MAX_TRUSTS_PER_USER`, issued by hop-1 authors only.
- Other posts: root + hop-1 / later authors within statement budget; trust
  statements only — **no** kind `32014` ratings on non-chain posts.

All of this still respects the subject eligibility rules above.

## Source files and tests

| Area | Location |
|------|----------|
| Constants, chain, planner | `src/shared/demo-wot.ts` |
| Planner unit tests | `src/shared/demo-wot.test.ts` |
| Seed, bind, ingest | `src/background/backend.ts` (`#seedDemoWot`, `#ensureDemoWotChainIdentities`) |
| Integration test | `src/background/backend.test.ts` (“seeds and clears local-only demo WoT”) |
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
6. **Skipping `eventNpub` bind on seed.** Identity rows stay pubkey-less for
   outgoing queries and pubkey enrichment.
7. **Seeding a fake `eventNpub` on the operator’s own X row.** Path shows You
   and a second hop with the same display name. Skip that twitterId as an
   extra author.

## Related docs

- [architecture.md § X content first](architecture.md#x-content-first-display-chrome)
- [data-layers.md](data-layers.md) — X-ID keys, unidentified display rules
- [NIP-32009.md](NIP-32009.md) — trust statement wire format
- [NIP-32014.md](NIP-32014.md) — ratings (never WoT hops)
