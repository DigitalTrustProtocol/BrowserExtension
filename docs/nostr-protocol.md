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

[NIP-32009](NIP-32009.md) defines one addressable slot per author and `d` tag.
The required tags are:

- exactly one subject tag: `p`, `e`, or `i`;
- `d`, always `sha256(material)` where `material` is `subject:scope:context`;
- `v`: `1` for trust, `-1` for distrust, or `0` to cancel;
- optional `k` (identifier class) and `s` (domain/namespace);
- optional `c` for a canonical hierarchical context (omit for global);
- optional `x` and `y` activation and expiration times.

The current X UI publishes stable `i` subjects:

```text
user:id:<numeric-account-id>
post:id:<numeric-post-id>
```

Profile publishing is disabled until a numeric account ID is resolved; a
mutable handle is never a durable trust subject. New X trust statements omit
`c` (global). Optional purpose contexts such as `identity` remain supported
for graph fallback.

The question control is deliberately local-only. It updates the current card
and publishes no Nostr event.

Example account statement:

```json
{
  "kind": 32009,
  "tags": [
    ["d", "<sha256(user:id:11348282:x.com:)>"],
    ["i", "user:id:11348282"],
    ["k", "user:id"],
    ["s", "x.com"],
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
    ["d", "<sha256(post:id:2080659774136291424:x.com:)>"],
    ["i", "post:id:2080659774136291424"],
    ["k", "post:id"],
    ["s", "x.com"],
    ["v", "-1"]
  ],
  "content": ""
}
```

Content is an optional short human explanation (ternary `v` is the machine
edge). AttentionX product policy: optional, never required; ~144-character
plain-text compose cap; show in path/detail views only; prefer reasons on
account trust over posts — see
[design.md § Trust statement content](design.md#trust-statement-content-human-reasons).
AttentionX does not put X post bodies or X authentication data in events.

### Validation and replacement

Before storage or graph use, the backend verifies the Nostr shape, event hash,
signature, kind, one-subject rule, value, canonical context, deterministic `d`
tag, activation/expiration interval, and content limits.

The newest valid event for `(author pubkey, d)` wins by greatest `created_at`;
the lexically lower event ID wins a timestamp tie. The winning `v = "0"` event
cancels the slot and does not revive an older statement. Context lookup tries
the exact context, its nearest parents, then the empty general context,
skipping cancelled or inactive slots along the way.

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

Current winning signed events and reducer indexes are durable in IndexedDB;
superseded addressable replacements should not be retained locally (see
[architecture.md § Minimal data and memory](architecture.md#minimal-data-and-memory-product-rule)).
Per-relay, per-scope cursors use an overlap window and advance after EOSE.
Publishing is write-through to IndexedDB and a durable per-relay outbox before
delivery is attempted.

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

The proof-composer UI requires visible preview, active-account verification,
and explicit confirmation before opening X compose intent and capturing the
resulting post ID for kind `10011` publication.
