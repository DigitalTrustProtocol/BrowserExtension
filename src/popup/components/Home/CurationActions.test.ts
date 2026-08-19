import { describe, expect, it } from 'vitest'
import type { ResolvedStatement, TrustQueryResult } from '../../../graph'
import type { SerializableTrustSubject } from '../../../shared/contracts'
import {
  isAlreadySelected,
  ownDirectPolarity,
  polarityToPublishValue,
  shouldShowDelete,
  shouldShowOpenGraph,
} from './CurationActions'

const account: SerializableTrustSubject = {
  type: 'i',
  value: 'user:id:11348282',
}
const post: SerializableTrustSubject = {
  type: 'i',
  value: 'post:id:2080659774136291424',
}
const pubkey: SerializableTrustSubject = {
  type: 'p',
  value: 'ab'.repeat(32),
}
const event: SerializableTrustSubject = {
  type: 'e',
  value: 'cd'.repeat(32),
}

function result(overrides: Partial<TrustQueryResult> = {}): TrustQueryResult {
  return {
    subject: account,
    context: '',
    resolution: 'none',
    trust: 0,
    distrust: 0,
    trustValue: 0,
    degree: 0,
    connected: false,
    statements: [],
    paths: [],
    sourceEventIds: [],
    truncated: false,
    computedAt: 1_700_000_000,
    graphVersion: 1,
    ...overrides,
  }
}

function direct(value: 1 | 0 | -1): ResolvedStatement {
  return {
    eventId: 'e1',
    author: 'aa'.repeat(32),
    subject: account,
    context: '',
    requestedContext: '',
    contextMatch: 'exact',
    value,
    createdAt: 1_700_000_000,
    distance: 0,
  }
}

describe('polarityToPublishValue', () => {
  it('maps Trust / Neutral / Distrust to PUBLISH_TRUST_STATEMENT values', () => {
    expect(polarityToPublishValue('trust')).toBe('1')
    expect(polarityToPublishValue('neutral')).toBe('0')
    expect(polarityToPublishValue('distrust')).toBe('-1')
  })
})

describe('ownDirectPolarity', () => {
  it('reads the current own value from trust.direct', () => {
    expect(ownDirectPolarity(null)).toBeNull()
    expect(ownDirectPolarity(result())).toBeNull()
    expect(ownDirectPolarity(result({ direct: direct(1) }))).toBe('trust')
    expect(ownDirectPolarity(result({ direct: direct(0) }))).toBe('neutral')
    expect(ownDirectPolarity(result({ direct: direct(-1) }))).toBe('distrust')
  })
})

describe('shouldShowDelete', () => {
  it('shows Delete only when an own winning statement exists', () => {
    expect(shouldShowDelete(null)).toBe(false)
    expect(shouldShowDelete(result())).toBe(false)
    expect(shouldShowDelete(result({ direct: direct(1) }))).toBe(true)
    expect(shouldShowDelete(result({ direct: direct(0) }))).toBe(true)
    expect(shouldShowDelete(result({ direct: direct(-1) }))).toBe(true)
  })
})

describe('shouldShowOpenGraph', () => {
  it('shows Open Graph for identity subjects, not artifacts', () => {
    expect(shouldShowOpenGraph(account)).toBe(true)
    expect(shouldShowOpenGraph(pubkey)).toBe(true)
    expect(shouldShowOpenGraph(post)).toBe(false)
    expect(shouldShowOpenGraph(event)).toBe(false)
  })
})

describe('isAlreadySelected', () => {
  it('treats a re-click of the current polarity as a documented no-op', () => {
    expect(isAlreadySelected('trust', 'trust')).toBe(true)
    expect(isAlreadySelected('neutral', 'trust')).toBe(false)
    expect(isAlreadySelected('distrust', null)).toBe(false)
  })
})
