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
import { isPromotedArticle, timelineCellForArticle } from './ads'
import { formatTrustScore, TONE_COLORS } from './signals'

export { isPromotedArticle, timelineCellForArticle } from './ads'

export const FILTER_STYLE_ID = 'attentionx-timeline-filter'

const FILTER_STYLE_TEXT = `
[data-testid="cellInnerDiv"][data-attentionx-hidden="true"],
article[data-attentionx-hidden="true"] {
  display: none !important;
}
/* X wraps <article> in nested divs — hide all cell content except our bar. */
[data-testid="cellInnerDiv"][data-attentionx-collapsed="true"] > :not([data-attentionx-collapse-bar]) {
  display: none !important;
}
[data-attentionx-collapse-bar] {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  margin: 2px 0;
  border-radius: 8px;
  background: rgba(127, 127, 127, 0.12);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 13px;
  line-height: 1.3;
  color: inherit;
  box-sizing: border-box;
  width: 100%;
}
[data-attentionx-collapse-bar] .ax-collapse-name {
  font-weight: 700;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-attentionx-collapse-bar] .ax-collapse-trust {
  flex: 0 0 auto;
  font-weight: 600;
  opacity: 0.9;
}
[data-attentionx-collapse-bar] .ax-collapse-spacer {
  flex: 1 1 auto;
}
[data-attentionx-collapse-bar] button.ax-collapse-toggle {
  flex: 0 0 auto;
  appearance: none;
  border: 1px solid rgba(127, 127, 127, 0.35);
  background: transparent;
  color: inherit;
  border-radius: 999px;
  padding: 2px 10px;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
[data-attentionx-collapse-bar] button.ax-collapse-toggle:hover {
  background: rgba(127, 127, 127, 0.15);
}
`

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

export interface CollapseBarModel {
  name: string
  trustLabel: string
  tone: TrustTone
}

export function clearArticleCollapse(article: HTMLElement): void {
  const cell = timelineCellForArticle(article)
  delete cell.dataset.attentionxCollapsed
  cell.querySelector('[data-attentionx-collapse-bar]')?.remove()
  expandedArticles.delete(article)
}

export function clearAllCollapsed(): void {
  for (const bar of document.querySelectorAll('[data-attentionx-collapse-bar]')) {
    bar.remove()
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

function ensureCollapseBar(
  article: HTMLElement,
  model: CollapseBarModel,
  onToggle: () => void,
): void {
  const cell = timelineCellForArticle(article)
  let bar = cell.querySelector<HTMLElement>('[data-attentionx-collapse-bar]')
  if (!bar) {
    bar = document.createElement('div')
    bar.dataset.attentionxCollapseBar = 'true'
    const name = document.createElement('span')
    name.className = 'ax-collapse-name'
    const trust = document.createElement('span')
    trust.className = 'ax-collapse-trust'
    const spacer = document.createElement('span')
    spacer.className = 'ax-collapse-spacer'
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'ax-collapse-toggle'
    bar.append(name, trust, spacer, button)
    cell.insertBefore(bar, cell.firstChild)
  }

  const nameEl = bar.querySelector('.ax-collapse-name')
  const trustEl = bar.querySelector<HTMLElement>('.ax-collapse-trust')
  const button = bar.querySelector<HTMLButtonElement>('.ax-collapse-toggle')
  if (nameEl) nameEl.textContent = model.name
  if (trustEl) {
    trustEl.textContent = model.trustLabel
    const color = trustColor(model.tone)
    trustEl.style.color = color ?? ''
  }
  if (button) {
    const expanded = expandedArticles.has(article)
    button.textContent = expanded
      ? t('content.filter.collapse')
      : t('content.filter.expand')
    button.onclick = (event) => {
      event.preventDefault()
      event.stopPropagation()
      onToggle()
    }
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
    const summary =
      resolved.basis === 'post' ? options.post : options.author
    const trustLabel =
      (summary
        ? formatTrustScore(summary, { text: true, degree: true })
        : undefined) ?? t('content.resolution.none')
    const tone = summary?.tone ?? 'neutral'
    const nameParts = [options.displayName, options.handle]
      .filter(Boolean)
      .join(' ')

    const syncBar = () => {
      const expanded = expandedArticles.has(options.article)
      cell.dataset.attentionxCollapsed = expanded ? 'false' : 'true'
      ensureCollapseBar(
        options.article,
        {
          name: nameParts || options.displayName,
          trustLabel,
          tone,
        },
        () => {
          if (expandedArticles.has(options.article)) {
            expandedArticles.delete(options.article)
          } else {
            expandedArticles.add(options.article)
          }
          syncBar()
        },
      )
    }
    syncBar()
    return 'collapse'
  }

  clearArticleCollapse(options.article)
  return 'none'
}
