import { describe, expect, it } from 'vitest'
import {
  isNewerProofPost,
  parseXTweetCreatedAtMs,
  readTweetCreatedAtMs,
} from './x-proof-time'

describe('x proof time helpers', () => {
  it('parses GraphQL legacy created_at strings', () => {
    expect(parseXTweetCreatedAtMs('Wed Oct 10 20:19:24 +0000 2018')).toBe(
      Date.parse('Wed Oct 10 20:19:24 +0000 2018'),
    )
    expect(parseXTweetCreatedAtMs('')).toBeUndefined()
    expect(parseXTweetCreatedAtMs(null)).toBeUndefined()
  })

  it('reads created_at from a tweet record', () => {
    expect(
      readTweetCreatedAtMs({
        legacy: { created_at: 'Wed Oct 10 20:19:24 +0000 2018' },
      }),
    ).toBe(Date.parse('Wed Oct 10 20:19:24 +0000 2018'))
  })

  it('prefers postedAt for newer-wins and falls back to post id', () => {
    expect(
      isNewerProofPost(
        { postId: '1', postedAt: 200 },
        { postId: '9', postedAt: 100 },
      ),
    ).toBe(true)
    expect(
      isNewerProofPost(
        { postId: '1', postedAt: 50 },
        { postId: '9', postedAt: 100 },
      ),
    ).toBe(false)
    expect(
      isNewerProofPost({ postId: '200' }, { postId: '100' }),
    ).toBe(true)
  })
})
