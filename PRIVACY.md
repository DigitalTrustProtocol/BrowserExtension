# Privacy notes for the proof of concept

AttentionX processes public X post IDs, handles, and numeric account IDs in the
browser. It discovers these values from semantic page markup and through a
`MAIN`-world observer that passively inspects cloned successful JSON responses
from an explicit operation allowlist. Original X requests are not changed.
Responses are left unchanged except for the intentional timeline JSON rewrite:
when user hide/trust filters are active, allowlisted home/timeline GraphQL JSON
may be filtered (hide-only) and optionally backfilled so X never mounts removed
items (timeline render optimization). That rewrite stays in page-world and does
not forward raw response bodies across the content boundary.

For NIP-39 proof discovery, page-world may also initiate authenticated X
GraphQL calls (notably `SearchTimeline`) using the signed-in browser session
(`ct0` CSRF token and cookies automatically included by the page origin). Those
calls do not navigate the UI or scrape the DOM. They run only when IndexedDB
`xIdentities` lacks a verified binding for the target: on extension X-pane open
(self CHECK), or when the user clicks Trust on another X account. Raw GraphQL
response bodies, bearer tokens, and cookie strings remain in page-world; only a
validated proof match (`postId`, handle, proof text) may cross the
content/background boundary.

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
by relays indefinitely. Kind `1985` labels are unsupported and are not
published or stored.

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

The background may request public X profile HTML only when verifying a
NIP-39 identity claim against the claimed handle, and may request
`publish.twitter.com` oEmbed data to verify a user-supplied proof post.
Those verification requests omit credentials. Active-account resolution uses
the page `twid` cookie numeric ID (and local observations), not a profile page
fetch. After preview, active-account verification, and explicit confirmation,
the extension may open X's compose intent with the NIP-39 proof text and
capture the resulting post ID. No proof post is submitted silently, and no
other X account action is performed.

AttentionX does not collect browsing history outside its declared X hosts and
has no AttentionX-operated analytics or remote server. This document describes
the current source code and is not a production privacy policy.
