export const NIP39_EVENT_KIND = 10011
export const X_TRUST_SCOPE = 'x.com'

export function normalizeTwitterHandle(handle: string): string {
  return handle.replace(/^@/, '').toLowerCase()
}

export function isCanonicalTwitterHandle(value: string): boolean {
  return /^[a-z0-9_]{1,15}$/.test(value)
}

export function isTwitterNumericId(value: string): boolean {
  return /^\d+$/.test(value)
}

function requireTwitterNumericId(value: string, name: string): string {
  if (!isTwitterNumericId(value)) {
    throw new Error(`${name} must contain only decimal digits`)
  }

  return value
}

function requireTwitterHandle(handle: string): string {
  const normalized = normalizeTwitterHandle(handle)
  if (!isCanonicalTwitterHandle(normalized)) {
    throw new Error('Twitter handle must be 1-15 letters, digits, or underscores')
  }

  return normalized
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
  if (options.twitterId !== undefined) {
    return `https://x.com/i/user/${requireTwitterNumericId(options.twitterId, 'twitterId')}`
  }

  if (options.handle) {
    return `https://x.com/${requireTwitterHandle(options.handle)}`
  }

  throw new Error('Twitter profile requires handle or twitterId')
}

export function canonicalTwitterProfileId(options: {
  handle?: string
  twitterId?: string
}): string {
  if (options.twitterId !== undefined) {
    return requireTwitterNumericId(options.twitterId, 'twitterId')
  }

  if (options.handle) {
    return requireTwitterHandle(options.handle)
  }

  throw new Error('Twitter profile requires handle or twitterId')
}

export function canonicalTwitterAccountSubject(twitterId: string): string {
  return `user:id:${requireTwitterNumericId(twitterId, 'twitterId')}`
}

export function canonicalTwitterPostSubject(postId: string): string {
  return `post:id:${requireTwitterNumericId(postId, 'postId')}`
}

export function canonicalTwitterAccountClass(): 'user:id' {
  return 'user:id'
}

export function canonicalTwitterPostClass(): 'post:id' {
  return 'post:id'
}

export function canonicalTwitterPostUrl(postId: string): string {
  return `https://x.com/i/web/status/${requireTwitterNumericId(postId, 'postId')}`
}

export function parseCanonicalTwitterSubject(
  subject: string,
):
  | { type: 'account'; twitterId: string }
  | { type: 'post'; postId: string }
  | undefined {
  const account = /^user:id:(\d+)$/.exec(subject)
  if (account) {
    return { type: 'account', twitterId: account[1] }
  }

  const post = /^post:id:(\d+)$/.exec(subject)
  if (post) {
    return { type: 'post', postId: post[1] }
  }

  return undefined
}

export function buildNip39TwitterLinkTags(
  handle: string,
  twitterId: string,
  proofTweetId: string,
): string[][] {
  const normalizedHandle = requireTwitterHandle(handle)
  requireTwitterNumericId(twitterId, 'twitterId')
  requireTwitterNumericId(proofTweetId, 'proofTweetId')

  return [
    ['i', `twitter:${normalizedHandle}`, proofTweetId],
    ['i', `twitter_id:${twitterId}`, proofTweetId],
  ]
}
