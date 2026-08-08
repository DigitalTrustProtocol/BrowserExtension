/**
 * Normalized X post display chrome for trust-gated `xPosts` rows.
 * Role classification uses allowlisted GraphQL tweet shapes only.
 */

import { coerceXNumericId, isXNumericId } from './observed-x-identity'
import type { XPostRole } from '../storage/types'

export type { XPostRole }

export const X_POST_ROLES: readonly XPostRole[] = [
  'root',
  'reply',
  'quote',
  'repost',
] as const

/** Soft cap aligned with content-script card titles. */
export const X_POST_HEADLINE_MAX = 40
export const MAX_X_POST_CHROME_PER_MESSAGE = 40

export interface XPostChromeInput {
  postId: string
  authorTwitterId?: string
  authorHandle?: string
  headline?: string
  role?: XPostRole
  parentPostId?: string
  observedAt?: number
}

export function isXPostRole(value: unknown): value is XPostRole {
  return (
    value === 'root' ||
    value === 'reply' ||
    value === 'quote' ||
    value === 'repost'
  )
}

/** Collapse whitespace and ellipsize at a word boundary when possible. */
export function capXPostHeadline(
  text: string,
  maxChars = X_POST_HEADLINE_MAX,
): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (!collapsed) return ''
  if (collapsed.length <= maxChars) return collapsed
  const slice = collapsed.slice(0, Math.max(1, maxChars - 1))
  const space = slice.lastIndexOf(' ')
  const base =
    space > Math.floor(maxChars * 0.45) ? slice.slice(0, space) : slice
  return `${base}…`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeHandle(handle: string | undefined): string | undefined {
  if (!handle) return undefined
  const normalized = handle.trim().replace(/^@/, '').toLowerCase()
  return normalized.length > 0 && normalized.length <= 64 ? normalized : undefined
}

/**
 * Classify a GraphQL tweet result (unwrapped Tweet / TweetWithVisibilityResults).
 * Prefer reply over quote over repost when multiple markers exist.
 * Order: repost → reply → quote → root.
 */
export function classifyXPostRole(tweet: Record<string, unknown>): {
  role: XPostRole
  parentPostId?: string
} {
  const legacy = isRecord(tweet.legacy) ? tweet.legacy : undefined

  const retweeted =
    isRecord(tweet.retweeted_status_result) ||
    isRecord(legacy?.retweeted_status_result) ||
    isRecord(legacy?.retweeted_status)
  if (retweeted) {
    const parent =
      coerceXNumericId(
        readNestedRestId(tweet.retweeted_status_result) ??
          readNestedRestId(legacy?.retweeted_status_result) ??
          (isRecord(legacy?.retweeted_status)
            ? legacy.retweeted_status.id_str
            : undefined),
      ) ?? coerceXNumericId(legacy?.retweeted_status_id_str)
    return {
      role: 'repost',
      ...(parent ? { parentPostId: parent } : {}),
    }
  }

  const replyParent =
    coerceXNumericId(legacy?.in_reply_to_status_id_str) ??
    coerceXNumericId(tweet.in_reply_to_status_id_str)
  if (replyParent) {
    return { role: 'reply', parentPostId: replyParent }
  }

  const quoted =
    isRecord(tweet.quoted_status_result) ||
    isRecord(legacy?.quoted_status_result) ||
    isRecord(legacy?.quoted_status) ||
    Boolean(legacy?.is_quote_status)
  if (quoted) {
    const parent =
      coerceXNumericId(
        readNestedRestId(tweet.quoted_status_result) ??
          readNestedRestId(legacy?.quoted_status_result) ??
          (isRecord(legacy?.quoted_status)
            ? legacy.quoted_status.id_str
            : undefined),
      ) ?? coerceXNumericId(legacy?.quoted_status_id_str)
    return {
      role: 'quote',
      ...(parent ? { parentPostId: parent } : {}),
    }
  }

  return { role: 'root' }
}

function readNestedRestId(container: unknown): unknown {
  if (!isRecord(container)) return undefined
  const result = isRecord(container.result) ? container.result : container
  if (result.__typename === 'TweetWithVisibilityResults' && isRecord(result.tweet)) {
    return result.tweet.rest_id
  }
  return result.rest_id
}

/** Extract post chrome fields from an unwrapped GraphQL tweet record. */
export function extractXPostChromeFromTweet(
  tweet: Record<string, unknown>,
): XPostChromeInput | undefined {
  const postId =
    coerceXNumericId(tweet.rest_id) ??
    coerceXNumericId(isRecord(tweet.legacy) ? tweet.legacy.id_str : undefined)
  if (!postId) return undefined

  const { role, parentPostId } = classifyXPostRole(tweet)
  const author = readAuthorFromTweet(tweet)
  const text = readTweetText(tweet)
  const headline = text ? capXPostHeadline(text) : undefined

  return {
    postId,
    ...(author.twitterId ? { authorTwitterId: author.twitterId } : {}),
    ...(author.handle ? { authorHandle: author.handle } : {}),
    ...(headline ? { headline } : {}),
    role,
    ...(parentPostId ? { parentPostId } : {}),
  }
}

function readAuthorFromTweet(tweet: Record<string, unknown>): {
  twitterId?: string
  handle?: string
} {
  const core = isRecord(tweet.core) ? tweet.core : undefined
  const userResults = isRecord(core?.user_results)
    ? core.user_results
    : isRecord(core?.user_result)
      ? core.user_result
      : undefined
  const user = isRecord(userResults?.result) ? userResults.result : undefined
  if (!user) return {}
  const legacy = isRecord(user.legacy) ? user.legacy : undefined
  const userCore = isRecord(user.core) ? user.core : undefined
  const handle = normalizeHandle(
    (typeof legacy?.screen_name === 'string' && legacy.screen_name) ||
      (typeof userCore?.screen_name === 'string' && userCore.screen_name) ||
      undefined,
  )
  return {
    twitterId: coerceXNumericId(user.rest_id),
    ...(handle ? { handle } : {}),
  }
}

/** Read full tweet text from GraphQL tweet shapes (timeline / note_tweet). */
export function readTweetText(tweet: Record<string, unknown>): string | undefined {
  const legacy = isRecord(tweet.legacy) ? tweet.legacy : undefined
  if (typeof legacy?.full_text === 'string' && legacy.full_text.trim()) {
    return legacy.full_text
  }
  if (typeof tweet.full_text === 'string' && tweet.full_text.trim()) {
    return tweet.full_text
  }
  const noteTweet = isRecord(tweet.note_tweet) ? tweet.note_tweet : undefined
  const noteResults = isRecord(noteTweet?.note_tweet_results)
    ? noteTweet.note_tweet_results
    : undefined
  const noteResult = isRecord(noteResults?.result) ? noteResults.result : undefined
  if (typeof noteResult?.text === 'string' && noteResult.text.trim()) {
    return noteResult.text
  }
  return undefined
}

/** Extract author rest_id + handle from an unwrapped GraphQL tweet. */
export function readTweetAuthor(tweet: Record<string, unknown>): {
  twitterId?: string
  handle?: string
} {
  return readAuthorFromTweet(tweet)
}

/** Sanitize chrome from content/page messages before backend upsert. */
export function sanitizeXPostChromeInput(
  value: unknown,
): XPostChromeInput | undefined {
  if (!isRecord(value)) return undefined
  if (!isXNumericId(value.postId)) return undefined

  const authorTwitterId = coerceXNumericId(value.authorTwitterId)
  const authorHandle = normalizeHandle(
    typeof value.authorHandle === 'string' ? value.authorHandle : undefined,
  )
  let headline: string | undefined
  if (typeof value.headline === 'string') {
    const capped = capXPostHeadline(value.headline)
    if (capped) headline = capped
  }
  const role = isXPostRole(value.role) ? value.role : undefined
  const parentPostId = coerceXNumericId(value.parentPostId)
  const observedAt =
    typeof value.observedAt === 'number' &&
    Number.isSafeInteger(value.observedAt) &&
    value.observedAt > 0
      ? value.observedAt
      : undefined

  return {
    postId: value.postId,
    ...(authorTwitterId ? { authorTwitterId } : {}),
    ...(authorHandle ? { authorHandle } : {}),
    ...(headline ? { headline } : {}),
    ...(role ? { role } : {}),
    ...(parentPostId ? { parentPostId } : {}),
    ...(observedAt !== undefined ? { observedAt } : {}),
  }
}

/** Page-world → content: batch of GraphQL-derived post chrome. */
export const OBSERVED_X_POST_SOURCE = 'attentionx-page-world' as const
export const OBSERVED_X_POST_MESSAGE = 'observed-x-posts' as const
export const OBSERVED_X_POST_VERSION = 1 as const

export interface ObservedXPostMessage {
  source: typeof OBSERVED_X_POST_SOURCE
  type: typeof OBSERVED_X_POST_MESSAGE
  version: typeof OBSERVED_X_POST_VERSION
  posts: XPostChromeInput[]
}

export function createObservedXPostMessage(
  posts: readonly XPostChromeInput[],
): ObservedXPostMessage {
  return {
    source: OBSERVED_X_POST_SOURCE,
    type: OBSERVED_X_POST_MESSAGE,
    version: OBSERVED_X_POST_VERSION,
    posts: [...posts],
  }
}

export function parseObservedXPostMessage(
  value: unknown,
): ObservedXPostMessage | undefined {
  if (!isRecord(value)) return undefined
  if (value.source !== OBSERVED_X_POST_SOURCE) return undefined
  if (value.type !== OBSERVED_X_POST_MESSAGE) return undefined
  if (value.version !== OBSERVED_X_POST_VERSION) return undefined
  if (!Array.isArray(value.posts) || value.posts.length === 0) return undefined
  if (value.posts.length > MAX_X_POST_CHROME_PER_MESSAGE) return undefined
  const posts = value.posts
    .map(sanitizeXPostChromeInput)
    .filter((post): post is XPostChromeInput => Boolean(post))
  if (posts.length === 0) return undefined
  return {
    source: OBSERVED_X_POST_SOURCE,
    type: OBSERVED_X_POST_MESSAGE,
    version: OBSERVED_X_POST_VERSION,
    posts,
  }
}

/** Merge two chrome payloads; prefer newer observedAt and non-empty fields. */
export function mergeXPostChrome(
  previous: XPostChromeInput | undefined,
  next: XPostChromeInput,
): XPostChromeInput {
  if (!previous || previous.postId !== next.postId) return next
  const observedAt = Math.max(
    previous.observedAt ?? 0,
    next.observedAt ?? 0,
  )
  return {
    postId: next.postId,
    authorTwitterId: next.authorTwitterId ?? previous.authorTwitterId,
    authorHandle: next.authorHandle ?? previous.authorHandle,
    headline: next.headline ?? previous.headline,
    role: next.role ?? previous.role,
    parentPostId: next.parentPostId ?? previous.parentPostId,
    ...(observedAt > 0 ? { observedAt } : {}),
  }
}
