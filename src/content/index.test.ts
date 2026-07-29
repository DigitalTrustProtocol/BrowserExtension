import { describe, expect, it } from 'vitest'
import type { TrustQueryResult } from '../graph'
import {
  parseArticle,
  publishValueForVerdict,
  selectTwitterId,
  trustDescriptor,
  trustDisplay,
} from './index'

describe('content trust integration', () => {
  it('uses canonical subjects and refuses unresolved profile publication', () => {
    expect(
      trustDescriptor({
        type: 'profile',
        id: '11348282',
        url: 'https://x.com/i/user/11348282',
        handle: 'nasa',
        twitterId: '11348282',
      }),
    ).toEqual({
      subject: { type: 'i', value: 'user:id:11348282' },
    })
    expect(
      trustDescriptor({
        type: 'post',
        id: '2080659774136291424',
        url: 'https://x.com/i/web/status/2080659774136291424',
      }),
    ).toEqual({
      subject: {
        type: 'i',
        value: 'post:id:2080659774136291424',
      },
    })
    expect(
      trustDescriptor({
        type: 'profile',
        id: 'nasa',
        url: 'https://x.com/nasa',
        handle: 'nasa',
      }),
    ).toBeUndefined()
  })

  it('keeps question local and maps publishable verdict values', () => {
    expect(publishValueForVerdict('trust')).toBe('1')
    expect(publishValueForVerdict('misleading')).toBe('-1')
    expect(publishValueForVerdict('question')).toBeUndefined()
  })

  it('prefers observed post and handle identities over DOM metadata', () => {
    const byHandle = new Map([
      [
        'nasa',
        { twitterId: 'handle-id', handle: 'nasa', observedAt: 100 },
      ],
    ])
    const byPost = new Map([
      ['123', { twitterId: 'post-id', handle: 'nasa', observedAt: 200 }],
    ])

    expect(selectTwitterId('123', 'NASA', 'dom-id', byHandle, byPost)).toBe(
      'post-id',
    )
    expect(selectTwitterId('456', 'NASA', 'dom-id', byHandle, byPost)).toBe(
      'handle-id',
    )
    expect(selectTwitterId('456', 'other', 'dom-id', byHandle, byPost)).toBe(
      'dom-id',
    )
    expect(selectTwitterId('123', 'other', 'dom-id', byHandle, byPost)).toBe(
      'dom-id',
    )
  })

  it('isolates malformed articles and validates rendered identity fields', () => {
    const malformedArticle = {
      dataset: {},
      querySelectorAll() {
        throw new Error('host page getter failed')
      },
    } as unknown as HTMLElement
    const validArticle = {
      dataset: {},
      querySelectorAll() {
        return [{ getAttribute: () => '/NASA/status/123' }]
      },
      querySelector() {
        return null
      },
    } as unknown as HTMLElement
    const invalidArticle = {
      dataset: { tweetId: 'not-a-post-id' },
      querySelectorAll() {
        return [{ getAttribute: () => '/invalid-handle!/status/not-an-id' }]
      },
      querySelector() {
        return null
      },
    } as unknown as HTMLElement

    expect(parseArticle(malformedArticle)).toBeUndefined()
    expect(parseArticle(invalidArticle)).toBeUndefined()
    expect(parseArticle(validArticle)?.postTarget).toMatchObject({
      id: '123',
      handle: 'nasa',
    })
  })

  it('adapts graph resolution, evidence, freshness, and truncation', () => {
    const result: TrustQueryResult = {
      subject: { type: 'i', value: 'post:id:123' },
      context: '',
      resolution: 'distrusted',
      statements: [
        {
          eventId: 'event',
          author: 'a'.repeat(64),
          subject: { type: 'i', value: 'post:id:123' },
          context: '',
          requestedContext: '',
          contextMatch: 'exact',
          value: -1,
          createdAt: 100,
          distance: 1,
        },
      ],
      paths: [],
      sourceEventIds: ['event'],
      computedAt: 1_000,
      graphVersion: 2,
      truncated: true,
    }

    expect(trustDisplay(result, 4_700)).toEqual({
      resolution: 'distrusted',
      tone: 'misleading',
      evidence: 'network',
      freshness: { unit: 'hour', count: 1 },
      truncated: true,
    })
  })
})
