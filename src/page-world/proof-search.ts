import {
  coerceXNumericId,
  normalizeObservedHandle,
} from '../shared/observed-x-identity'
import {
  buildLinkingProofText,
  LINKING_PROOF_PREFIX,
  proofTextMatches,
} from '../shared/proof-composer'

export const PROOF_SEARCH_SOURCE = 'attentionx-proof-search' as const
export const PROOF_SEARCH_VERSION = 1 as const

export type ProofSearchPageMessage =
  | {
      source: typeof PROOF_SEARCH_SOURCE
      version: typeof PROOF_SEARCH_VERSION
      type: 'run-proof-search'
      expectedHandle: string
      /** When set: search `from:handle "npub"` and require that linking proof. */
      expectedNpub?: string
      /**
       * @deprecated Prefer `expectedNpub`. Still accepted as an exact substring
       * filter / quoted search phrase when `expectedNpub` is absent.
       */
      expectedProofText?: string
    }
  | {
      source: typeof PROOF_SEARCH_SOURCE
      version: typeof PROOF_SEARCH_VERSION
      type: 'disable-proof-search'
    }

export type ProofSearchHostMessage =
  | {
      source: typeof PROOF_SEARCH_SOURCE
      version: typeof PROOF_SEARCH_VERSION
      type: 'proof-search-found'
      postId: string
      handle: string
      fullText: string
    }
  | {
      source: typeof PROOF_SEARCH_SOURCE
      version: typeof PROOF_SEARCH_VERSION
      type: 'proof-search-empty'
      handle: string
      reason: string
      query?: string
    }

export interface FoundProofSearchPost {
  postId: string
  handle: string
  fullText: string
}

export interface ProofSearchCriteria {
  expectedHandle: string
  /** Exact linking proof text that must appear in the post body. */
  matchText: string
  /** Quoted phrase used in the X SearchTimeline `rawQuery`. */
  searchPhrase: string
}

/**
 * With npub: `from:handle "npub"` and match the full linking proof.
 * Without: `from:handle "Linking my account to Nostr:"` and pick latest.
 */
export function resolveProofSearchCriteria(input: {
  expectedHandle: string
  expectedNpub?: string
  expectedProofText?: string
}): ProofSearchCriteria | undefined {
  const handle = normalizeObservedHandle(input.expectedHandle)
  if (!handle) return undefined

  if (input.expectedNpub?.trim()) {
    const npub = input.expectedNpub.trim().toLowerCase()
    try {
      return {
        expectedHandle: handle,
        searchPhrase: npub,
        matchText: buildLinkingProofText(npub),
      }
    } catch {
      return undefined
    }
  }

  const proofText = input.expectedProofText?.trim()
  if (proofText) {
    return {
      expectedHandle: handle,
      searchPhrase: proofText,
      matchText: proofText,
    }
  }

  return {
    expectedHandle: handle,
    searchPhrase: LINKING_PROOF_PREFIX,
    matchText: LINKING_PROOF_PREFIX,
  }
}

/** Build the live-search query string X SearchTimeline expects. */
export function buildProofSearchQuery(
  handle: string,
  proofText: string,
): string {
  const normalized = normalizeObservedHandle(handle)
  if (!normalized) throw new Error('Invalid X handle')
  if (!proofText.trim()) throw new Error('Missing proof search phrase')
  return `from:${normalized} "${proofText.trim()}"`
}

export function buildProofSearchQueryFromCriteria(
  criteria: ProofSearchCriteria,
): string {
  return buildProofSearchQuery(criteria.expectedHandle, criteria.searchPhrase)
}

/** @deprecated Prefer silent GraphQL; kept for tests / debugging. */
export function buildProofSearchUrl(handle: string, proofText: string): string {
  const query = buildProofSearchQuery(handle, proofText)
  const url = new URL('https://x.com/search')
  url.searchParams.set('q', query)
  url.searchParams.set('src', 'typed_query')
  url.searchParams.set('f', 'live')
  return url.toString()
}

export function isSearchTimelineOperation(operationName: string): boolean {
  return /^SearchTimeline$/i.test(operationName)
}

/** Prefer the newest post id (X snowflakes increase with time). */
export function pickLatestProofPost(
  matches: FoundProofSearchPost[],
): FoundProofSearchPost | undefined {
  if (matches.length === 0) return undefined
  return matches.reduce((best, current) => {
    try {
      return BigInt(current.postId) > BigInt(best.postId) ? current : best
    } catch {
      return current.postId > best.postId ? current : best
    }
  })
}

/**
 * Find matching proof posts inside a SearchTimeline JSON payload and return
 * the latest. Does not use the rendered DOM.
 */
export function extractProofFromSearchTimeline(
  payload: unknown,
  expectedProofText: string,
  expectedHandle: string,
): FoundProofSearchPost | undefined {
  return extractProofFromSearchTimelineWithCriteria(payload, {
    expectedHandle,
    searchPhrase: expectedProofText,
    matchText: expectedProofText,
  })
}

export function extractProofFromSearchTimelineWithCriteria(
  payload: unknown,
  criteria: ProofSearchCriteria,
): FoundProofSearchPost | undefined {
  const handle = normalizeObservedHandle(criteria.expectedHandle)
  if (!handle || !criteria.matchText.trim()) return undefined

  const matches: FoundProofSearchPost[] = []
  const stack: unknown[] = [payload]
  let visited = 0
  while (stack.length > 0 && visited < 20_000) {
    visited += 1
    const value = stack.pop()
    if (!value || typeof value !== 'object') continue

    if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i -= 1) stack.push(value[i])
      continue
    }

    const record = value as Record<string, unknown>
    const hit = readTweetProof(record, criteria.matchText, handle)
    if (hit) matches.push(hit)

    for (const child of Object.values(record)) {
      if (child && typeof child === 'object') stack.push(child)
    }
  }
  return pickLatestProofPost(matches)
}

function readTweetProof(
  record: Record<string, unknown>,
  expectedProofText: string,
  expectedHandle: string,
): FoundProofSearchPost | undefined {
  const legacy = isRecord(record.legacy) ? record.legacy : undefined
  const fullText =
    (typeof legacy?.full_text === 'string' && legacy.full_text) ||
    (typeof record.full_text === 'string' && record.full_text) ||
    undefined
  if (!fullText || !proofTextMatches(fullText, expectedProofText)) {
    return undefined
  }

  // Search is already scoped with `from:handle`, so do not require GraphQL
  // user/screen_name fields (often missing or under unstable paths).
  const postId =
    coerceXNumericId(record.rest_id) ??
    coerceXNumericId(legacy?.id_str) ??
    coerceXNumericId(record.id_str)
  if (!postId) return undefined

  return { postId, handle: expectedHandle, fullText }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseProofSearchPageMessage(
  value: unknown,
): ProofSearchPageMessage | undefined {
  if (!isRecord(value)) return undefined
  if (
    value.source !== PROOF_SEARCH_SOURCE ||
    value.version !== PROOF_SEARCH_VERSION
  ) {
    return undefined
  }
  if (value.type === 'disable-proof-search') {
    return {
      source: PROOF_SEARCH_SOURCE,
      version: PROOF_SEARCH_VERSION,
      type: 'disable-proof-search',
    }
  }
  if (
    value.type === 'run-proof-search' &&
    typeof value.expectedHandle === 'string'
  ) {
    const expectedNpub =
      typeof value.expectedNpub === 'string' ? value.expectedNpub : undefined
    const expectedProofText =
      typeof value.expectedProofText === 'string'
        ? value.expectedProofText
        : undefined
    if (!expectedNpub && !expectedProofText) {
      // Prefix-only search is allowed (pick latest linking post).
      return {
        source: PROOF_SEARCH_SOURCE,
        version: PROOF_SEARCH_VERSION,
        type: 'run-proof-search',
        expectedHandle: value.expectedHandle,
      }
    }
    return {
      source: PROOF_SEARCH_SOURCE,
      version: PROOF_SEARCH_VERSION,
      type: 'run-proof-search',
      expectedHandle: value.expectedHandle,
      ...(expectedNpub ? { expectedNpub } : {}),
      ...(expectedProofText ? { expectedProofText } : {}),
    }
  }
  return undefined
}

/** Parse page→content proof-search result messages. */
export function parseProofSearchHostMessage(
  value: unknown,
): ProofSearchHostMessage | undefined {
  if (!isRecord(value)) return undefined
  if (
    value.source !== PROOF_SEARCH_SOURCE ||
    value.version !== PROOF_SEARCH_VERSION
  ) {
    return undefined
  }
  if (
    value.type === 'proof-search-found' &&
    typeof value.postId === 'string' &&
    typeof value.handle === 'string' &&
    typeof value.fullText === 'string'
  ) {
    return {
      source: PROOF_SEARCH_SOURCE,
      version: PROOF_SEARCH_VERSION,
      type: 'proof-search-found',
      postId: value.postId,
      handle: value.handle,
      fullText: value.fullText,
    }
  }
  if (
    value.type === 'proof-search-empty' &&
    typeof value.handle === 'string' &&
    typeof value.reason === 'string'
  ) {
    return {
      source: PROOF_SEARCH_SOURCE,
      version: PROOF_SEARCH_VERSION,
      type: 'proof-search-empty',
      handle: value.handle,
      reason: value.reason,
      ...(typeof value.query === 'string' ? { query: value.query } : {}),
    }
  }
  return undefined
}
