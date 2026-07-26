/**
 * Quiet relay failure logger — persists to IndexedDB instead of console noise.
 */
import { AttentionXRepository } from './repository'
import type { RelayFailureKind } from './types'

let repositoryPromise: Promise<AttentionXRepository> | undefined

function repository(): Promise<AttentionXRepository> {
  if (!repositoryPromise) {
    repositoryPromise = AttentionXRepository.open()
  }
  return repositoryPromise
}

export function isSocketLikeError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : String(error)
  return /websocket|socket|eose|timed out|503|502|504|relay query|network|failed to fetch|handshake/i.test(
    message,
  )
}

export async function logRelayFailure(input: {
  relayUrl: string
  kind: RelayFailureKind
  message: string
}): Promise<void> {
  try {
    const repo = await repository()
    await repo.recordRelayFailure(input)
  } catch {
    // Never let health logging break signing/sync.
  }
}

export async function logRelaySuccess(relayUrl: string): Promise<void> {
  try {
    const repo = await repository()
    await repo.recordRelaySuccess(relayUrl)
  } catch {
    /* ignore */
  }
}

export async function listRelayHealth() {
  try {
    const repo = await repository()
    return await repo.listRelayHealth()
  } catch {
    return []
  }
}

export async function listRelayErrorLog(limit = 50) {
  try {
    const repo = await repository()
    return await repo.listRelayErrorLog(limit)
  } catch {
    return []
  }
}

/** Extract relay URLs mentioned in a pooled query failure, if any. */
export function relayUrlsFromError(
  error: unknown,
  fallbackUrls: readonly string[],
): string[] {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : ''
  const found = fallbackUrls.filter((url) => message.includes(url))
  return found.length > 0 ? found : [...fallbackUrls]
}
