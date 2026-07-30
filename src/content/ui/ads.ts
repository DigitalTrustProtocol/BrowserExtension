/** Detect X promoted / ad placements. Never filter these for revenue safety. */

import { findAuthorNameRow } from '../scanner'

/** Timeline cell that owns spacing for a tweet article. */
export function timelineCellForArticle(article: HTMLElement): HTMLElement {
  return (
    article.closest<HTMLElement>('[data-testid="cellInnerDiv"]') ?? article
  )
}

/**
 * Detect X promoted / ad placements.
 * Note: many organic videos also wrap the player in `placementTracking`.
 * Real ads include impression pixels and/or an Ad/Promoted label.
 */
export function isPromotedArticle(article: HTMLElement): boolean {
  const cell = timelineCellForArticle(article)

  if (
    cell.querySelector(
      '[data-testid="placementTracking"] [data-testid$="-impression-pixel"], [data-testid="placementTracking"] [data-testid*="impression-pixel"]',
    )
  ) {
    return true
  }

  const social = article.querySelector('[data-testid="socialContext"]')
  if (social && /\b(Ad|Promoted|Sponsored)\b/i.test(social.textContent ?? '')) {
    return true
  }

  const nameRow = findAuthorNameRow(article)
  const header = nameRow?.parentElement ?? nameRow
  if (header) {
    for (const el of header.querySelectorAll('span, div, a')) {
      const label = el.textContent?.trim() ?? ''
      if (label === 'Ad' || label === 'Promoted' || label === 'Sponsored') {
        return true
      }
    }
    if (/@[A-Za-z0-9_]+\s*Ad(?:\s|[A-Z]|$)/.test(header.textContent ?? '')) {
      return true
    }
  }

  return false
}
