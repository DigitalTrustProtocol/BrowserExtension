import { describe, expect, it } from 'vitest'
import type { ReducedTrustStatement } from './types'
import {
  isOutgoingUserStatement,
  outgoingTargetTwitterId,
  selectOutgoingUserStatements,
  toOutgoingResolvedStatement,
} from './outgoing'

const alice = 'aa'.repeat(32)
const bob = 'bb'.repeat(32)

function statement(
  overrides: Partial<ReducedTrustStatement> &
    Pick<ReducedTrustStatement, 'eventId' | 'author' | 'subject' | 'value'>,
): ReducedTrustStatement {
  return {
    context: '',
    createdAt: 1_700_000_000,
    ...overrides,
  }
}

describe('isOutgoingUserStatement', () => {
  const authors = new Set([alice])

  it('keeps trust, neutral, and distrust on user:id from listed authors', () => {
    expect(
      isOutgoingUserStatement(
        statement({
          eventId: 't',
          author: alice,
          subject: { type: 'i', value: 'user:id:1' },
          value: 1,
        }),
        authors,
      ),
    ).toBe(true)
    expect(
      isOutgoingUserStatement(
        statement({
          eventId: 'n',
          author: alice.toUpperCase(),
          subject: { type: 'i', value: 'user:id:2' },
          value: 0,
        }),
        authors,
      ),
    ).toBe(true)
    expect(
      isOutgoingUserStatement(
        statement({
          eventId: 'd',
          author: alice,
          subject: { type: 'i', value: 'user:id:3' },
          value: -1,
        }),
        authors,
      ),
    ).toBe(true)
  })

  it('drops posts, other authors, and pubkey subjects', () => {
    expect(
      isOutgoingUserStatement(
        statement({
          eventId: 'p',
          author: alice,
          subject: { type: 'i', value: 'post:id:99' },
          value: 1,
        }),
        authors,
      ),
    ).toBe(false)
    expect(
      isOutgoingUserStatement(
        statement({
          eventId: 'o',
          author: bob,
          subject: { type: 'i', value: 'user:id:1' },
          value: 1,
        }),
        authors,
      ),
    ).toBe(false)
    expect(
      isOutgoingUserStatement(
        statement({
          eventId: 'k',
          author: alice,
          subject: { type: 'p', value: bob },
          value: 1,
        }),
        authors,
      ),
    ).toBe(false)
  })
})

describe('selectOutgoingUserStatements', () => {
  it('maps matching winners including labels and content', () => {
    const result = selectOutgoingUserStatements(
      [
        statement({
          eventId: 'keep',
          author: alice,
          subject: { type: 'i', value: 'user:id:44196397' },
          value: 0,
          content: 'Neither endorsed nor opposed.',
          labels: ['reviewer'],
          labelHints: { reviewer: 'Watches this account' },
        }),
        statement({
          eventId: 'drop-post',
          author: alice,
          subject: { type: 'i', value: 'post:id:1' },
          value: 1,
        }),
      ],
      new Set([alice]),
    )
    expect(result.truncated).toBe(false)
    expect(result.statements).toHaveLength(1)
    expect(result.statements[0]).toMatchObject({
      eventId: 'keep',
      value: 0,
      content: 'Neither endorsed nor opposed.',
      labels: ['reviewer'],
      distance: 0,
    })
    expect(outgoingTargetTwitterId(result.statements[0]!)).toBe('44196397')
  })

  it('returns empty when no linked pubkeys', () => {
    expect(
      selectOutgoingUserStatements(
        [
          statement({
            eventId: 't',
            author: alice,
            subject: { type: 'i', value: 'user:id:1' },
            value: 1,
          }),
        ],
        new Set(),
      ),
    ).toEqual({ statements: [], truncated: false })
  })
})

describe('toOutgoingResolvedStatement', () => {
  it('clones the subject and exact context match', () => {
    const resolved = toOutgoingResolvedStatement(
      statement({
        eventId: 'e',
        author: alice,
        subject: { type: 'i', value: 'user:id:7' },
        value: 1,
        context: '',
      }),
    )
    expect(resolved.contextMatch).toBe('exact')
    expect(resolved.subject).toEqual({ type: 'i', value: 'user:id:7' })
  })
})
