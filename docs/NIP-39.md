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

When an X proof post is available, AttentionX appends a fourth, structured
subject hint that repeats the proof post as `post:id:<same-id>`. The standard
raw numeric proof-post ID remains in element 3 for compatibility. A legacy
three-element tag is still valid; when the fourth element is present it MUST
match element 3.

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

The fourth element is an AttentionX extension, not a replacement for the NIP-39
proof-post field. Implementations interoperating with strict clients SHOULD
accept legacy three-element tags and SHOULD ignore the optional fourth hint
when they do not support structured subject hints. AttentionX validators
require the fourth value, when present, to be the canonical
`post:id:<same-id>` form.

When publishing an update, AttentionX queries the author's current kind `10011`
replacement, removes prior `twitter` and `twitter_id` tags, inserts the new
pair, and preserves unrelated provider tags and existing content.

## Revocation

To revoke an X claim, publish a newer replaceable kind `10011` with all
`twitter` / `twitter_id` tags removed, preserving unrelated provider tags and
content. A signed kind `10011` without Twitter tags is valid as a slot winner
but is not an identity claim — claim validation still requires both tags.

Revocation is latest-wins only. Relays retain historical claim events; readers
that ignore replaceable-event semantics may still surface an older claim.
AttentionX treats the current addressable slot winner as authoritative and
clears local `nip39*` columns when the winner has no Twitter claim.

Popup Unlink (User settings) offers: publish clear `10011` → suggest stripping
the npub from the X bio → clear local `xIdentities` sides → unbind
`boundTwitterId`.

## Proof post

**Primary linking UX** is Update bio (popup): prepare a suggested profile
description with `npub1… (nostr)` (drop `(nostr)` when the 160-character X bio
limit is tight), copy it, and open `https://x.com/settings/profile` so the user
pastes it themselves. AttentionX never writes the X bio. When the live bio or
`xIdentities.xNpub` already holds a different npub, the UI offers an explicit
replace before building the copyable suggestion.

AttentionX still **supports** the canonical NIP-39-style proof **post** for
`twitter` when publishing kind `10011` (secondary path):

- Post from the linked X account.
- Text includes: `Linking my account to Nostr: <npub>`.
- The raw post ID is the third parameter on each `i` tag. AttentionX adds
  `post:id:<same-id>` as the fourth parameter when the proof post is
  available.

**Discovery and verification** also accept looser ecosystem wording (for
example “Verifying my account on nostr… My Public Key: …”) when the post
embeds exactly one valid `npub` and an intent cue (`nostr` plus
link/verify/public-key language). Bare npub spam and multi-npub posts are
rejected. Composer output stays the Linking template.

Passive allowlisted GraphQL timeline/detail JSON may emit Bio npub candidates
(`REPORT_X_BIO_CANDIDATES`) and post-proof candidates
(`REPORT_X_PROOF_CANDIDATES`). Bio is the primary X source (single `npub1…` in
`legacy.description`); post proofs remain secondary and require public oEmbed
before `post*` writes. Gated `SearchTimeline` search remains available when
unbound.

`xIdentities` stores per-source dates: `xDate` (bio-carrying post time),
`postDate` (proof-post `created_at`), `nip39Date` (signed 10011 `created_at`),
`eventDate` (selected 32009 `created_at`). Newer source dates win within a
source; cross-source precedence is Bio > Post > 10011 > WoT-gated 32009 (see
`.cursor/rules/x-identity.mdc`).

The backend implements `PREPARE_X_BIO_EDIT` for the bio linking UX, plus proof
text generation and an `already_proven` decision for the secondary post path.
Post-proof verification still uses public `publish.twitter.com/oembed` and
profile resolution. Kind `10011` is self-verified from signature + matching
`twitter_id` without oEmbed. `proofSource` records which source currently
supplies the winning npub.

## Identity resolution and trust subjects

Durable identity storage is `xIdentities`, keyed by `twitterId`. Backend
lookups always use that numeric ID. The row’s `handle` is the latest mutable
username (for X.com URLs and proof search), not a primary key.

When a handle must be resolved to a numeric ID (e.g. before an observation
exists), AttentionX tries, in order:

1. a sanitized page-world observation pairing `rest_id` and username;
2. public profile JSON-LD;
3. a verified kind `10011` claim (both `twitter` and `twitter_id` tags).

Conflicting numeric IDs remain unresolved instead of being silently selected.

Trust is separate from identity linking. Kind `32009` account statements use
`user:id:<numeric-id>` with optional `k` = `user:id` and `s=x.com` for new X
statements, and product person trust uses `c=identity`. Older empty-context
user statements remain valid. AttentionX does not publish durable profile trust keyed only by
handle. Post statements use `post:id:<post-id>` with optional `k` = `post:id`
and `s=x.com`, with **no** `c` tag. A 32009 `i` subject MAY
carry a bare `npub1…` hint for the subject's linked pubkey; that hint is
advisory fallback metadata and does not replace Bio/post evidence or the
signed, independently verified kind `10011` claim. See `docs/NIP-32009.md`.
NIP-39 wire names remain `twitter` / `twitter_id`.

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
