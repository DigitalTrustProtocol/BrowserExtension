# AttentionX Nostr protocol

The PoC represents feedback as NIP-32 label events (`kind: 1985`). The
`attentionx` namespace prevents unrelated labels from being interpreted as
AttentionX assessments.

## X identity linking

[NIP-39](NIP-39.md) kind `10011` links a Nostr public key to an X account.
AttentionX publishes both:

- `twitter:<handle>` with the current username.
- `twitter_id:<numeric-id>` with the stable X user ID.

When AttentionX resolves profile subjects from rendered posts, it prefers
`twitter_id` and ignores the handle for references. Profile URLs use
`https://x.com/i/user/<twitter_id>` when the numeric ID is available in the
DOM.

## Proposed trust event

[NIP-32009](NIP-32009.md) documents the proposed single-subject trust event for
the next protocol iteration. It uses one addressable event per subject and
context, avoiding the replacement and cancellation complexity of batched
multi-subject statements.

Kind `32009` is documentation only and is not implemented by the current PoC.

## Event tags

```json
[
  ["L", "attentionx"],
  ["l", "trust", "attentionx"],
  ["r", "https://x.com/example/status/123"],
  ["t", "attentionx"]
]
```

Supported labels are:

- `trust`
- `question`
- `misleading`

The `r` tag targets a canonical X profile or post URL. Profile URLs use
`https://x.com/i/user/<twitter_id>` when the numeric ID is known; otherwise the
handle is lowercased in `https://x.com/<handle>`.

## Event content

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

When `twitter_id` is unavailable in the DOM, profile targets fall back to the
lowercase handle:

```json
{
  "schema": "attentionx-assessment-v1",
  "target": {
    "type": "post",
    "id": "123",
    "handle": "example",
    "url": "https://x.com/example/status/123"
  }
}
```

An optional human note may be added later. The current UI publishes no note.
No post body text or X authentication data is sent to relays.

## Aggregation

For each target, only the newest valid AttentionX assessment from each Nostr
public key is counted. This prevents one identity's repeated events from
inflating the visible result.

This is not a Web-of-Trust score. All contributors currently have equal weight.
The second phase can apply a local trust graph to the same signed source events.

## Compatibility status

The use of NIP-32 labels and URL targets is intentional, but the JSON content
schema and verdict vocabulary are AttentionX-specific and may change before a
stable release. Protocol changes should introduce a new schema identifier and
maintain backward-compatible readers where practical.
