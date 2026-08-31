import { describe, expect, it } from 'vitest'
import type { ReducedTrustStatement } from './types'
import {
  incomingSubjectKeys,
  isIncomingUserStatement,
  selectIncomingUserStatements,
} from './incoming'

const alice = 'aa'.repeat(32)
const bob = 'bb'.repeat(32)

function statement(
  overrides: Partial<ReducedTrustStatement> &
    Pick<ReducedTrustStatement, 'eventId' | 'author' | 'subject' | 'value'>,
): ReducedTrustStatement {
  return {
    context: 'identity',
    createdAt: 1_700_000_000,
    ...overrides,
  }
}

describe('isIncomingUserStatement', () => {
  const options = {
    twitterId: '1290800267441532928',
    pubkeyHexes: new Set([alice]),
  }

  it('keeps trust, neutral, and distrust on the target user:id', () => {
    expect(
      isIncomingUserStatement(
        statement({
          eventId: 't',
          author: bob,
          subject: { type: 'i', value: 'user:id:1290800267441532928' },
          value: 1,
        }),
        options,
      ),
    ).toBe(true)
    expect(
      isIncomingUserStatement(
        statement({
          eventId: 'n',
          author: bob,
          subject: { type: 'i', value: 'user:id:1290800267441532928' },
          value: 0,
        }),
        options,
      ),
    ).toBe(true)
    expect(
      isIncomingUserStatement(
        statement({
          eventId: 'd',
          author: bob,
          subject: { type: 'i', value: 'user:id:1290800267441532928' },
          value: -1,
        }),
        options,
      ),
    ).toBe(true)
  })

  it('keeps p-tag evidence onto a bound pubkey', () => {
    expect(
      isIncomingUserStatement(
        statement({
          eventId: 'p',
          author: bob,
          subject: { type: 'p', value: alice },
          value: 1,
        }),
        options,
      ),
    ).toBe(true)
  })

  it('drops other users, posts, and unbound pubkeys', () => {
    expect(
      isIncomingUserStatement(
        statement({
          eventId: 'other',
          author: bob,
          subject: { type: 'i', value: 'user:id:1' },
          value: 1,
        }),
        options,
      ),
    ).toBe(false)
    expect(
      isIncomingUserStatement(
        statement({
          eventId: 'post',
          author: bob,
          subject: { type: 'i', value: 'post:id:99' },
          value: 1,
        }),
        options,
      ),
    ).toBe(false)
    expect(
      isIncomingUserStatement(
        statement({
          eventId: 'unbound',
          author: bob,
          subject: { type: 'p', value: bob },
          value: 1,
        }),
        options,
      ),
    ).toBe(false)
  })
})

describe('selectIncomingUserStatements', () => {
  it('returns 1-hop inbound when WoT resolve would be empty', () => {
    const selected = selectIncomingUserStatements(
      [
        statement({
          eventId: 'hit',
          author: bob,
          subject: { type: 'i', value: 'user:id:42' },
          value: 1,
          content: 'witness',
        }),
        statement({
          eventId: 'miss',
          author: alice,
          subject: { type: 'i', value: 'user:id:99' },
          value: 1,
        }),
      ],
      { twitterId: '42', pubkeyHexes: new Set() },
    )
    expect(selected.truncated).toBe(false)
    expect(selected.statements).toHaveLength(1)
    expect(selected.statements[0]).toMatchObject({
      eventId: 'hit',
      author: bob,
      value: 1,
      distance: 1,
      content: 'witness',
    })
  })
})

describe('incomingSubjectKeys', () => {
  it('reads twitterId from user:id and hex from p', () => {
    expect(incomingSubjectKeys({ type: 'i', value: 'user:id:42' })).toEqual({
      twitterId: '42',
      pubkeyHexes: new Set(),
    })
    expect(incomingSubjectKeys({ type: 'p', value: alice })).toEqual({
      pubkeyHexes: new Set([alice]),
    })
  })
})
