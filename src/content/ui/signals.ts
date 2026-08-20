import { t } from '../i18n'
import { findAuthorNameRow, findProfileNameRoot } from '../scanner'
import type { TrustSummary } from '../trust-summary'
import type { TrustTone } from '../types'
import {
  formatTrustScore as formatTrustScoreShared,
  TONE_COLORS,
} from '../../shared/trust-score-format'

export const SIGNAL_STYLE_ID = 'attentionx-signals'

export { TONE_COLORS }

export const CONNECT_TONE_ATTR = 'data-attentionx-connect-tone'

export type TonePattern = 'solid' | 'dashed' | 'double'

/** Colorblind-safe underline / sideline pattern for a non-neutral tone. */
export function patternForTone(
  tone: keyof typeof TONE_COLORS,
): TonePattern {
  switch (tone) {
    case 'trust':
      return 'solid'
    case 'question':
      return 'dashed'
    case 'misleading':
      return 'double'
    default: {
      const _exhaustive: never = tone
      return _exhaustive
    }
  }
}

/**
 * Underline the display-name leaf only (span>span), never the @handle
 * (single span). Driven by tone on article/profile root — do not stamp
 * attributes onto React-managed name nodes (X strips them → flicker).
 * Pattern (solid / dashed / double) is the colorblind channel; color stays.
 */
function displayNameRule(tone: keyof typeof TONE_COLORS): string {
  const leaf =
    'a[href^="/"]:not([href*="/status/"]) span > span:not(:has(span))'
  const connectLeaf =
    '[data-attentionx-connect-tone] > div > div:first-child ' + leaf
  const connectLink =
    '[data-attentionx-connect-tone] > div > div:first-child a[href^="/"]:not([href*="/status/"])'
  const style = patternForTone(tone)
  return `
[data-attentionx-author-tone="${tone}"] [data-testid="User-Name"] ${leaf},
[data-attentionx-author-tone="${tone}"] [data-testid="UserName"] ${leaf},
[data-attentionx-profile-tone="${tone}"] [data-testid="User-Name"] ${leaf},
[data-attentionx-profile-tone="${tone}"] [data-testid="UserName"] ${leaf},
[data-attentionx-connect-tone="${tone}"] ${connectLeaf},
[data-attentionx-connect-tone="${tone}"] ${connectLink} {
  text-decoration: underline;
  text-decoration-style: ${style};
  text-decoration-color: ${TONE_COLORS[tone]};
  text-underline-offset: 3px;
  text-decoration-thickness: 2px;
}`
}

const STYLE_TEXT = (['trust', 'question', 'misleading'] as const)
  .map((tone) => displayNameRule(tone))
  .join('\n')

export function ensureSignalStylesheet(): void {
  if (document.getElementById(SIGNAL_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = SIGNAL_STYLE_ID
  style.textContent = STYLE_TEXT
  ;(document.head ?? document.documentElement).append(style)
}

export function removeSignalStylesheet(): void {
  document.getElementById(SIGNAL_STYLE_ID)?.remove()
}

/**
 * Resolve the author/profile name container without depending on one X markup
 * shape. Accepts an article, a name row, or a profile header root.
 */
function resolveNameScope(scope: ParentNode): HTMLElement {
  if (scope instanceof HTMLElement) {
    // Prefer the tweet name row even when scope is the article — status pages
    // have empty avatar profile links before User-Name in document order.
    const nestedName =
      scope.querySelector<HTMLElement>('[data-testid="User-Name"]') ??
      scope.querySelector<HTMLElement>('[data-testid="UserName"]')
    if (nestedName) return nestedName

    if (
      scope.dataset.testid === 'User-Name' ||
      scope.dataset.testid === 'UserName' ||
      scope.getAttribute('itemprop') === 'author' ||
      scope.getAttribute('itemprop') === 'name'
    ) {
      return scope
    }
    const inArticle = findAuthorNameRow(scope)
    if (inArticle) return inArticle
    if (scope === document.documentElement || scope === document.body) {
      return findProfileNameRoot() ?? scope
    }
    return scope
  }
  return findProfileNameRoot() ?? (document.body as HTMLElement)
}

function isHandleText(text: string): boolean {
  return text.startsWith('@')
}

function isUsableDisplayText(text: string): boolean {
  return Boolean(text) && !isHandleText(text) && text.length <= 80
}

/**
 * The DOM node that renders the visible display name (not the @handle).
 * Prefers an innermost leaf span so underline paints on X's nested name text.
 */
export function findDisplayNameElement(
  scope: ParentNode,
): HTMLElement | undefined {
  const row = resolveNameScope(scope)

  for (const link of row.querySelectorAll<HTMLAnchorElement>(
    'a[href^="/"], a[href*="://"]',
  )) {
    const href = link.getAttribute('href') ?? ''
    if (/\/status\//i.test(href)) continue
    const text = (link.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (!isUsableDisplayText(text)) continue

    // Prefer the leaf text span inside the link (status pages nest deeply).
    for (const span of link.querySelectorAll<HTMLElement>('span')) {
      const spanText = (span.textContent ?? '').replace(/\s+/g, ' ').trim()
      if (spanText !== text) continue
      if (span.querySelector('span')) continue
      return span
    }
    return link
  }

  for (const span of row.querySelectorAll<HTMLElement>('span')) {
    const text = (span.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (!isUsableDisplayText(text)) continue
    if (span.querySelector('span')) continue
    // Skip our own mounts.
    if (
      span.closest(
        '[data-attentionx-chip], [data-attentionx-score], [data-attentionx-author-meta], [data-attentionx-connect-meta], [data-attentionx-collapse-bar]',
      )
    ) {
      continue
    }
    return span
  }

  return undefined
}

/**
 * Reads the visible display name from the author/profile name area.
 * Used by the author trust popup title.
 */
export function readDisplayName(scope: ParentNode): string | undefined {
  const el = findDisplayNameElement(scope)
  return el ? (el.textContent ?? '').replace(/\s+/g, ' ').trim() : undefined
}

export function setAuthorTone(
  article: HTMLElement,
  tone: TrustTone | undefined,
): void {
  if (!tone || tone === 'neutral') {
    if (article.dataset.attentionxAuthorTone !== undefined) {
      delete article.dataset.attentionxAuthorTone
    }
    return
  }
  if (article.dataset.attentionxAuthorTone === tone) return
  ensureSignalStylesheet()
  article.dataset.attentionxAuthorTone = tone
}

export function setPostTone(
  article: HTMLElement,
  tone: TrustTone | undefined,
): void {
  if (!tone || tone === 'neutral') {
    if (article.dataset.attentionxPostTone !== undefined) {
      delete article.dataset.attentionxPostTone
    }
    return
  }
  if (article.dataset.attentionxPostTone === tone) return
  ensureSignalStylesheet()
  article.dataset.attentionxPostTone = tone
}

export function setProfileTone(
  root: HTMLElement,
  tone: TrustTone | undefined,
): void {
  if (!tone || tone === 'neutral') {
    if (root.dataset.attentionxProfileTone !== undefined) {
      delete root.dataset.attentionxProfileTone
    }
    return
  }
  if (root.dataset.attentionxProfileTone === tone) return
  ensureSignalStylesheet()
  root.dataset.attentionxProfileTone = tone
}

/** Connect People suggestion rows: underline display name only (not @handle). */
export function setConnectPeopleTone(
  nameColumn: HTMLElement,
  tone: TrustTone | undefined,
): void {
  if (!tone || tone === 'neutral') {
    if (nameColumn.dataset.attentionxConnectTone !== undefined) {
      delete nameColumn.dataset.attentionxConnectTone
    }
    return
  }
  if (nameColumn.dataset.attentionxConnectTone === tone) return
  ensureSignalStylesheet()
  nameColumn.dataset.attentionxConnectTone = tone
}

export function clearArticleSignals(article: HTMLElement): void {
  delete article.dataset.attentionxAuthorTone
  delete article.dataset.attentionxPostTone
}

/** Reverts every host-page mutation this module can make. */
export function clearAllSignals(): void {
  for (const article of document.querySelectorAll<HTMLElement>(
    'article[data-attentionx-author-tone], article[data-attentionx-post-tone]',
  )) {
    clearArticleSignals(article)
  }
  for (const el of document.querySelectorAll<HTMLElement>(
    '[data-attentionx-profile-tone], [data-attentionx-connect-tone]',
  )) {
    delete el.dataset.attentionxProfileTone
    delete el.dataset.attentionxConnectTone
  }
  removeSignalStylesheet()
}

export function formatTrustScore(
  summary: TrustSummary,
  parts: { text?: boolean; degree?: boolean } = { text: true, degree: true },
): string | undefined {
  return formatTrustScoreShared(summary, t, parts)
}
