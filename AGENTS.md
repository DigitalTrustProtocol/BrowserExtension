# Agent guide (AttentionX)

Short entry point for AI assistants and contributors. For human onboarding, see [README.md](README.md).

## Before you change code

1. Read [.cursor/rules/attentionx-architecture.mdc](.cursor/rules/attentionx-architecture.mdc) — always-on invariants (privacy, MV3 boundaries, protocol basics).
2. Match stack-specific rules when editing matching paths (see [Cursor rules](#cursor-rules) below).
3. Run `npm run check` before handing off (lint, tests, production build).

## Where to look

| Task | Start here |
|------|------------|
| Debug Chrome + reload extension | `npm run go` — see [.cursor/skills/attentionx-dev-browser/SKILL.md](.cursor/skills/attentionx-dev-browser/SKILL.md) |
| Observe X + side panel/cockpit (compact) | `npm run inspect` (run `go` first; prefer over Playwright snapshots) |
| Overall design and runtime | [docs/architecture.md](docs/architecture.md) |
| Product intent and phases | [docs/design.md](docs/design.md) |
| Kind 32009 trust statements | [docs/NIP-32009.md](docs/NIP-32009.md) |
| NIP-39 X identity linking | [docs/NIP-39.md](docs/NIP-39.md) |
| Protocol overview | [docs/nostr-protocol.md](docs/nostr-protocol.md) |
| Doc index by topic | [docs/README.md](docs/README.md) |

## Source layout

```text
src/background/   Service worker: signing, messaging, sync, graph orchestration
src/content/      X DOM discovery, Shadow DOM panel (vanilla TS, not React)
src/graph/        Bounded local trust graph and evidence queries
src/identity/     X identity resolution, NIP-39 proof, xIdentities row logic
src/page-world/   MAIN-world passive X JSON observer + proof-search GraphQL
src/relay/        Relay sync cursors, outbox, retry
src/shared/       Event validation, contracts, shared types
src/storage/      IndexedDB schema and repository (`xIdentities`, `xPosts`, events, …)
src/popup/        React Chrome Side Panel UI
src/cockpit/      Application data UI
public/           Manifest and locale JSON
```

Display chrome for X users/posts is **X content first** (timeline-seen, trust-gated for posts) — see [docs/architecture.md § X content first](docs/architecture.md#x-content-first-display-chrome). Do not reverse-lookup Nostr subjects on x.com for Application lists.

## Cursor rules

Rules live in `.cursor/rules/`. Scoped rules load only when you edit matching files (saves context).

| Rule | Scope | Purpose |
|------|-------|---------|
| `attentionx-architecture.mdc` | Always | Core architecture and privacy boundaries |
| `x-identity.mdc` | `src/identity/**`, `src/storage/**`, identity backend adapters | `xIdentities` columns, NIP-39 merge, status sync |
| `content-page-world.mdc` | `src/content/**`, `src/page-world/**` | Shadow DOM panel, SPA scan, page↔content bridge |
| `vault-nip07.mdc` | `src/vault/**`, `src/nip07/**` | Key vault and NIP-07 signer boundaries |
| `graph-wot.mdc` | `src/graph/**`, `src/relay/**` | Bounded WoT, evidence queries, relay sync |
| `extension-build.mdc` | `vite*.ts`, `public/manifest.json`, `package.json` | Multi-Vite MV3 build and manifest alignment |
| `typescript-extension.mdc` | `src/**/*.{ts,tsx}` | TS conventions, messaging contracts, tests |
| `react.mdc` | `src/**/*.{tsx,jsx}` | React popup/cockpit UI patterns |
| `internationalization.mdc` | UI/locale paths (not all of `src/`) | Shared `public/locales` catalog (popup + content) |

## Context window tips

- Prefer `@` on a folder or file (e.g. `@src/graph`, `@docs/NIP-32009.md`) over broad “read everything” prompts.
- When verifying UI, prefer compact `npm run inspect` output over Playwright snapshots or large screenshots.
- [`.cursorignore`](.cursorignore) blocks lockfiles, `dist/`, binaries, and secrets from indexing — do not `@` those paths.
- Long protocol detail is in `docs/`; it is not auto-injected unless referenced or discovered.
- Do not open these whole — Grep / partial read / `@` a section instead:
  - `src/background/backend.ts` (~120KB) — search for the handler or symbol you need
  - `docs/design.md` — prefer [docs/architecture.md](docs/architecture.md) for implementation; use design only for product/phase intent
  - `docs/NIP-32009.md` and large UI files (e.g. `AttentionXPanel.tsx`) — only when that exact topic is in scope

## Non-negotiables (summary)

- Browser/UI verification for AttentionX uses **`npm run go`** (debug Chrome on `9222`), not the built-in Playwright MCP browser.
- Prefer the **lowest-token** observation path that answers the question (`npm run inspect` / compact probes over snapshots and screenshots).
- Nostr secret keys stay in the background service worker only.
- Do not modify X's existing requests. Do not modify X responses except the intentional timeline JSON rewrite (hide/filter + optional backfill) used to optimize timeline rendering — see `attentionx-architecture.mdc` / `content-page-world.mdc`.
- Forward only validated, normalized data across the content boundary — no raw GraphQL bodies, cookies, or bearer tokens.
- Kind `32009` for trust/distrust; kind `1985` is retired.
- Injected X UI uses Shadow DOM; content-script panel is vanilla TypeScript, not React.
- Trust results are subjective evidence, not objective scores.
- **Minimal disk and memory:** keep only data required for current trust,
  identity, sync, and publish. Do not retain superseded addressable events or
  other historical junk by default — see
  [docs/architecture.md § Minimal data and memory](docs/architecture.md#minimal-data-and-memory-product-rule).
  Prefer write-time validation/reduction and fast rehydrate over re-scanning
  and re-validating large event piles on every service-worker start.
- **X content first:** `xPosts` / `xIdentities` chrome comes from visible X
  subjects; no Event→X bulk fetches for decoration.
