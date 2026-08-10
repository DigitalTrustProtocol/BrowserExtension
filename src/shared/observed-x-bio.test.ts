import { describe, expect, it } from 'vitest'
import {
  OBSERVED_X_BIO_MESSAGE,
  OBSERVED_X_BIO_SOURCE,
  OBSERVED_X_BIO_VERSION,
  extractBioNpubCandidate,
  extractXBioCandidateFromTweet,
  isPreferredBioCandidate,
  parseObservedXBioMessage,
  sanitizeObservedXBioCandidate,
} from './observed-x-bio'

const NPUB_A = `npub1${'q'.repeat(60)}`
const NPUB_B = `npub1${'z'.repeat(60)}`

describe('extractBioNpubCandidate', () => {
  it('accepts a bare single npub with no linking intent cue', () => {
    expect(extractBioNpubCandidate(`gm ${NPUB_A} building on nostr`)).toBe(
      NPUB_A,
    )
  })

  it('rejects a bio with no npub', () => {
    expect(extractBioNpubCandidate('Just a normal bio, no keys here.')).toBeUndefined()
  })

  it('rejects a bio with multiple npubs', () => {
    expect(
      extractBioNpubCandidate(`${NPUB_A} or maybe ${NPUB_B}`),
    ).toBeUndefined()
  })

  it('rejects overlong bio text', () => {
    expect(extractBioNpubCandidate(`${NPUB_A} ${'x'.repeat(501)}`)).toBeUndefined()
  })
})

describe('isPreferredBioCandidate', () => {
  it('prefers newer postCreatedAt over later observedAt', () => {
    expect(
      isPreferredBioCandidate(
        {
          twitterId: '1',
          handle: 'a',
          npub: NPUB_A,
          postCreatedAt: 2_000,
          observedAt: 10,
        },
        {
          twitterId: '1',
          handle: 'a',
          npub: NPUB_A,
          postCreatedAt: 1_000,
          observedAt: 99,
        },
      ),
    ).toBe(true)
    expect(
      isPreferredBioCandidate(
        {
          twitterId: '1',
          handle: 'a',
          npub: NPUB_A,
          postCreatedAt: 1_000,
          observedAt: 99,
        },
        {
          twitterId: '1',
          handle: 'a',
          npub: NPUB_A,
          postCreatedAt: 2_000,
          observedAt: 10,
        },
      ),
    ).toBe(false)
  })

  it('falls back to observedAt when postCreatedAt is missing', () => {
    expect(
      isPreferredBioCandidate(
        { twitterId: '1', handle: 'a', npub: NPUB_A, observedAt: 200 },
        { twitterId: '1', handle: 'a', npub: NPUB_A, observedAt: 100 },
      ),
    ).toBe(true)
  })
})

describe('sanitizeObservedXBioCandidate', () => {
  it('accepts a well-formed candidate and lowercases the npub', () => {
    expect(
      sanitizeObservedXBioCandidate({
        twitterId: '11348282',
        handle: '@NASA',
        npub: NPUB_A.toUpperCase(),
        postId: '2080659774136291424',
        postCreatedAt: 1_700_000_000_000,
        observedAt: 1_700_000_000_001,
      }),
    ).toEqual({
      twitterId: '11348282',
      handle: 'nasa',
      npub: NPUB_A,
      postId: '2080659774136291424',
      postCreatedAt: 1_700_000_000_000,
      observedAt: 1_700_000_000_001,
    })
  })

  it('accepts a candidate with no carrier post evidence', () => {
    expect(
      sanitizeObservedXBioCandidate({
        twitterId: '11348282',
        handle: 'nasa',
        npub: NPUB_A,
        observedAt: 1_700_000_000_001,
      }),
    ).toEqual({
      twitterId: '11348282',
      handle: 'nasa',
      npub: NPUB_A,
      observedAt: 1_700_000_000_001,
    })
  })

  it('rejects invalid npub, handle, twitterId, postId, or observedAt', () => {
    const base = {
      twitterId: '11348282',
      handle: 'nasa',
      npub: NPUB_A,
      observedAt: 1_700_000_000_001,
    }
    expect(sanitizeObservedXBioCandidate({ ...base, npub: 'not-an-npub' })).toBeUndefined()
    expect(sanitizeObservedXBioCandidate({ ...base, handle: '' })).toBeUndefined()
    expect(sanitizeObservedXBioCandidate({ ...base, twitterId: 'abc' })).toBeUndefined()
    expect(sanitizeObservedXBioCandidate({ ...base, postId: 'abc' })).toBeUndefined()
    expect(sanitizeObservedXBioCandidate({ ...base, observedAt: -1 })).toBeUndefined()
    expect(sanitizeObservedXBioCandidate(null)).toBeUndefined()
  })
})

describe('parseObservedXBioMessage', () => {
  const candidate = {
    twitterId: '11348282',
    handle: 'nasa',
    npub: NPUB_A,
    postId: '2080659774136291424',
    postCreatedAt: 1_700_000_000_000,
    observedAt: 1_700_000_000_001,
  }
  const message = {
    source: OBSERVED_X_BIO_SOURCE,
    type: OBSERVED_X_BIO_MESSAGE,
    version: OBSERVED_X_BIO_VERSION,
    candidates: [candidate],
  }

  it('parses a well-formed message', () => {
    expect(parseObservedXBioMessage(message)).toEqual(message)
  })

  it('rejects wrong source, type, or version', () => {
    expect(parseObservedXBioMessage({ ...message, source: 'evil' })).toBeUndefined()
    expect(parseObservedXBioMessage({ ...message, type: 'evil' })).toBeUndefined()
    expect(parseObservedXBioMessage({ ...message, version: 2 })).toBeUndefined()
  })

  it('drops invalid candidates but keeps valid ones', () => {
    expect(
      parseObservedXBioMessage({
        ...message,
        candidates: [{ handle: 'nasa' }, candidate],
      }),
    ).toEqual(message)
  })

  it('rejects an empty or oversized candidate batch', () => {
    expect(parseObservedXBioMessage({ ...message, candidates: [] })).toBeUndefined()
    expect(
      parseObservedXBioMessage({
        ...message,
        candidates: Array.from({ length: 21 }, () => candidate),
      }),
    ).toBeUndefined()
  })
})

describe('extractXBioCandidateFromTweet', () => {
  it('extracts the npub and carrier-post evidence, discarding the bio text', () => {
    const tweet = {
      rest_id: '2080659774136291424',
      legacy: {
        full_text: 'Public post text.',
        created_at: 'Wed Oct 10 20:19:24 +0000 2018',
      },
      core: {
        user_results: {
          result: {
            rest_id: '11348282',
            legacy: {
              screen_name: 'NASA',
              description: `Space agency. Nostr: ${NPUB_A}`,
            },
          },
        },
      },
    }

    const candidate = extractXBioCandidateFromTweet(tweet, 1_700_000_000_001)
    expect(candidate).toEqual({
      twitterId: '11348282',
      handle: 'nasa',
      npub: NPUB_A,
      postId: '2080659774136291424',
      postCreatedAt: Date.parse('Wed Oct 10 20:19:24 +0000 2018'),
      observedAt: 1_700_000_000_001,
    })
    expect(JSON.stringify(candidate)).not.toContain('Space agency')
  })

  it('returns undefined when the bio has no npub', () => {
    const tweet = {
      rest_id: '1',
      core: {
        user_results: {
          result: {
            rest_id: '2',
            legacy: { screen_name: 'nasa', description: 'Just a bio.' },
          },
        },
      },
    }
    expect(extractXBioCandidateFromTweet(tweet, 1)).toBeUndefined()
  })

  it('returns undefined when the bio has multiple npubs', () => {
    const tweet = {
      rest_id: '1',
      core: {
        user_results: {
          result: {
            rest_id: '2',
            legacy: {
              screen_name: 'nasa',
              description: `${NPUB_A} ${NPUB_B}`,
            },
          },
        },
      },
    }
    expect(extractXBioCandidateFromTweet(tweet, 1)).toBeUndefined()
  })

  it('returns undefined without a paired twitterId and handle', () => {
    const tweet = {
      rest_id: '1',
      core: {
        user_results: {
          result: {
            legacy: { description: `Nostr: ${NPUB_A}` },
          },
        },
      },
    }
    expect(extractXBioCandidateFromTweet(tweet, 1)).toBeUndefined()
  })
})
