# Privacy notes for the proof of concept

AttentionX processes public X post IDs, handles, and numeric account IDs in the
browser. It discovers these values from semantic page markup and through a
`MAIN`-world observer that passively inspects cloned successful JSON responses
from an explicit operation allowlist. The original requests and responses are
not changed.

The page observer applies response-size, traversal, queue, and batch limits.
Only validated, normalized identity tuples—numeric account ID, lowercase
handle, related post IDs, observation time, and source operation—cross the
page/content boundary. Raw response bodies, post bodies, request headers,
cookies, authorization tokens, protected content, direct messages, and
unrelated personalized fields are neither forwarded nor persisted.

Configured relay URLs receive Nostr filters for public kind `32009` trust
statements and kind `10011` identity links. Statements deliberately published
by the user are public, signed by the configured Nostr key, and may be retained
by relays indefinitely. Kind `1985` labels are unsupported and are not
published or stored.

The browser profile stores:

- encrypted vault ciphertext, public account metadata, relay URLs, NIP-07
  permissions, and small settings in `chrome.storage.local` / `sync`;
- raw signed Nostr events, reducer indexes, relay observations, synchronization
  cursors, X identity records and handle aliases, and pending per-relay outbox
  delivery state in IndexedDB.

When NIP-07 is enabled for a site (optional `<all_urls>` content scripts), the
extension may receive signing requests from that origin. Approvals are shown in
the popup; private keys never enter page context. Lightning / WebLN payments
are not implemented.

The background may request public X profile HTML to resolve numeric IDs and
`publish.twitter.com` oEmbed data to verify a user-supplied NIP-39 proof post.
Those requests omit credentials. After preview, active-account verification,
and explicit confirmation, the extension may open X's compose intent with the
NIP-39 proof text and capture the resulting post ID. No proof post is submitted
silently, and no other X account action is performed.

AttentionX does not collect browsing history outside its declared X hosts and
has no AttentionX-operated analytics or remote server. This document describes
the current source code and is not a production privacy policy.
