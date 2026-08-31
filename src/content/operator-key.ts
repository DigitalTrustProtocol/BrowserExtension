/**
 * Cached "has a writable operator key" flag for the X main thread.
 * Init once + storage.onChanged only — never RPC on chip click.
 */

export function accountsHaveWritableKey(raw: unknown): boolean {
  if (!Array.isArray(raw)) return false
  return raw.some((row) => {
    if (!row || typeof row !== 'object') return false
    return (row as { readOnly?: unknown }).readOnly !== true
  })
}

let cachedHasKey = false
let initialized = false
let watching = false
const listeners = new Set<(hasKey: boolean) => void>()

function setHasKey(hasKey: boolean): void {
  if (cachedHasKey === hasKey && initialized) return
  cachedHasKey = hasKey
  initialized = true
  for (const listener of listeners) listener(hasKey)
}

export function hasWritableOperatorKey(): boolean {
  return cachedHasKey
}

export function onWritableOperatorKeyChange(
  listener: (hasKey: boolean) => void,
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export async function initContentOperatorKey(): Promise<boolean> {
  try {
    const data = await chrome.storage.local.get('accounts')
    setHasKey(accountsHaveWritableKey(data.accounts))
  } catch {
    setHasKey(false)
  }

  if (!watching) {
    watching = true
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return
      const change = changes.accounts
      if (!change) return
      setHasKey(accountsHaveWritableKey(change.newValue))
    })
  }

  return cachedHasKey
}

export function setHasWritableOperatorKeyForTests(hasKey: boolean): void {
  setHasKey(hasKey)
}

export function resetContentOperatorKeyForTests(): void {
  cachedHasKey = false
  initialized = false
  listeners.clear()
}
