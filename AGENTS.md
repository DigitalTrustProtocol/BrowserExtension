# Agent guide (Attention)

Short entry point for AI assistants and contributors. For human onboarding, see [README.md](README.md).

## Working standard

Work as a senior engineer on this codebase, not an average intern. Finish the increment. The user naming one file is not the scope — grep the same concern and change every sibling. Focused means *one concern*, not *one file* (no drive-by refactors). Ask only when blocked on taste, secrets, or a product fork.

**Speed.** Always pick the implementation with the least CPU cost first — especially on the x.com main thread. CPU is a planning and coding constraint, not polish. Do not pick the easy-to-write path or an architecture that burns CPU. The scarcest resource is the **x.com main thread** (`src/content`, `src/page-world`) — it shares X's renderer; if the feed hitches, nothing else matters. Popup and cockpit may be richer; they still must not waste cycles. Full rule: [docs/architecture.md § Timeline CPU](docs/architecture.md#timeline-cpu-and-responsiveness-product-rule); when editing those trees, [content-page-world.mdc](.cursor/rules/content-page-world.mdc).

| If you touch… | Also cover… |
|---------------|-------------|
| A new UI string | Every `public/locales/*.json` (content copy also `fallback-en.ts`) — see [internationalization.mdc](.cursor/rules/internationalization.mdc) |
| Popup wizard / unlock | `src/popup` (`WizardOverlay`, unlock); RPCs stay in `src/accounts/bg/onboarding-handlers.ts` |
| A message in `contracts.ts` | Background handler, sender, and tests |
| Vault / roaming / credential login | Handlers, types, tests, and roaming/privacy docs if the contract changed |
| A shared helper used by N wizard steps | The helper (or every copy), not only the named step |

Family means **this increment’s siblings**, not the rest of the product. If the ask is several things or unrelated foundations, **push back**: propose increment 1, ship it, wait until the user tests on-course vs wrong direction; do not stack the next plan. Usual cut: data, then business, then UI — each its own plan. Cross all three only as a thin additive slice (one type, one handler, one screen family).

**One primary foundation per plan** (the other two are a boundary list, not a second design):

1. **Data (bone)** — types, contracts, schema, identifiers. You cannot spec every future field. Prefer additive optional fields and stable IDs; preserve unknown fields where the format allows; evolve behind data access so user-layer and UI keep working; do not bake UI layout into stored records; extend existing stores before proposing new IndexedDB tables (still ask). Wrong bone → fix data access, not React.
2. **Business** — data access (`src/storage`, vault persist) vs user/use-case (service worker handlers, graph, wizard machine). Cache, auth, and validation may inject between them. UI must not own this. Secrets/signing stay in the worker.
3. **UI** — popup, content, and cockpit call the user-layer; they own layout, copy, and a11y. Multiple UIs share the same business.

**Done this increment:** happy path plus empty/error states you touched; tests for behavior you changed; every locale if copy changed; docs if a contract, permission, or privacy rule changed; `npm run check`; `npm run ax` / AXI when user-visible.

**Do not:** stub a handler; `en.json` only; change `contracts.ts` without the background switch; skip tests “because it’s UI”; stop at first green compile; swallow “make this and this” as one mega-plan; stack the next increment before the user has tested; put publish rules in a React tree; add a UI-only field because the schema felt frozen; ship easy-but-slow hot-path work (per-cell RPC, extra observers, React on X, IndexedDB on scroll); edit `src/graph/trust` without permission; invent a Trust resolver outside that folder.

## Before you change code

1. Read [.cursor/rules/attentionx-architecture.mdc](.cursor/rules/attentionx-architecture.mdc) — always-on invariants (privacy, MV3 boundaries, protocol basics).
2. **If the ask is too large, stop and split** — say so; one increment; wait for the user to test before planning the next.
3. **Enumerate the family** — grep callers/duplicates; list sibling files for *this* increment.
4. **Name the primary foundation** — data, business, or UI. If data must grow, prefer additive change behind data access.
5. Match stack-specific rules when editing matching paths (see [Cursor rules](#cursor-rules) below).
6. **Speed** — pick the least-CPU implementation first (especially content/page-world on the x.com main thread). If the cheap-to-write path is expensive at runtime, pick another path or do not ship. See [docs/architecture.md § Timeline CPU](docs/architecture.md#timeline-cpu-and-responsiveness-product-rule).
7. Hand off only when **Done this increment** (above) is true, including `npm run check` (lint, tests, production build).

## Where to look

| Task | Start here |
|------|------------|
| Debug Chrome + reload extension | `npm run ax -- go` — see [.cursor/skills/attentionx-dev-browser/SKILL.md](.cursor/skills/attentionx-dev-browser/SKILL.md) |
| Observe X + popup/cockpit | `npm run ax` / `npm run ax -- x` (AXI). Same Chrome: Playwright MCP `playwright-debug` — never the isolated plugin. |
| Overall design and runtime | [docs/architecture.md](docs/architecture.md) |
| X.com page chrome (UserHero / Author / Row / Rail) | [docs/x-page-chrome.md](docs/x-page-chrome.md) — atoms shared, **mount slots per X name/handle layout** (Who to follow ≠ timeline) |
| Product intent and phases | [docs/design.md](docs/design.md) |
| Kind 32009 trust statements | [docs/NIP-32009.md](docs/NIP-32009.md) |
| Demo WoT seed / Elon chain | [docs/demo-wot.md](docs/demo-wot.md) |
| Kind 32014 ratings | [docs/NIP-32014.md](docs/NIP-32014.md) |
| Trust vs rating (the two questions) | [docs/wot-questions.md](docs/wot-questions.md) |
| NIP-39 X identity linking | [docs/NIP-39.md](docs/NIP-39.md) |
| Protocol overview | [docs/nostr-protocol.md](docs/nostr-protocol.md) |
| Doc index by topic | [docs/README.md](docs/README.md) |
| X-ID data layers, selection, page cache | [docs/data-layers.md](docs/data-layers.md) |

## Source layout

```text
src/background/   Service worker: signing, messaging, sync, graph orchestration
src/content/      X DOM discovery, Shadow DOM panel (vanilla TS, not React)
src/graph/        Bounded local trust graph and evidence queries (`trust/` is vendored — do not edit without permission)
src/identity/     X identity resolution, NIP-39 proof, xIdentities row logic
src/lib/          Shared libraries (`nostr/` = kinds 32009/32014/10011 + NIP-07)
src/page-world/   MAIN-world passive X JSON observer + proof-search GraphQL
src/relay/        Relay sync cursors, outbox, retry
src/shared/       Messaging contracts and shared types
src/storage/      IndexedDB schema and repository (`xIdentities`, `xPosts`, events, …)
src/popup/        React Chrome Side Panel UI
src/cockpit/      Application data UI
public/           Manifest and locale JSON
```

Display chrome for X users/posts is **X content first** (timeline-seen, trust-gated for posts) — see [docs/architecture.md § X content first](docs/architecture.md#x-content-first-display-chrome). Operator chrome presents the **current X user**, not kind 0. Soft-bind auto-follows the Nostr key bound to the signed-in X (1 X→1 Nostr; many X on one key allowed; no silent auto-bind). Header avatar opens this X user’s Bindings detail (no Nostr dropdown). Settings **Nostr Keys** lists keys; **Bindings** lists X accounts. Do not reverse-lookup Nostr subjects on x.com for Application lists.

| Concern | Owner |
|---------|--------|
| Panel **routing** | `GET_PANEL_SESSION` / `snapshot.route` + `intent` |
| **Identify this X tab** | Worker `ENSURE_ACTIVE_X_ACCOUNT` after an unknown snapshot; popup does not poll. Retry is a user kick. |
| Trust / Graph / statements | Graph RPCs, not the snapshot |
| Notes subject | Sticky on `intent.selected` until Close or history. URL fallback only when selected is null. Focused X tab does not retarget Notes. |

## Cursor rules

Rules live in `.cursor/rules/`. Scoped rules load only when you edit matching files (saves context).

| Rule | Scope | Purpose |
|------|-------|---------|
| `attentionx-architecture.mdc` | Always | Core architecture, privacy, and timeline CPU |
| `x-identity.mdc` | `src/identity/**`, `src/storage/**`, identity backend adapters | `xIdentities` columns, NIP-39 merge, status sync |
| `content-page-world.mdc` | `src/content/**`, `src/page-world/**` | Shadow DOM panel, SPA scan, page↔content bridge |
| `vault-nip07.mdc` | `src/vault/**`, `src/lib/nostr/nip07/**` | Key vault and NIP-07 signer boundaries |
| `graph-wot.mdc` | `src/graph/**`, `src/relay/**` | Heap is runtime truth; GraphManager facade; IndexResolver only (ask to change Trust; no compensation resolvers) |
| `extension-build.mdc` | `vite*.ts`, `public/manifest.json`, `package.json` | Multi-Vite MV3 build and manifest alignment |
| `chrome-extension.mdc` | background, content, page-world, UI, NIP-07, manifest | MV3 coding: isolated runtimes, SW lifetime, permissions, messaging, CSP |
| `typescript-extension.mdc` | `src/**/*.{ts,tsx}` | TS conventions, messaging contracts, tests |
| `data-business-clean-code.mdc` | data + business trees (not React) | Clean Code / SOLID for storage, handlers, graph, identity, vault, relay, shared non-UI |
| `react.mdc` | `src/**/*.{tsx,jsx}` | React popup/cockpit UI patterns |
| `internationalization.mdc` | UI/locale paths (not all of `src/`) | Shared `public/locales` catalog (popup + content) |
| `x-id-data-layers.mdc` | React UI + identity/storage/backend | React keys = X id; backend translation; keep SelectedSubject; 32009 empty\|x.com; 32014 x.com-only |

## Context window tips

- Prefer `@` on a folder or file (e.g. `@src/graph`, `@docs/NIP-32009.md`) over broad “read everything” prompts.
- When verifying UI, prefer `npm run ax` / `npm run ax -- x`. Escalate to project Playwright MCP `playwright-debug` (same `:9222`) only when AXI cannot do the action. Never the isolated Playwright plugin browser.
- [`.cursorignore`](.cursorignore) blocks lockfiles, `dist/`, binaries, and secrets from indexing — do not `@` those paths.
- Long protocol detail is in `docs/`; it is not auto-injected unless referenced or discovered.
- Do not open these whole — Grep / partial read / `@` a section instead:
  - `src/background/backend.ts` (~120KB) — search for the handler or symbol you need
  - `docs/design.md` — prefer [docs/architecture.md](docs/architecture.md) for implementation; use design only for product/phase intent
  - `docs/NIP-32009.md` and large UI files (e.g. `AttentionXPanel.tsx`) — only when that exact topic is in scope

## Non-negotiables (summary)

- Browser/UI verification for Attention uses **`npm run ax -- go`** (debug Chrome on `9222`). Playwright MCP must be project server **`playwright-debug`** on that same CDP port — never the isolated Playwright plugin, never `browser_close`.
- Prefer the **lowest-token** observation path (`npm run ax` / `x` / `popup` / `cockpit`). AXI stamps `[data-ax-ref]` for MCP clicks. Do not recreate one-off CDP probes.
- Nostr secret keys stay in the background service worker only.
- Do not modify X's existing requests. Do not modify X responses except the intentional timeline JSON rewrite (hide/filter + optional backfill) used to optimize timeline rendering — see `attentionx-architecture.mdc` / `content-page-world.mdc`.
- Forward only validated, normalized data across the content boundary — no raw GraphQL bodies, cookies, or bearer tokens.
- Kind `32009` for trust/distrust; kind `32014` for ratings (never hops). Optional `l` labels augment either with further clarification.
- Injected X UI uses Shadow DOM; content-script panel is vanilla TypeScript, not React.
- **Timeline CPU first:** take as little main-thread time as possible so X's
  feed stays responsive. Check every new feature for timeline cost. If the
  app gets slow, nothing else matters — see
  [docs/architecture.md § Timeline CPU](docs/architecture.md#timeline-cpu-and-responsiveness-product-rule).
- Trust results are subjective evidence, not objective scores.
- **`src/graph/trust` freeze:** locked. If IndexResolver/Graph cannot do the job, ask permission and state what you need — do not compensate with a second resolver or hop walk outside the folder. `query.ts` maps `Score[]` only. See [`src/graph/trust/README.md`](src/graph/trust/README.md).
- **Graph heap is runtime truth:** no trust-event lists or identity/chrome catalogs beside `Graph`. Writes update IndexedDB and the heap together; reads look at the Graph first (IndexedDB on miss). Backend asks GraphManager; GraphManager returns one payload for UI/content. Current user / panel director is operational, not Graph data. See [docs/architecture.md § Trust graph heap](docs/architecture.md#trust-graph-heap-runtime-source-of-truth).
- **Minimal disk and memory:** keep only data required for current trust,
  identity, sync, and publish. Do not retain superseded addressable events or
  other historical junk by default — see
  [docs/architecture.md § Minimal data and memory](docs/architecture.md#minimal-data-and-memory-product-rule).
  Prefer write-time validation/reduction and fast rehydrate over re-scanning
  and re-validating large event piles on every service-worker start.
- **X content first:** `xPosts` / `xIdentities` chrome comes from visible X
  subjects; no Event→X bulk fetches for decoration. Operator chrome is the
  current X user (not kind 0). Soft-bind: auto-follow the Nostr bound to this
  X; missing binding offers create or reuse (including a key already bound
  to another X). Header is not a Nostr switcher — Nostr Keys vs Bindings in
  Settings; avatar opens this X user’s binding detail.
