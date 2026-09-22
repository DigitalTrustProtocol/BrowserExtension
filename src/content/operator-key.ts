/**
 * Cached "has a writable operator key" flag for the X main thread.
 * Init once + storage.onChanged only — never RPC on chip click.
 * Demo mode is a writable operator (in-code sentinel) without a vault key.
 */

import { isDemoMode, onAppModeChange } from './app-mode'

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

function notify(): void {
  const hasKey = isDemoMode() || cachedHasKey
  for (const listener of listeners) listener(hasKey)
}

function setHasKey(hasKey: boolean): void {
  if (cachedHasKey === hasKey && initialized) return
  cachedHasKey = hasKey
  initialized = true
  notify()
}

export function hasWritableOperatorKey(): boolean {
  return isDemoMode() || cachedHasKey
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
    onAppModeChange(() => notify())
  }

  return hasWritableOperatorKey()
}

export function setHasWritableOperatorKeyForTests(hasKey: boolean): void {
  setHasKey(hasKey)
}

export function resetContentOperatorKeyForTests(): void {
  cachedHasKey = false
  initialized = false
  watching = false
  listeners.clear()
}
