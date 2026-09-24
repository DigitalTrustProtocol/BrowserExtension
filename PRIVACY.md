# Privacy notes for the proof of concept

Attention processes public X post IDs, handles, and numeric account IDs in the
browser. It discovers these values from semantic page markup and through a
`MAIN`-world observer that passively inspects cloned successful JSON responses
from an explicit operation allowlist. Original X requests are not changed.
Responses are left unchanged except for the intentional timeline JSON rewrite:
when user hide/trust filters are active, allowlisted home/timeline GraphQL JSON
may be filtered (hide-only) so X never mounts removed
items (timeline render optimization). That rewrite stays in page-world and does
not forward raw response bodies across the content boundary.

Attention does not start X searches or other X account actions. A linking
post is recorded only when that post is already present in an allowlisted
timeline or detail response the page loaded. Raw response bodies, bearer
tokens, and cookie strings remain in page-world; only a validated proof match
(`postId`, handle, proof text) may cross the content/background boundary.

The page observer applies response-size, traversal, queue, and batch limits.
Only validated, normalized identity tuples—numeric account ID, lowercase
handle, related post IDs, observation time, and source operation—cross the
page/content boundary from passive observation. Protected content, direct
messages, and unrelated personalized fields are neither forwarded nor
persisted. The content script may derive the signed-in account's numeric ID
from the public `twid` cookie value (`u=<id>`); only that numeric ID is kept,
never the raw cookie string. The service worker may also read the same `twid`
cookie via `chrome.cookies` when the popup asks to ensure the active X account
(so numeric ID resolution does not depend only on `document.cookie` timing).

Configured relay URLs receive Nostr filters for public kind `32009` trust
statements and kind `10011` identity links. Statements deliberately published
by the user are public, signed by the configured Nostr key, and may be retained
by relays indefinitely.

The browser profile stores:

- encrypted vault ciphertext, public account metadata (including optional
  `boundTwitterId` / `boundUpdatedAt` operator bindings), relay URLs, NIP-07
  permissions, and small settings in `chrome.storage.local` / `sync`;
- non-secret Sync index `xNostrBindings` (X numeric id ↔ Nostr pubkey +
  timestamps) and optional Easy per-X sealed key map `easyAccountBlobs`
  (NIP-49 `ncryptsec` ciphertext only — same trust model as the legacy single
  `easyAccountBlob`);
- raw signed Nostr events, reducer indexes, relay observations, synchronization
  cursors, X identity records, and pending per-relay outbox delivery state in
  IndexedDB.

When NIP-07 is enabled for a site (optional `<all_urls>` content scripts), the
extension may receive signing requests from that origin. Approvals are shown in
the popup; private keys never enter page context. Lightning / WebLN payments
are not implemented.

The background does not fetch public X profile HTML and does not request
`publish.twitter.com` oEmbed data. A linking post is recorded only from a
post already present in a page X loaded. Active-account resolution uses
the page `twid` cookie numeric ID (and local observations), not a profile page
fetch. Linking an X account is done by putting the Nostr public key in the
X bio. Attention does not open X's compose window to publish a proof post.

Attention does not collect browsing history outside its declared X hosts and
has no Attention-operated analytics or remote server. This document describes
the current source code and is not a production privacy policy.
