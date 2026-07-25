import { describe, expect, it } from 'vitest'
import type { Event } from 'nostr-tools'
import {
  getAssessmentVerdict,
  mergeEvents,
  summarizeAssessments,
} from './assessment'

const targetUrl = 'https://x.com/example/status/123'

function assessment(
  id: string,
  pubkey: string,
  verdict: string,
  createdAt: number,
  url = targetUrl,
): Event {
  return {
    id,
    pubkey,
    created_at: createdAt,
    kind: 1985,
    tags: [
      ['L', 'attentionx'],
      ['l', verdict, 'attentionx'],
      ['r', url],
    ],
    content: '',
    sig: id.padEnd(128, '0'),
  }
}

describe('assessment aggregation', () => {
  it('reads only supported AttentionX labels', () => {
    expect(getAssessmentVerdict(assessment('1', 'alice', 'trust', 1))).toBe(
      'trust',
    )
    expect(getAssessmentVerdict(assessment('2', 'alice', 'spam', 1))).toBe(
      undefined,
    )
  })

  it('uses each author’s latest assessment for a target', () => {
    const summaries = summarizeAssessments(
      [
        assessment('1', 'alice', 'trust', 1),
        assessment('2', 'alice', 'question', 2),
        assessment('3', 'bob', 'trust', 3),
      ],
      [targetUrl],
      'alice',
    )

    expect(summaries[targetUrl]).toMatchObject({
      counts: { trust: 1, question: 1, misleading: 0 },
      contributors: 2,
      myVerdict: 'question',
    })
  })

  it('deduplicates cached events and keeps the newest entries', () => {
    const first = assessment('1', 'alice', 'trust', 1)
    const second = assessment('2', 'bob', 'question', 2)

    expect(mergeEvents([first], [first, second], 1)).toEqual([second])
  })
})
