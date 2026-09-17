/**
 * Clone X's verified / affiliation badge from a name row host, if present
 * (blue check, gold business, gray government, etc.).
 * Bakes the live computed color onto the clone so `currentColor` fills still
 * render correctly outside X's stylesheet (trust dialog, chips).
 */

import { findAuthorVerifiedBadge } from '../scanner'

export function cloneAuthorVerifiedBadge(
  article: HTMLElement,
): SVGElement | undefined {
  const svg = findAuthorVerifiedBadge(article)
  if (!svg) return undefined
  const clone = svg.cloneNode(true) as SVGElement
  const color = getComputedStyle(svg).color
  if (color && color !== 'rgba(0, 0, 0, 0)') {
    clone.style.color = color
  }
  return clone
}
