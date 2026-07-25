import {
  PROOF_CAPTURE_SOURCE,
  PROOF_CAPTURE_VERSION,
  type ProofCaptureHostMessage,
  type ProofCapturePageMessage,
} from '../page-world/proof-capture'

export interface ProofCaptureBridge {
  enable(expectedProofText: string, expectedHandle?: string): void
  disable(): void
  stop(): void
}

export interface ProofCaptureBridgeOptions {
  targetWindow?: Window
  onCaptured(postId: string, meta?: { handle?: string; twitterId?: string }): void
  onError?(error: unknown): void
}

export function startProofCaptureBridge(
  options: ProofCaptureBridgeOptions,
): ProofCaptureBridge {
  const target = options.targetWindow ?? window
  let stopped = false

  const onMessage = (event: MessageEvent<unknown>): void => {
    if (stopped || event.source !== target) return
    const message = parseProofCaptureHostMessage(event.data)
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

  target.addEventListener('message', onMessage)

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
      target.postMessage(message, target.location.origin)
    },
    disable() {
      if (stopped) return
      const message: ProofCapturePageMessage = {
        source: PROOF_CAPTURE_SOURCE,
        version: PROOF_CAPTURE_VERSION,
        type: 'disable-proof-capture',
      }
      target.postMessage(message, target.location.origin)
    },
    stop() {
      stopped = true
      target.removeEventListener('message', onMessage)
    },
  }
}

function parseProofCaptureHostMessage(
  value: unknown,
): ProofCaptureHostMessage | undefined {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('source' in value) ||
    !('type' in value) ||
    !('version' in value)
  ) {
    return undefined
  }
  const message = value as Partial<ProofCaptureHostMessage>
  if (
    message.source !== PROOF_CAPTURE_SOURCE ||
    message.version !== PROOF_CAPTURE_VERSION ||
    message.type !== 'proof-post-created' ||
    typeof message.postId !== 'string'
  ) {
    return undefined
  }
  return message as ProofCaptureHostMessage
}
