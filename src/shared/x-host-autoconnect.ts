/**
 * X product hosts get a one-time NIP-07 auto-connect.
 * After the first connect (or after the user disconnects), they stay
 * unconnected until the user manually connects again.
 */

export const X_PRODUCT_HOSTS = new Set([
  'x.com',
  'www.x.com',
  'twitter.com',
  'www.twitter.com',
])

/** Persisted once the one-time auto-connect has been consumed. */
export const X_HOST_AUTO_CONNECT_DONE_KEY = 'xHostOneTimeAutoConnectDone'

export function isXProductHost(domain: string): boolean {
  return X_PRODUCT_HOSTS.has(domain.trim().toLowerCase())
}

/**
 * Whether Attention should silently allowlist this X host on first sight.
 * Returns false once the one-time offer has been consumed (including after
 * the user removes x.com from the connected-sites list).
 */
export function shouldOneTimeAutoConnectXHost(
  domain: string,
  allowedDomains: readonly string[] | null | undefined,
  autoConnectDone: boolean,
): boolean {
  if (!isXProductHost(domain)) return false
  if (autoConnectDone) return false
  const list = allowedDomains ?? []
  return !list.includes(domain)
}
