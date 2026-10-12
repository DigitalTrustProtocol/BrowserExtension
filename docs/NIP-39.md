# NIP-39

## X account link

`draft` `optional`

## Status

Attention's profile of replaceable kind `10011`. Upstream
[NIP-39](https://github.com/nostr-protocol/nips/blob/master/39.md) puts a
platform proof id in each `i` tag. That form is unused in practice, and the
X proof it names cannot be retrieved: this extension does not call X on the
user's behalf, and the X API is paid. This document is the wire Attention
publishes and accepts.

## Abstract

Kind `10011` is a claim, signed by a Nostr key, that the key controls an X
account. The signature proves control of the key. It does not prove control
of the X account.

The X-side pointer is the profile bio. The value after the identity on each
`i` tag is a location hint. For X that hint is the text `bio`: a reader finds
the npub in the profile description. The bio arrives with accounts already
present in a timeline. Attention does not fetch it.

## Canonical shape

The account is the numeric X user id. A handle is a username, and usernames
change, so a claim is not keyed by `twitter:<handle>`.

The id tag is `x_id:<numeric-id>` or `twitter_id:<numeric-id>`. Same digits,
either name. One of them is required. If both are present they MUST be the
same digits. Decimal digits only; do not coerce the id to a number.

```json
{
  "kind": 10011,
  "tags": [
    ["i", "x_id:11348282", "bio"],
    ["i", "twitter:nasa", "bio"]
  ],
  "content": ""
}
```

`twitter_id:11348282` is the same account key as `x_id:11348282`.

| Position | Role | Example |
| --- | --- | --- |
| tag name | identity tag | `i` |
| identity | stable account, or current username | `x_id:11348282`, `twitter_id:11348282`, or `twitter:nasa` |
| hint | where a reader finds the npub | `bio` |

- `x_id:<numeric-id>` or `twitter_id:<numeric-id>` is the account. Readers
  match and store on this id. A rename does not create a new account.
- `twitter:<handle>` is the current username, lowercase. It is optional and
  informational. When the username changes, replace this tag and keep the
  same id.
- The hint `bio` means the npub is in that account's profile description.
  It is not a tweet id. A client MUST NOT request `x.com/<handle>/status/bio`.
  The same hint is used on every X tag that carries one.

A tag with only the id (no hint) is still a signed claim of key control.
The hint tells a reader where to look. It does not itself prove that the
bio contains the npub.

Unrelated provider tags and event content are preserved when the X tags are
replaced.

## Why `bio`

Two directions have to meet:

1. The Nostr key signed this event (key control).
2. The X account shows that same npub (account control).

The bio is direction 2, and it is passive. Timeline and profile payloads
already include `legacy.description`. Attention reads a single `npub1…`
from a description that is already on screen. It does not search X, call
the X API, or request oEmbed.

Anyone can put any npub in a bio. The bio alone does not prove key control.
The signed event alone does not prove account control. Confirmation is the
match: this event's author is the npub in the bio, and `x_id` or
`twitter_id` names that same account. The handle is not part of the match.

Suggested description text, which the person copies and saves, is
`npub1… (nostr)`. Attention never writes the X bio.

## Deprecated post proof

Upstream NIP-39, and earlier Attention tags, used a post id as the proof
and repeated it as a fourth hint:

```json
["i", "twitter:nasa", "2080659774136291424", "post:id:2080659774136291424"]
["i", "twitter_id:11348282", "2080659774136291424", "post:id:2080659774136291424"]
```

Do not publish this form. A post id is an active lookup: some client must
search for or fetch that status. That is what the paid X API and an
extension-initiated read both are. The bio does not need that lookup. It is
already on the account object in the timeline the page loaded.

A legacy post id is only a link a person can open:

```text
https://x.com/i/web/status/<post-id>
```

Attention does not open or request that post. If the same post is already
visible in an allowlisted timeline or detail response, a reader may notice
an npub in it. That observation does not make the post the proof to publish.
New events use the `bio` hint.

## Confirmation

Attention checks:

1. the kind `10011` signature;
2. one id tag, `x_id:<numeric-id>` or `twitter_id:<numeric-id>` (both, only
   when they are the same digits);
3. the same hint on each X tag that has one;
4. for a current event, that hint is `bio`.

A `twitter:<handle>` tag is not required. It is not compared as the account.

It does not fetch the X profile to confirm the claim. Kind `10011` confirms
the bio when the event author equals the bio npub and the id tag is that
account. The event does not open a trust hop and does not create an identity
row by itself. `nip39*` is stored only after that bio npub is already on the
row.

## Replace and revoke

Kind `10011` is replaceable. The newest event from the author wins.

To update the X claim, take the current event, drop prior `x_id`,
`twitter_id`, and `twitter` tags, insert the id tag (and the current handle
tag, if any) with hint `bio`, and keep unrelated provider tags and content.
A handle change keeps the same numeric id.

To revoke, publish a newer kind `10011` with every `x_id`, `twitter_id`, and
`twitter` tag removed. A signed event with no X tags is a valid slot
winner and is not an identity claim. Relays may still hold older events.
Attention treats the current slot winner as authoritative and clears the
local claim when that winner has no X tags.

## Trust

Kind `32009` trust is a separate event. X subjects use `user:id:<numeric-id>`
and `post:id:<post-id>`. A bare `npub1…` on a trust tag is an advisory hint.
It does not replace this claim or the bio. See [NIP-32009.md](NIP-32009.md).
