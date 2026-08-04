import {
  MAX_OBSERVATIONS_PER_MESSAGE,
  isXNumericId,
  parseObservedXIdentityMessage,
  type ObservedXIdentity,
} from '../shared/observed-x-identity'
import { ensurePageWorldContentPort } from './page-world-port'

const MAX_PENDING_IDENTITIES = 200

export interface IdentityObservationBatch {
  version: 1
  observations: ObservedXIdentity[]
}

export interface IdentityBridge {
  flush(): void
  stop(): void
}

export interface IdentityBridgeOptions {
  targetWindow?: Window
  batchDelayMs?: number
  now?: () => number
  renderedPostIds?: (observation: ObservedXIdentity) => readonly string[]
  forwardBatch(batch: IdentityObservationBatch): void | Promise<void>
  onForwardError?(error: unknown): void
  /**
   * Test override: receive inbound page messages without the shared MessagePort.
   * Production uses `ensurePageWorldContentPort().subscribe`.
   */
  subscribeInbound?: (handler: (data: unknown) => void) => () => void
}

export function startIdentityBridge(
  options: IdentityBridgeOptions,
): IdentityBridge {
  const target = options.targetWindow ?? window
  const pending = new Map<string, ObservedXIdentity>()
  const delay = Math.max(0, options.batchDelayMs ?? 150)
  const now = options.now ?? Date.now
  const renderedPostIds =
    options.renderedPostIds ??
    ((observation) => findRenderedPostIds(target.document, observation.handle))
  let timer: number | undefined
  let stopped = false

  const flush = (): void => {
    timer = undefined
    if (stopped || pending.size === 0) return

    const observations = [...pending.values()].slice(
      0,
      MAX_OBSERVATIONS_PER_MESSAGE,
    )
    for (const observation of observations) {
      pending.delete(identityKey(observation))
    }

    try {
      const result = options.forwardBatch({ version: 1, observations })
      void Promise.resolve(result).catch((error: unknown) =>
        options.onForwardError?.(error),
      )
    } catch (error) {
      options.onForwardError?.(error)
    }

    if (pending.size > 0) schedule()
  }

  const schedule = (): void => {
    if (timer !== undefined || stopped) return
    timer = target.setTimeout(flush, delay)
  }

  const onInbound = (data: unknown): void => {
    if (stopped) return
    const message = parseObservedXIdentityMessage(data)
    if (!message) return
    const receivedAt = now()
    if (!Number.isSafeInteger(receivedAt) || receivedAt <= 0) return

    for (const observation of message.observations) {
      const key = identityKey(observation)
      const previous = pending.get(key)
      if (!previous && pending.size >= MAX_PENDING_IDENTITIES) continue
      const combinedPostIds = [
        ...new Set([
          ...(previous?.postIds ?? []),
          ...(observation.postIds ?? []),
          ...renderedPostIds(observation),
        ]),
      ].filter(isXNumericId)
      pending.set(key, {
        ...observation,
        observedAt: Math.max(previous?.observedAt ?? 0, receivedAt),
        ...(combinedPostIds.length > 0
          ? { postIds: combinedPostIds.slice(0, 20) }
          : {}),
      })
    }
    schedule()
  }

  const unsubscribe =
    options.subscribeInbound?.(onInbound) ??
    ensurePageWorldContentPort(target).subscribe(onInbound)

  return {
    flush,
    stop(): void {
      stopped = true
      unsubscribe()
      if (timer !== undefined) target.clearTimeout(timer)
      pending.clear()
    },
  }
}

export function findRenderedPostIds(
  document: Document,
  handle: string,
): string[] {
  const normalizedHandle = handle.toLowerCase()
  const postIds = new Set<string>()
  const links = document.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]')

  for (let index = 0; index < Math.min(links.length, 500); index += 1) {
    const href = links[index]?.getAttribute('href')
    if (!href) continue
    const match = href.match(/^\/([^/?#]+)\/status\/(\d{1,24})(?:[/?#]|$)/i)
    if (match?.[1]?.toLowerCase() === normalizedHandle && match[2]) {
      postIds.add(match[2])
      if (postIds.size >= 20) break
    }
  }
  return [...postIds]
}

function identityKey(observation: ObservedXIdentity): string {
  return `${observation.twitterId}:${observation.handle}`
}
