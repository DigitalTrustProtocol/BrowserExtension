# AttentionX

AttentionX is a Chrome Manifest V3 proof of concept that adds a Nostr-backed
context and feedback layer to posts on X.

The extension reads semantic information rendered on `x.com` and passively
extracts minimal public identity tuples from allowlisted JSON responses used
to render the current page. It does not use X credentials, session cookies, or
request headers, and it never modifies X traffic.

## Why AttentionX differs

AttentionX is a decentralized Community Report: signed trust and distrust of X
accounts and posts, optional short human reasons, and explainable evidence
through your local web of trust — Community Notes–style shared judgment without
a platform-run scorer. Identities bind via verified NIP-39 proofs and stable
numeric IDs; edges are portable on Nostr, not locked to a central authority.

## Implemented proof-of-concept features

- Detects posts on profile, timeline, search, and post-detail layouts and adds
  an idempotent, style-isolated Shadow DOM panel.
- Passively observes cloned JSON responses from allowlisted X operations in a
  Manifest V3 `MAIN`-world script. Only validated numeric user IDs, handles,
  post IDs, timestamps, and operation names cross into the extension.
- Manages Nostr identity through an encrypted key vault (BIP-39 generate,
  import nsec/mnemonic, watch-only, NIP-46, multi-account, unlock/auto-lock).
  The secret key remains in the background service worker and is never sent to
  content or page code.
- Acts as a NIP-07 signer (`window.nostr`) for other sites when host access is
  granted. Payments / WebLN are not included.
- Publishes addressable kind `32009` trust, distrust, and cancellation
  statements for stable `user:id:<id>` and `post:id:<id>` subjects, with
  `s=x.com` for new X statements. Optional subject hints and proof-post
  references are advisory metadata; the question control is local-only and
  publishes no event.
- Validates signatures and protocol fields, reduces replacements, and stores
  raw signed events, indexes, relay provenance, sync cursors, X identity
  records, and the durable publish outbox in IndexedDB.
- Performs bounded local Web-of-Trust synchronization and returns explainable
  evidence, paths, source event IDs, and truncation state—not an objective or
  universal score.
- Generates and verifies NIP-39 proof text and verifies and merges replaceable
  kind `10011` X identity events with `twitter` and `twitter_id` tags.
- Provides a guarded proof-composer workflow: active-account check, proof
  preview, explicit confirmation, X compose-intent open, post-ID capture, and
  kind `10011` publication. `already_proven` links can be refreshed without a
  new post.
- Opens a local **Application data** cockpit from Settings that summarizes
  IndexedDB store counts, chrome.storage keys, identity, relays, and sync
  status (interactive connection graph planned later).
- Retries synchronization and outbox delivery from the service worker through
  `chrome.alarms`.
- Handles X's client-side navigation and dynamically inserted posts, with
  English and Danish UI strings.

Kind `1985` labels are retired and unsupported: AttentionX neither publishes
nor ingests them. The extension never silently posts to X; proof text opens in
X's compose intent only after preview and confirmation.

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
6. Open the AttentionX popup and complete the onboarding wizard (create or
   import a vault-backed identity).

After code changes, run `npm run build`, press **Reload** on the extension card,
and refresh X.

## Commands

- `npm run build` — type-check and create the unpacked extension in `dist`.
- `npm run lint` — run Oxlint.
- `npm run test` — run unit tests.
- `npm run check` — run lint, tests, and the production build.

## Security

Private keys are encrypted at rest in an AES-256-GCM vault (PBKDF2, 210,000
iterations) and cleared from memory on lock / auto-lock. Prefer a dedicated
low-value key for early testing. Unlock the vault before publishing trust
statements or NIP-39 proofs. The extension can also act as a NIP-07 signer for
other websites; grant site access intentionally from the popup.

## Project structure

```text
src/background/  Service worker orchestration, signing, and messaging
src/content/     X post discovery, identity bridge, and Shadow DOM interface
src/graph/       Bounded local trust graph and evidence queries
src/i18n/        Shared i18next resources for popup and content script
src/identity/    X identity resolution and NIP-39 proof verification
src/page-world/  Allowlisted passive X response observer
src/relay/       Cursor synchronization, retry, and durable outbox logic
src/shared/      Kind 32009/10011 validation and shared contracts
src/storage/     IndexedDB schema and raw event repository
src/App.tsx      Extension popup
public/          Chrome extension manifest
docs/            Architecture and protocol notes
```

See [AGENTS.md](AGENTS.md) for AI/contributor onboarding, [docs/README.md](docs/README.md)
for the documentation index, [architecture](docs/architecture.md),
[current Nostr protocol](docs/nostr-protocol.md), [NIP-39 X identity
linking](docs/NIP-39.md), and the [kind 32009
specification](docs/NIP-32009.md) for design details and PoC limits.
