/**
 * Timeline hide / collapse helpers for trust filters.
 * Promoted / ad placements are never filtered — X revenue must not be affected.
 */

import type {
  TimelineFilterMode,
  TrustFilters,
} from '../../shared/x-augmentation'
import { resolveTimelineFilter } from '../../shared/x-augmentation'
import { t } from '../i18n'
import type { TrustSummary } from '../trust-summary'
import type { TrustTone } from '../types'
import {
  findAuthorVerifiedBadge,
} from '../scanner'
import { isPromotedArticle, timelineCellForArticle } from './ads'
import {
  ensureSignalStylesheet,
  formatTrustScore,
  TONE_COLORS,
} from './signals'

export { isPromotedArticle, timelineCellForArticle } from './ads'

export const FILTER_STYLE_ID = 'attentionx-timeline-filter'
export const COLLAPSE_CHEVRON_ATTR = 'data-attentionx-collapse-chevron'

const FILTER_STYLE_TEXT = `
[data-testid="cellInnerDiv"][data-attentionx-hidden="true"],
article[data-attentionx-hidden="true"] {
  display: none !important;
}
/* Same-height shield: keep native layout (X virtualizer) but conceal content. */
[data-testid="cellInnerDiv"][data-attentionx-collapsed="true"] {
  position: relative;
}
[data-testid="cellInnerDiv"][data-attentionx-collapsed="true"] > :not([data-attentionx-collapse-bar]) {
  visibility: hidden !important;
  pointer-events: none !important;
}
/* Expanded: hide the collapse headline; post content is visible. */
[data-testid="cellInnerDiv"][data-attentionx-collapsed="false"] > [data-attentionx-collapse-bar] {
  display: none !important;
}
[data-attentionx-collapse-bar] {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  margin: 0;
  border-radius: 8px;
  background: rgba(247, 249, 249, 0.92);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 15px;
  line-height: 1.3;
  color: inherit;
  box-sizing: border-box;
  width: 100%;
  cursor: pointer;
  user-select: none;
}
@media (prefers-color-scheme: dark) {
  [data-attentionx-collapse-bar] {
    background: rgba(22, 24, 28, 0.92);
  }
}
[data-attentionx-collapse-bar]:hover {
  background: rgba(127, 127, 127, 0.18);
}
[data-attentionx-collapse-bar] .ax-collapse-identity {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
}
[data-attentionx-collapse-bar] .ax-collapse-display-name {
  font-weight: 700;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: inherit;
}
[data-attentionx-collapse-bar] .ax-collapse-handle {
  flex: 0 0 auto;
  font-weight: 400;
  color: rgb(83, 100, 113);
  white-space: nowrap;
}
@media (prefers-color-scheme: dark) {
  [data-attentionx-collapse-bar] .ax-collapse-handle {
    color: rgb(113, 118, 123);
  }
}
[data-attentionx-collapse-bar] .ax-collapse-verified {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  line-height: 0;
}
[data-attentionx-collapse-bar] .ax-collapse-verified svg {
  width: 16px;
  height: 16px;
  display: block;
}
[data-attentionx-collapse-bar] .ax-collapse-trust {
  flex: 0 0 auto;
  font-weight: 600;
  font-size: 13px;
  opacity: 0.9;
}
[data-attentionx-collapse-bar] .ax-collapse-trust:empty {
  display: none;
}
[data-attentionx-collapse-bar] .ax-collapse-spacer {
  flex: 1 1 auto;
}
[${COLLAPSE_CHEVRON_ATTR}] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin: 0 0 0 2px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: rgb(83, 100, 113);
  cursor: pointer;
  line-height: 1;
  vertical-align: middle;
}
[${COLLAPSE_CHEVRON_ATTR}]:hover {
  background: rgba(127, 127, 127, 0.15);
}
[${COLLAPSE_CHEVRON_ATTR}] svg {
  display: block;
}
`

const CHEVRON_UP_SVG = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M4.7 10.3a.75.75 0 0 1 0-1.06l2.95-2.95a.5.5 0 0 1 .7 0l2.95 2.95a.75.75 0 1 1-1.06 1.06L8 7.81 5.76 10.3a.75.75 0 0 1-1.06 0z"/></svg>`

export function ensureFilterStylesheet(): void {
  if (document.getElementById(FILTER_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = FILTER_STYLE_ID
  style.textContent = FILTER_STYLE_TEXT
  ;(document.head ?? document.documentElement).append(style)
}

export function removeFilterStylesheet(): void {
  document.getElementById(FILTER_STYLE_ID)?.remove()
}

/** @deprecated */
export const ensureHideStylesheet = ensureFilterStylesheet
/** @deprecated */
export const removeHideStylesheet = removeFilterStylesheet

export function setArticleHidden(article: HTMLElement, hidden: boolean): void {
  const cell = timelineCellForArticle(article)
  if (hidden) {
    cell.dataset.attentionxHidden = 'true'
    if (cell !== article) delete article.dataset.attentionxHidden
  } else {
    delete cell.dataset.attentionxHidden
    delete article.dataset.attentionxHidden
  }
}

export function clearArticleHide(article: HTMLElement): void {
  setArticleHidden(article, false)
}

export function clearAllHidden(): void {
  const restored: HTMLElement[] = []
  for (const el of document.querySelectorAll<HTMLElement>(
    '[data-attentionx-hidden]',
  )) {
    delete el.dataset.attentionxHidden
    restored.push(el)
  }
  if (restored.length === 0) return

  // display:none collapses X's virtualized timeline. After restoring, those
  // rows often sit above the viewport — bring the first one back into view.
  requestAnimationFrame(() => {
    const target = restored.find((el) => el.isConnected)
    if (!target) return
    const rect = target.getBoundingClientRect()
    if (rect.bottom > 0 && rect.top < window.innerHeight) return
    target.scrollIntoView({ block: 'center', behavior: 'auto' })
  })
}

const expandedArticles = new WeakSet<HTMLElement>()
/** Articles currently under a collapse filter (eligible for chevron when expanded). */
const collapseEligibleArticles = new WeakSet<HTMLElement>()

export interface CollapseBarModel {
  displayName: string
  handle?: string
  /** Omitted for neutral / no-evidence — do not show "No trust evidence". */
  trustLabel?: string
  tone: TrustTone
}

export function isArticleCollapseExpanded(article: HTMLElement): boolean {
  return expandedArticles.has(article)
}

export function clearArticleCollapse(article: HTMLElement): void {
  const cell = timelineCellForArticle(article)
  delete cell.dataset.attentionxCollapsed
  cell.querySelector('[data-attentionx-collapse-bar]')?.remove()
  article.querySelector(`[${COLLAPSE_CHEVRON_ATTR}]`)?.remove()
  expandedArticles.delete(article)
  collapseEligibleArticles.delete(article)
}

export function clearAllCollapsed(): void {
  for (const bar of document.querySelectorAll('[data-attentionx-collapse-bar]')) {
    bar.remove()
  }
  for (const chevron of document.querySelectorAll(`[${COLLAPSE_CHEVRON_ATTR}]`)) {
    chevron.remove()
  }
  for (const el of document.querySelectorAll<HTMLElement>(
    '[data-attentionx-collapsed]',
  )) {
    delete el.dataset.attentionxCollapsed
  }
}

export function clearAllFilters(): void {
  clearAllHidden()
  clearAllCollapsed()
  removeFilterStylesheet()
}

function trustColor(tone: TrustTone): string | undefined {
  if (tone === 'neutral') return undefined
  return TONE_COLORS[tone]
}

/**
 * Clone X's verified / affiliation badge from the post author row, if present
 * (blue check, gold business, gray government, etc.).
 * Bakes the live computed color onto the clone so `currentColor` fills still
 * render correctly outside X's stylesheet (collapse bar, trust dialog).
 */
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

function findAuthorChipHost(article: HTMLElement): HTMLElement | undefined {
  return (
    article.querySelector<HTMLElement>('[data-attentionx-chip="author"]') ??
    article.querySelector<HTMLElement>('[data-attentionx-chip]') ??
    undefined
  )
}

function syncCollapseChevron(
  article: HTMLElement,
  expanded: boolean,
  onCollapse: () => void,
): void {
  const existing = article.querySelector<HTMLButtonElement>(
    `[${COLLAPSE_CHEVRON_ATTR}]`,
  )
  if (!expanded) {
    existing?.remove()
    return
  }

  const chip = findAuthorChipHost(article)
  if (!chip) {
    existing?.remove()
    return
  }

  let chevron = existing
  if (!chevron) {
    chevron = document.createElement('button')
    chevron.type = 'button'
    chevron.setAttribute(COLLAPSE_CHEVRON_ATTR, 'true')
    chevron.innerHTML = CHEVRON_UP_SVG
  }
  chevron.title = t('content.filter.collapse')
  chevron.setAttribute('aria-label', t('content.filter.collapse'))
  chevron.onclick = (event) => {
    event.preventDefault()
    event.stopPropagation()
    onCollapse()
  }
  if (
    chevron.parentElement !== chip.parentElement ||
    chevron.previousSibling !== chip
  ) {
    chip.after(chevron)
  }
}

function ensureCollapseBar(
  article: HTMLElement,
  model: CollapseBarModel,
  onExpand: () => void,
): void {
  const cell = timelineCellForArticle(article)
  let bar = cell.querySelector<HTMLElement>('[data-attentionx-collapse-bar]')
  if (!bar) {
    bar = document.createElement('div')
    bar.dataset.attentionxCollapseBar = 'true'
    bar.setAttribute('role', 'button')
    bar.tabIndex = 0
    const identity = document.createElement('span')
    identity.className = 'ax-collapse-identity'
    const displayName = document.createElement('span')
    displayName.className = 'ax-collapse-display-name'
    const verified = document.createElement('span')
    verified.className = 'ax-collapse-verified'
    const handle = document.createElement('span')
    handle.className = 'ax-collapse-handle'
    identity.append(displayName, verified, handle)
    const trust = document.createElement('span')
    trust.className = 'ax-collapse-trust'
    const spacer = document.createElement('span')
    spacer.className = 'ax-collapse-spacer'
    bar.append(identity, trust, spacer)
    cell.insertBefore(bar, cell.firstChild)
  }

  const displayNameEl = bar.querySelector<HTMLElement>(
    '.ax-collapse-display-name',
  )
  const handleEl = bar.querySelector<HTMLElement>('.ax-collapse-handle')
  const verifiedEl = bar.querySelector<HTMLElement>('.ax-collapse-verified')
  const trustEl = bar.querySelector<HTMLElement>('.ax-collapse-trust')

  if (displayNameEl) {
    displayNameEl.textContent = model.displayName
    if (model.tone !== 'neutral') {
      ensureSignalStylesheet()
      bar.dataset.attentionxAuthorTone = model.tone
      displayNameEl.dataset.attentionxDisplayName = 'true'
    } else {
      delete bar.dataset.attentionxAuthorTone
      delete displayNameEl.dataset.attentionxDisplayName
    }
  }
  if (handleEl) {
    handleEl.textContent = model.handle ?? ''
  }
  if (verifiedEl) {
    verifiedEl.replaceChildren()
    const badge = cloneAuthorVerifiedBadge(article)
    if (badge) verifiedEl.append(badge)
  }
  if (trustEl) {
    trustEl.textContent = model.trustLabel ?? ''
    const color = model.trustLabel ? trustColor(model.tone) : undefined
    trustEl.style.color = color ?? ''
  }

  const ariaParts = [
    model.displayName,
    model.handle,
    model.trustLabel,
    t('content.filter.expand'),
  ].filter(Boolean)
  bar.setAttribute('aria-label', ariaParts.join('. '))
  bar.onclick = (event) => {
    event.preventDefault()
    event.stopPropagation()
    onExpand()
  }
  bar.onkeydown = (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    event.stopPropagation()
    onExpand()
  }
}

export function applyArticleFilter(options: {
  article: HTMLElement
  filters: TrustFilters
  author?: TrustSummary
  post?: TrustSummary
  displayName: string
  handle?: string
}): TimelineFilterMode {
  ensureFilterStylesheet()
  const promoted = isPromotedArticle(options.article)
  const resolved = resolveTimelineFilter({
    filters: options.filters,
    authorResolution: options.author?.resolution,
    postResolution: options.post?.resolution,
    promoted,
  })

  const cell = timelineCellForArticle(options.article)

  if (resolved.mode === 'hide') {
    clearArticleCollapse(options.article)
    setArticleHidden(options.article, true)
    return 'hide'
  }

  setArticleHidden(options.article, false)

  if (resolved.mode === 'collapse') {
    collapseEligibleArticles.add(options.article)
    const summary =
      resolved.basis === 'post' ? options.post : options.author
    const trustLabel = summary
      ? formatTrustScore(summary, { text: true, degree: true })
      : undefined
    const tone = summary?.tone ?? 'neutral'
    const handle = options.handle
      ? options.handle.startsWith('@')
        ? options.handle
        : `@${options.handle}`
      : undefined

    const syncBar = () => {
      const expanded = expandedArticles.has(options.article)
      cell.dataset.attentionxCollapsed = expanded ? 'false' : 'true'
      ensureCollapseBar(
        options.article,
        {
          displayName: options.displayName || handle || '',
          ...(handle ? { handle } : {}),
          ...(trustLabel ? { trustLabel } : {}),
          tone,
        },
        () => {
          expandedArticles.add(options.article)
          syncBar()
        },
      )
      syncCollapseChevron(options.article, expanded, () => {
        expandedArticles.delete(options.article)
        syncBar()
      })
    }
    syncBar()
    return 'collapse'
  }

  clearArticleCollapse(options.article)
  return 'none'
}
