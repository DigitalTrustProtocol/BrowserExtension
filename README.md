# AttentionX

AttentionX is a Chrome Manifest V3 proof of concept that adds a Nostr-backed
context and feedback layer to posts on X.

The extension reads only information already rendered on `x.com`. It does not
use X's API, session cookies, or private endpoints.

## Proof-of-concept features

- Detects posts on profile, timeline, search, and post-detail layouts.
- Supports both current semantic X markup and legacy `data-testid` markup.
- Adds a style-isolated panel beneath each detected post.
- Displays separate Nostr context for the post and its author.
- Offers compact trust, question, and misleading feedback controls.
- Generates or imports a dedicated Nostr identity.
- Signs NIP-32-style label events and publishes them to configured relays.
- Queries relays and caches recent events in `chrome.storage.local`.
- Handles X's client-side navigation and dynamically inserted timeline posts.
- Localizes the popup and injected controls with i18next (English and Danish).

## Install for development

Requirements: Node.js 22 or newer and Chrome/Chromium.

```powershell
npm install
npm run check
```

Then load the built extension:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this project's `dist` directory.
5. Open or refresh an `https://x.com/` page.
6. Open the AttentionX popup and generate a dedicated identity.

After code changes, run `npm run build`, press **Reload** on the extension card,
and refresh X.

## Commands

- `npm run build` — type-check and create the unpacked extension in `dist`.
- `npm run lint` — run Oxlint.
- `npm run test` — run unit tests.
- `npm run check` — run lint, tests, and the production build.

## Security warning

This PoC stores its Nostr secret key unencrypted in `chrome.storage.local`.
Generate a dedicated low-value key. Do not import a primary or valuable Nostr
identity. A production version should support an external signer such as
NIP-07 or an encrypted key vault.

## Project structure

```text
src/background/  Nostr relay, signing, storage, and messaging
src/content/     X post discovery and injected Shadow DOM interface
src/i18n/        Shared i18next resources for popup and content script
src/shared/      Protocol contracts and assessment aggregation
src/App.tsx      Extension popup
public/          Chrome extension manifest
docs/            Architecture and protocol notes
```

See [architecture](docs/architecture.md),
[current Nostr protocol](docs/nostr-protocol.md), and the proposed
[single-subject kind 32009](docs/NIP-32009.md) for design details and PoC
limits.
