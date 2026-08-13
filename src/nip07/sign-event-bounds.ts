/**
 * Kind-aware bounds for NIP-07 `signEvent` (and crypto) inputs.
 *
 * Reject oversized or incomplete unsigned events before they enter the
 * approval queue, activity log, or signer. AttentionX-owned kinds use
 * product/protocol caps; other kinds get generous but finite safety limits.
 */

import { ATTENTIONX_TRUST_CONTENT_UI_LIMIT } from '../shared/trust-content.ts'
import { TRUST_STATEMENT_KIND } from '../shared/kind-32009.ts'
import { RATING_STATEMENT_KIND } from '../shared/kind-32014.ts'

export interface SignEventKindBounds {
  /** Max Unicode code points in `content`. */
  maxContentChars: number
  /** Max number of tags. */
  maxTags: number
  /** Max elements per tag array. */
  maxTagElements: number
  /** Max Unicode code points per tag element string. */
  maxTagElementChars: number
  /** Max UTF-8 bytes of a conservative serialization of the unsigned event. */
  maxSerializedBytes: number
}

/** Absolute ceiling for any kind (relay-adjacent safety). */
export const NIP07_KIND_MAX = 16_777_215

/** Max Unicode code points for nip04/nip44 plaintext or ciphertext. */
export const NIP07_MAX_CRYPTO_PAYLOAD_CHARS = 64_000

/**
 * Default bounds for kinds without a specific profile.
 * Large enough for normal notes/lists; small enough to bound SW memory.
 */
export const NIP07_DEFAULT_SIGN_BOUNDS: SignEventKindBounds = {
  maxContentChars: 64_000,
  maxTags: 2_000,
  maxTagElements: 32,
  maxTagElementChars: 4_096,
  maxSerializedBytes: 96_000,
}

const KIND_BOUNDS: ReadonlyMap<number, SignEventKindBounds> = new Map([
  // Metadata JSON
  [
    0,
    {
      maxContentChars: 64_000,
      maxTags: 64,
      maxTagElements: 8,
      maxTagElementChars: 512,
      maxSerializedBytes: 96_000,
    },
  ],
  // Short text note
  [
    1,
    {
      maxContentChars: 64_000,
      maxTags: 500,
      maxTagElements: 32,
      maxTagElementChars: 4_096,
      maxSerializedBytes: 96_000,
    },
  ],
  // Contact list — many `p` tags
  [
    3,
    {
      maxContentChars: 1_024,
      maxTags: 10_000,
      maxTagElements: 4,
      maxTagElementChars: 128,
      maxSerializedBytes: 96_000,
    },
  ],
  // Encrypted DM (legacy)
  [
    4,
    {
      maxContentChars: 64_000,
      maxTags: 64,
      maxTagElements: 8,
      maxTagElementChars: 256,
      maxSerializedBytes: 96_000,
    },
  ],
  // Mute list
  [
    10_000,
    {
      maxContentChars: 64_000,
      maxTags: 10_000,
      maxTagElements: 8,
      maxTagElementChars: 512,
      maxSerializedBytes: 96_000,
    },
  ],
  // NIP-39 external identities
  [
    10_011,
    {
      maxContentChars: 8_192,
      maxTags: 128,
      maxTagElements: 8,
      maxTagElementChars: 512,
      maxSerializedBytes: 32_000,
    },
  ],
  // Gift wrap / private DM carriers
  [
    1_059,
    {
      maxContentChars: 64_000,
      maxTags: 64,
      maxTagElements: 8,
      maxTagElementChars: 256,
      maxSerializedBytes: 96_000,
    },
  ],
  // AttentionX trust statements — product UI cap (stricter than protocol 1024)
  [
    TRUST_STATEMENT_KIND,
    {
      maxContentChars: ATTENTIONX_TRUST_CONTENT_UI_LIMIT,
      maxTags: 32,
      maxTagElements: 8,
      maxTagElementChars: 256,
      maxSerializedBytes: 8_192,
    },
  ],
  // AttentionX ratings — same compose cap as trust statements
  [
    RATING_STATEMENT_KIND,
    {
      maxContentChars: ATTENTIONX_TRUST_CONTENT_UI_LIMIT,
      maxTags: 32,
      maxTagElements: 8,
      maxTagElementChars: 256,
      maxSerializedBytes: 8_192,
    },
  ],
])

export function unicodeCharacterLength(value: string): number {
  return [...value].length
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

export function boundsForSignEventKind(kind: number): SignEventKindBounds {
  return KIND_BOUNDS.get(kind) ?? NIP07_DEFAULT_SIGN_BOUNDS
}

function estimateUnsignedSerializedBytes(
  createdAt: number,
  kind: number,
  tags: string[][],
  content: string,
): number {
  // Mirror NIP-01 id serialization shape without a real pubkey.
  const serialized = JSON.stringify([
    0,
    '0'.repeat(64),
    createdAt,
    kind,
    tags,
    content,
  ])
  return utf8ByteLength(serialized)
}

export type BoundedUnsignedEvent = {
  kind: number
  content: string
  tags: string[][]
  created_at: number
}

/**
 * Validate and normalize an unsigned NIP-07 signEvent payload.
 * Throws on missing fields or kind-specific bound violations.
 */
export function assertBoundedUnsignedEvent(
  value: unknown,
): BoundedUnsignedEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid event')
  }
  const event = value as Record<string, unknown>

  if (
    typeof event.kind !== 'number' ||
    !Number.isInteger(event.kind) ||
    event.kind < 0 ||
    event.kind > NIP07_KIND_MAX
  ) {
    throw new Error(`Invalid event kind (0–${NIP07_KIND_MAX})`)
  }
  if (typeof event.content !== 'string') {
    throw new Error('Invalid event content')
  }
  if (!Array.isArray(event.tags)) {
    throw new Error('Invalid event tags: must be an array')
  }
  if (
    typeof event.created_at !== 'number' ||
    !Number.isInteger(event.created_at) ||
    event.created_at < 0
  ) {
    throw new Error('Invalid event created_at')
  }
  const maxFuture = Math.floor(Date.now() / 1000) + 3600
  if (event.created_at > maxFuture) {
    throw new Error('Invalid event created_at: too far in the future')
  }

  const bounds = boundsForSignEventKind(event.kind)
  const contentChars = unicodeCharacterLength(event.content)
  if (contentChars > bounds.maxContentChars) {
    throw new Error(
      `Event content exceeds kind ${event.kind} limit of ${bounds.maxContentChars} characters`,
    )
  }
  if (event.tags.length > bounds.maxTags) {
    throw new Error(
      `Event tags exceed kind ${event.kind} limit of ${bounds.maxTags} tags`,
    )
  }

  const tags: string[][] = []
  for (const tag of event.tags) {
    if (!Array.isArray(tag) || tag.length === 0) {
      throw new Error('Invalid event tags: each tag must be a non-empty array of strings')
    }
    if (tag.length > bounds.maxTagElements) {
      throw new Error(
        `Event tag exceeds kind ${event.kind} limit of ${bounds.maxTagElements} elements`,
      )
    }
    const normalized: string[] = []
    for (const element of tag) {
      if (typeof element !== 'string') {
        throw new Error('Invalid event tags: each tag must be an array of strings')
      }
      if (unicodeCharacterLength(element) > bounds.maxTagElementChars) {
        throw new Error(
          `Event tag element exceeds kind ${event.kind} limit of ${bounds.maxTagElementChars} characters`,
        )
      }
      normalized.push(element)
    }
    tags.push(normalized)
  }

  const serializedBytes = estimateUnsignedSerializedBytes(
    event.created_at,
    event.kind,
    tags,
    event.content,
  )
  if (serializedBytes > bounds.maxSerializedBytes) {
    throw new Error(
      `Event exceeds kind ${event.kind} serialized size limit of ${bounds.maxSerializedBytes} bytes`,
    )
  }

  return {
    kind: event.kind,
    content: event.content,
    tags,
    created_at: event.created_at,
  }
}

export function assertBoundedCryptoPayload(
  field: 'plaintext' | 'ciphertext',
  value: unknown,
): string {
  if (typeof value !== 'string') {
    throw new Error(`Invalid ${field}`)
  }
  if (unicodeCharacterLength(value) > NIP07_MAX_CRYPTO_PAYLOAD_CHARS) {
    throw new Error(
      `${field} exceeds limit of ${NIP07_MAX_CRYPTO_PAYLOAD_CHARS} characters`,
    )
  }
  return value
}
