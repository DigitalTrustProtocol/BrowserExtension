import {
  PROOF_CAPTURE_SOURCE,
  PROOF_CAPTURE_VERSION,
  parseProofCaptureHostMessage,
  type ProofCapturePageMessage,
} from '../page-world/proof-capture'
import { ensurePageWorldContentPort } from './page-world-port'

export interface ProofCaptureBridge {
  enable(expectedProofText: string, expectedHandle?: string): void
  disable(): void
  stop(): void
}

export interface ProofCaptureBridgeOptions {
  targetWindow?: Window
  onCaptured(postId: string, meta?: { handle?: string; twitterId?: string }): void
  onError?(error: unknown): void
  subscribeInbound?: (handler: (data: unknown) => void) => () => void
  postToPage?: (data: unknown) => void
}

export function startProofCaptureBridge(
  options: ProofCaptureBridgeOptions,
): ProofCaptureBridge {
  const target = options.targetWindow ?? window
  const port = ensurePageWorldContentPort(target)
  const subscribe = options.subscribeInbound ?? port.subscribe.bind(port)
  const post = options.postToPage ?? port.post.bind(port)
  let stopped = false

  const onMessage = (data: unknown): void => {
    if (stopped) return
    const message = parseProofCaptureHostMessage(data)
    if (!message) return
    try {
      options.onCaptured(message.postId, {
        ...(message.handle ? { handle: message.handle } : {}),
        ...(message.twitterId ? { twitterId: message.twitterId } : {}),
      })
    } catch (error) {
      options.onError?.(error)
    }
  }

  const unsubscribe = subscribe(onMessage)

  return {
    enable(expectedProofText, expectedHandle) {
      if (stopped) return
      const message: ProofCapturePageMessage = {
        source: PROOF_CAPTURE_SOURCE,
        version: PROOF_CAPTURE_VERSION,
        type: 'enable-proof-capture',
        expectedProofText,
        ...(expectedHandle ? { expectedHandle } : {}),
      }
      post(message)
    },
    disable() {
      if (stopped) return
      const message: ProofCapturePageMessage = {
        source: PROOF_CAPTURE_SOURCE,
        version: PROOF_CAPTURE_VERSION,
        type: 'disable-proof-capture',
      }
      post(message)
    },
    stop() {
      stopped = true
      unsubscribe()
    },
  }
}
