import { describe, expect, it } from 'vitest'
import {
  buildSeedGraphData,
  collapseExpansion,
  mergeNeighborhood,
  omitPostNeighborsUnlessCenterIsPost,
  pathsToGraph,
} from './graph-view-data'
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
    expect(
      merged.nodes.find((n) => n.id === 'p:alice')?.expandedFrom,
    ).toEqual(['p:root'])
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
})
