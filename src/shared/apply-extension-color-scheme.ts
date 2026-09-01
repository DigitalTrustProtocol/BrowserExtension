import {
  isPageColorScheme,
  resolveExtensionColorScheme,
  systemColorScheme,
  X_PAGE_COLOR_SCHEME_KEY,
  type PageColorScheme,
} from './page-color-scheme'

const CACHE_KEY = 'axExtensionColorScheme'

function paint(scheme: PageColorScheme): void {
  const root = document.documentElement
  root.dataset.axColorScheme = scheme
  root.style.colorScheme = scheme
  try {
    localStorage.setItem(CACHE_KEY, scheme)
  } catch {
    /* private mode / quota */
  }
}

function readCache(): PageColorScheme | undefined {
  try {
    const value = localStorage.getItem(CACHE_KEY)
    return isPageColorScheme(value) ? value : undefined
  } catch {
    return undefined
  }
}

async function resolveFromStorage(): Promise<PageColorScheme> {
  let xScheme: PageColorScheme | undefined
  try {
    const stored = await chrome.storage.local.get(X_PAGE_COLOR_SCHEME_KEY)
    const value = stored[X_PAGE_COLOR_SCHEME_KEY]
    if (isPageColorScheme(value)) xScheme = value
  } catch {
    /* tests / no chrome */
  }
  return resolveExtensionColorScheme(xScheme, systemColorScheme())
}

/**
 * Paint extension pages (side panel, Application, prompt) to
 * match last-known X.com theme, else the OS preference.
 */
export async function applyExtensionColorScheme(): Promise<PageColorScheme> {
  const cached = readCache()
  if (cached) paint(cached)

  const scheme = await resolveFromStorage()
  paint(scheme)

  const mq = matchMedia('(prefers-color-scheme: dark)')
  const refresh = () => {
    void resolveFromStorage().then(paint)
  }
  mq.addEventListener('change', refresh)
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[X_PAGE_COLOR_SCHEME_KEY]) return
      refresh()
    })
  }

  return scheme
}
