---
name: attentionx-dev-browser
description: >-
  Open AttentionX debug Chrome on port 9222, reload the unpacked extension from
  dist/, and clear extension errors. Use when the user says "go", wants the dev
  browser, debug Chrome, extension reload, or a fresh test session on X.
---

# AttentionX dev browser

One-command local dev loop for the MV3 extension.

## When to use

Trigger on:

- `go`
- open debug Chrome / dev browser
- reload AttentionX extension
- prepare browser for X testing

## Default workflow

Run from repo root:

```bash
npm run go
```

This:

1. Reuses debug Chrome when port `9222` is already listening; otherwise starts:
   `& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\temp\chrome-debug"`
2. Opens `chrome://extensions/`
3. Ensures Developer mode is on
4. Finds **AttentionX** and reloads it from the existing unpacked install
5. If AttentionX is missing, loads unpacked from `dist/`
6. Clears extension errors when present
7. Focuses X for testing:
   - if an `x.com` tab exists → focus it and hard-reload with cache cleared (fresh content script)
   - otherwise → focus an empty tab and open `https://x.com/`

`npm run build` already runs `postbuild`, which calls `npm run reload-extension` when debug Chrome is open (extension reload + X tab step).

## Agent checklist

When the user says **go**:

1. Run `npm run build` if `dist/` is missing or the user changed extension code.
2. Run `npm run go`.
3. Report:
   - Chrome debug status (`9222`)
   - AttentionX extension id/name
   - reload result
   - whether errors were cleared
   - X tab action (`reloaded-existing-tab` or `opened-x-in-empty-tab`)
4. If reload fails, inspect `scripts/lib/extension-dev-browser.mjs` and retry once after confirming `dist/manifest.json` exists.

## Manual commands

```bash
npm run go                 # start debug Chrome + reload extension
npm run reload-extension   # reload only; no-op if Chrome is closed
npm run build              # build dist/ and auto-reload when Chrome is open
```

## Constants

- Chrome: `C:\Program Files\Google\Chrome\Application\chrome.exe`
- Profile: `C:\temp\chrome-debug`
- CDP: `http://127.0.0.1:9222`
- Extension output: `dist/`
- Extension name match: `AttentionX`

## Notes

- Do not ask for X credentials. User signs in locally in the debug profile.
- Reload picks up the latest `dist/` output for the already-loaded unpacked path.
- Existing `x.com` tabs are hard-reloaded with cache cleared so the content script re-injects from the rebuilt extension.
