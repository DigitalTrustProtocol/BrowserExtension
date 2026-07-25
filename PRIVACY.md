# Privacy notes for the proof of concept

AttentionX processes rendered X post identifiers, author handles, and numeric
author IDs locally when present in the page markup.
It does not read X cookies, collect browsing history outside X, or use the X
API.

When relay lookup is enabled, canonical X profile and post URLs are sent as
Nostr subscription filters to the configured relays. Feedback deliberately
published by the user is public, signed by the configured Nostr key, and may be
retained by relays indefinitely.

The extension stores its configuration, secret key, and recent Nostr events in
the browser profile through `chrome.storage.local`. The PoC has no
AttentionX-operated analytics or remote server.

This document describes the current source code and is not a production privacy
policy.
