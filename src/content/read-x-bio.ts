/**
 * Ephemeral DOM read of the signed-in user's visible X bio for Update-bio
 * prepare. Never forwarded to IndexedDB — only returned to the service worker
 * for a one-shot popup preview.
 */

const MAX_READ_BIO_CHARS = 500

/**
 * Convert a bio DOM node to plain text while keeping line breaks.
 * Textareas use `.value`. For profile HTML, prefer Chromium `innerText` when it
 * exposes more newlines (CSS blocks); otherwise map `<br>` via a clone so
 * formatting survives environments where `innerText` collapses breaks.
 */
function textFromElement(el: Element | null | undefined): string | undefined {
  if (!el) return undefined
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    return el.value
  }

  const doc = el.ownerDocument
  const clone = el.cloneNode(true) as Element
  for (const br of Array.from(clone.querySelectorAll('br'))) {
    br.replaceWith(doc.createTextNode('\n'))
  }
  const viaClone = clone.textContent ?? ''
  const viaInner =
    el instanceof HTMLElement && typeof el.innerText === 'string'
      ? el.innerText
      : ''
  const cloneBreaks = viaClone.match(/\n/g)?.length ?? 0
  const innerBreaks = viaInner.match(/\n/g)?.length ?? 0
  return innerBreaks > cloneBreaks ? viaInner : viaClone
}

/**
 * Read the visible profile bio from the current x.com document, if present.
 * Returns `undefined` when no bio node is found (caller should treat as unread).
 * Returns `''` when the node exists but is empty.
 */
export function readVisibleXBioText(
  doc: Document = document,
): string | undefined {
  const candidates: Array<Element | null> = [
    doc.querySelector('[data-testid="UserDescription"]'),
    doc.querySelector('textarea[name="description"]'),
    doc.querySelector('textarea[data-testid="ProfileDescription"]'),
    doc.querySelector('textarea[aria-label="Bio"]'),
    doc.querySelector('textarea[aria-label="Description"]'),
  ]
  for (const el of candidates) {
    const raw = textFromElement(el)
    if (raw === undefined) continue
    // Keep blank lines / structure; only normalize CRLF and trailing spaces.
    const normalized = raw.replace(/\r\n/g, '\n').replace(/[ \t]+$/g, '')
    if (normalized.length > MAX_READ_BIO_CHARS) {
      return normalized.slice(0, MAX_READ_BIO_CHARS)
    }
    return normalized
  }
  return undefined
}
