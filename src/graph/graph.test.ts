import { describe, expect, it } from 'vitest'
import {
  LocalTrustGraph,
  contextCandidates,
  normalizeBounds,
  type ReducedTrustStatement,
  type TrustSubject,
  type TrustValue,
} from './index'

const root = 'root'
const target: TrustSubject = { type: 'i', value: 'x:post:42' }

function statement(
  eventId: string,
  author: string,
  subject: TrustSubject,
  value: TrustValue,
  options: Partial<
    Pick<
      ReducedTrustStatement,
      'context' | 'createdAt' | 'activeFrom' | 'activeUntil'
    >
  > = {},
): ReducedTrustStatement {
  return {
    eventId,
    author,
    subject,
    value,
    context: options.context ?? '',
    createdAt: options.createdAt ?? 1,
    ...(options.activeFrom === undefined
      ? {}
      : { activeFrom: options.activeFrom }),
    ...(options.activeUntil === undefined
      ? {}
      : { activeUntil: options.activeUntil }),
  }
}

function pubkey(value: string): TrustSubject {
  return { type: 'p', value }
}

describe('context resolution', () => {
  it('orders exact, nearest parents, and general context', () => {
    expect(contextCandidates('security:audit:web')).toEqual([
      { context: 'security:audit:web', match: 'exact' },
      { context: 'security:audit', match: 'parent' },
      { context: 'security', match: 'parent' },
      { context: '', match: 'general' },
    ])
  })

  it('falls back when a cancelled specific slot has no active edge', () => {
    const graph = new LocalTrustGraph([
      statement('general', root, target, 1),
      statement('security', root, target, -1, { context: 'security' }),
      statement('cancelled', root, target, 0, {
        context: 'security:audit',
      }),
    ])

    const result = graph.query({
      rootPubkey: root,
      subject: target,
      context: 'security:audit',
      now: 10,
    })

    expect(result.direct).toMatchObject({
      eventId: 'security',
      context: 'security',
      contextMatch: 'parent',
      value: -1,
    })
    expect(result.resolution).toBe('distrusted')
  })

  it('falls back when a not-yet-active specific slot has no active edge', () => {
    const graph = new LocalTrustGraph([
      statement('general', root, target, 1),
      statement('future', root, target, -1, {
        context: 'security:audit',
        activeFrom: 20,
      }),
    ])

    expect(
      graph.query({
        rootPubkey: root,
        subject: target,
        context: 'security:audit',
        now: 10,
      }).direct,
    ).toMatchObject({
      eventId: 'general',
      context: '',
      contextMatch: 'general',
      value: 1,
    })
  })

  it('falls back when an expired specific slot has no active edge', () => {
    const graph = new LocalTrustGraph([
      statement('general', root, target, 1),
      statement('expired', root, target, -1, {
        context: 'security:audit',
        activeUntil: 5,
      }),
    ])

    expect(
      graph.query({
        rootPubkey: root,
        subject: target,
        context: 'security:audit',
        now: 10,
      }).direct,
    ).toMatchObject({
      eventId: 'general',
      context: '',
      contextMatch: 'general',
      value: 1,
    })
  })

  it('falls back to a parent when the specific terminal slot is absent', () => {
    const graph = new LocalTrustGraph([
      statement('general', root, target, 1),
      statement('security', root, target, -1, { context: 'security' }),
    ])

    expect(
      graph.query({
        rootPubkey: root,
        subject: target,
        context: 'security:audit',
        now: 10,
      }).direct,
    ).toMatchObject({
      eventId: 'security',
      context: 'security',
      contextMatch: 'parent',
    })
  })
})

describe('local trust graph', () => {
  it('traverses only active positive p statements', () => {
    const graph = new LocalTrustGraph([
      statement('to-alice', root, pubkey('alice'), 1),
      statement('alice-evidence', 'alice', target, 1),
      statement('distrust-bob', root, pubkey('bob'), -1),
      statement('bob-evidence', 'bob', target, -1),
      statement('cancel-carol', root, pubkey('carol'), 0),
      statement('carol-evidence', 'carol', target, -1),
      statement('terminal-i', root, { type: 'i', value: 'dave' }, 1),
      statement('dave-evidence', 'dave', target, -1),
      statement('terminal-e', root, { type: 'e', value: 'erin' }, 1),
      statement('erin-evidence', 'erin', target, -1),
      statement('expired-frank', root, pubkey('frank'), 1, {
        activeUntil: 5,
      }),
      statement('frank-evidence', 'frank', target, -1),
    ])

    const result = graph.query({
      rootPubkey: root,
      subject: target,
      now: 10,
    })

    expect(result.statements.map(({ eventId }) => eventId)).toEqual([
      'alice-evidence',
    ])
    expect(result.paths).toEqual([
      {
        authors: ['root', 'alice'],
        subject: target,
        sourceEventIds: ['to-alice', 'alice-evidence'],
      },
    ])
    expect(result.resolution).toBe('trusted')
    expect(result.truncated).toBe(false)
  })

  it.each([
    {
      name: 'cancelled',
      value: 0 as TrustValue,
      activation: {},
    },
    {
      name: 'not-yet-active',
      value: 1 as TrustValue,
      activation: { activeFrom: 20 },
    },
    {
      name: 'expired',
      value: 1 as TrustValue,
      activation: { activeUntil: 5 },
    },
  ])(
    'falls back to broader p edges when a $name specific slot has no active edge',
    ({ name: _name, value, activation }) => {
      const graph = new LocalTrustGraph([
        statement('general-edge', root, pubkey('alice'), 1),
        statement('specific-edge', root, pubkey('alice'), value, {
          context: 'security:audit',
          ...activation,
        }),
        statement('alice-evidence', 'alice', target, 1),
      ])

      const result = graph.query({
        rootPubkey: root,
        subject: target,
        context: 'security:audit',
        now: 10,
      })

      expect(result.statements.map(({ eventId }) => eventId)).toEqual([
        'alice-evidence',
      ])
      expect(result.paths).toEqual([
        {
          authors: ['root', 'alice'],
          subject: target,
          sourceEventIds: ['general-edge', 'alice-evidence'],
        },
      ])
      expect(result.resolution).toBe('trusted')
    },
  )

  it('falls back to a parent p edge when the specific slot is absent', () => {
    const graph = new LocalTrustGraph([
      statement('parent-edge', root, pubkey('alice'), 1, {
        context: 'security',
      }),
      statement('alice-evidence', 'alice', target, 1, {
        context: 'security',
      }),
    ])

    const result = graph.query({
      rootPubkey: root,
      subject: target,
      context: 'security:audit',
      now: 10,
    })

    expect(result.statements).toHaveLength(1)
    expect(result.paths[0]).toEqual({
      authors: ['root', 'alice'],
      subject: target,
      sourceEventIds: ['parent-edge', 'alice-evidence'],
    })
    expect(result.sourceEventIds).toEqual(['alice-evidence', 'parent-edge'])
  })

  it('returns direct and mixed reachable evidence with provenance', () => {
    const graph = new LocalTrustGraph([
      statement('root-target', root, target, 1),
      statement('root-alice', root, pubkey('alice'), 1),
      statement('alice-target', 'alice', target, -1),
    ])

    const result = graph.query({
      rootPubkey: root,
      subject: target,
      context: 'news',
      now: 50,
    })

    expect(result).toMatchObject({
      subject: target,
      context: 'news',
      resolution: 'mixed',
      computedAt: 50,
      graphVersion: 1,
      truncated: false,
    })
    expect(result.direct).toMatchObject({
      eventId: 'root-target',
      distance: 0,
    })
    expect(result.statements.map(({ eventId, distance }) => [
      eventId,
      distance,
    ])).toEqual([
      ['root-target', 0],
      ['alice-target', 1],
    ])
    expect(result.sourceEventIds).toEqual([
      'alice-target',
      'root-alice',
      'root-target',
    ])
    expect('score' in result).toBe(false)
  })

  it('uses one canonical shortest path and one statement per author', () => {
    const inputs = [
      statement('root-b', root, pubkey('b'), 1),
      statement('root-a', root, pubkey('a'), 1),
      statement('a-d', 'a', pubkey('d'), 1),
      statement('b-d', 'b', pubkey('d'), 1),
      statement('d-target', 'd', target, 1),
    ]
    const forward = new LocalTrustGraph(inputs).query({
      rootPubkey: root,
      subject: target,
      now: 1,
    })
    const reverse = new LocalTrustGraph([...inputs].reverse()).query({
      rootPubkey: root,
      subject: target,
      now: 1,
    })

    expect(forward).toEqual(reverse)
    expect(forward.statements).toHaveLength(1)
    expect(forward.paths[0]).toEqual({
      authors: ['root', 'a', 'd'],
      subject: target,
      sourceEventIds: ['root-a', 'a-d', 'd-target'],
    })
    expect(forward.sourceEventIds).not.toContain('b-d')
  })

  it('never traverses an i subject as a linked pubkey identity', () => {
    const graph = new LocalTrustGraph([
      statement('x-account', root, { type: 'i', value: 'alice' }, 1),
      statement('alice-target', 'alice', target, -1),
    ])

    const result = graph.query({
      rootPubkey: root,
      subject: target,
      now: 1,
    })

    expect(result.statements).toEqual([])
    expect(result.resolution).toBe('none')
  })
})

describe('replacement updates and rebuilds', () => {
  it('updates incrementally using addressable-event ordering', () => {
    const graph = new LocalTrustGraph([
      statement('middle', root, target, 1, { createdAt: 10 }),
    ])
    const initialVersion = graph.graphVersion

    expect(
      graph.upsert(
        statement('older', root, target, -1, { createdAt: 9 }),
      ),
    ).toBe(false)
    expect(graph.graphVersion).toBe(initialVersion)

    expect(
      graph.upsert(
        statement('z-cancel', root, target, 0, { createdAt: 11 }),
      ),
    ).toBe(true)
    expect(
      graph.query({ rootPubkey: root, subject: target, now: 11 }).direct,
    ).toBeUndefined()

    expect(
      graph.upsert(
        statement('a-distrust', root, target, -1, { createdAt: 11 }),
      ),
    ).toBe(true)
    expect(
      graph.query({ rootPubkey: root, subject: target, now: 11 }).direct,
    ).toMatchObject({ eventId: 'a-distrust', value: -1 })
  })

  it('rebuilds to exactly the supplied reduced statements', () => {
    const graph = new LocalTrustGraph([
      statement('first', root, target, 1),
    ])
    const before = graph.graphVersion
    const update = graph.rebuild([
      statement('replacement', root, target, -1),
    ])

    expect(update.graphVersion).toBe(before + 1)
    expect(
      graph.query({ rootPubkey: root, subject: target, now: 1 }).direct,
    ).toMatchObject({ eventId: 'replacement', value: -1 })
  })
})

describe('query boundaries', () => {
  const chain = [
    statement('root-target', root, target, 1),
    statement('root-a', root, pubkey('a'), 1),
    statement('a-target', 'a', target, -1),
    statement('a-b', 'a', pubkey('b'), 1),
    statement('b-target', 'b', target, -1),
  ]

  it('marks a depth boundary as truncated', () => {
    const result = new LocalTrustGraph(chain).query({
      rootPubkey: root,
      subject: target,
      now: 1,
      bounds: { maxDepth: 0 },
    })

    expect(result.statements.map(({ eventId }) => eventId)).toEqual([
      'root-target',
    ])
    expect(result.truncated).toBe(true)
  })

  it('enforces per-level and total-author boundaries', () => {
    const fanout = new LocalTrustGraph([
      statement('to-c', root, pubkey('c'), 1),
      statement('to-a', root, pubkey('a'), 1),
      statement('to-b', root, pubkey('b'), 1),
      statement('a-target', 'a', target, 1),
      statement('b-target', 'b', target, 1),
      statement('c-target', 'c', target, 1),
    ])

    const perLevel = fanout.query({
      rootPubkey: root,
      subject: target,
      now: 1,
      bounds: { maxAuthorsPerLevel: 2 },
    })
    expect(perLevel.statements.map(({ author }) => author)).toEqual(['a', 'b'])
    expect(perLevel.truncated).toBe(true)

    const total = fanout.query({
      rootPubkey: root,
      subject: target,
      now: 1,
      bounds: { maxTotalAuthors: 1 },
    })
    expect(total.statements).toEqual([])
    expect(total.truncated).toBe(true)
  })

  it('caps distinct source events', () => {
    const result = new LocalTrustGraph(chain).query({
      rootPubkey: root,
      subject: target,
      now: 1,
      bounds: { maxEvents: 2 },
    })

    expect(result.sourceEventIds).toHaveLength(2)
    expect(result.statements.map(({ eventId }) => eventId)).toEqual([
      'root-target',
    ])
    expect(result.truncated).toBe(true)
  })

  it('handles zero limits and rejects invalid bounds', () => {
    const graph = new LocalTrustGraph(chain)
    const none = graph.query({
      rootPubkey: root,
      subject: target,
      now: 1,
      bounds: { maxTotalAuthors: 0, maxEvents: 0 },
    })

    expect(none.statements).toEqual([])
    expect(none.sourceEventIds).toEqual([])
    expect(none.truncated).toBe(true)
    expect(() => normalizeBounds({ maxDepth: -1 })).toThrow(RangeError)
    expect(() => normalizeBounds({ maxEvents: Number.POSITIVE_INFINITY })).toThrow(
      RangeError,
    )
  })
})

describe('large synthetic graph', () => {
  it('keeps a ten-thousand-author fanout deterministic and bounded', () => {
    const statements: ReducedTrustStatement[] = []
    for (let index = 9_999; index >= 0; index -= 1) {
      const author = `node-${index.toString().padStart(5, '0')}`
      statements.push(
        statement(`edge-${author}`, root, pubkey(author), 1),
        statement(`evidence-${author}`, author, target, index % 2 ? -1 : 1),
      )
    }

    const result = new LocalTrustGraph(statements).query({
      rootPubkey: root,
      subject: target,
      now: 1,
      bounds: {
        maxDepth: 1,
        maxAuthorsPerLevel: 25,
        maxTotalAuthors: 26,
        maxEvents: 50,
      },
    })

    expect(result.statements).toHaveLength(25)
    expect(result.statements[0]?.author).toBe('node-00000')
    expect(result.statements[24]?.author).toBe('node-00024')
    expect(result.sourceEventIds).toHaveLength(50)
    expect(result.truncated).toBe(true)
    expect(result.resolution).toBe('mixed')
  })
})

describe('neighborhood', () => {
  it('returns outgoing trust and distrust edges from a pubkey', () => {
    const alice = 'alice'
    const bob = 'bob'
    const graph = new LocalTrustGraph([
      statement('t1', alice, pubkey(bob), 1, { context: 'identity' }),
      statement('d1', alice, target, -1, { context: 'identity' }),
      statement('other', bob, target, 1, { context: 'identity' }),
    ])

    const out = graph.neighborhood(`p:${alice}`, {
      direction: 'out',
      valueFilter: 'both',
      context: 'identity',
      now: 10,
    })

    expect(out.centerId).toBe(`p:${alice}`)
    expect(out.edges).toHaveLength(2)
    expect(out.edges.map((e) => e.to).sort()).toEqual([
      `i:${target.value}`,
      `p:${bob}`,
    ])
  })

  it('returns incoming edges to a terminal subject', () => {
    const alice = 'alice'
    const bob = 'bob'
    const graph = new LocalTrustGraph([
      statement('a', alice, target, 1, { context: 'news:accuracy' }),
      statement('b', bob, target, -1, { context: 'news:accuracy' }),
    ])

    const incoming = graph.neighborhood(`i:${target.value}`, {
      direction: 'in',
      valueFilter: 'distrust',
      context: 'news:accuracy',
      now: 10,
    })

    expect(incoming.edges).toHaveLength(1)
    expect(incoming.edges[0]?.from).toBe(`p:${bob}`)
    expect(incoming.edges[0]?.value).toBe(-1)
  })

  it('honors context fallback and continues past cancelled slots', () => {
    const graph = new LocalTrustGraph([
      statement('general', root, target, 1),
      statement('cancelled', root, target, 0, {
        context: 'news:accuracy',
        createdAt: 2,
      }),
    ])

    expect(
      graph.neighborhood(`p:${root}`, {
        direction: 'out',
        context: 'news:accuracy',
        now: 10,
      }).edges.map((edge) => edge.eventId),
    ).toEqual(['general'])

    expect(
      graph.neighborhood(`p:${root}`, {
        direction: 'out',
        context: 'identity',
        now: 10,
      }).edges.map((edge) => edge.eventId),
    ).toEqual(['general'])
  })

  it('bounds results and reports truncation', () => {
    const graph = new LocalTrustGraph([
      statement('one', root, pubkey('one'), 1),
      statement('two', root, pubkey('two'), 1),
    ])

    const result = graph.neighborhood(`p:${root}`, {
      direction: 'out',
      limit: 1,
      now: 10,
    })

    expect(result.edges).toHaveLength(1)
    expect(result.truncated).toBe(true)
  })

  it('uses Unix seconds for active-window checks by default', () => {
    const now = Math.floor(Date.now() / 1_000)
    const graph = new LocalTrustGraph([
      statement('active', root, target, 1, {
        activeFrom: now - 60,
        activeUntil: now + 60,
      }),
    ])

    expect(
      graph.neighborhood(`p:${root}`, { direction: 'out' }).edges,
    ).toHaveLength(1)
  })
})
