# AttentionX Nostr protocol

AttentionX currently uses:

- addressable kind `32009` for single-subject trust, distrust, and
  cancellation;
- replaceable kind `10011` for verified NIP-39 X identity links.

NIP-32 kind `1985` was used by an early prototype but is retired and
unsupported. The current backend does not query, ingest, migrate, or publish
kind `1985`, and it does not use the old `attentionx-assessment-v1` JSON
payload.

## Kind 32009 trust statements

[NIP-32009](NIP-32009.md) defines one addressable slot per author, subject, and
context. The required tags are:

- exactly one subject tag: `p`, `e`, or `i`;
- `d`, deterministically derived from the subject and context;
- `v`: `1` for trust, `-1` for distrust, or `0` to cancel;
- optional `c` for a canonical hierarchical context;
- optional `x` and `y` activation and expiration times.

The current X UI publishes stable `i` subjects:

```text
ext:twitter_id:<numeric-account-id>
ext:twitter_post:<numeric-post-id>
```

Profile publishing is disabled until a numeric account ID is resolved; a
mutable handle is never a durable trust subject. The default contexts are:

- `identity` for X accounts;
- `news:accuracy` for X posts.

The question control is deliberately local-only. It updates the current card
and publishes no Nostr event.

Example account statement:

```json
{
  "kind": 32009,
  "tags": [
    ["d", "<sha256(ext:twitter_id:11348282)>:identity"],
    ["i", "ext:twitter_id:11348282"],
    ["c", "identity"],
    ["v", "1"]
  ],
  "content": ""
}
```

Example post statement:

```json
{
  "kind": 32009,
  "tags": [
    ["d", "<sha256(ext:twitter_post:2080659774136291424)>:news:accuracy"],
    ["i", "ext:twitter_post:2080659774136291424"],
    ["c", "news:accuracy"],
    ["v", "-1"]
  ],
  "content": ""
}
```

Content is an optional short human explanation. AttentionX does not put X post
bodies or X authentication data in events.

### Validation and replacement

Before storage or graph use, the backend verifies the Nostr shape, event hash,
signature, kind, one-subject rule, value, canonical context, deterministic `d`
tag, activation/expiration interval, and content limits.

The newest valid event for `(author pubkey, d)` wins by greatest `created_at`;
the lexically lower event ID wins a timestamp tie. The winning `v = "0"` event
cancels the slot and does not revive an older statement. Context lookup tries
the exact context, its nearest parents, then the empty general context.

## Local WoT interpretation

Positive active kind `32009` statements with a `p` subject are traversable
trust edges. Negative `p` statements are evidence but not traversal edges.
`e` and `i` subjects, including X account and post subjects, are terminal
evidence.

Relay synchronization and query traversal are bounded by depth, fan-out,
authors, and event count. Query results retain direct and reachable statements,
paths, source event IDs, graph version, and truncation state. The resolution is
`trusted`, `distrusted`, `mixed`, or `none`; it is local to the selected root
and context and is not an objective or numerical Web-of-Trust score.

Raw signed events and reducer indexes are durable in IndexedDB. Per-relay,
per-scope cursors use an overlap window and advance after EOSE. Publishing is
write-through to IndexedDB and a durable per-relay outbox before delivery is
attempted.

## Kind 10011 X identity linking

[NIP-39](NIP-39.md) links the event author's Nostr key to an X account with two
matching `i` tags:

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

Both tags reference the same proof-post ID. The handle is informational;
`twitter_id` is the stable account identifier. When AttentionX updates this
replaceable event, it removes prior X-provider tags and preserves unrelated
provider tags and content.

The backend generates the NIP-39 proof text and verifies the event signature,
matching tags, proof post ID, proof text, proof author, and public profile's
handle-to-numeric-ID mapping. Unavailable public data yields `pending`, not a
false invalid result; conflicting mappings remain explicit. Verified claims
and provenance are persisted in IndexedDB.

Proof-post composer submission, visible preview, active-account verification,
and explicit confirmation UI are not implemented yet and remain Phase D.
