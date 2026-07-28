import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GRAPH_VIEW_SETTINGS,
  filterGraphData,
  type GraphVizData,
} from './types'

function sample(): GraphVizData {
  return {
    nodes: [
      { id: 'p:root', kind: 'pubkey', depth: 0, label: 'You' },
      { id: 'p:alice', kind: 'pubkey', depth: 1, label: 'alice…' },
      { id: 'i:ext:twitter_id:1', kind: 'twitter_id', depth: 1, label: 'X · 1' },
    ],
    links: [
      {
        id: 'e1',
        source: 'p:root',
        target: 'p:alice',
        value: 1,
        context: 'identity',
        eventId: 'e1',
        depth: 1,
      },
      {
        id: 'e2',
        source: 'p:root',
        target: 'i:ext:twitter_id:1',
        value: -1,
        context: 'identity',
        eventId: 'e2',
        depth: 1,
      },
    ],
  }
}

describe('filterGraphData', () => {
  it('filters by polarity while keeping root', () => {
    const filtered = filterGraphData(
      sample(),
      { ...DEFAULT_GRAPH_VIEW_SETTINGS, valueFilter: 'trust' },
      new Set(['p:root']),
    )
    expect(filtered.links).toHaveLength(1)
    expect(filtered.links[0]?.value).toBe(1)
    expect(filtered.nodes.some((n) => n.id === 'p:root')).toBe(true)
  })

  it('filters by search', () => {
    const filtered = filterGraphData(
      sample(),
      { ...DEFAULT_GRAPH_VIEW_SETTINGS, search: 'alice' },
      new Set(['p:root']),
    )
    expect(filtered.nodes.map((n) => n.id).sort()).toEqual(['p:alice', 'p:root'])
  })
})
