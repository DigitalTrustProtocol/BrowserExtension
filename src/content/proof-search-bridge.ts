import {
  PROOF_SEARCH_SOURCE,
  PROOF_SEARCH_VERSION,
  parseProofSearchHostMessage,
  type ProofSearchPageMessage,
} from '../page-world/proof-search'
import { normalizeObservedHandle } from '../shared/observed-x-identity'
import { ensurePageWorldContentPort } from './page-world-port'

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

export interface ProofSearchBridgeOptions {
  targetWindow?: Window
  subscribeInbound?: (handler: (data: unknown) => void) => () => void
  postToPage?: (data: unknown) => void
}

export function startProofSearchBridge(
  options: ProofSearchBridgeOptions = {},
): ProofSearchBridge {
  const target = options.targetWindow ?? window
  const port = ensurePageWorldContentPort(target)
  const subscribe = options.subscribeInbound ?? ((handler) => port.subscribe(handler))
  const post = options.postToPage ?? ((data) => port.post(data))
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
        let unsubscribe: (() => void) | undefined
        const finish = (match?: ProofSearchMatch) => {
          if (settled) return
          settled = true
          target.clearTimeout(timer)
          unsubscribe?.()
          resolve(match)
        }

        const onMessage = (data: unknown) => {
          if (stopped) return
          const message = parseProofSearchHostMessage(data)
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
          finish(undefined)
        }

        unsubscribe = subscribe(onMessage)
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
        post(run)
        const timer = target.setTimeout(() => finish(undefined), timeoutMs)
      })
    },
    stop() {
      stopped = true
    },
  }
}
