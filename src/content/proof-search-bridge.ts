import {
  PROOF_SEARCH_SOURCE,
  PROOF_SEARCH_VERSION,
  parseProofSearchHostMessage,
  type ProofSearchPageMessage,
} from '../page-world/proof-search'
import { normalizeObservedHandle } from '../shared/observed-x-identity'

export interface ProofSearchMatch {
  postId: string
  handle: string
  fullText: string
}

export interface ProofSearchBridge {
  /**
   * Ask page-world to run an authenticated SearchTimeline GraphQL query
   * (no navigation / no DOM scrape).
   *
   * With `expectedNpub`: search `from:handle "npub"` and require that linking proof.
   * Without: search `from:handle "Linking my account to Nostr:"` and pick latest.
   */
  search(input: {
    expectedHandle: string
    expectedNpub?: string
    expectedProofText?: string
    timeoutMs?: number
  }): Promise<ProofSearchMatch | undefined>
  stop(): void
}

export function startProofSearchBridge(
  targetWindow: Window = window,
): ProofSearchBridge {
  let stopped = false

  return {
    search({
      expectedHandle,
      expectedNpub,
      expectedProofText,
      timeoutMs = 12_000,
    }) {
      if (stopped) return Promise.resolve(undefined)
      const handle = normalizeObservedHandle(expectedHandle)
      if (!handle) return Promise.resolve(undefined)

      return new Promise((resolve) => {
        let settled = false
        const finish = (match?: ProofSearchMatch) => {
          if (settled) return
          settled = true
          targetWindow.clearTimeout(timer)
          targetWindow.removeEventListener('message', onMessage)
          resolve(match)
        }

        const onMessage = (event: MessageEvent<unknown>) => {
          if (stopped || event.source !== targetWindow) return
          const message = parseProofSearchHostMessage(event.data)
          if (!message) return
          if (message.handle !== handle) return
          if (message.type === 'proof-search-found') {
            finish({
              postId: message.postId,
              handle: message.handle,
              fullText: message.fullText,
            })
            return
          }
          // proof-search-empty — finish immediately (no 12s wait)
          finish(undefined)
        }

        targetWindow.addEventListener('message', onMessage)
        const run: ProofSearchPageMessage = {
          source: PROOF_SEARCH_SOURCE,
          version: PROOF_SEARCH_VERSION,
          type: 'run-proof-search',
          expectedHandle: handle,
          ...(expectedNpub?.trim()
            ? { expectedNpub: expectedNpub.trim() }
            : {}),
          ...(expectedProofText?.trim()
            ? { expectedProofText: expectedProofText.trim() }
            : {}),
        }
        targetWindow.postMessage(run, targetWindow.location.origin)
        const timer = targetWindow.setTimeout(
          () => finish(undefined),
          timeoutMs,
        )
      })
    },
    stop() {
      stopped = true
    },
  }
}
