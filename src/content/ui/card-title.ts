/** Soft cap for trust-card titles so the popup layout stays compact. */
export const CARD_TITLE_MAX_CHARS = 40

/** Collapse whitespace and ellipsize at a word boundary when possible. */
export function capCardTitle(
  text: string,
  maxChars = CARD_TITLE_MAX_CHARS,
): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (!collapsed) return ''
  if (collapsed.length <= maxChars) return collapsed
  const slice = collapsed.slice(0, Math.max(1, maxChars - 1))
  const space = slice.lastIndexOf(' ')
  const base =
    space > Math.floor(maxChars * 0.45) ? slice.slice(0, space) : slice
  return `${base}…`
}

function firstWords(text: string, maxWords: number): string {
  return text.split(/\s+/).filter(Boolean).slice(0, maxWords).join(' ')
}

function isAvatarImage(img: Element): boolean {
  return Boolean(
    img.closest(
      '[data-testid^="UserAvatar"], [data-testid="Tweet-User-Avatar"], [data-testid="UserAvatar-Container"]',
    ),
  )
}

/**
 * Headline for a post trust popup: first words of body text, else media
 * alt/name, else a short prefix of the post id.
 */
export function readPostHeadline(
  article: HTMLElement,
  postId?: string,
): string {
  const textNode = article.querySelector<HTMLElement>(
    '[data-testid="tweetText"]',
  )
  const body = (textNode?.innerText ?? textNode?.textContent ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (body) return capCardTitle(firstWords(body, 8))

  for (const img of article.querySelectorAll<HTMLImageElement>('img[alt]')) {
    if (isAvatarImage(img)) continue
    const alt = (img.getAttribute('alt') ?? '').trim()
    if (!alt || /^image$/i.test(alt)) continue
    return capCardTitle(alt)
  }

  for (const el of article.querySelectorAll<HTMLElement>(
    '[data-testid="videoPlayer"], [data-testid="videoComponent"], video',
  )) {
    const label = (
      el.getAttribute('aria-label') ??
      el.getAttribute('title') ??
      ''
    ).trim()
    if (label) return capCardTitle(label)
  }

  for (const el of article.querySelectorAll<HTMLElement>(
    '[data-testid="tweetPhoto"], [data-testid="card.wrapper"]',
  )) {
    const label = (
      el.getAttribute('aria-label') ??
      el.getAttribute('title') ??
      ''
    ).trim()
    if (label) return capCardTitle(label)
  }

  const id = (postId ?? '').trim()
  if (id) return capCardTitle(id, 14)

  return ''
}
