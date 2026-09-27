import { RELAY_CATALOG } from './contracts'
import { normalizeRelayUrl } from './url'

export interface RelayMembership {
  active: string[]
  storedInactive: string[]
}

/** Keep order, drop blanks and non-relay URLs, collapse duplicates. */
export function normalizeRelayList(values: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const url = normalizeRelayUrl(value)
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push(url)
  }
  return out
}

/**
 * Catalog relays that are not active, then custom URLs the user turned off.
 */
export function listInactiveRelays(
  active: readonly string[],
  storedInactive: readonly string[],
  catalog: readonly string[] = RELAY_CATALOG,
  dismissed: readonly string[] = [],
): string[] {
  const activeSet = new Set(active)
  const dismissedSet = new Set(dismissed)
  const seen = new Set<string>()
  const result: string[] = []
  const push = (url: string) => {
    if (activeSet.has(url) || dismissedSet.has(url) || seen.has(url)) return
    seen.add(url)
    result.push(url)
  }
  for (const url of catalog) push(url)
  for (const url of storedInactive) push(url)
  return result
}

/** Drop a relay from the inactive list. Catalog entries stay hidden until added again. */
export function forgetInactiveRelay(
  storedInactive: readonly string[],
  dismissed: readonly string[],
  url: string,
): { storedInactive: string[]; dismissed: string[] } {
  return {
    storedInactive: storedInactive.filter((item) => item !== url),
    dismissed: dismissed.includes(url) ? [...dismissed] : [...dismissed, url],
  }
}

/**
 * Drop dismissed catalog relays that are not active, so they show on the
 * inactive list again. Active relays and custom dismissals stay.
 */
export function restoreCatalogRelays(
  active: readonly string[],
  dismissed: readonly string[],
  catalog: readonly string[] = RELAY_CATALOG,
): string[] {
  const activeSet = new Set(active)
  const catalogSet = new Set(catalog)
  return dismissed.filter((url) => !catalogSet.has(url) || activeSet.has(url))
}

/** A deleted relay can be added again. */
export function rememberRelay(
  dismissed: readonly string[],
  url: string,
): string[] {
  return dismissed.filter((item) => item !== url)
}

/** Move a relay to the front of the active list. */
export function activateRelay(
  active: readonly string[],
  storedInactive: readonly string[],
  url: string,
): RelayMembership {
  return {
    active: [url, ...active.filter((item) => item !== url)],
    storedInactive: storedInactive.filter((item) => item !== url),
  }
}

/**
 * Move a relay off the active list. Catalog URLs are not stored; they
 * reappear from the catalog. A custom URL is appended to the off list.
 */
export function deactivateRelay(
  active: readonly string[],
  storedInactive: readonly string[],
  url: string,
  catalog: readonly string[] = RELAY_CATALOG,
): RelayMembership {
  const nextStored = storedInactive.filter((item) => item !== url)
  if (!catalog.includes(url)) nextStored.push(url)
  return {
    active: active.filter((item) => item !== url),
    storedInactive: nextStored,
  }
}
