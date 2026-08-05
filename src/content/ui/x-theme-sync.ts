import {
  isPageColorScheme,
  type PageColorScheme,
  X_PAGE_COLOR_SCHEME_KEY,
} from '../../shared/page-color-scheme'
import {
  applyPageColorScheme,
  readPageColorScheme,
} from './theme'

export { applyPageColorScheme, readPageColorScheme }
export type { PageColorScheme }

/** Persist X's current theme so extension pages (Graph) can match it. */
export async function syncXPageColorSchemeToStorage(
  scheme: PageColorScheme = readPageColorScheme(),
): Promise<PageColorScheme> {
  await chrome.storage.local.set({ [X_PAGE_COLOR_SCHEME_KEY]: scheme })
  return scheme
}

/**
 * Watch X theme changes on <html> and keep chrome.storage in sync.
 * Returns a disposer.
 */
export function startXPageColorSchemeSync(): () => void {
  let last = readPageColorScheme()
  void syncXPageColorSchemeToStorage(last)

  const pushIfChanged = () => {
    const next = readPageColorScheme()
    if (next === last) return
    last = next
    void syncXPageColorSchemeToStorage(next)
  }

  const observer = new MutationObserver(pushIfChanged)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'data-color-mode', 'data-bs-theme', 'style'],
  })

  const mq = matchMedia('(prefers-color-scheme: dark)')
  mq.addEventListener('change', pushIfChanged)

  return () => {
    observer.disconnect()
    mq.removeEventListener('change', pushIfChanged)
  }
}

export function parseStoredXPageColorScheme(
  value: unknown,
): PageColorScheme | undefined {
  return isPageColorScheme(value) ? value : undefined
}
