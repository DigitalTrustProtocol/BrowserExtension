/**
 * Content-side: forward passive GraphQL Bio (primary X) npub candidates to
 * the service worker. Mirrors `proof-candidate-bridge.ts`; only the
 * structured `{ twitterId, handle, npub, postId?, postCreatedAt? }` shape
 * crosses this boundary — never the raw bio text.
 */

import { BACKGROUND_API_VERSION } from '../shared/contracts'
import {
  MAX_X_BIO_CANDIDATES_PER_MESSAGE,
  isPreferredBioCandidate,
  parseObservedXBioMessage,
  type ObservedXBioCandidate,
} from '../shared/observed-x-bio'
import { ensurePageWorldContentPort } from './page-world-port'
import { sendMessage } from './trust-store'

const MAX_PENDING = 100
const FLUSH_COALESCE_MS = 150

export interface BioCandidateBridge {
  stop(): void
}

export function startBioCandidateBridge(
  options: {
    subscribeInbound?: (handler: (data: unknown) => void) => () => void
    forwardCandidates?: (
      candidates: ObservedXBioCandidate[],
    ) => void | Promise<void>
  } = {},
): BioCandidateBridge {
  let stopped = false
  const pending = new Map<string, ObservedXBioCandidate>()
  let flushTimer: ReturnType<typeof setTimeout> | undefined
  let unsubscribePort: (() => void) | undefined

  const forward =
    options.forwardCandidates ??
    (async (candidates: ObservedXBioCandidate[]) => {
      await sendMessage<{ recorded: number; skipped: number }>({
        type: 'REPORT_X_BIO_CANDIDATES',
        version: BACKGROUND_API_VERSION,
        candidates,
      })
    })

  const flush = (): void => {
    flushTimer = undefined
    if (stopped || pending.size === 0) return
    const batch = [...pending.values()].slice(
      0,
      MAX_X_BIO_CANDIDATES_PER_MESSAGE,
    )
    for (const item of batch) pending.delete(item.twitterId)
    try {
      const result = forward(batch)
      void Promise.resolve(result).catch((error: unknown) => {
        console.info('Attention bio candidate report failed', error)
      })
    } catch (error) {
      console.info('Attention bio candidate report failed', error)
    }
    if (pending.size > 0) scheduleFlush()
  }

  const scheduleFlush = (): void => {
    if (flushTimer !== undefined || stopped) return
    flushTimer = setTimeout(flush, FLUSH_COALESCE_MS)
  }

  const onInbound = (data: unknown): void => {
    if (stopped) return
    const message = parseObservedXBioMessage(data)
    if (!message) return
    for (const candidate of message.candidates) {
      const previous = pending.get(candidate.twitterId)
      if (!previous) {
        if (pending.size >= MAX_PENDING) continue
        pending.set(candidate.twitterId, candidate)
        continue
      }
      if (isPreferredBioCandidate(candidate, previous)) {
        pending.set(candidate.twitterId, candidate)
      }
    }
    scheduleFlush()
  }

  unsubscribePort = options.subscribeInbound
    ? options.subscribeInbound(onInbound)
    : ensurePageWorldContentPort().subscribe(onInbound)

  return {
    stop() {
      stopped = true
      unsubscribePort?.()
      unsubscribePort = undefined
      if (flushTimer !== undefined) {
        clearTimeout(flushTimer)
        flushTimer = undefined
      }
      pending.clear()
    },
  }
}
