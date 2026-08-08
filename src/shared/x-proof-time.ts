/**
 * Parse X tweet `created_at` (GraphQL `legacy.created_at`) to unix ms.
 * Typical value: "Wed Oct 10 20:19:24 +0000 2018". Also accepts ISO strings.
 */
export function parseXTweetCreatedAtMs(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 64) return undefined
  const ms = Date.parse(trimmed)
  if (!Number.isFinite(ms) || !Number.isSafeInteger(ms) || ms <= 0) {
    return undefined
  }
  return ms
}

/** Read creation time from an unwrapped GraphQL tweet record. */
export function readTweetCreatedAtMs(
  tweet: Record<string, unknown>,
): number | undefined {
  const legacy =
    tweet.legacy && typeof tweet.legacy === 'object' && !Array.isArray(tweet.legacy)
      ? (tweet.legacy as Record<string, unknown>)
      : undefined
  return (
    parseXTweetCreatedAtMs(legacy?.created_at) ??
    parseXTweetCreatedAtMs(tweet.created_at)
  )
}

/**
 * True when the candidate proof post is strictly newer than the stored one.
 * Prefer GraphQL `created_at` timestamps; fall back to numeric post id order
 * when a path (oEmbed / id-only) did not supply a date.
 */
export function isNewerProofPost(
  candidate: { postId: string; postedAt?: number },
  stored: { postId: string; postedAt?: number },
): boolean {
  if (
    candidate.postedAt !== undefined &&
    stored.postedAt !== undefined &&
    Number.isSafeInteger(candidate.postedAt) &&
    Number.isSafeInteger(stored.postedAt)
  ) {
    return candidate.postedAt > stored.postedAt
  }
  try {
    return BigInt(candidate.postId) > BigInt(stored.postId)
  } catch {
    return candidate.postId > stored.postId
  }
}
