# NIP-39 X identity linking

AttentionX uses [NIP-39](https://github.com/nostr-protocol/nips/blob/master/39.md)
kind `10011` events to publish verified links between a Nostr public key and an
X account.

## Event shape

Each link is a replaceable kind `10011` event signed by the Nostr key that owns
the X account. AttentionX publishes **two** `i` tags for every X link:

1. `twitter:<handle>` — the current public username, normalized to lowercase.
2. `twitter_id:<numeric-id>` — the stable numeric X user ID.

Both tags share the same proof tweet ID. Clients that support stable references
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

## Proof tweet

The proof follows NIP-39 for `twitter`:

- Post from the linked X account.
- Text includes: `Verifying my account on nostr My Public Key: "<npub>"`.
- The tweet ID is the third parameter on each `i` tag.

## AttentionX resolution rules

When AttentionX reads rendered X posts:

1. Extract the author numeric ID from Schema.org metadata when present
   (`meta[itemprop="identifier"]` under `itemprop="author"`).
2. For **profile** assessments and lookups, use `twitter_id` as the canonical
   subject when available.
3. Ignore the handle for profile references when `twitter_id` is known.
4. Use the stable profile URL `https://x.com/i/user/<twitter_id>` for relay
   filters and published assessment targets.
5. Fall back to lowercase handle URLs only when the numeric ID is unavailable
   in the rendered DOM.

Post assessments continue to target the status URL
(`https://x.com/<handle>/status/<post-id>`). The post ID is already stable
across handle changes.

## Published assessment target

Profile feedback published while `twitter_id` is available omits the handle from
the JSON payload and records only the stable identifiers:

```json
{
  "schema": "attentionx-assessment-v1",
  "target": {
    "type": "profile",
    "id": "11348282",
    "url": "https://x.com/i/user/11348282",
    "twitterId": "11348282"
  }
}
```

## Why both tags?

Handles can change. Numeric user IDs do not. Publishing both tags keeps NIP-39
compatibility for clients that only understand `twitter:<handle>` while allowing
AttentionX and other clients to keep stable references after a rename.

## API

The background service worker accepts:

```ts
{
  type: 'PUBLISH_X_IDENTITY',
  handle: 'nasa',
  twitterId: '11348282',
  proofTweetId: '2080659774136291424'
}
```

This signs and publishes the kind `10011` event to configured relays.
