/** Color scheme for graph UI and X page theme sync. */

export type PageColorScheme = 'light' | 'dark'

/** Graph preference: auto follows X (if known) then OS. */
export type GraphColorSchemePreference = PageColorScheme | 'auto'

/** Last observed X.com theme from the content script. */
export const X_PAGE_COLOR_SCHEME_KEY = 'xPageColorScheme'

export function systemColorScheme(
  matchMediaFn: (query: string) => MediaQueryList = matchMedia,
): PageColorScheme {
  return matchMediaFn('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function isPageColorScheme(value: unknown): value is PageColorScheme {
  return value === 'light' || value === 'dark'
}

/**
 * Resolve an effective light/dark scheme for the Graph page.
 * Preference `auto` uses the last known X theme, else the OS preference.
 */
export function resolveGraphColorScheme(
  preference: GraphColorSchemePreference,
  xScheme: PageColorScheme | undefined,
  system: PageColorScheme = systemColorScheme(),
): PageColorScheme {
  if (preference === 'light' || preference === 'dark') return preference
  if (xScheme) return xScheme
  return system
}
