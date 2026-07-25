export const NIP39_EVENT_KIND = 10011

export function normalizeTwitterHandle(handle: string): string {
  return handle.replace(/^@/, '').toLowerCase()
}

export function isTwitterNumericId(value: string): boolean {
  return /^\d+$/.test(value)
}

export function parseTwitterIdFromAuthorMeta(
  authorIdentifier?: string,
): string | undefined {
  if (!authorIdentifier || !isTwitterNumericId(authorIdentifier)) {
    return undefined
  }

  return authorIdentifier
}

export function canonicalTwitterProfileUrl(options: {
  handle?: string
  twitterId?: string
}): string {
  if (options.twitterId && isTwitterNumericId(options.twitterId)) {
    return `https://x.com/i/user/${options.twitterId}`
  }

  if (options.handle) {
    return `https://x.com/${normalizeTwitterHandle(options.handle)}`
  }

  throw new Error('Twitter profile requires handle or twitterId')
}

export function canonicalTwitterProfileId(options: {
  handle?: string
  twitterId?: string
}): string {
  if (options.twitterId && isTwitterNumericId(options.twitterId)) {
    return options.twitterId
  }

  if (options.handle) {
    return normalizeTwitterHandle(options.handle)
  }

  throw new Error('Twitter profile requires handle or twitterId')
}

export function buildNip39TwitterLinkTags(
  handle: string,
  twitterId: string,
  proofTweetId: string,
): string[][] {
  const normalizedHandle = normalizeTwitterHandle(handle)
  if (!isTwitterNumericId(twitterId)) {
    throw new Error('twitterId must be a numeric X user ID')
  }

  return [
    ['i', `twitter:${normalizedHandle}`, proofTweetId],
    ['i', `twitter_id:${twitterId}`, proofTweetId],
  ]
}
