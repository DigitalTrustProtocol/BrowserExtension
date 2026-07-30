---
name: attentionx-dev-browser
description: >-
  Open AttentionX debug Chrome on port 9222, reload the unpacked extension from
  dist/, inspect the X timeline UI and extension app pages with compact CDP
  probes. Use when the user says "go", wants autonomous UI verification,
  debug Chrome, extension reload, or to see what AttentionX is doing without
  asking the user.
---

# AttentionX dev browser

Primary loop for developing AttentionX **without relying on the user to describe UI state**.

## Hard rules (agreed)

1. **Use option 1 only for AttentionX browser work:** `npm run go` + debug Chrome on port `9222` + CDP scripts (`npm run inspect`). Do not use the built-in Playwright MCP’s separate Chrome session for AttentionX development.
2. **Prefer the lowest-token path that is enough.** Compact JSON probes over full snapshots, screenshots, or dumping large DOM/a11y trees. Escalate to richer capture only when the compact path cannot answer the question.

## Preferred model

Use **debug Chrome via CDP** (`npm run go` + `npm run inspect`):

- Most freedom: reload extension, clear cache, open popup/cockpit, inspect X
- Compact JSON output (low context tokens)
- Avoid Playwright MCP full-page snapshots on X — they are huge and expensive

Do **not** ask the user what the UI looks like when debug Chrome can answer.

## When to use

Trigger on:

- `go`
- develop / verify AttentionX UI
- reload extension
- “what’s happening on X / in the popup / cockpit?”

## Commands

```bash
npm run go                 # ensure debug Chrome + reload AttentionX + focus X
npm run inspect            # compact probe: X timeline + popup + cockpit + extension card
npm run inspect -- --x-only
npm run reload-extension   # reload only; no-op if Chrome closed
npm run build              # build + auto-reload when debug Chrome is open
```

Chrome launch (only if port `9222` is down):

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\temp\chrome-debug"
```

## Autonomous development loop

1. If port `9222` is down or code changed → `npm run go` (build first if needed).
2. Observe with `npm run inspect` (compact JSON). Do not dump full a11y trees.
3. Change code → `npm run build` (auto-reloads when Chrome is open) or `npm run go`.
4. Re-run `npm run inspect` and/or targeted CDP probes before asking the user.
5. Only ask the user for things automation cannot know (passkey login, subjective product taste).

### What `inspect` reports

Order is fixed:

1. **Focus `x.com` first** and probe the timeline
2. **Then** open extension app pages (popup / cockpit)
3. Extension card status on `chrome://extensions` last

Never open popup/cockpit before the X tab is focused — those pages depend on the active X session.

Reports:

- **X timeline:** chip/score/tone counts, sample chip labels, popover open, signals present
- **Extension apps:** popup (`index.html`) and cockpit (`src/cockpit/index.html`) — headings, buttons, errors, short text preview
- **Extension card:** id, name, error flag on `chrome://extensions`

### Token discipline

- Always choose the cheaper observation path when it is sufficient.
- Prefer `npm run inspect` / small `page.evaluate` JSON over Playwright `browser_snapshot`.
- Prefer summarizing inspect JSON in chat over pasting the full blob when only a few fields matter.
- Prefer no screenshots unless visual bugs need pixels.
- Keep console output as the source of truth in chat (already compact).

## Playwright MCP note

Do **not** use the built-in Playwright plugin browser for AttentionX. It is a separate session (option 2) and is out of scope for this workflow.

Optional project MCP `playwright-debug` in `.cursor/mcp.json` can attach to `http://127.0.0.1:9222`, but still prefer `npm run inspect` for token cost. Use richer MCP tools only when compact CDP probes are not enough.

## Agent checklist (`go`)

1. Build if `dist/` missing or extension code changed.
2. `npm run go`
3. Report: Chrome status, extension id, reload, errors, X tab action
4. When verifying UI: `npm run inspect` and summarize findings (do not paste giant trees)

## Constants

- Profile: `C:\temp\chrome-debug`
- CDP: `http://127.0.0.1:9222`
- Extension output: `dist/`
- Popup: `chrome-extension://<id>/index.html`
- Cockpit: `chrome-extension://<id>/src/cockpit/index.html`

## Notes

- User signs in to X locally in the debug profile (passkeys stay local).
- Existing `x.com` tabs are hard-reloaded with cache cleared so content scripts re-inject.
