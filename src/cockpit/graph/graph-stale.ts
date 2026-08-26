import { TRUST_GRAPH_UPDATED_MESSAGE } from '../../shared/demo-wot'

/** True for the backend broadcast after statements (or ratings) change. */
export function isTrustGraphUpdatedMessage(message: unknown): boolean {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === TRUST_GRAPH_UPDATED_MESSAGE
  )
}

/**
 * Combine the cockpit parent refresh with this Graph tab's Refresh Graph clicks.
 * Other Graph tabs keep their own local token and stay stale until clicked.
 */
export function graphViewRefreshToken(
  parentRefreshToken: number,
  localRefreshToken: number,
): number {
  return parentRefreshToken + localRefreshToken
}
