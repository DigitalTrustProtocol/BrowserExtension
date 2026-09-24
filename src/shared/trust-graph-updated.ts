/** Broadcast so content-script trust caches refresh after graph changes. */
export const TRUST_GRAPH_UPDATED_MESSAGE = 'TRUST_GRAPH_UPDATED' as const

/** A kind 32014 write. Person-trust caches must stay put. */
export function isRatingsOnlyGraphUpdate(message: unknown): boolean {
  return (
    typeof message === 'object' &&
    message !== null &&
    'scope' in message &&
    message.scope === 'ratings'
  )
}
