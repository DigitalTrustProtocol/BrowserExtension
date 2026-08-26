import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GRAPH_VIEW_SETTINGS,
  filterGraphData,
  normalizeGraphViewSettings,
  type GraphVizData,
} from './types'

function sample(): GraphVizData {
  return {
    nodes: [
      { id: 'p:root', kind: 'pubkey', depth: 0, label: 'You' },
      { id: 'p:alice', kind: 'pubkey', depth: 1, label: 'alice…' },
      { id: 'i:user:id:1', kind: 'twitter_id', depth: 1, label: 'X · 1' },
      { id: 'i:user:id:2', kind: 'twitter_id', depth: 1, label: 'X · 2' },
    ],
    links: [
      {
        id: 'e1',
        source: 'p:root',
        target: 'p:alice',
        value: 1,
        context: '',
        eventId: 'e1',
        depth: 1,
      },
      {
        id: 'e0',
        source: 'p:root',
        target: 'i:user:id:2',
        value: 0,
        context: '',
        eventId: 'e0',
        depth: 1,
      },
      {
        id: 'e2',
        source: 'p:root',
        target: 'i:user:id:1',
        value: -1,
        context: '',
        eventId: 'e2',
        depth: 1,
      },
    ],
  }
}

describe('filterGraphData', () => {
  it('keeps Trust hops when filtering Trust', () => {
    const filtered = filterGraphData(
      sample(),
      { ...DEFAULT_GRAPH_VIEW_SETTINGS, finalStatementFilter: 'trust' },
      new Set(['p:root']),
    )
    expect(filtered.links.map((link) => link.value)).toEqual([1])
    expect(filtered.nodes.some((n) => n.id === 'p:root')).toBe(true)
  })

  it('adds Neutral finals while keeping Trust hops', () => {
    const filtered = filterGraphData(
      sample(),
      { ...DEFAULT_GRAPH_VIEW_SETTINGS, finalStatementFilter: 'neutral' },
      new Set(['p:root']),
    )
    expect(filtered.links.map((link) => link.value).sort()).toEqual([0, 1])
  })

  it('adds Distrust finals while keeping Trust hops', () => {
    const filtered = filterGraphData(
      sample(),
      { ...DEFAULT_GRAPH_VIEW_SETTINGS, finalStatementFilter: 'distrust' },
      new Set(['p:root']),
    )
    expect(filtered.links.map((link) => link.value).sort()).toEqual([-1, 1])
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

describe('normalizeGraphViewSettings', () => {
  it('migrates old polarity both to all and ignores stored context', () => {
    const next = normalizeGraphViewSettings({
      valueFilter: 'both',
      context: 'news:accuracy',
      maxHops: 3,
    })
    expect(next.finalStatementFilter).toBe('all')
    expect(next.maxHops).toBe(3)
    expect(next).not.toHaveProperty('context')
    expect(next).not.toHaveProperty('valueFilter')
  })

  it('maps old trust and distrust polarity values', () => {
    expect(
      normalizeGraphViewSettings({ valueFilter: 'trust' }).finalStatementFilter,
    ).toBe('trust')
    expect(
      normalizeGraphViewSettings({ valueFilter: 'distrust' })
        .finalStatementFilter,
    ).toBe('distrust')
  })
})
