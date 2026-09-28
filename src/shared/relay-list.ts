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

export function isCatalogRelay(
  url: string,
  catalog: readonly string[] = RELAY_CATALOG,
): boolean {
  return catalog.includes(url)
}

/**
 * Custom relays the user turned off. Built-in catalog relays are omitted;
 * they are not kept on the inactive list.
 */
export function listInactiveRelays(
  active: readonly string[],
  storedInactive: readonly string[],
  catalog: readonly string[] = RELAY_CATALOG,
): string[] {
  const activeSet = new Set(active)
  const catalogSet = new Set(catalog)
  const seen = new Set<string>()
  const result: string[] = []
  for (const url of storedInactive) {
    if (activeSet.has(url) || catalogSet.has(url) || seen.has(url)) continue
    seen.add(url)
    result.push(url)
  }
  return result
}

/** Drop a custom relay from the off list. Catalog suggestions are not stored. */
export function forgetInactiveRelay(
  storedInactive: readonly string[],
  url: string,
): string[] {
  return storedInactive.filter((item) => item !== url)
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
 * Move a relay off the active list. A built-in catalog URL is dropped.
 * A relay the user added is appended to the inactive list.
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
