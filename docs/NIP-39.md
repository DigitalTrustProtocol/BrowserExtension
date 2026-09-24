# NIP-39 X identity linking

Attention uses [NIP-39](https://github.com/nostr-protocol/nips/blob/master/39.md)
kind `10011` events to publish verified links between a Nostr public key and an
X account.

## Event shape

Each link is a replaceable kind `10011` event signed by the claiming Nostr key.
Attention requires exactly two X `i` tags:

1. `twitter:<handle>` — the current public username, normalized to lowercase.
2. `twitter_id:<numeric-id>` — the stable numeric X user ID.

Bio-backed discovery still uses the public profile Bio as an X-side hint.
Kind `10011` itself is a signed claim and does not require that Bio: two-element
tags are enough because the event signature proves key control:

```json
["i", "twitter:<handle>"]
["i", "twitter_id:<numeric-id>"]
```

Legacy post-backed claims may include the same X proof-post ID as element 3.
Clients that support stable references should prefer `twitter_id` and treat
the handle tag as informational.

For post-backed claims, Attention appends a fourth, structured subject hint
that repeats the evidence post as `post:id:<same-id>`. The standard raw
numeric proof-post ID remains in element 3 for compatibility. A legacy
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

The fourth element is an Attention extension, not a replacement for the NIP-39
evidence field. Implementations interoperating with strict clients SHOULD
accept legacy three-element tags and SHOULD ignore the optional fourth hint
when they do not support structured subject hints. Attention validators
require the fourth value, when present, to be the canonical
`post:id:<same-id>` form.

When publishing an update, Attention queries the author's current kind `10011`
replacement, removes prior `twitter` and `twitter_id` tags, inserts the new
pair, and preserves unrelated provider tags and existing content.

## Revocation

To revoke an X claim, publish a newer replaceable kind `10011` with all
`twitter` / `twitter_id` tags removed, preserving unrelated provider tags and
content. A signed kind `10011` without Twitter tags is valid as a slot winner
but is not an identity claim — claim validation still requires both tags.

Revocation is latest-wins only. Relays retain historical claim events; readers
that ignore replaceable-event semantics may still surface an older claim.
Attention treats the current addressable slot winner as authoritative and
clears local `nip39*` columns when the winner has no Twitter claim.

Popup Unlink (User settings) offers: publish clear `10011` → suggest stripping
the npub from the X bio → clear local `xIdentities` sides → unbind
`boundTwitterId`.

## X-side evidence

**Primary linking UX** is Update bio (popup): open the X profile and its Edit
profile dialog, then prepare a suggested description from the **saved**
profile text with `npub1… (nostr)` (drop `(nostr)` when the 160-character X
bio limit is tight). The user copies and saves it. Attention never writes
the X bio. The wizard always suggests the bound npub (`confirmReplace: true`).
Completion is the profile observer writing `xNpub`, then binding completeness
(`bioOk` / `bioMismatch`). Overlay Check again is a user kick that ingests the
saved UserDescription through that same path — not a poll. A foreign npub is
step 3 status, not a confirm gate. Unlink still uses `confirmReplace` /
`removeNpub` on `buildSuggestedXBio` and opens `https://x.com/settings/profile`.

The current popup publishes kind `10011` after the active account's numeric
X ID is known and the operator Nostr key is bound to that X. Bio is an
independent public hint (anyone can put any npub in a profile). Step 3 signs
and queues the Nostr event only; it never needs, opens, or creates an X post.

Attention still accepts existing canonical NIP-39-style proof posts for
`twitter` as a secondary compatibility and discovery path:

- Post from the linked X account.
- Text includes: `Linking my account to Nostr: <npub>`.
- The raw post ID is the third parameter on each `i` tag. Attention adds
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
`legacy.description`); post proofs remain secondary and are taken from that
already-loaded post. Attention does not search X or request oEmbed for them. A post
counts only when it is already visible in an allowlisted timeline or detail
response.

`xIdentities` stores per-source dates: `xDate` (bio-carrying post time),
`postDate` (proof-post `created_at`), `nip39Date` (signed 10011 `created_at`),
`eventDate` (selected 32009 `created_at`). Newer source dates win within a
source; cross-source precedence is Bio > Post > 10011 > WoT-gated 32009 (see
`.cursor/rules/x-identity.mdc`).

The backend implements `PREPARE_X_BIO_EDIT` for the bio linking UX. Legacy
proof-text generation remains for secondary compatibility paths, not the
current Bindings setup.
Kind `10011` is self-verified from its signature and matching `twitter` /
`twitter_id` tags. Attention does not fetch the X profile
page to confirm that claim. `proofSource` records which source currently
supplies the winning npub.

## Identity resolution and trust subjects

Durable identity storage is `xIdentities`, keyed by `twitterId`. Backend
lookups always use that numeric ID. The row’s `handle` is the latest mutable
username (for X.com URLs), not a primary key.

When a handle must be resolved to a numeric ID (e.g. before an observation
exists), Attention tries, in order:

1. a sanitized page-world observation pairing `rest_id` and username;
2. a verified kind `10011` claim (both `twitter` and `twitter_id` tags).

Conflicting numeric IDs remain unresolved instead of being silently selected.

Trust is separate from identity linking. Kind `32009` account statements use
`user:id:<numeric-id>` with optional `k` = `user:id` and `s=x.com` for new X
statements, and product person trust uses `c=identity`. Older empty-context
user statements remain valid. Attention does not publish durable profile trust keyed only by
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

The current Bindings UI verifies the active numeric account, then explicitly
publishes a proofless kind `10011`. Bio is a separate optional hint and is not
required. It performs no X account action.
