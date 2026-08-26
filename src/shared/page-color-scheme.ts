/** Color scheme for graph UI and X page theme sync. */

export type PageColorScheme = 'light' | 'dark'

/**
 * Graph / extension preference: `auto` follows last-known X.com theme,
 * else the OS `prefers-color-scheme`.
 */
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
 * Extension chrome (side panel, Application): last-known X theme, else OS.
 */
export function resolveExtensionColorScheme(
  xScheme: PageColorScheme | undefined,
  system: PageColorScheme = systemColorScheme(),
): PageColorScheme {
  return xScheme ?? system
}

/**
 * Resolve an effective light/dark scheme for the Graph page.
 * Preference `auto` uses last-known X theme, else OS. Explicit light/dark
 * is the toolbar override.
 */
export function resolveGraphColorScheme(
  preference: GraphColorSchemePreference,
  xScheme: PageColorScheme | undefined,
  system: PageColorScheme = systemColorScheme(),
): PageColorScheme {
  if (preference === 'light' || preference === 'dark') return preference
  return resolveExtensionColorScheme(xScheme, system)
}
