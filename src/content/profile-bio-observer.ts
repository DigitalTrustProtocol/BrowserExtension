/**
 * Passive profile-page bio sighting: when `[data-testid="UserDescription"]`
 * is visible, classify npubs and forward a structured bio candidate — never
 * the raw bio text. Complements GraphQL UserBy / tweet-author observation.
 */

import { BACKGROUND_API_VERSION } from '../shared/contracts'
import {
  classifyBioNpubs,
  type ObservedXBioCandidate,
} from '../shared/observed-x-bio'
import { isXNumericId, normalizeObservedHandle } from '../shared/observed-x-identity'
import {
  detectActiveAccountHandle,
  twitterIdFromDocument,
  twitterIdFromTwidCookie,
} from './active-account'
import { profileHandleFromPathname, identitiesByHandle } from './scanner'
import { sendMessage } from './trust-store'

const MAX_BIO_CHARS = 500
const COALESCE_MS = 400

export interface ProfileBioObserver {
  stop(): void
  /** Force a scan (e.g. after SPA navigation). */
  scan(): void
}

function textFromUserDescription(el: Element): string {
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
  const raw = (innerBreaks > cloneBreaks ? viaInner : viaClone)
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
  return raw.length > MAX_BIO_CHARS ? raw.slice(0, MAX_BIO_CHARS) : raw
}

/**
 * Build a bio candidate from the visible profile UserDescription, if the
 * profile handle and numeric id can be resolved. Raw text is discarded after
 * npub classification.
 */
export function buildProfileBioCandidateFromDocument(
  doc: Document = document,
  locationPathname: string = location.pathname,
  now = Date.now(),
  cookieSource: string = doc.cookie,
): ObservedXBioCandidate | undefined {
  const handle = profileHandleFromPathname(locationPathname)
  if (!handle) return undefined

  const descEl = doc.querySelector('[data-testid="UserDescription"]')
  if (!descEl) return undefined

  const description = textFromUserDescription(descEl)
  // Empty string is a valid “bio seen, no npub” sighting.
  const classified = classifyBioNpubs(description)

  const activeHandle = detectActiveAccountHandle(doc)
  const fromSignedInAccount =
    activeHandle === handle ? twitterIdFromTwidCookie(cookieSource) : undefined
  const fromMap = identitiesByHandle.get(handle)
  const twitterId =
    fromSignedInAccount ??
    (fromMap && isXNumericId(fromMap.twitterId) ? fromMap.twitterId : undefined) ??
    twitterIdFromDocument(doc, handle)
  if (!twitterId || !isXNumericId(twitterId)) return undefined

  const normalizedHandle = normalizeObservedHandle(handle)
  if (!normalizedHandle) return undefined

  return {
    twitterId,
    handle: normalizedHandle,
    npubCount: classified.npubCount,
    ...(classified.npub ? { npub: classified.npub } : {}),
    observedAt: now,
  }
}

export function startProfileBioObserver(
  options: {
    document?: Document
    getPathname?: () => string
    forwardCandidate?: (
      candidate: ObservedXBioCandidate,
    ) => void | Promise<void>
    now?: () => number
  } = {},
): ProfileBioObserver {
  const doc = options.document ?? document
  const getPathname = options.getPathname ?? (() => location.pathname)
  const now = options.now ?? Date.now
  const forward =
    options.forwardCandidate ??
    (async (candidate: ObservedXBioCandidate) => {
      await sendMessage<{ recorded: number; skipped: number }>({
        type: 'REPORT_X_BIO_CANDIDATES',
        version: BACKGROUND_API_VERSION,
        candidates: [candidate],
      })
    })

  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastKey = ''
  let lastPath = ''
  let observer: MutationObserver | undefined

  const scan = (): void => {
    if (stopped) return
    const path = getPathname()
    if (path !== lastPath) {
      lastPath = path
      lastKey = ''
    }
    const candidate = buildProfileBioCandidateFromDocument(doc, path, now())
    if (!candidate) return
    const key = `${candidate.twitterId}:${candidate.npubCount}:${candidate.npub ?? ''}`
    if (key === lastKey) return
    lastKey = key
    void Promise.resolve(forward(candidate)).catch((error: unknown) => {
      console.info('AttentionX profile bio report failed', error)
    })
  }

  const schedule = (): void => {
    if (stopped || timer !== undefined) return
    timer = setTimeout(() => {
      timer = undefined
      scan()
    }, COALESCE_MS)
  }

  observer = new MutationObserver(() => schedule())
  observer.observe(doc.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  })

  // Initial + soft after SPA paint.
  schedule()
  setTimeout(schedule, 800)

  return {
    stop() {
      stopped = true
      observer?.disconnect()
      observer = undefined
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
    },
    scan: schedule,
  }
}
