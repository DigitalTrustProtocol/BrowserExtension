import { describe, expect, it } from 'vitest'
import { contextCandidates } from './context'
import {
  LocalTrustGraph,
  normalizeBounds,
  normalizeResolveBounds,
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
      'context' | 'createdAt' | 'activeFrom' | 'activeUntil' | 'content' | 'labels' | 'labelHints'
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
    ...(options.content === undefined ? {} : { content: options.content }),
    ...(options.labels === undefined ? {} : { labels: options.labels }),
    ...(options.labelHints === undefined
      ? {}
      : { labelHints: options.labelHints }),
  }
}

function pubkey(value: string): TrustSubject {
  return { type: 'p', value }
}

function nodeIndexId(graph: LocalTrustGraph, heapId: string): number {
  const index = graph.trustGraph.nodesIndex.get(heapId.toLowerCase())
  if (index === undefined) throw new Error(`missing heap node ${heapId}`)
  return index
}

function pathSubjectValues(result: {
  pathView?: { nodes: Array<{ subject?: TrustSubject }> }
}): string[] {
  return (result.pathView?.nodes ?? [])
    .map((node) => node.subject?.value)
    .filter((value): value is string => Boolean(value))
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

  it('falls back when a deleted specific slot has no active edge', () => {
    const graph = new LocalTrustGraph([
      statement('general', root, target, 1),
      statement('security', root, target, -1, { context: 'security' }),
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
      value: -1,
    })
    expect(result.resolution).toBe('distrusted')
    expect(result.trust).toBe(0)
    expect(result.distrust).toBe(1)
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
      value: 1,
    })
  })
})

describe('IndexResolver early-stop', () => {
  it('follows only active positive p edges; ignores distrust/cancel/terminal peers', () => {
    const graph = new LocalTrustGraph([
      statement('to-alice', root, pubkey('alice'), 1),
      statement('alice-evidence', 'alice', target, 1),
      statement('distrust-bob', root, pubkey('bob'), -1),
      statement('bob-evidence', 'bob', target, -1),
      statement('cancel-carol', root, pubkey('carol'), 0),
      statement('carol-evidence', 'carol', target, -1),
      statement('terminal-i', root, { type: 'i', value: 'dave' }, 1),
      statement('dave-evidence', 'dave', target, -1),
    ])

    const result = graph.query({
      rootPubkey: root,
      subject: target,
      now: 10,
    })

    expect(result.connected).toBe(true)
    expect(result.trust).toBe(1)
    expect(result.distrust).toBe(0)
    expect(result.degree).toBe(2)
    expect(result.resolution).toBe('trusted')
    expect(result.statements.map(({ eventId }) => eventId)).toEqual([
      'alice-evidence',
    ])
  })

  it('stops at direct trust and ignores deeper distrust', () => {
    const graph = new LocalTrustGraph([
      statement('root-target', root, target, 1),
      statement('root-alice', root, pubkey('alice'), 1),
      statement('alice-target', 'alice', target, -1),
    ])

    const result = graph.query({
      rootPubkey: root,
      subject: target,
      now: 50,
    })

    expect(result.resolution).toBe('trusted')
    expect(result.trust).toBe(1)
    expect(result.distrust).toBe(0)
    expect(result.degree).toBe(1)
    expect(result.direct).toMatchObject({
      eventId: 'root-target',
      distance: 0,
    })
    expect(result.statements.map(({ eventId }) => eventId)).toEqual([
      'root-target',
    ])
  })

  it('aggregates all trustees at the hitting degree', () => {
    const graph = new LocalTrustGraph([
      statement('to-a', root, pubkey('a'), 1),
      statement('to-b', root, pubkey('b'), 1),
      statement('to-c', root, pubkey('c'), 1),
      statement('a-target', 'a', target, 1),
      statement('b-target', 'b', target, 1),
      statement('c-target', 'c', target, -1),
    ])

    const result = graph.query({
      rootPubkey: root,
      subject: target,
      now: 1,
    })

    expect(result.degree).toBe(2)
    expect(result.trust).toBe(2)
    expect(result.distrust).toBe(1)
    expect(result.resolution).toBe('mixed') // 2/3 ≈ 0.67
    expect(result.statements).toHaveLength(3)
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

    expect(result.connected).toBe(false)
    expect(result.resolution).toBe('none')
  })

  it('returns path data only when format is path', () => {
    const graph = new LocalTrustGraph([
      statement('to-alice', root, pubkey('alice'), 1),
      statement('alice-evidence', 'alice', target, 1),
    ])

    const scored = graph.query({
      rootPubkey: root,
      subject: target,
      now: 1,
      format: 'default',
    })
    expect(scored.paths).toEqual([])
    expect(scored.pathView?.nodes ?? []).toEqual([])

    const withPath = graph.query({
      rootPubkey: root,
      subject: target,
      now: 1,
      format: 'path',
    })
    expect(withPath.paths).toEqual([])
    expect(withPath.pathView?.nodes.length).toBeGreaterThan(0)
    expect(pathSubjectValues(withPath)).toContain('alice')
    expect(
      withPath.pathView?.nodes.every((node) => typeof node.id === 'number'),
    ).toBe(true)
  })

  it('reconstructs every hop on a degree-4 path', () => {
    const graph = new LocalTrustGraph([
      statement('r-a', root, pubkey('a'), 1),
      statement('a-b', 'a', pubkey('b'), 1),
      statement('b-c', 'b', pubkey('c'), 1),
      statement('c-target', 'c', target, 1),
    ])

    const result = graph.query({
      rootPubkey: root,
      subject: target,
      now: 1,
      format: 'path',
    })

    expect(result.degree).toBe(4)
    expect(result.paths).toEqual([])
    expect(pathSubjectValues(result)).toEqual(
      expect.arrayContaining([root, 'a', 'b', 'c', target.value]),
    )
  })

  it('keeps parallel shortest-path authors at the same degree', () => {
    const graph = new LocalTrustGraph([
      statement('r-a', root, pubkey('a'), 1),
      statement('r-x', root, pubkey('x'), 1),
      statement('a-b', 'a', pubkey('b'), 1),
      statement('x-b', 'x', pubkey('b'), 1),
      statement('b-target', 'b', target, 1),
    ])

    const result = graph.query({
      rootPubkey: root,
      subject: target,
      now: 1,
      format: 'path',
    })

    expect(result.degree).toBe(3)
    expect(pathSubjectValues(result)).toEqual(
      expect.arrayContaining(['a', 'x', 'b']),
    )
  })

  it('caps maxDepth at 5 (me → 1 → 2 → 3 → 4 → target)', () => {
    const graph = new LocalTrustGraph([
      statement('r-a', root, pubkey('a'), 1),
      statement('a-b', 'a', pubkey('b'), 1),
      statement('b-c', 'b', pubkey('c'), 1),
      statement('c-d', 'c', pubkey('d'), 1),
      statement('d-e', 'd', pubkey('e'), 1),
      statement('e-target', 'e', target, 1),
    ])

    const deep = graph.query({
      rootPubkey: root,
      subject: target,
      now: 1,
      bounds: { maxDepth: 10 },
    })
    // degree 6 would be needed; hard cap 5 → not connected
    expect(deep.connected).toBe(false)

    const atCap = new LocalTrustGraph([
      statement('r-a', root, pubkey('a'), 1),
      statement('a-b', 'a', pubkey('b'), 1),
      statement('b-c', 'b', pubkey('c'), 1),
      statement('c-d', 'c', pubkey('d'), 1),
      statement('d-target', 'd', target, 1),
    ]).query({
      rootPubkey: root,
      subject: target,
      now: 1,
      bounds: { maxDepth: 5 },
    })

    expect(atCap.connected).toBe(true)
    expect(atCap.degree).toBe(5)

    const cappedFour = new LocalTrustGraph([
      statement('r-a', root, pubkey('a'), 1),
      statement('a-b', 'a', pubkey('b'), 1),
      statement('b-c', 'b', pubkey('c'), 1),
      statement('c-d', 'c', pubkey('d'), 1),
      statement('d-target', 'd', target, 1),
    ]).query({
      rootPubkey: root,
      subject: target,
      now: 1,
      bounds: { maxDepth: 4 },
    })
    expect(cappedFour.connected).toBe(false)
  })
})

describe('replacement updates and rebuilds', () => {
  it('updates incrementally using addressable-event ordering', () => {
    const graph = new LocalTrustGraph([
      statement('middle', root, target, 1, { createdAt: 10 }),
    ])
    const initialVersion = graph.graphVersion

    expect(
      graph.upsert(statement('older', root, target, -1, { createdAt: 9 })),
    ).toBe(false)
    expect(graph.graphVersion).toBe(initialVersion)

    expect(
      graph.upsert(statement('z-neutral', root, target, 0, { createdAt: 11 })),
    ).toBe(true)
    expect(
      graph.query({ rootPubkey: root, subject: target, now: 11 }).direct,
    ).toMatchObject({ eventId: 'z-neutral', value: 0 })

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
    const graph = new LocalTrustGraph([statement('first', root, target, 1)])
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
  it('rejects invalid resolve and sync bounds', () => {
    expect(() => normalizeResolveBounds({ maxDepth: -1 })).toThrow(RangeError)
    expect(() => normalizeBounds({ maxDepth: -1 })).toThrow(RangeError)
    expect(() =>
      normalizeBounds({ maxEvents: Number.POSITIVE_INFINITY }),
    ).toThrow(RangeError)
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

    const out = graph.neighborhood(nodeIndexId(graph, alice), {
      direction: 'out',
      valueFilter: 'both',
      context: 'identity',
      now: 10,
    })

    expect(out.centerId).toBe(nodeIndexId(graph, alice))
    expect(out.edges).toHaveLength(2)
    expect(out.edges.map((e) => e.to).sort()).toEqual(
      [nodeIndexId(graph, target.value), nodeIndexId(graph, bob)].sort(),
    )
  })

  it('returns incoming edges to a terminal subject', () => {
    const alice = 'alice'
    const bob = 'bob'
    const graph = new LocalTrustGraph([
      statement('a', alice, target, 1, { context: 'news:accuracy' }),
      statement('b', bob, target, -1, { context: 'news:accuracy' }),
    ])

    const incoming = graph.neighborhood(nodeIndexId(graph, target.value), {
      direction: 'in',
      valueFilter: 'distrust',
      context: 'news:accuracy',
      now: 10,
    })

    expect(incoming.edges).toHaveLength(1)
    expect(incoming.edges[0]?.from).toBe(nodeIndexId(graph, bob))
    expect(incoming.edges[0]?.value).toBe(-1)
  })

  it('walks outboundPubkeys as their own heap nodes', () => {
    const elon = 'elonpk'
    const elonUser: TrustSubject = { type: 'i', value: 'user:id:44196397' }
    const spacex: TrustSubject = { type: 'i', value: 'user:id:34743251' }
    const graph = new LocalTrustGraph([
      statement('e-s', elon, spacex, 1, { context: 'identity' }),
      statement('e-u', elon, elonUser, 1, { context: 'identity' }),
    ])

    const out = graph.neighborhood(nodeIndexId(graph, elonUser.value), {
      direction: 'out',
      valueFilter: 'both',
      context: 'identity',
      now: 10,
      outboundPubkeys: [elon],
    })

    expect(out.centerId).toBe(nodeIndexId(graph, elonUser.value))
    expect(
      out.edges.some(
        (edge) =>
          edge.from === nodeIndexId(graph, elon) &&
          edge.to === nodeIndexId(graph, spacex.value),
      ),
    ).toBe(true)
    expect(out.nodes.some((node) => node.id === nodeIndexId(graph, elon))).toBe(
      true,
    )
  })

  it('emits Neutral edges without walking Neutral hops', () => {
    const alice = 'alice'
    const bob = 'bob'
    const graph = new LocalTrustGraph([
      statement('root-alice', root, pubkey(alice), 1, { context: 'identity' }),
      statement('alice-bob', alice, pubkey(bob), 0, { context: 'identity' }),
      statement('bob-target', bob, target, 1, { context: 'identity' }),
    ])

    const snap = graph.egoSnapshot(root, {
      context: 'identity',
      now: 10,
      maxDepth: 4,
    })
    expect(
      snap.edges.some((edge) => edge.eventId === 'alice-bob' && edge.value === 0),
    ).toBe(true)
    expect(snap.edges.some((edge) => edge.eventId === 'bob-target')).toBe(false)

    const out = graph.neighborhood(nodeIndexId(graph, alice), {
      direction: 'out',
      valueFilter: 'both',
      context: 'identity',
      now: 10,
    })
    expect(
      out.edges.some(
        (edge) => edge.value === 0 && edge.to === nodeIndexId(graph, bob),
      ),
    ).toBe(true)
  })

  it('shows incoming rating arrows on a post center', () => {
    const post: TrustSubject = { type: 'i', value: 'post:id:99' }
    const graph = new LocalTrustGraph([
      statement('root-alice', root, { type: 'p', value: 'alice' }, 1),
      statement('seed-post', 'seed', post, 1),
    ])
    graph.rebuildClaims([
      {
        eventId: 'rate-alice',
        author: 'alice',
        subject: post,
        context: '',
        score: 80,
        labels: ['genuine'],
        content: '',
        createdAt: 1,
      },
      {
        eventId: 'rate-root',
        author: root,
        subject: post,
        context: '',
        score: 20,
        labels: ['misleading'],
        content: '',
        createdAt: 1,
      },
    ])

    const incoming = graph.neighborhood(nodeIndexId(graph, post.value), {
      direction: 'in',
      valueFilter: 'both',
      now: 10,
    })

    expect(incoming.nodes.some((node) => node.id === nodeIndexId(graph, post.value))).toBe(
      true,
    )
    expect(incoming.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: nodeIndexId(graph, 'alice'),
          to: nodeIndexId(graph, post.value),
          value: 1,
          eventId: 'rate-alice',
        }),
        expect.objectContaining({
          from: nodeIndexId(graph, root),
          to: nodeIndexId(graph, post.value),
          value: -1,
          eventId: 'rate-root',
        }),
      ]),
    )
  })

  it('keeps Neutral in the graph without following it as a hop', () => {
    const alice = 'alice'
    const bob = 'bob'
    const graph = new LocalTrustGraph([
      statement('root-alice', root, pubkey(alice), 1),
      statement('alice-bob', alice, pubkey(bob), 0, {
        content: 'Neither endorsed nor opposed.',
      }),
      statement('alice-target', alice, target, 0),
      statement('bob-target', bob, target, 1),
    ])

    const hop = graph.query({
      rootPubkey: root,
      subject: pubkey(bob),
      now: 10,
    })
    expect(hop.connected).toBe(false)
    expect(hop.statements.some((stmt) => stmt.eventId === 'alice-bob')).toBe(
      true,
    )
    expect(hop.statements.find((stmt) => stmt.eventId === 'alice-bob')?.value).toBe(
      0,
    )
    expect(
      hop.statements.find((stmt) => stmt.eventId === 'alice-bob')?.content,
    ).toBe('Neither endorsed nor opposed.')

    const ofTarget = graph.query({
      rootPubkey: root,
      subject: target,
      now: 10,
      format: 'path',
    })
    expect(ofTarget.resolution).toBe('none')
    expect(ofTarget.trust).toBe(0)
    expect(
      ofTarget.statements.some((stmt) => stmt.eventId === 'alice-target'),
    ).toBe(true)
    expect(
      ofTarget.statements.find((stmt) => stmt.eventId === 'alice-target')
        ?.content,
    ).toBeUndefined()
  })

  it('carries label tokens and display hints without changing scores', () => {
    const graph = new LocalTrustGraph([
      statement('own', root, target, 1, {
        labels: ['reviewer'],
        labelHints: {
          reviewer: 'Trusted reviewer of aerospace accounts',
        },
      }),
    ])

    const result = graph.query({
      rootPubkey: root,
      subject: target,
      now: 10,
    })

    expect(result.trust).toBe(1)
    expect(result.distrust).toBe(0)
    expect(result.statements[0]?.labels).toEqual(['reviewer'])
    expect(result.statements[0]?.labelHints).toEqual({
      reviewer: 'Trusted reviewer of aerospace accounts',
    })
  })

  it('keeps Neutral only at the Trust hitting degree on Path', () => {
    const graph = new LocalTrustGraph([
      statement('root-alice', root, pubkey('alice'), 1),
      statement('alice-neutral', 'alice', target, 0),
      statement('alice-bob', 'alice', pubkey('bob'), 1),
      statement('bob-trust', 'bob', target, 1),
    ])

    const result = graph.query({
      rootPubkey: root,
      subject: target,
      now: 10,
      format: 'path',
    })

    expect(result.degree).toBe(3)
    expect(result.trust).toBe(1)
    expect(result.statements.map((row) => row.eventId).sort()).toEqual([
      'alice-neutral',
      'bob-trust',
    ])
    expect(pathSubjectValues(result)).toEqual(
      expect.arrayContaining([root, 'alice', 'bob', target.value]),
    )
    expect(
      result.pathView?.edges.some((edge) => edge.value === 0),
    ).toBe(true)
  })

  it('shows Neutral last-degree authors next to Trust at the hitting degree', () => {
    const graph = new LocalTrustGraph([
      statement('root-alice', root, pubkey('alice'), 1),
      statement('root-bob', root, pubkey('bob'), 1),
      statement('alice-neutral', 'alice', target, 0),
      statement('bob-trust', 'bob', target, 1),
    ])

    const result = graph.query({
      rootPubkey: root,
      subject: target,
      now: 10,
      format: 'path',
    })

    expect(result.degree).toBe(2)
    expect(result.trust).toBe(1)
    expect(result.statements.map((row) => row.eventId).sort()).toEqual([
      'alice-neutral',
      'bob-trust',
    ])
  })

  it('does not fall through a Neutral context slot', () => {
    const graph = new LocalTrustGraph([
      statement('general', root, target, 1),
      statement('neutral', root, target, 0, {
        context: 'security:audit',
        content: 'Watching this purpose.',
      }),
    ])

    const result = graph.query({
      rootPubkey: root,
      subject: target,
      context: 'security:audit',
      now: 10,
      format: 'path',
    })

    expect(result.direct).toMatchObject({
      eventId: 'neutral',
      value: 0,
      content: 'Watching this purpose.',
    })
    expect(result.resolution).toBe('none')
    expect(result.trust).toBe(0)
  })

  it('bounds results and reports truncation', () => {
    const graph = new LocalTrustGraph([
      statement('one', root, pubkey('one'), 1),
      statement('two', root, pubkey('two'), 1),
    ])

    const result = graph.neighborhood(nodeIndexId(graph, root), {
      direction: 'out',
      limit: 1,
      now: 10,
    })

    expect(result.edges).toHaveLength(1)
    expect(result.truncated).toBe(true)
  })
})
