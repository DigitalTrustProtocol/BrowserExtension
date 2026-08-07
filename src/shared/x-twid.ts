/**
 * Parse X's public `twid` cookie value into a numeric user id.
 * Used by the content script (`document.cookie`) and the service worker
 * (`chrome.cookies`) — never persists the raw cookie string.
 *
 * @module shared/x-twid
 */

import { isXNumericId } from './observed-x-identity.ts'

/**
 * Extract `u=<digits>` from a twid cookie value or a full `document.cookie`
 * string. Returns undefined when missing/invalid.
 */
export function twitterIdFromTwidCookie(
  cookieSource: string,
): string | undefined {
  if (!cookieSource) return undefined
  // Full cookie header: find twid=…; otherwise treat input as the value alone.
  let raw = cookieSource
  if (cookieSource.includes(';') || /(?:^|;\s*)twid=/i.test(cookieSource)) {
    for (const part of cookieSource.split(';')) {
      const trimmed = part.trim()
      if (!trimmed.toLowerCase().startsWith('twid=')) continue
      raw = trimmed.slice(trimmed.indexOf('=') + 1)
      break
    }
    if (raw === cookieSource && !cookieSource.toLowerCase().includes('twid=')) {
      return undefined
    }
  }

  let decoded = raw
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    decoded = raw
  }
  const cleaned = decoded.replace(/^"+|"+$/g, '')
  const match =
    cleaned.match(/(?:^|[?&])u=(\d{1,24})(?:&|$)/) ??
    cleaned.match(/^u=(\d{1,24})$/)
  const id = match?.[1]
  if (id && isXNumericId(id)) return id
  const plain = cleaned.match(/u[=:](\d{1,24})/)
  if (plain?.[1] && isXNumericId(plain[1])) return plain[1]
  return undefined
}
