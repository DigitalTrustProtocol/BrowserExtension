import { describe, expect, it } from 'vitest'
import {
  buildSeedGraphData,
  collapseExpansion,
  mergeNeighborhood,
} from './graph-view-data'
import type { GraphVizData } from './types'

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
})
