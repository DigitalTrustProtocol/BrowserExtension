import { describe, expect, it } from 'vitest'
import {
  classifyXPostRole,
  extractXPostChromeFromTweet,
  sanitizeXPostChromeInput,
} from './x-post-chrome'

describe('classifyXPostRole', () => {
  it('detects root, reply, quote, and repost', () => {
    expect(classifyXPostRole({ rest_id: '1' })).toEqual({ role: 'root' })
    expect(
      classifyXPostRole({
        rest_id: '2',
        legacy: { in_reply_to_status_id_str: '1' },
      }),
    ).toEqual({ role: 'reply', parentPostId: '1' })
    expect(
      classifyXPostRole({
        rest_id: '3',
        quoted_status_result: { result: { rest_id: '1' } },
      }),
    ).toEqual({ role: 'quote', parentPostId: '1' })
    expect(
      classifyXPostRole({
        rest_id: '4',
        retweeted_status_result: { result: { rest_id: '1' } },
      }),
    ).toEqual({ role: 'repost', parentPostId: '1' })
  })
})

describe('extractXPostChromeFromTweet', () => {
  it('extracts author, headline, and role', () => {
    const chrome = extractXPostChromeFromTweet({
      rest_id: '2080659774136291424',
      legacy: { full_text: 'One two three four five six seven eight nine' },
      core: {
        user_results: {
          result: {
            rest_id: '11348282',
            legacy: { screen_name: 'NASA' },
          },
        },
      },
    })
    expect(chrome).toMatchObject({
      postId: '2080659774136291424',
      authorTwitterId: '11348282',
      authorHandle: 'nasa',
      role: 'root',
    })
    expect(chrome?.headline).toContain('One two')
  })
})

describe('sanitizeXPostChromeInput', () => {
  it('rejects bad ids and caps headlines', () => {
    expect(sanitizeXPostChromeInput({ postId: 'abc' })).toBeUndefined()
    const ok = sanitizeXPostChromeInput({
      postId: '123',
      authorHandle: '@Foo',
      headline: 'a '.repeat(50),
      role: 'reply',
      parentPostId: '9',
    })
    expect(ok?.authorHandle).toBe('foo')
    expect(ok?.headline?.endsWith('…')).toBe(true)
    expect(ok?.role).toBe('reply')
    expect(ok?.parentPostId).toBe('9')
  })
})
