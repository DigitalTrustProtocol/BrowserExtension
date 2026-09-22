/**
 * Shared DOM read of a visible X bio (saved UserDescription, or the edit
 * textarea when not `savedOnly`). Prepare returns the text to the popup
 * ephemerally. The profile observer classifies npubs and discards the raw
 * string — never IndexedDB.
 */

const MAX_READ_BIO_CHARS = 500

/**
 * Convert a bio DOM node to plain text while keeping line breaks.
 * Textareas use `.value`. For profile HTML, prefer Chromium `innerText` when it
 * exposes more newlines (CSS blocks); otherwise map `<br>` via a clone so
 * formatting survives environments where `innerText` collapses breaks.
 */
export function textFromBioElement(
  el: Element | null | undefined,
): string | undefined {
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

export interface ReadVisibleXBioOptions {
  /**
   * Read only the saved profile description. The Edit profile textarea is a
   * draft and must not count as a save.
   */
  savedOnly?: boolean
}

/** Edit-profile fields. Present while the draft dialog is open on the profile page. */
const EDIT_BIO_FIELD =
  'textarea[name="description"], textarea[data-testid="ProfileDescription"]'

/** Save control inside X's profile edit dialog. */
const PROFILE_EDIT_SAVE_TESTID = 'Profile_Save_Button'

export function profileEditDialogOpen(doc: Document): boolean {
  return doc.querySelector(EDIT_BIO_FIELD) != null
}

/**
 * True when the event is the Save control of the profile edit dialog.
 * Cancel and other profile buttons do not match.
 */
export function isProfileEditSaveTarget(
  target: EventTarget | null,
  doc: Document,
): boolean {
  if (!(target instanceof Element)) return false
  if (!profileEditDialogOpen(doc)) return false
  const button = target.closest('button, [role="button"]')
  if (!(button instanceof Element)) return false
  if (!button.closest('[role="dialog"]')) return false
  return button.getAttribute('data-testid') === PROFILE_EDIT_SAVE_TESTID
}

export type OpenProfileEditResult = 'opened' | 'already-open' | 'not-found'

/**
 * Open X's Edit profile dialog on the signed-in profile. No-op when the
 * draft field is already showing. Does not write the bio.
 */
export function openProfileEditDialog(
  doc: Document = document,
): OpenProfileEditResult {
  if (doc.querySelector(EDIT_BIO_FIELD)) return 'already-open'
  const button = doc.querySelector('[data-testid="editProfileButton"]')
  if (!(button instanceof HTMLElement)) return 'not-found'
  button.click()
  return 'opened'
}

/**
 * Read the visible profile bio from the current x.com document, if present.
 * Returns `undefined` when no bio node is found (caller should treat as unread).
 * Returns `''` when the node exists but is empty.
 * `savedOnly` ignores the edit textarea so a paste is not treated as a save.
 */
export function readVisibleXBioText(
  doc: Document = document,
  options: ReadVisibleXBioOptions = {},
): string | undefined {
  const candidates: Array<Element | null> = options.savedOnly
    ? [doc.querySelector('[data-testid="UserDescription"]')]
    : [
        doc.querySelector('[data-testid="UserDescription"]'),
        doc.querySelector('textarea[name="description"]'),
        doc.querySelector('textarea[data-testid="ProfileDescription"]'),
        doc.querySelector('textarea[aria-label="Bio"]'),
        doc.querySelector('textarea[aria-label="Description"]'),
      ]
  for (const el of candidates) {
    const raw = textFromBioElement(el)
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
