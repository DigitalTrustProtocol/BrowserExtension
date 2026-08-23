# Documentation index

Use this page to pick the right doc for a task. For AI assistants, [AGENTS.md](../AGENTS.md) is the repo entry point.

## By task

| I want to… | Read |
|------------|------|
| Understand runtime components and security boundaries | [architecture.md](architecture.md) |
| Understand product goals, phases, and UX intent | [design.md](design.md) |
| Hide nsec for casual users; Chrome Sync / later cloud lockers + passkeys | [easy-account-roaming.md](easy-account-roaming.md) |
| Implement or review kind `32009` trust statements | [NIP-32009.md](NIP-32009.md) |
| Understand trust vs rating (the two questions) | [wot-questions.md](wot-questions.md) |
| Implement or review kind `32014` ratings | [NIP-32014.md](NIP-32014.md) |
| AttentionX `s` / empty-scope rules on x.com | [architecture.md § Scope policy](architecture.md#scope-policy-attentionx-on-xcom) |
| Decide how / whether trust events get free-text reasons | [design.md § Trust statement content](design.md#trust-statement-content-human-reasons) |
| Manage held / queued relay publishes | Application Outbox tab (`?page=outbox`) |
| Implement or review NIP-39 X identity proofs and kind `10011` | [NIP-39.md](NIP-39.md) |
| See how AttentionX uses Nostr event kinds and tags | [nostr-protocol.md](nostr-protocol.md) |
| Design hot-graph / scroll performance for the service worker | [architecture.md § Hot trust graph](architecture.md#hot-trust-graph-and-scroll-performance) |
| Apply minimal storage / prune replaced addressable events | [architecture.md § Minimal data and memory](architecture.md#minimal-data-and-memory-product-rule) |
| Understand X-content-first chrome (`xIdentities` / `xPosts`) | [architecture.md § X content first](architecture.md#x-content-first-display-chrome) |
| Identify users/posts/connections across content, panel, and Application | [data-layers.md](data-layers.md) |

## File summary

| File | Contents |
|------|----------|
| [architecture.md](architecture.md) | MV3 components, storage, WoT sync, limitations, performance model |
| [design.md](design.md) | Full design narrative, identity model, reducer, relay sync, open questions |
| [easy-account-roaming.md](easy-account-roaming.md) | Easy onboarding + sealed key roaming (Chrome Sync; later lockers + passkeys) |
| [NIP-32009.md](NIP-32009.md) | Kind `32009` specification used by AttentionX |
| [NIP-32014.md](NIP-32014.md) | Kind `32014` subject rating (shipped in AttentionX) |
| [wot-questions.md](wot-questions.md) | Trust vs rating: the two questions |
| [NIP-39.md](NIP-39.md) | X identity proof format and verification |
| [nostr-protocol.md](nostr-protocol.md) | Protocol overview and event-kind map for this project |
| [data-layers.md](data-layers.md) | X-ID identifiers, selection bus, page cache, unidentified display, 32014 `s=x.com` |

## Related project files

- [AGENTS.md](../AGENTS.md) — agent onboarding, source layout, Cursor rules
- [README.md](../README.md) — install, commands, feature summary
- [.cursor/rules/](../.cursor/rules/) — always-on and scoped AI rules
