---
name: attentionx-dev-browser
description: >-
  Read and operate x.com and the AttentionX extension through `npm run ax`
  (AXI CLI) plus project Playwright MCP `playwright-debug` on the same debug
  Chrome (port 9222). Use when the user says go, inspect, ax, wants timeline /
  popup / cockpit verification, extension reload, or browser automation on
  AttentionX. Do not use the isolated Playwright plugin browser.
---

# AttentionX AXI + Playwright MCP

One debug Chrome on port `9222`. Two complementary interfaces — never two browsers.

| Tool | When |
| --- | --- |
| **`npm run ax`** (default) | X chips/posts/popover, popup, cockpit, reload, compact TOON |
| **Playwright MCP `playwright-debug`** | Same Chrome: hover, drag, dialogs, console, network, a11y when AXI is not enough |
| **Isolated Playwright plugin** | Never for AttentionX — different session, no extension |

AXI stamps last-snapshot nodes as `[data-ax-ref="gN:M"]` so MCP `browser_click` can use that CSS `target`. AXI `@gN:M` refs are not MCP snapshot refs — do not mix them. After crossing tools, refresh: `ax snapshot` or MCP `browser_snapshot`.

## Hard rules

1. **AXI first.** Do not rebuild CDP probes. Do not dump full X a11y trees.
2. **Same Chrome only:** `http://127.0.0.1:9222`, profile `C:\temp\chrome-debug`.
3. **Never** MCP `browser_close`, never launch a second Chrome, never the isolated plugin.
4. **`ax go` / extension reload invalidates MCP locators** — snapshot again.

## First call

```bash
npm run ax                    # live dashboard + MCP contract
npm run ax -- go              # start Chrome + reload dist/ + focus X
npm run ax -- mcp             # tabs + stamp selector + MCP never-list
```

## AXI commands

| Intent | Command |
| --- | --- |
| X aggregates / posts / chip popover | `npm run ax -- x` · `x posts` · `x chip @c1` |
| Popup / Application / card | `popup` · `cockpit [--page users]` · `ext` |
| Filtered refs + click | `snapshot --query chip` · `click @g1:3 --query popover` |
| Tabs for MCP | `tabs` (id, kind, url) |

## Playwright MCP (`playwright-debug`)

Project MCP in `.cursor/mcp.json` already uses `--cdp-endpoint=http://127.0.0.1:9222`.

- Click AXI-stamped nodes: `target` = `[data-ax-ref="g2:3"]` (copy from AXI `mcp.target`, replace `N`).
- Prefer AXI `eval` / `x` / `popup` over MCP snapshots on the X timeline (token cost).
- After MCP clicks, `npm run ax -- snapshot` before further AXI `@` clicks (`STALE_REF` otherwise).

## Loop

1. Chrome down or code changed → `npm run ax -- go`.
2. Observe with `ax` / `ax x`. Summarize TOON; do not paste giant blobs.
3. Escalate to `playwright-debug` only for capabilities AXI lacks.
4. Ask the user only for passkeys, X login, or subjective taste.

## Do not

- Screenshot unless a visual bug needs pixels (`ax screenshot` writes a path).
- Click likes / follows / DMs / deletes on X — extension UI and navigation only.
- Recreate one-off inspect JSON probes.

## Constants

- CDP: `http://127.0.0.1:9222`
- Profile: `C:\temp\chrome-debug`
- Popup: `chrome-extension://<id>/index.html`
- Cockpit: `chrome-extension://<id>/src/cockpit/index.html`
- Stamp attr: `data-ax-ref`
