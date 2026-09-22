/**
 * Passive profile-page bio sighting: when `[data-testid="UserDescription"]`
 * is visible, classify npubs and forward a structured bio candidate — never
 * the raw bio text. Saving the profile edit dialog on this same page
 * schedules another look at that saved description (not the draft textarea).
 * Complements GraphQL UserBy / tweet-author observation.
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
import {
  isProfileEditSaveTarget,
  profileEditDialogOpen,
  readVisibleXBioText,
} from './read-x-bio'
import { profileHandleFromPathname, identitiesByHandle } from './scanner'
import { sendMessage } from './trust-store'

const COALESCE_MS = 400
/** Header bio updates after Save returns. A few looks, then stop. */
const SAVE_RESCAN_MS = [400, 1200, 2800]

export interface ProfileBioObserver {
  stop(): void
  /** Force a scan (e.g. after SPA navigation). */
  scan(): void
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

  const description = readVisibleXBioText(doc, { savedOnly: true })
  if (description === undefined) return undefined
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
  let dialogOpen = false
  let saveRescans: ReturnType<typeof setTimeout>[] = []
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
      scanAndDialog()
    }, COALESCE_MS)
  }

  const watchSavedBioAfterEdit = (): void => {
    for (const pending of saveRescans) clearTimeout(pending)
    saveRescans = []
    schedule()
    for (const delay of SAVE_RESCAN_MS) {
      saveRescans.push(
        setTimeout(() => {
          if (!stopped) schedule()
        }, delay),
      )
    }
  }

  const onClick = (event: Event): void => {
    if (!isProfileEditSaveTarget(event.target, doc)) return
    watchSavedBioAfterEdit()
  }

  const scanDialog = (): void => {
    const open = profileEditDialogOpen(doc)
    if (dialogOpen && !open) watchSavedBioAfterEdit()
    dialogOpen = open
  }

  const scanAndDialog = (): void => {
    scanDialog()
    scan()
  }

  observer = new MutationObserver(() => {
    schedule()
  })
  observer.observe(doc.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  })

  doc.addEventListener('click', onClick, true)

  // Initial + soft after SPA paint.
  schedule()
  setTimeout(schedule, 800)

  return {
    stop() {
      stopped = true
      doc.removeEventListener('click', onClick, true)
      observer?.disconnect()
      observer = undefined
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
      for (const pending of saveRescans) clearTimeout(pending)
      saveRescans = []
    },
    scan: scanAndDialog,
  }
}
