/** Global app data mode: live relays vs local-only demo. */
export type AppMode = 'production' | 'demo'

export const DEFAULT_APP_MODE: AppMode = 'production'

/** Mirrored in chrome.storage.local for content / badge readers. */
export const APP_MODE_STORAGE_KEY = 'attentionxAppMode' as const

/** Broadcast when mode changes so UI and content flush caches. */
export const APP_MODE_CHANGED_MESSAGE = 'APP_MODE_CHANGED' as const

export function isAppMode(value: unknown): value is AppMode {
  return value === 'production' || value === 'demo'
}

export function parseAppMode(value: unknown): AppMode {
  return isAppMode(value) ? value : DEFAULT_APP_MODE
}
