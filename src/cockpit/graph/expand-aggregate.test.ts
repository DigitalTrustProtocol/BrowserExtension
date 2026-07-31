import { describe, expect, it } from 'vitest'
import {
  EXPAND_LOAD_MORE_BATCH,
  EXPAND_VISIBLE_INITIAL,
  aggregateLabel,
  aggregateNodeId,
  partitionNeighborhoodReveal,
  takePendingBatch,
  upsertAggregateInData,
} from './expand-aggregate'
import type { GraphVizLink, GraphVizNode } from './types'

function node(id: string): { id: string; kind: 'pubkey'; depth: number; label: string } {
  return { id, kind: 'pubkey', depth: 1, label: id }
}

function link(from: string, to: string): GraphVizLink {
  return {
    id: `e:${from}:${to}`,
    source: from,
    target: to,
    value: 1,
    context: '',
    eventId: `ev:${from}:${to}`,
    depth: 1,
  }
}

describe('partitionNeighborhoodReveal', () => {
  it('reveals all when at or under the initial cap', () => {
    const nodes = Array.from({ length: 15 }, (_, i) => node(`n${i}`))
    const links = nodes.map((n) => link('parent', n.id))
    const { reveal, pending } = partitionNeighborhoodReveal(nodes, links)
    expect(reveal.nodes).toHaveLength(15)
    expect(pending.nodes).toHaveLength(0)
    expect(reveal.links).toHaveLength(15)
  })

  it('keeps the first 20 visible and queues the rest', () => {
    const nodes = Array.from({ length: 25 }, (_, i) => node(`n${i}`))
    const links = nodes.map((n) => link('parent', n.id))
    const { reveal, pending } = partitionNeighborhoodReveal(nodes, links)
    expect(EXPAND_VISIBLE_INITIAL).toBe(20)
    expect(reveal.nodes).toHaveLength(20)
    expect(pending.nodes).toHaveLength(5)
    expect(reveal.links).toHaveLength(20)
    expect(pending.links).toHaveLength(5)
  })
})

describe('takePendingBatch', () => {
  it('reveals up to 100 and leaves the rest pending', () => {
    const nodes = Array.from({ length: 150 }, (_, i) => node(`n${i}`))
    const links = nodes.map((n) => link('parent', n.id))
    const { reveal, remaining } = takePendingBatch({ nodes, links })
    expect(EXPAND_LOAD_MORE_BATCH).toBe(100)
    expect(reveal.nodes).toHaveLength(100)
    expect(remaining.nodes).toHaveLength(50)
    expect(aggregateLabel(remaining.nodes.length)).toBe('+50')
  })

  it('clears the queue when the final batch is taken', () => {
    const nodes = Array.from({ length: 40 }, (_, i) => node(`n${i}`))
    const links = nodes.map((n) => link('parent', n.id))
    const { reveal, remaining } = takePendingBatch({ nodes, links })
    expect(reveal.nodes).toHaveLength(40)
    expect(remaining.nodes).toHaveLength(0)
  })
})

describe('upsertAggregateInData', () => {
  it('adds an aggregate node while remaining > 0 and removes it at 0', () => {
    const base = {
      nodes: [{ id: 'parent', kind: 'pubkey' as const, depth: 0, label: 'p' }] satisfies GraphVizNode[],
      links: [] as GraphVizLink[],
    }
    const withAgg = upsertAggregateInData(base, 'parent', 5, 1)
    expect(withAgg.nodes.some((n) => n.id === aggregateNodeId('parent'))).toBe(
      true,
    )
    expect(
      withAgg.nodes.find((n) => n.id === aggregateNodeId('parent'))?.label,
    ).toBe('+5')
    const cleared = upsertAggregateInData(withAgg, 'parent', 0, 1)
    expect(cleared.nodes.some((n) => n.id === aggregateNodeId('parent'))).toBe(
      false,
    )
  })
})
