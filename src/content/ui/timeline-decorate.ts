/**
 * Fast-path DOM decorate: Ad markers from page-world dataset.
 */

import {
  readTimelineDecorateDataset,
  TIMELINE_DECORATE_DATASET_KEY,
  type TimelineDecorateState,
} from '../../shared/timeline-decorate'
import { t } from '../i18n'
import { findAuthorNameRow, findPostMoreMenu, parseStatusHref } from '../scanner'

export const AD_MARKER_ATTR = 'data-attentionx-ad-marker'
export const AD_STYLE_ID = 'attentionx-ad-marker-style'

const AD_STYLE_TEXT = `
[${AD_MARKER_ATTR}] {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  margin-inline-end: 4px;
  font-weight: 400;
  font-size: 13px;
  line-height: 16px;
  color: rgb(83, 100, 113);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  vertical-align: middle;
  white-space: nowrap;
  pointer-events: none;
  user-select: none;
}
@media (prefers-color-scheme: dark) {
  [${AD_MARKER_ATTR}] {
    color: rgb(113, 118, 123);
  }
}
`

function ensureAdStylesheet(): void {
  if (document.getElementById(AD_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = AD_STYLE_ID
  style.textContent = AD_STYLE_TEXT
  ;(document.head ?? document.documentElement).append(style)
}

function articlePostId(article: HTMLElement): string | undefined {
  for (const link of article.querySelectorAll<HTMLAnchorElement>(
    'a[href*="/status/"]',
  )) {
    const parsed = parseStatusHref(link.getAttribute('href'))
    if (parsed?.postId) return parsed.postId
  }
  return undefined
}

/**
 * Place (or re-place) the Ad label immediately before the tweet ⋮ menu —
 * matching native promoted placement after we strip promotedMetadata in JSON.
 */
function ensureAdMarker(article: HTMLElement): void {
  ensureAdStylesheet()
  let marker = article.querySelector<HTMLElement>(`[${AD_MARKER_ATTR}]`)
  if (!marker) {
    marker = document.createElement('span')
    marker.setAttribute(AD_MARKER_ATTR, 'true')
    marker.textContent = t('content.filter.ad')
  }

  const moreMenu = findPostMoreMenu(article)
  if (moreMenu?.parentElement) {
    if (marker.nextElementSibling !== moreMenu || marker.parentElement !== moreMenu.parentElement) {
      moreMenu.parentElement.insertBefore(marker, moreMenu)
    }
    return
  }

  // Fallback if the menu has not painted yet: end of the author name row.
  const name = findAuthorNameRow(article)
  if (!name) return
  if (marker.parentElement !== name || name.lastElementChild !== marker) {
    name.append(marker)
  }
}

function removeAdMarker(article: HTMLElement): void {
  article.querySelector(`[${AD_MARKER_ATTR}]`)?.remove()
}

function datasetAttributeName(datasetKey: string): string {
  return `data-${datasetKey.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`)}`
}

export function applyTimelineDecorateToArticle(
  article: HTMLElement,
  decorate: TimelineDecorateState = readTimelineDecorateDataset(document),
): void {
  const postId = articlePostId(article)
  if (!postId) return
  if (decorate.demotedAds.includes(postId)) {
    ensureAdMarker(article)
  }
}

export interface TimelineDecorateController {
  applyAll(): void
  stop(): void
}

/** Watch dataset updates + article inserts; apply Ad decorate ASAP. */
export function startTimelineDecorateObserver(): TimelineDecorateController {
  let stopped = false
  let scheduled = false
  const attrName = datasetAttributeName(TIMELINE_DECORATE_DATASET_KEY)

  const applyAll = (): void => {
    if (stopped) return
    const decorate = readTimelineDecorateDataset(document)
    if (decorate.demotedAds.length === 0) return
    for (const article of document.querySelectorAll<HTMLElement>('article')) {
      applyTimelineDecorateToArticle(article, decorate)
    }
  }

  const schedule = (): void => {
    if (stopped || scheduled) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      applyAll()
    })
  }

  const mo = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (
        mutation.type === 'attributes' &&
        mutation.attributeName === attrName
      ) {
        schedule()
        return
      }
      if (mutation.type !== 'childList') continue
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) continue
        if (
          node.matches?.('article') ||
          node.querySelector?.('article') ||
          node.matches?.('[data-testid="cellInnerDiv"]') ||
          node.querySelector?.('[data-testid="cellInnerDiv"]')
        ) {
          schedule()
          return
        }
      }
    }
  })

  mo.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [attrName],
  })
  mo.observe(document.body ?? document.documentElement, {
    childList: true,
    subtree: true,
  })

  schedule()

  return {
    applyAll,
    stop() {
      stopped = true
      mo.disconnect()
    },
  }
}

export function clearTimelineDecorateUi(): void {
  for (const article of document.querySelectorAll<HTMLElement>('article')) {
    removeAdMarker(article)
  }
}
