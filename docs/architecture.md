# AttentionX architecture

## PoC boundaries

AttentionX augments X's rendered interface. It does not authenticate with X,
read session cookies, call private X endpoints, or perform X account actions.
The only external network connections are WebSockets to relays configured by
the user.

## Runtime components

### Content script

The content script runs on `x.com` and `twitter.com`.

1. A `MutationObserver` watches for timeline changes and SPA navigation.
2. Posts are found using semantic article attributes, with legacy
   `data-testid="tweet"` as a fallback.
3. Post ID, author handle, and author numeric ID are extracted from Schema.org
   metadata or status links. Profile references prefer `twitter_id` when
   available.
4. An idempotent Shadow DOM panel is appended to each post.
5. Context lookup and signed feedback requests are sent to the service worker.

The content script never receives the Nostr secret key.

### Background service worker

The service worker owns:

- Nostr key generation, import, public-key derivation, and event signing.
- Relay WebSocket queries and publishing through `nostr-tools`.
- Relay configuration and local event cache.
- Aggregation of the latest assessment from each Nostr author.

Keeping these capabilities outside the content script reduces exposure to the
host page and centralizes protocol behavior.

### Popup

The React popup configures identity and relays. It intentionally does not show
or export a generated secret key in this PoC.

## Storage

One versioned object is stored under `attentionx-state-v1` in
`chrome.storage.local`:

- Secret key as 64-character hex, when configured.
- Relay URL list.
- Up to 500 recent assessment events, deduplicated by event ID.

The raw secret-key storage is acceptable only for this proof of concept.

## Page compatibility

Post discovery is page-independent, so the same logic covers Home, profile,
search, lists, and post-detail pages when they render post articles. Inner X
class names are deliberately ignored.

The current public X UI and older authenticated markup differ substantially.
The injected panel therefore attaches at the article boundary instead of
depending on a fragile internal layout path.

## Production direction

The second phase should add:

- Encrypted or external Nostr signing.
- A versioned selector adapter with fixture-based DOM tests.
- Relay health, retry, and request batching.
- A local Web-of-Trust graph and incremental recomputation.
- Signed mapping claims between Nostr identities and X profiles (NIP-39 kind
  `10011` with `twitter` and `twitter_id` tags).
- Optional specialized WoT services with independently verifiable results.
- Privacy controls, event deletion/retraction policy, and abuse resistance.
