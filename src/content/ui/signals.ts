import type { TrustTone } from '../types'

export const SIGNAL_STYLE_ID = 'attentionx-signals'

export const TONE_COLORS: Record<Exclude<TrustTone, 'neutral'>, string> = {
  trust: '#00a36c',
  question: '#d49b16',
  misleading: '#e5484d',
}

function underlineRule(tone: keyof typeof TONE_COLORS): string {
  return `
article[data-attentionx-author-tone="${tone}"] [data-testid="User-Name"] a[href^="/"] {
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
  .flatMap((tone) => [underlineRule(tone), frameRule(tone)])
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

export function setAuthorTone(
  article: HTMLElement,
  tone: TrustTone | undefined,
): void {
  if (!tone || tone === 'neutral') {
    delete article.dataset.attentionxAuthorTone
    return
  }
  article.dataset.attentionxAuthorTone = tone
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
  removeSignalStylesheet()
}
