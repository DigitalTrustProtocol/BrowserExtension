import { describe, expect, it } from 'vitest'
import {
  DEMO_WOT_MAX_DEPTH,
  isDemoWotEvent,
  materializeDemoSubject,
  planDemoWotNetwork,
} from './demo-wot'

describe('planDemoWotNetwork', () => {
  it('requires at least one numeric twitter id', () => {
    expect(() => planDemoWotNetwork({ twitterIds: [] })).toThrow(/No X identities/)
    expect(() => planDemoWotNetwork({ twitterIds: ['abc'] })).toThrow(
      /No X identities/,
    )
  })

  it('builds a 5-degree p-chain and only account i subjects', () => {
    const ids = Array.from({ length: 20 }, (_, i) => String(1000 + i))
    const plan = planDemoWotNetwork({ twitterIds: ids })
    expect(plan.maxDepth).toBe(DEMO_WOT_MAX_DEPTH)
    expect(plan.fakeAuthorCount).toBe(DEMO_WOT_MAX_DEPTH * 4)

    const pEdges = plan.statements.filter((row) => row.subject.type === 'p')
    const iEdges = plan.statements.filter((row) => row.subject.type === 'i')
    expect(pEdges.length).toBeGreaterThan(plan.fakeAuthorCount)
    expect(iEdges.length).toBeGreaterThanOrEqual(ids.length)

    expect(
      iEdges.every(
        (row) => row.subject.type === 'i' && /^\d+$/.test(row.subject.twitterId),
      ),
    ).toBe(true)

    const rootToDegree1 = pEdges.filter(
      (row) =>
        row.authorIndex === -1 &&
        row.subject.type === 'p' &&
        row.value === '1',
    )
    expect(rootToDegree1.length).toBe(4)

    // Depth-5 authors are reachable; shortest path to last layer is 5.
    const distance = new Map<number, number>()
    const queue = [-1]
    distance.set(-1, 0)
    while (queue.length > 0) {
      const author = queue.shift()!
      const depth = distance.get(author) ?? 0
      for (const edge of pEdges) {
        if (
          edge.authorIndex !== author ||
          edge.value !== '1' ||
          edge.subject.type !== 'p'
        ) {
          continue
        }
        const child = edge.subject.authorIndex
        if (distance.has(child)) continue
        distance.set(child, depth + 1)
        queue.push(child)
      }
    }
    expect(distance.size - 1).toBe(plan.fakeAuthorCount)
    expect(Math.max(...[...distance.values()])).toBe(DEMO_WOT_MAX_DEPTH)
  })

  it('materializes p subjects from generated pubkeys', () => {
    const pubkeys = Array.from({ length: 3 }, (_, i) =>
      (i + 1).toString(16).padStart(64, 'a'),
    )
    expect(materializeDemoSubject({ type: 'p', authorIndex: 1 }, pubkeys)).toEqual(
      { type: 'p', value: pubkeys[1] },
    )
    expect(
      materializeDemoSubject({ type: 'i', twitterId: '42' }, pubkeys),
    ).toEqual({ type: 'i', value: 'ext:twitter_id:42' })
  })
})

describe('isDemoWotEvent', () => {
  it('detects the test tag', () => {
    expect(
      isDemoWotEvent({
        tags: [
          ['d', 'x'],
          ['test', 'attentionx-demo'],
        ],
      }),
    ).toBe(true)
    expect(isDemoWotEvent({ tags: [['d', 'x']] })).toBe(false)
  })
})
