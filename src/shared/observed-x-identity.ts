import {
  isXProfileIconPath,
  normalizeXDisplayName,
  normalizeXProfileIconPath,
} from './x-profile-display'

export const OBSERVED_X_IDENTITY_VERSION = 1 as const
export const OBSERVED_X_IDENTITY_SOURCE = 'attentionx-page-observer' as const
export const OBSERVED_X_IDENTITY_MESSAGE = 'observed-x-identities' as const

export const MAX_OBSERVATIONS_PER_MESSAGE = 50
export const MAX_POST_IDS_PER_OBSERVATION = 20

const HANDLE_PATTERN = /^[a-z0-9_]{1,15}$/
const NUMERIC_ID_PATTERN = /^\d{1,24}$/
const ALLOWED_X_OPERATIONS = [
  /^UserBy(?:ScreenName|RestId)$/,
  /^UsersByRestIds$/,
  // TweetDetail is the conversation/reply endpoint (including cursor pagination).
  /^TweetDetail$/,
  /^TweetResultByRestId$/,
  /^TweetResultsByRestIds$/,
  /^(?:Home|HomeLatest|Search|ListLatestTweets)Timeline$/,
  /^(?:UserTweets|UserTweetsAndReplies)$/,
] as const

export interface ObservedXIdentity {
  twitterId: string
  handle: string
  observedAt: number
  sourceOperation: string
  postIds?: string[]
  /** Public display name from X profile metadata. */
  displayName?: string
  /** pbs.twimg.com profile_images path stem (no size suffix). */
  iconPath?: string
}

export interface ObservedXIdentityMessage {
  source: typeof OBSERVED_X_IDENTITY_SOURCE
  type: typeof OBSERVED_X_IDENTITY_MESSAGE
  version: typeof OBSERVED_X_IDENTITY_VERSION
  observations: ObservedXIdentity[]
}

export function normalizeObservedHandle(value: string): string | undefined {
  const normalized = value.trim().replace(/^@/, '').toLowerCase()
  return HANDLE_PATTERN.test(normalized) ? normalized : undefined
}

export function isXNumericId(value: unknown): value is string {
  return typeof value === 'string' && NUMERIC_ID_PATTERN.test(value)
}

export function coerceXNumericId(value: unknown): string | undefined {
  if (isXNumericId(value)) return value
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    const digits = String(value)
    return isXNumericId(digits) ? digits : undefined
  }
  return undefined
}

export function isAllowedXOperation(operationName: unknown): operationName is string {
  return (
    typeof operationName === 'string' &&
    ALLOWED_X_OPERATIONS.some((pattern) => pattern.test(operationName))
  )
}

export function sanitizeObservedXIdentity(
  value: unknown,
): ObservedXIdentity | undefined {
  if (!isRecord(value)) return undefined

  const observedAt = value.observedAt
  const handle =
    typeof value.handle === 'string'
      ? normalizeObservedHandle(value.handle)
      : undefined
  if (
    !handle ||
    !isXNumericId(value.twitterId) ||
    typeof observedAt !== 'number' ||
    !Number.isSafeInteger(observedAt) ||
    observedAt <= 0 ||
    !isAllowedXOperation(value.sourceOperation)
  ) {
    return undefined
  }

  const displayName =
    typeof value.displayName === 'string'
      ? normalizeXDisplayName(value.displayName)
      : undefined
  let iconPath: string | undefined
  if (typeof value.iconPath === 'string') {
    iconPath = isXProfileIconPath(value.iconPath)
      ? value.iconPath
      : normalizeXProfileIconPath(value.iconPath)
  }

  let postIds: string[] | undefined
  if (value.postIds !== undefined) {
    if (
      !Array.isArray(value.postIds) ||
      value.postIds.length > MAX_POST_IDS_PER_OBSERVATION
    ) {
      return undefined
    }
    postIds = [...new Set(value.postIds.filter(isXNumericId))]
    if (postIds.length !== value.postIds.length) return undefined
  }

  return {
    twitterId: value.twitterId,
    handle,
    observedAt,
    sourceOperation: value.sourceOperation,
    ...(postIds && postIds.length > 0 ? { postIds } : {}),
    ...(displayName ? { displayName } : {}),
    ...(iconPath ? { iconPath } : {}),
  }
}

export function parseObservedXIdentityMessage(
  value: unknown,
): ObservedXIdentityMessage | undefined {
  if (
    !isRecord(value) ||
    value.source !== OBSERVED_X_IDENTITY_SOURCE ||
    value.type !== OBSERVED_X_IDENTITY_MESSAGE ||
    value.version !== OBSERVED_X_IDENTITY_VERSION ||
    !Array.isArray(value.observations) ||
    value.observations.length === 0 ||
    value.observations.length > MAX_OBSERVATIONS_PER_MESSAGE
  ) {
    return undefined
  }

  const observations = value.observations
    .map(sanitizeObservedXIdentity)
    .filter((observation): observation is ObservedXIdentity =>
      Boolean(observation),
    )
  if (observations.length === 0) return undefined

  return {
    source: OBSERVED_X_IDENTITY_SOURCE,
    type: OBSERVED_X_IDENTITY_MESSAGE,
    version: OBSERVED_X_IDENTITY_VERSION,
    observations,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
