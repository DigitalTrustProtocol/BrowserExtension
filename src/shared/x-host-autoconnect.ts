/**
 * Hosts the extension treats as X. Install host permissions cover these.
 */

export const X_PRODUCT_HOSTS = new Set([
  'x.com',
  'www.x.com',
  'twitter.com',
  'www.twitter.com',
])

export function isXProductHost(domain: string): boolean {
  return X_PRODUCT_HOSTS.has(domain.trim().toLowerCase())
}
