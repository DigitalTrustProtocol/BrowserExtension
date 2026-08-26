/**
 * Fast-path DOM decorate: collapse bars + Ad markers from page-world dataset.
 * Trust summaries prefer the shared trustStore (seeded by JSON resolve).
 */

import {
  readTimelineDecorateDataset,
  TIMELINE_DECORATE_DATASET_KEY,
  type TimelineCollapseTarget,
  type TimelineDecorateState,
} from '../../shared/timeline-decorate'
import {
  readTrustFiltersDataset,
} from '../../shared/trust-filters-dataset'
import {
  DEFAULT_TRUST_FILTERS,
  type TrustFilters,
} from '../../shared/x-augmentation'
import {
  canonicalTwitterAccountSubject,
  canonicalTwitterPostSubject,
} from '../../shared/x-identity'
import {
  contextField,
  trustQueryContextForSubject,
} from '../../shared/trust-context'
import { t } from '../i18n'
import { findAuthorNameRow, findPostMoreMenu, parseStatusHref } from '../scanner'
import {
  emptyTrustSummary,
  summarizeTrust,
  toneForResolution,
  type TrustSummary,
} from '../trust-summary'
import { descriptorKey, trustStore } from '../trust-store'
import type { TrustDescriptor } from '../types'
import {
  applyArticleFilter,
  clearArticleCollapse,
  ensureFilterStylesheet,
} from './hide'

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

/** Re-apply decorate when a fallback resolve (or invalidate refetch) completes. */
let decorateStoreRefresh: (() => void) | undefined
const decorateStoreWatches = new Map<string, () => void>()

function trustDescriptorFor(
  kind: 'user' | 'post',
  id: string,
): TrustDescriptor {
  const subject = {
    type: 'i' as const,
    value:
      kind === 'user'
        ? canonicalTwitterAccountSubject(id)
        : canonicalTwitterPostSubject(id),
  }
  return {
    subject,
    ...contextField(trustQueryContextForSubject(subject)),
  }
}

/**
 * Watch a subject so TRUST_GRAPH_UPDATED / invalidateAll re-fetches it, and
 * so a cache-miss fallback resolve re-applies collapse labels when it lands.
 * Does not call request() — that notifies and would re-enter apply in a loop.
 */
function ensureDecorateStoreWatch(key: string): void {
  if (decorateStoreWatches.has(key)) return
  decorateStoreWatches.set(
    key,
    trustStore.subscribe(key, () => {
      decorateStoreRefresh?.()
    }),
  )
}

function clearDecorateStoreWatches(): void {
  for (const unsub of decorateStoreWatches.values()) unsub()
  decorateStoreWatches.clear()
}

function pruneDecorateStoreWatches(needed: Set<string>): void {
  for (const [key, unsub] of [...decorateStoreWatches.entries()]) {
    if (needed.has(key)) continue
    unsub()
    decorateStoreWatches.delete(key)
  }
}

function summaryFromStore(
  kind: 'user' | 'post',
  id: string,
  fallbackResolution: TimelineCollapseTarget['resolution'],
): TrustSummary {
  const descriptor = trustDescriptorFor(kind, id)
  const key = descriptorKey(descriptor)
  ensureDecorateStoreWatch(key)
  const cached = trustStore.get(key)
  if (cached) return summarizeTrust(cached)
  // Seed may have been cleared (e.g. TRUST_GRAPH_UPDATED) before DOM apply —
  // fall back to a fresh backend resolve; use decorate provisional until then.
  trustStore.request(key, descriptor)
  return {
    ...emptyTrustSummary(),
    resolution: fallbackResolution,
    tone: toneForResolution(fallbackResolution),
  }
}

function summariesForCollapse(collapse: TimelineCollapseTarget): {
  author?: TrustSummary
  post?: TrustSummary
  /** Prefer live cache resolution so the headline is not stuck on "none". */
  labelBasis: 'author' | 'post'
  labelSummary: TrustSummary
} {
  const author = collapse.userId
    ? summaryFromStore(
        'user',
        collapse.userId,
        collapse.basis === 'author' ? collapse.resolution : 'none',
      )
    : collapse.basis === 'author'
      ? {
          ...emptyTrustSummary(),
          resolution: collapse.resolution,
          tone: toneForResolution(collapse.resolution),
        }
      : undefined
  const post = summaryFromStore(
    'post',
    collapse.postId,
    collapse.basis === 'post' ? collapse.resolution : 'none',
  )

  const labelBasis = collapse.basis
  const labelSummary =
    (labelBasis === 'post' ? post : author) ??
    post ??
    author ?? {
      ...emptyTrustSummary(),
      resolution: collapse.resolution,
      tone: toneForResolution(collapse.resolution),
    }

  return {
    ...(author ? { author } : {}),
    post,
    labelBasis,
    labelSummary,
  }
}

export function applyTimelineDecorateToArticle(
  article: HTMLElement,
  decorate: TimelineDecorateState = readTimelineDecorateDataset(document),
  _filters: TrustFilters = readTrustFiltersDataset(document) ??
    DEFAULT_TRUST_FILTERS,
): void {
  const postId = articlePostId(article)
  if (!postId) return

  if (decorate.demotedAds.includes(postId)) {
    ensureAdMarker(article)
  }

  const collapse = decorate.collapse[postId]
  if (!collapse) return

  ensureFilterStylesheet()
  const handle = collapse.handle
    ? collapse.handle.startsWith('@')
      ? collapse.handle
      : `@${collapse.handle}`
    : undefined
  const displayName = collapse.displayName ?? handle ?? postId
  const { author, post, labelBasis, labelSummary } =
    summariesForCollapse(collapse)

  // Keep this post collapsed from the decorate list (page-world decision).
  // Use cached trust for the label — do not re-derive collapse from live
  // resolutions or mixed posts would un-collapse after seed.
  const effectiveResolution = labelSummary.resolution
  const collapseFilters: TrustFilters = {
    trusted: 'none',
    mixed: 'none',
    distrusted: 'none',
    none: 'none',
    [effectiveResolution]:
      labelBasis === 'post' ? 'collapsePost' : 'collapseUser',
  }

  applyArticleFilter({
    article,
    filters: collapseFilters,
    ...(author ? { author } : {}),
    ...(post ? { post } : {}),
    displayName,
    ...(handle ? { handle } : {}),
  })
}

export interface TimelineDecorateController {
  applyAll(): void
  stop(): void
}

/** Watch dataset updates + article inserts; apply collapse/Ad decorate ASAP. */
export function startTimelineDecorateObserver(): TimelineDecorateController {
  let stopped = false
  let scheduled = false
  const attrName = datasetAttributeName(TIMELINE_DECORATE_DATASET_KEY)

  const applyAll = (): void => {
    if (stopped) return
    const decorate = readTimelineDecorateDataset(document)
    if (
      Object.keys(decorate.collapse).length === 0 &&
      decorate.demotedAds.length === 0
    ) {
      pruneDecorateStoreWatches(new Set())
      return
    }
    const filters =
      readTrustFiltersDataset(document) ?? DEFAULT_TRUST_FILTERS
    const neededKeys = new Set<string>()
    for (const target of Object.values(decorate.collapse)) {
      neededKeys.add(descriptorKey(trustDescriptorFor('post', target.postId)))
      if (target.userId) {
        neededKeys.add(descriptorKey(trustDescriptorFor('user', target.userId)))
      }
    }
    pruneDecorateStoreWatches(neededKeys)
    for (const article of document.querySelectorAll<HTMLElement>('article')) {
      applyTimelineDecorateToArticle(article, decorate, filters)
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

  decorateStoreRefresh = schedule

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
      decorateStoreRefresh = undefined
      clearDecorateStoreWatches()
      mo.disconnect()
    },
  }
}

export function clearTimelineDecorateUi(): void {
  for (const article of document.querySelectorAll<HTMLElement>('article')) {
    clearArticleCollapse(article)
    removeAdMarker(article)
  }
}
