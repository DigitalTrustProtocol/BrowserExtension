import { describe, expect, it } from 'vitest'
import {
  buildSeedGraphData,
  collapseExpansion,
  mergeNeighborhood,
  mergeTrustAndRatingForPath,
  omitPostNeighborsUnlessCenterIsPost,
  pathsToGraph,
  graphNodeClickIntent,
} from './graph-view-data'
import { collapseBoundPubkeyAliases } from './graph-display'
import type { GraphVizData, GraphVizLink } from './types'
import type { GraphSnapshotNode } from '../../shared/contracts'
import type { TrustQueryResult } from '../../graph'

describe('graph-view-data', () => {
  it('buildSeedGraphData seeds root-only or focus-only', () => {
    const withFocus = buildSeedGraphData('rootpk', 'i:user:id:42')
    expect(withFocus.nodes).toHaveLength(1)
    expect(withFocus.nodes[0]?.id).toBe('i:user:id:42')
    expect(withFocus.nodes[0]?.isFocus).toBe(true)
    expect(withFocus.nodes[0]?.isRoot).toBeUndefined()

    const rootOnly = buildSeedGraphData('rootpk', 'p:rootpk')
    expect(rootOnly.nodes).toHaveLength(1)
    expect(rootOnly.nodes[0]?.isRoot).toBe(true)

    const defaultRoot = buildSeedGraphData('rootpk', undefined)
    expect(defaultRoot.nodes).toHaveLength(1)
    expect(defaultRoot.nodes[0]?.id).toBe('p:rootpk')
  })

  it('mergeNeighborhood marks center expanded and tracks owners', () => {
    const seed: GraphVizData = {
      nodes: [
        {
          id: 'p:root',
          kind: 'pubkey',
          depth: 0,
          label: 'You',
          isRoot: true,
        },
      ],
      links: [],
    }
    const merged = mergeNeighborhood(
      seed,
      'p:root',
      [
        {
          id: 'p:root',
          kind: 'pubkey',
          depth: 0,
          label: 'You',
        },
        {
          id: 'p:alice',
          kind: 'pubkey',
          depth: 1,
          label: 'alice',
        },
      ],
      [
        {
          id: 'e1',
          source: 'p:root',
          target: 'p:alice',
          value: 1,
          context: '',
          eventId: 'ev1',
          depth: 1,
        },
      ],
    )
    expect(merged.nodes.find((n) => n.id === 'p:root')?.expanded).toBe(true)
    expect(merged.nodes.find((n) => n.id === 'p:root')?.unidentifiedKind).toBeUndefined()
    expect(
      merged.nodes.find((n) => n.id === 'p:alice')?.expandedFrom,
    ).toEqual(['p:root'])
    expect(merged.nodes.find((n) => n.id === 'p:alice')?.unidentifiedKind).toBe(
      'external',
    )
  })

  it('mergeNeighborhood keeps chrome on existing nodes, not snapshot adds', () => {
    const current: GraphVizData = {
      nodes: [
        {
          id: 'i:user:id:1',
          kind: 'twitter_id',
          depth: 1,
          label: 'Tesla',
          subtitle: '@Tesla',
          picture: 'https://pbs.twimg.com/profile_images/1/a_200x200.png',
          expandedFrom: ['p:root'],
        },
      ],
      links: [],
    }
    const kept = mergeNeighborhood(current, 'p:root', [], [])
    expect(kept.nodes[0]?.picture).toBe(
      'https://pbs.twimg.com/profile_images/1/a_200x200.png',
    )
    const readded = mergeNeighborhood(
      { nodes: [], links: [] },
      'p:root',
      [
        {
          id: 'i:user:id:1',
          kind: 'twitter_id',
          depth: 1,
          label: 'X · 1',
        },
      ],
      [],
    )
    expect(readded.nodes[0]?.picture).toBeUndefined()
  })

  it('omitPostNeighborsUnlessCenterIsPost drops posts under user expand', () => {
    const nodes: GraphSnapshotNode[] = [
      {
        id: 'p:alice',
        kind: 'pubkey',
        depth: 1,
        label: 'alice',
      },
      {
        id: 'i:post:id:99',
        kind: 'post',
        depth: 1,
        label: 'Post · 99',
      },
    ]
    const links: GraphVizLink[] = [
      {
        id: 'e-user',
        source: 'p:root',
        target: 'p:alice',
        value: 1,
        context: '',
        eventId: 'ev1',
        depth: 1,
      },
      {
        id: 'e-post',
        source: 'p:root',
        target: 'i:post:id:99',
        value: 1,
        context: '',
        eventId: 'ev2',
        depth: 1,
      },
    ]
    const filtered = omitPostNeighborsUnlessCenterIsPost('p:root', nodes, links)
    expect(filtered.nodes.map((n) => n.id)).toEqual(['p:alice'])
    expect(filtered.links.map((l) => l.id)).toEqual(['e-user'])
  })

  it('omitPostNeighborsUnlessCenterIsPost keeps posts when center is a post', () => {
    const nodes: GraphSnapshotNode[] = [
      {
        id: 'p:alice',
        kind: 'pubkey',
        depth: 1,
        label: 'alice',
      },
    ]
    const links: GraphVizLink[] = [
      {
        id: 'e-trust',
        source: 'p:alice',
        target: 'i:post:id:99',
        value: 1,
        context: '',
        eventId: 'ev1',
        depth: 1,
      },
    ]
    const filtered = omitPostNeighborsUnlessCenterIsPost(
      'i:post:id:99',
      nodes,
      links,
    )
    expect(filtered.nodes).toEqual(nodes)
    expect(filtered.links).toEqual(links)
  })

  it('collapseExpansion removes owned neighbors', () => {
    const data: GraphVizData = {
      nodes: [
        {
          id: 'p:root',
          kind: 'pubkey',
          depth: 0,
          label: 'You',
          isRoot: true,
          expanded: true,
        },
        {
          id: 'p:alice',
          kind: 'pubkey',
          depth: 1,
          label: 'alice',
          expandedFrom: ['p:root'],
        },
      ],
      links: [
        {
          id: 'e1',
          source: 'p:root',
          target: 'p:alice',
          value: 1,
          context: '',
          eventId: 'ev1',
          depth: 1,
          expandedFrom: ['p:root'],
        },
      ],
    }
    const collapsed = collapseExpansion(data, 'p:root', 'p:root')
    expect(collapsed.nodes.map((n) => n.id)).toEqual(['p:root'])
    expect(collapsed.links).toHaveLength(0)
    expect(collapsed.nodes[0]?.expanded).toBe(false)
  })

  it('lays out a degree-4 path as five left-to-right columns', () => {
    const subject = { type: 'i' as const, value: 'user:id:11348282' }
    const result: TrustQueryResult = {
      subject,
      context: '',
      resolution: 'trusted',
      trust: 1,
      distrust: 0,
      trustValue: 1,
      degree: 4,
      connected: true,
      statements: [
        {
          eventId: 'c-nasa',
          author: 'c',
          subject,
          context: '',
          requestedContext: '',
          contextMatch: 'exact',
          value: 1,
          createdAt: 1,
          distance: 3,
        },
      ],
      paths: [
        {
          authors: ['rootpk', 'a', 'b', 'c'],
          subject,
          sourceEventIds: ['r-a', 'a-b', 'b-c'],
        },
      ],
      sourceEventIds: ['c-nasa'],
      computedAt: 1,
      graphVersion: 1,
      truncated: false,
    }
    const data = pathsToGraph(result, 'rootpk')
    expect(data.nodes.find((n) => n.isRoot)?.depth).toBe(0)
    expect(data.nodes.find((n) => n.id === 'p:a')?.depth).toBe(1)
    expect(data.nodes.find((n) => n.id === 'p:b')?.depth).toBe(2)
    expect(data.nodes.find((n) => n.id === 'p:c')?.depth).toBe(3)
    expect(data.nodes.find((n) => n.isFocus)?.depth).toBe(4)
    expect(data.nodes.find((n) => n.isFocus)?.id).toBe('i:user:id:11348282')
  })

  it('collapses a bound Path hop onto the focus user:id', () => {
    const subject = { type: 'i' as const, value: 'user:id:44196397' }
    const elon = 'a'.repeat(64)
    const result: TrustQueryResult = {
      subject,
      context: 'identity',
      resolution: 'none',
      trust: 1,
      distrust: 0,
      trustValue: 1,
      degree: 2,
      connected: true,
      statements: [
        {
          eventId: 'elon-self',
          author: elon,
          subject,
          context: 'identity',
          requestedContext: 'identity',
          contextMatch: 'exact',
          value: 1,
          createdAt: 1,
          distance: 1,
        },
      ],
      paths: [
        {
          authors: ['rootpk', elon],
          subject,
          sourceEventIds: ['root-elon', 'elon-self'],
        },
      ],
      sourceEventIds: ['elon-self'],
      computedAt: 1,
      graphVersion: 1,
      truncated: false,
    }
    const collapsed = collapseBoundPubkeyAliases(pathsToGraph(result, 'rootpk'), {
      xByTwitterId: new Map(),
      xByPubkey: new Map([
        [elon, { twitterId: '44196397', displayName: 'Elon Musk' }],
      ]),
      profileByPubkey: new Map(),
      postById: new Map(),
    })
    expect(collapsed.nodes.find((n) => n.isRoot)?.id).toBe('p:rootpk')
    expect(collapsed.nodes.filter((n) => n.id === `p:${elon}`)).toHaveLength(0)
    expect(collapsed.nodes.filter((n) => n.id === 'i:user:id:44196397')).toHaveLength(
      1,
    )
  })

  it('preserves Neutral final-statement values on Path edges', () => {
    const subject = { type: 'i' as const, value: 'user:id:42' }
    const result: TrustQueryResult = {
      subject,
      context: 'identity',
      resolution: 'none',
      trust: 0,
      distrust: 0,
      trustValue: 0,
      degree: 1,
      connected: true,
      statements: [
        {
          eventId: 'neutral-own',
          author: 'rootpk',
          subject,
          context: 'identity',
          requestedContext: 'identity',
          contextMatch: 'exact',
          value: 0,
          createdAt: 1,
          distance: 0,
        },
      ],
      paths: [
        {
          authors: ['rootpk'],
          subject,
          sourceEventIds: ['neutral-own'],
        },
      ],
      sourceEventIds: ['neutral-own'],
      computedAt: 1,
      graphVersion: 1,
      truncated: false,
    }
    const data = pathsToGraph(result, 'rootpk')
    const last = data.links.find(
      (link) =>
        (typeof link.target === 'string' ? link.target : link.target.id) ===
        'i:user:id:42',
    )
    expect(last?.value).toBe(0)
    expect(data.links.filter((link) => link.value === 0)).toHaveLength(1)
  })

  it('keeps Path hop edges as Trust and Neutral only on the last degree', () => {
    const subject = { type: 'i' as const, value: 'user:id:42' }
    const result: TrustQueryResult = {
      subject,
      context: 'identity',
      resolution: 'none',
      trust: 0,
      distrust: 0,
      trustValue: 0,
      degree: 2,
      connected: true,
      statements: [
        {
          eventId: 'alice-neutral',
          author: 'alice',
          subject,
          context: 'identity',
          requestedContext: 'identity',
          contextMatch: 'exact',
          value: 0,
          createdAt: 1,
          distance: 1,
        },
      ],
      paths: [
        {
          authors: ['rootpk', 'alice'],
          subject,
          sourceEventIds: ['root-alice'],
        },
      ],
      sourceEventIds: ['alice-neutral'],
      computedAt: 1,
      graphVersion: 1,
      truncated: false,
    }
    const data = pathsToGraph(result, 'rootpk')
    const hops = data.links.filter(
      (link) =>
        (typeof link.target === 'string' ? link.target : link.target.id) !==
        'i:user:id:42',
    )
    const last = data.links.filter(
      (link) =>
        (typeof link.target === 'string' ? link.target : link.target.id) ===
        'i:user:id:42',
    )
    expect(hops.every((link) => link.value === 1)).toBe(true)
    expect(last).toEqual([expect.objectContaining({ value: 0 })])
  })

  it('draws a post Path from rating issuers to the post', () => {
    const post = { type: 'i' as const, value: 'post:id:99' }
    const emptyTrust: TrustQueryResult = {
      subject: post,
      context: '',
      resolution: 'none',
      trust: 0,
      distrust: 0,
      trustValue: 0,
      degree: 0,
      connected: false,
      statements: [],
      paths: [],
      sourceEventIds: [],
      computedAt: 1,
      graphVersion: 1,
      truncated: false,
    }
    const merged = mergeTrustAndRatingForPath(
      emptyTrust,
      {
        subject: post,
        context: '',
        claims: [
          {
            eventId: 'rate-alice',
            author: 'alice',
            subject: post,
            context: '',
            score: 80,
            labels: [],
            content: '',
            createdAt: 1,
            distance: 1,
          },
        ],
        averageScore: 80,
        claimCount: 1,
        degree: 2,
        sourceEventIds: ['rate-alice'],
        paths: [
          {
            authors: ['rootpk', 'alice'],
            subject: post,
            sourceEventIds: ['r-a', 'rate-alice'],
          },
        ],
        computedAt: 1,
        graphVersion: 1,
      },
      'rootpk',
    )
    const data = pathsToGraph(merged, 'rootpk')
    expect(data.nodes.find((n) => n.isFocus)?.id).toBe('i:post:id:99')
    expect(data.nodes.find((n) => n.isRoot)?.id).toBe('p:rootpk')
    expect(data.nodes.some((n) => n.id === 'p:alice')).toBe(true)
    expect(
      data.links.some((link) => {
        const source = typeof link.source === 'string' ? link.source : link.source.id
        const target = typeof link.target === 'string' ? link.target : link.target.id
        return source === 'p:rootpk' && target === 'p:alice'
      }),
    ).toBe(true)
    expect(
      data.links.some((link) => {
        const source = typeof link.source === 'string' ? link.source : link.source.id
        const target = typeof link.target === 'string' ? link.target : link.target.id
        return source === 'p:alice' && target === 'i:post:id:99'
      }),
    ).toBe(true)
  })
})

describe('graphNodeClickIntent', () => {
  it('expands a collapsed node on the first click', () => {
    expect(
      graphNodeClickIntent({
        isDouble: false,
        expandedNow: false,
        expandedOnFirstClick: false,
      }),
    ).toBe('expand')
  })

  it('selects an already-expanded node on a single click', () => {
    expect(
      graphNodeClickIntent({
        isDouble: false,
        expandedNow: true,
        expandedOnFirstClick: true,
      }),
    ).toBe('select')
  })

  it('collapses only when the first click of the pair was already expanded', () => {
    expect(
      graphNodeClickIntent({
        isDouble: true,
        expandedNow: true,
        expandedOnFirstClick: true,
      }),
    ).toBe('collapse')
    expect(
      graphNodeClickIntent({
        isDouble: true,
        expandedNow: false,
        expandedOnFirstClick: false,
      }),
    ).toBe('select')
  })
})
