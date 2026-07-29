# NIP-39 X identity linking

AttentionX uses [NIP-39](https://github.com/nostr-protocol/nips/blob/master/39.md)
kind `10011` events to publish verified links between a Nostr public key and an
X account.

## Event shape

Each link is a replaceable kind `10011` event signed by the claiming Nostr key.
AttentionX requires exactly two X `i` tags:

1. `twitter:<handle>` — the current public username, normalized to lowercase.
2. `twitter_id:<numeric-id>` — the stable numeric X user ID.

Both tags share the same proof-post ID. Clients that support stable references
should prefer `twitter_id` and treat the handle tag as informational.

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

When publishing an update, AttentionX queries the author's current kind `10011`
replacement, removes prior `twitter` and `twitter_id` tags, inserts the new
pair, and preserves unrelated provider tags and existing content.

## Proof post

The proof follows NIP-39 for `twitter`:

- Post from the linked X account.
- Text includes: `Linking my account to Nostr: <npub>`.
- The post ID is the third parameter on each `i` tag.

The backend implements proof text generation and an `already_proven` decision
that rechecks the current replacement before a caller creates another proof.
It also implements proof verification using public
`publish.twitter.com/oembed` data and public X profile JSON-LD.

Before a link is accepted or published, verification checks:

1. the kind `10011` event ID and signature;
2. one canonical `twitter` tag and one decimal `twitter_id` tag;
3. the same decimal proof-post ID on both tags;
4. a public proof post containing the exact proof text for the event author's
   `npub`;
5. the proof post author's handle;
6. public profile resolution mapping that handle to the declared numeric ID.

Verification returns `verified`, `pending`, `invalid`, or `conflict`.
Unavailable proof/profile data is `pending`; contradictory identity candidates
are `conflict`. Only verified mappings become NIP-39 aliases. Verified claims,
proof IDs, timestamps, and provenance are persisted in IndexedDB, and multiple
Nostr keys may remain recorded for one numeric X account.

## Identity resolution and trust subjects

AttentionX resolves a handle from, in order:

1. a current local alias;
2. a sanitized page-world observation pairing `rest_id` and username;
3. public profile JSON-LD;
4. a verified kind `10011` claim.

Handles have bounded cache lifetimes because they can change. Conflicting
numeric IDs remain unresolved instead of being silently selected.

Trust is separate from identity linking. Kind `32009` account statements use
`user:id:<numeric-id>` with optional `k` = `user:id` and optional `s` = `x.com`
(omit `c` for global trust). AttentionX does not publish durable profile trust
keyed only by handle. Post statements use `post:id:<post-id>` with optional
`k` = `post:id` and optional `s` = `x.com`, with **no** `c` tag (global
trust). See `docs/NIP-32009.md`. NIP-39 wire tags remain `twitter` /
`twitter_id`.

## Background API and Phase D gap

The versioned background API includes:

```ts
{
  type: 'GENERATE_X_PROOF',
  version: 1,
  handle: 'nasa',
  twitterId: '11348282'
}

{
  type: 'VERIFY_X_PROOF',
  version: 1,
  event: kind10011Event
}

{
  type: 'PUBLISH_X_IDENTITY',
  version: 1,
  handle: 'nasa',
  twitterId: '11348282',
  proofTweetId: '2080659774136291424'
}
```

`PUBLISH_X_IDENTITY` verifies the proof before signing, stores the event and
outbox state in IndexedDB, and then attempts per-relay delivery.

The Phase D UI shows the complete proof text and destination account, verifies
the active numeric account, requires explicit confirmation, opens X's compose
intent when a new proof is needed, captures the resulting post ID (session-
scoped CreateTweet observation or manual entry), and only then invokes
verification and kind `10011` publication. It never performs another X account
action.
