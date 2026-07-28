import i18n from 'i18next'
import type { TrustSummary } from '../trust-summary'
import type { TrustTone } from '../types'

export const SIGNAL_STYLE_ID = 'attentionx-signals'

export const TONE_COLORS: Record<Exclude<TrustTone, 'neutral'>, string> = {
  trust: '#00a36c',
  question: '#d49b16',
  misleading: '#e5484d',
}

function displayNameRule(tone: keyof typeof TONE_COLORS): string {
  // Only the display-name mark is underlined — never the @handle link.
  return `
[data-attentionx-author-tone="${tone}"] [data-attentionx-display-name],
[data-attentionx-profile-tone="${tone}"] [data-attentionx-display-name] {
  text-decoration: underline;
  text-decoration-color: ${TONE_COLORS[tone]};
  text-underline-offset: 3px;
  text-decoration-thickness: 2px;
}`
}

function frameRule(tone: keyof typeof TONE_COLORS): string {
  // Inset shadow keeps the frame inside the existing box: no reflow.
  return `
article[data-attentionx-post-tone="${tone}"] {
  box-shadow: inset 3px 0 0 ${TONE_COLORS[tone]};
}`
}

const STYLE_TEXT = (['trust', 'question', 'misleading'] as const)
  .flatMap((tone) => [displayNameRule(tone), frameRule(tone)])
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

function clearDisplayNameMarks(root: ParentNode): void {
  for (const el of root.querySelectorAll<HTMLElement>(
    '[data-attentionx-display-name]',
  )) {
    delete el.dataset.attentionxDisplayName
  }
}

function userNameRow(scope: ParentNode): HTMLElement | undefined {
  return (
    scope.querySelector<HTMLElement>('[data-testid="User-Name"]') ??
    scope.querySelector<HTMLElement>('[data-testid="UserName"]') ??
    (scope instanceof HTMLElement &&
    (scope.dataset.testid === 'User-Name' || scope.dataset.testid === 'UserName')
      ? scope
      : undefined)
  )
}

/**
 * Reads the visible display name from a User-Name row (not the @handle).
 * Used by ambient marks and the author trust popup title.
 */
export function readDisplayName(scope: ParentNode): string | undefined {
  const row = userNameRow(scope) ?? (scope as HTMLElement)

  for (const link of row.querySelectorAll<HTMLAnchorElement>('a[href^="/"]')) {
    const href = link.getAttribute('href') ?? ''
    if (/\/status\//i.test(href)) continue
    const text = (link.textContent ?? '').trim()
    if (!text || text.startsWith('@')) continue
    return text
  }

  for (const span of row.querySelectorAll<HTMLElement>('span')) {
    const text = (span.textContent ?? '').trim()
    if (!text || text.startsWith('@')) continue
    if (span.querySelector('span')) continue
    if (text.length > 80) continue
    return text
  }

  return undefined
}

/**
 * Marks the display name so ambient underline never paints the @handle.
 * Profile headers often use plain spans instead of links.
 */
export function markDisplayName(
  scope: ParentNode,
  tone: TrustTone | undefined,
): void {
  clearDisplayNameMarks(scope)
  if (!tone || tone === 'neutral') return

  const row = userNameRow(scope) ?? (scope as HTMLElement)

  for (const link of row.querySelectorAll<HTMLAnchorElement>('a[href^="/"]')) {
    const href = link.getAttribute('href') ?? ''
    if (/\/status\//i.test(href)) continue
    const text = (link.textContent ?? '').trim()
    if (!text || text.startsWith('@')) continue
    link.dataset.attentionxDisplayName = 'true'
    return
  }

  // Profile page: display name is often a span, with @handle in a sibling.
  for (const span of row.querySelectorAll<HTMLElement>('span')) {
    const text = (span.textContent ?? '').trim()
    if (!text || text.startsWith('@')) continue
    if (span.querySelector('span')) continue // prefer leaf-ish name nodes
    // Skip tiny decorative nodes
    if (text.length > 80) continue
    span.dataset.attentionxDisplayName = 'true'
    return
  }
}

export function setAuthorTone(
  article: HTMLElement,
  tone: TrustTone | undefined,
): void {
  if (!tone || tone === 'neutral') {
    delete article.dataset.attentionxAuthorTone
    clearDisplayNameMarks(article)
    return
  }
  article.dataset.attentionxAuthorTone = tone
  markDisplayName(article, tone)
}

export function setPostTone(
  article: HTMLElement,
  tone: TrustTone | undefined,
): void {
  if (!tone || tone === 'neutral') {
    delete article.dataset.attentionxPostTone
    return
  }
  article.dataset.attentionxPostTone = tone
}

export function setProfileTone(
  root: HTMLElement,
  tone: TrustTone | undefined,
): void {
  if (!tone || tone === 'neutral') {
    delete root.dataset.attentionxProfileTone
    clearDisplayNameMarks(root)
    return
  }
  root.dataset.attentionxProfileTone = tone
  markDisplayName(root, tone)
}

export function clearArticleSignals(article: HTMLElement): void {
  delete article.dataset.attentionxAuthorTone
  delete article.dataset.attentionxPostTone
  clearDisplayNameMarks(article)
}

/** Reverts every host-page mutation this module can make. */
export function clearAllSignals(): void {
  for (const article of document.querySelectorAll<HTMLElement>(
    'article[data-attentionx-author-tone], article[data-attentionx-post-tone]',
  )) {
    clearArticleSignals(article)
  }
  for (const el of document.querySelectorAll<HTMLElement>(
    '[data-attentionx-profile-tone]',
  )) {
    delete el.dataset.attentionxProfileTone
    clearDisplayNameMarks(el)
  }
  removeSignalStylesheet()
}

export function formatTrustScore(summary: TrustSummary): string | undefined {
  if (summary.resolution === 'none') return undefined

  if (summary.degree === 0) {
    if (summary.direct === 1 || summary.resolution === 'trusted') {
      return i18n.t('content.card.trustedByYou')
    }
    if (summary.direct === -1 || summary.resolution === 'distrusted') {
      return i18n.t('content.card.distrustedByYou')
    }
  }

  const label =
    summary.resolution === 'trusted'
      ? i18n.t('content.resolution.trusted')
      : summary.resolution === 'distrusted'
        ? i18n.t('content.resolution.distrusted')
        : summary.resolution === 'mixed'
          ? i18n.t('content.resolution.mixed')
          : undefined
  if (!label) return undefined
  if (summary.degree !== undefined) return `${label} · ${summary.degree}°`
  if (summary.trustCount > 0 || summary.distrustCount > 0) {
    return `${label} · +${summary.trustCount}/−${summary.distrustCount}`
  }
  return label
}
