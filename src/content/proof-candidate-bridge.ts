/**
 * Content-side: forward passive GraphQL proof candidates to the service worker.
 */

import { BACKGROUND_API_VERSION } from '../shared/contracts'
import {
  MAX_X_PROOF_CANDIDATES_PER_MESSAGE,
  parseObservedXProofMessage,
  type ObservedXProofCandidate,
} from '../shared/observed-x-proof'
import { ensurePageWorldContentPort } from './page-world-port'
import { sendMessage } from './trust-store'

const MAX_PENDING = 100
const FLUSH_COALESCE_MS = 150

export interface ProofCandidateBridge {
  stop(): void
}

export function startProofCandidateBridge(
  options: {
    subscribeInbound?: (handler: (data: unknown) => void) => () => void
    forwardCandidates?: (
      candidates: ObservedXProofCandidate[],
    ) => void | Promise<void>
  } = {},
): ProofCandidateBridge {
  let stopped = false
  const pending = new Map<string, ObservedXProofCandidate>()
  let flushTimer: ReturnType<typeof setTimeout> | undefined
  let unsubscribePort: (() => void) | undefined

  const forward =
    options.forwardCandidates ??
    (async (candidates: ObservedXProofCandidate[]) => {
      await sendMessage<{ recorded: number; skipped: number }>({
        type: 'REPORT_X_PROOF_CANDIDATES',
        version: BACKGROUND_API_VERSION,
        candidates,
      })
    })

  const flush = (): void => {
    flushTimer = undefined
    if (stopped || pending.size === 0) return
    const batch = [...pending.values()].slice(
      0,
      MAX_X_PROOF_CANDIDATES_PER_MESSAGE,
    )
    for (const item of batch) pending.delete(item.postId)
    try {
      const result = forward(batch)
      void Promise.resolve(result).catch((error: unknown) => {
        console.info('AttentionX proof candidate report failed', error)
      })
    } catch (error) {
      console.info('AttentionX proof candidate report failed', error)
    }
    if (pending.size > 0) scheduleFlush()
  }

  const scheduleFlush = (): void => {
    if (flushTimer !== undefined || stopped) return
    flushTimer = setTimeout(flush, FLUSH_COALESCE_MS)
  }

  const onInbound = (data: unknown): void => {
    if (stopped) return
    const message = parseObservedXProofMessage(data)
    if (!message) return
    for (const candidate of message.candidates) {
      const previous = pending.get(candidate.postId)
      if (!previous && pending.size >= MAX_PENDING) continue
      pending.set(candidate.postId, candidate)
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
