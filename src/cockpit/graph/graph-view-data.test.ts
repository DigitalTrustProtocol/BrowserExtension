import { describe, expect, it } from 'vitest'
import { t } from '../../lib/i18n'
import {
  collapseExpansion,
  mergeNeighborhood,
  mergeTrustAndRatingForPath,
  omitPostNeighborsUnlessCenterIsPost,
  pathsToGraph,
  neighborhoodToGraph,
  graphNodeClickIntent,
} from './graph-view-data'
import { collapseBoundPubkeyAliases } from './graph-display'
import { linkEndpointId, type GraphVizData, type GraphVizLink } from './types'
import type { GraphSnapshotNode } from '../../shared/contracts'
import type { TrustQueryResult } from '../../graph'

describe('graph-view-data', () => {
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
      {
        id: '99',
        kind: 'post',
        subject: { type: 'i', value: 'post:id:99' },
      },
      nodes,
      links,
    )
    expect(filtered.nodes).toEqual(nodes)
    expect(filtered.links).toEqual(links)
  })

  it('neighborhoodToGraph labels the root You, not a truncated hex', () => {
    const rootHex = 'a'.repeat(64)
    const data = neighborhoodToGraph(
      {
        centerId: 0,
        nodes: [
          {
            id: 0,
            kind: 'pubkey',
            depth: 0,
            label: `${rootHex.slice(0, 12)}…`,
            subject: { type: 'p', value: rootHex },
          },
          {
            id: 1,
            kind: 'twitter_id',
            depth: 1,
            label: 'X · 44196397',
            subject: { type: 'i', value: 'user:id:44196397' },
          },
        ],
        edges: [
          {
            id: 10,
            from: 0,
            to: 1,
            value: 1,
            context: 'identity',
            eventId: 'root-elon',
            depth: 1,
          },
        ],
      },
      rootHex,
    )
    const you = data.nodes.find((n) => n.isRoot)
    expect(you?.label).toBe(t('graph.you'))
    expect(you?.id).toBe(0)
    expect(you?.label).not.toBe(`${rootHex.slice(0, 12)}…`)
    expect(data.nodes.find((n) => n.id === 1)?.label).toBe('X · 44196397')
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
      statements: [],
      paths: [],
      pathView: {
        nodes: [
          {
            id: 0,
            kind: 'pubkey',
            depth: 0,
            label: 'You',
            subject: { type: 'p', value: 'rootpk' },
          },
          {
            id: 1,
            kind: 'pubkey',
            depth: 1,
            label: 'a',
            subject: { type: 'p', value: 'a' },
          },
          {
            id: 2,
            kind: 'pubkey',
            depth: 2,
            label: 'b',
            subject: { type: 'p', value: 'b' },
          },
          {
            id: 3,
            kind: 'pubkey',
            depth: 3,
            label: 'c',
            subject: { type: 'p', value: 'c' },
          },
          {
            id: 4,
            kind: 'twitter_id',
            depth: 4,
            label: 'X · 11348282',
            subject,
          },
        ],
        edges: [],
      },
      sourceEventIds: ['c-nasa'],
      computedAt: 1,
      graphVersion: 1,
      truncated: false,
      followTrustRed: 25, followTrustThreshold: 75,
    }
    const data = pathsToGraph(result, 'rootpk')
    expect(data.nodes.find((n) => n.isRoot)?.id).toBe(0)
    expect(data.nodes.find((n) => n.id === 1)?.depth).toBe(1)
    expect(data.nodes.find((n) => n.id === 2)?.depth).toBe(2)
    expect(data.nodes.find((n) => n.id === 3)?.depth).toBe(3)
    expect(data.nodes.find((n) => n.isFocus)?.depth).toBe(4)
    expect(data.nodes.find((n) => n.isFocus)?.id).toBe(4)
  })

  it('collapses a bound Path hop onto the focus user:id node index', () => {
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
      statements: [],
      paths: [],
      pathView: {
        nodes: [
          {
            id: 0,
            kind: 'pubkey',
            depth: 0,
            label: 'You',
            subject: { type: 'p', value: 'rootpk' },
          },
          {
            id: 1,
            kind: 'pubkey',
            depth: 1,
            label: 'Elon',
            subject: { type: 'p', value: elon },
          },
          {
            id: 2,
            kind: 'twitter_id',
            depth: 2,
            label: 'Elon Musk',
            subject,
          },
        ],
        edges: [
          {
            id: 10,
            from: 0,
            to: 1,
            value: 1,
            context: 'identity',
            eventId: 'root-elon',
            depth: 1,
          },
          {
            id: 11,
            from: 1,
            to: 2,
            value: 1,
            context: 'identity',
            eventId: 'elon-self',
            depth: 2,
          },
        ],
      },
      sourceEventIds: ['elon-self'],
      computedAt: 1,
      graphVersion: 1,
      truncated: false,
      followTrustRed: 25, followTrustThreshold: 75,
    }
    const collapsed = collapseBoundPubkeyAliases(pathsToGraph(result, 'rootpk'), {
      xByTwitterId: new Map(),
      xByPubkey: new Map([
        [elon, { twitterId: '44196397', displayName: 'Elon Musk' }],
      ]),
      profileByPubkey: new Map(),
      postById: new Map(),
    })
    expect(collapsed.nodes.find((n) => n.isRoot)?.id).toBe(0)
    expect(collapsed.nodes.filter((n) => n.id === 1)).toHaveLength(0)
    expect(collapsed.nodes.filter((n) => n.id === 2)).toHaveLength(1)
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
      statements: [],
      paths: [],
      pathView: {
        nodes: [
          {
            id: 0,
            kind: 'pubkey',
            depth: 0,
            label: 'You',
            subject: { type: 'p', value: 'rootpk' },
          },
          {
            id: 1,
            kind: 'twitter_id',
            depth: 1,
            label: 'X · 42',
            subject,
          },
        ],
        edges: [
          {
            id: 9,
            from: 0,
            to: 1,
            value: 0,
            context: 'identity',
            eventId: 'neutral-own',
            depth: 1,
          },
        ],
      },
      sourceEventIds: ['neutral-own'],
      computedAt: 1,
      graphVersion: 1,
      truncated: false,
      followTrustRed: 25, followTrustThreshold: 75,
    }
    const data = pathsToGraph(result, 'rootpk')
    const last = data.links.find(
      (link) => linkEndpointId(link.target) === 1,
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
      statements: [],
      paths: [],
      pathView: {
        nodes: [
          {
            id: 0,
            kind: 'pubkey',
            depth: 0,
            label: 'You',
            subject: { type: 'p', value: 'rootpk' },
          },
          {
            id: 1,
            kind: 'pubkey',
            depth: 1,
            label: 'alice',
            subject: { type: 'p', value: 'alice' },
          },
          {
            id: 2,
            kind: 'twitter_id',
            depth: 2,
            label: 'X · 42',
            subject,
          },
        ],
        edges: [
          {
            id: 8,
            from: 0,
            to: 1,
            value: 1,
            context: 'identity',
            eventId: 'root-alice',
            depth: 1,
          },
          {
            id: 9,
            from: 1,
            to: 2,
            value: 0,
            context: 'identity',
            eventId: 'alice-neutral',
            depth: 2,
          },
        ],
      },
      sourceEventIds: ['alice-neutral'],
      computedAt: 1,
      graphVersion: 1,
      truncated: false,
      followTrustRed: 25, followTrustThreshold: 75,
    }
    const data = pathsToGraph(result, 'rootpk')
    const hops = data.links.filter(
      (link) => linkEndpointId(link.target) !== 2,
    )
    const last = data.links.filter(
      (link) => linkEndpointId(link.target) === 2,
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
      pathView: { nodes: [], edges: [] },
      sourceEventIds: [],
      computedAt: 1,
      graphVersion: 1,
      truncated: false,
      followTrustRed: 25, followTrustThreshold: 75,
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
        paths: [],
        pathView: {
          nodes: [
            {
              id: 0,
              kind: 'pubkey',
              depth: 0,
              label: 'You',
              subject: { type: 'p', value: 'rootpk' },
            },
            {
              id: 1,
              kind: 'pubkey',
              depth: 1,
              label: 'alice',
              subject: { type: 'p', value: 'alice' },
            },
            {
              id: 2,
              kind: 'post',
              depth: 2,
              label: 'Post · 99',
              subject: post,
            },
          ],
          edges: [
            {
              id: 8,
              from: 0,
              to: 1,
              value: 1,
              context: '',
              eventId: 'r-a',
              depth: 1,
            },
          ],
        },
        ratingEdges: [
          {
            id: 'rate-alice',
            from: 1,
            to: 2,
            value: 1,
            context: '',
            eventId: 'rate-alice',
            depth: 2,
          },
        ],
        computedAt: 1,
        graphVersion: 1,
        followTrustRed: 25,
        followTrustThreshold: 75,
      },
      'rootpk',
    )
    const data = pathsToGraph(merged, 'rootpk')
    expect(data.nodes.find((n) => n.isFocus)?.id).toBe(2)
    expect(data.nodes.find((n) => n.isRoot)?.id).toBe(0)
    expect(data.nodes.some((n) => n.id === 1)).toBe(true)
    expect(
      data.links.some((link) => {
        const source = linkEndpointId(link.source)
        const target = linkEndpointId(link.target)
        return source === 0 && target === 1
      }),
    ).toBe(true)
    expect(
      data.links.some((link) => {
        const source = linkEndpointId(link.source)
        const target = linkEndpointId(link.target)
        return source === 1 && target === 2
      }),
    ).toBe(true)
  })
})

describe('graphNodeClickIntent', () => {
  it('does not expand or collapse on a single click', () => {
    expect(
      graphNodeClickIntent({
        isDouble: false,
        expandedNow: false,
      }),
    ).toBe('select')
    expect(
      graphNodeClickIntent({
        isDouble: false,
        expandedNow: true,
      }),
    ).toBe('select')
  })

  it('expands a collapsed node on double-click', () => {
    expect(
      graphNodeClickIntent({
        isDouble: true,
        expandedNow: false,
      }),
    ).toBe('expand')
  })

  it('collapses an expanded node on double-click', () => {
    expect(
      graphNodeClickIntent({
        isDouble: true,
        expandedNow: true,
      }),
    ).toBe('collapse')
  })
})
