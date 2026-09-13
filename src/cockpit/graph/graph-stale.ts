import {
  isStateTopicMessage,
  type StateTopic,
} from '../../shared/state-topics'

export const GRAPH_STALE_TOPICS = [
  'trustGraph',
  'viewer',
  'identity',
] as const satisfies readonly StateTopic[]

export const APPLICATION_STALE_TOPICS = [
  'trustGraph',
  'activity',
  'viewer',
  'identity',
  'profileMetadata',
  'appMode',
  'wotMaxDegree',
  'followTrustThreshold',
] as const satisfies readonly StateTopic[]

export function isStaleTopicMessage(
  message: unknown,
  topics: readonly StateTopic[] = GRAPH_STALE_TOPICS,
): boolean {
  return isStateTopicMessage(message, topics)
}

/** True for the backend broadcast after statements (or ratings) change. */
export function isTrustGraphUpdatedMessage(message: unknown): boolean {
  return isStaleTopicMessage(message, ['trustGraph'])
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
