import {
  APP_MODE_CHANGED_MESSAGE,
  APP_MODE_STORAGE_KEY,
  DEFAULT_APP_MODE,
  parseAppMode,
  type AppMode,
} from '../shared/app-mode'

let cachedMode: AppMode = DEFAULT_APP_MODE
let initialized = false
const listeners = new Set<(mode: AppMode) => void>()

function setMode(mode: AppMode): void {
  if (cachedMode === mode && initialized) return
  cachedMode = mode
  initialized = true
  for (const listener of listeners) listener(mode)
}

export function getAppMode(): AppMode {
  return cachedMode
}

export function isDemoMode(): boolean {
  return cachedMode === 'demo'
}

export function onAppModeChange(listener: (mode: AppMode) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export async function initContentAppMode(): Promise<AppMode> {
  try {
    const data = await chrome.storage.local.get(APP_MODE_STORAGE_KEY)
    setMode(parseAppMode(data[APP_MODE_STORAGE_KEY]))
  } catch {
    setMode(DEFAULT_APP_MODE)
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return
    const change = changes[APP_MODE_STORAGE_KEY]
    if (!change) return
    setMode(parseAppMode(change.newValue))
  })

  chrome.runtime.onMessage.addListener((message: { type?: string; mode?: unknown }) => {
    if (message?.type === APP_MODE_CHANGED_MESSAGE) {
      setMode(parseAppMode(message.mode))
    }
  })

  return cachedMode
}

export function setAppModeForTests(mode: AppMode): void {
  setMode(mode)
}

export function resetContentAppModeForTests(): void {
  cachedMode = DEFAULT_APP_MODE
  initialized = false
  listeners.clear()
}
