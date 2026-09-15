import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GRAPH_VIEW_SETTINGS,
  filterGraphData,
  graphDisplaySettingsForStorage,
  graphSettingsForNewTab,
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

function hop(
  source: string,
  target: string,
  value: 1 | 0 | -1,
  depth: number,
): GraphVizData['links'][number] {
  return {
    id: `${source}->${target}`,
    source,
    target,
    value,
    context: '',
    eventId: `${source}->${target}`,
    depth,
  }
}

function pathSample(): GraphVizData {
  return {
    nodes: [
      { id: 'p:root', kind: 'pubkey', depth: 0, label: 'You', isRoot: true },
      { id: 'p:alice', kind: 'pubkey', depth: 1, label: 'alice' },
      { id: 'p:neutral', kind: 'pubkey', depth: 2, label: 'neutral-author' },
      { id: 'p:distrust', kind: 'pubkey', depth: 2, label: 'distrust-author' },
      { id: 'p:trust', kind: 'pubkey', depth: 2, label: 'trust-author' },
      {
        id: 'i:user:id:sub',
        kind: 'twitter_id',
        depth: 3,
        label: 'Subject',
        isFocus: true,
      },
    ],
    links: [
      hop('p:root', 'p:alice', 1, 1),
      hop('p:alice', 'p:neutral', 1, 2),
      hop('p:alice', 'p:distrust', 1, 2),
      hop('p:alice', 'p:trust', 1, 2),
      hop('p:neutral', 'i:user:id:sub', 0, 3),
      hop('p:distrust', 'i:user:id:sub', -1, 3),
      hop('p:trust', 'i:user:id:sub', 1, 3),
    ],
  }
}

describe('filterGraphData', () => {
  it('keeps Neutral edges in the default Graph filter', () => {
    const filtered = filterGraphData(
      sample(),
      DEFAULT_GRAPH_VIEW_SETTINGS,
      new Set(['p:root']),
    )
    expect(filtered.links.map((link) => link.value).sort()).toEqual([-1, 0, 1])
  })

  it('keeps Trust hops when filtering Trust', () => {
    const filtered = filterGraphData(
      sample(),
      { ...DEFAULT_GRAPH_VIEW_SETTINGS, finalStatementFilter: 'trust' },
      new Set(['p:root']),
    )
    expect(filtered.links.map((link) => link.value)).toEqual([1])
    expect(filtered.nodes.some((n) => n.id === 'p:root')).toBe(true)
    expect(filtered.nodes.some((n) => n.id === 'i:user:id:2')).toBe(false)
    expect(filtered.nodes.some((n) => n.id === 'i:user:id:1')).toBe(false)
  })

  it('keeps only Neutral connections when filtering Neutral', () => {
    const filtered = filterGraphData(
      sample(),
      { ...DEFAULT_GRAPH_VIEW_SETTINGS, finalStatementFilter: 'neutral' },
      new Set(['p:root']),
    )
    expect(filtered.links.map((link) => link.value)).toEqual([0])
  })

  it('keeps only Distrust connections when filtering Distrust', () => {
    const filtered = filterGraphData(
      sample(),
      { ...DEFAULT_GRAPH_VIEW_SETTINGS, finalStatementFilter: 'distrust' },
      new Set(['p:root']),
    )
    expect(filtered.links.map((link) => link.value)).toEqual([-1])
  })

  it('filters by search', () => {
    const filtered = filterGraphData(
      sample(),
      { ...DEFAULT_GRAPH_VIEW_SETTINGS, search: 'alice' },
      new Set(['p:root']),
    )
    expect(filtered.nodes.map((n) => n.id).sort()).toEqual(['p:alice', 'p:root'])
  })

  it('hides last-degree Neutral and Distrust nodes when Path filters to Trust', () => {
    const filtered = filterGraphData(
      pathSample(),
      { ...DEFAULT_GRAPH_VIEW_SETTINGS, finalStatementFilter: 'trust' },
      new Set(['p:root', 'i:user:id:sub']),
      { fromId: 'p:root', toId: 'i:user:id:sub' },
    )
    expect(filtered.nodes.map((n) => n.id).sort()).toEqual([
      'i:user:id:sub',
      'p:alice',
      'p:root',
      'p:trust',
    ])
    expect(
      filtered.links
        .filter((link) => link.target === 'i:user:id:sub')
        .map((link) => link.value),
    ).toEqual([1])
    expect(filtered.nodes.some((n) => n.id === 'p:neutral')).toBe(false)
    expect(filtered.nodes.some((n) => n.id === 'p:distrust')).toBe(false)
  })

  it('hides last-degree Trust and Neutral nodes when Path filters to Distrust', () => {
    const filtered = filterGraphData(
      pathSample(),
      { ...DEFAULT_GRAPH_VIEW_SETTINGS, finalStatementFilter: 'distrust' },
      new Set(['p:root', 'i:user:id:sub']),
      { fromId: 'p:root', toId: 'i:user:id:sub' },
    )
    expect(filtered.nodes.map((n) => n.id).sort()).toEqual([
      'i:user:id:sub',
      'p:alice',
      'p:distrust',
      'p:root',
    ])
    expect(
      filtered.links
        .filter((link) => link.target === 'i:user:id:sub')
        .map((link) => link.value),
    ).toEqual([-1])
    expect(filtered.nodes.some((n) => n.id === 'p:trust')).toBe(false)
    expect(filtered.nodes.some((n) => n.id === 'p:neutral')).toBe(false)
  })

  it('hides last-degree Trust and Distrust nodes when Path filters to Neutral', () => {
    const filtered = filterGraphData(
      pathSample(),
      { ...DEFAULT_GRAPH_VIEW_SETTINGS, finalStatementFilter: 'neutral' },
      new Set(['p:root', 'i:user:id:sub']),
      { fromId: 'p:root', toId: 'i:user:id:sub' },
    )
    expect(filtered.nodes.map((n) => n.id).sort()).toEqual([
      'i:user:id:sub',
      'p:alice',
      'p:neutral',
      'p:root',
    ])
    expect(
      filtered.links
        .filter((link) => link.target === 'i:user:id:sub')
        .map((link) => link.value),
    ).toEqual([0])
    expect(filtered.nodes.some((n) => n.id === 'p:trust')).toBe(false)
    expect(filtered.nodes.some((n) => n.id === 'p:distrust')).toBe(false)
  })
})

describe('normalizeGraphViewSettings', () => {
  it('migrates old polarity both to all and ignores stored context', () => {
    const next = normalizeGraphViewSettings({
      valueFilter: 'both',
      context: 'news:accuracy',
    })
    expect(next.finalStatementFilter).toBe('all')
    expect(next).not.toHaveProperty('maxHops')
    expect(next).not.toHaveProperty('showArrows')
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

  it('resets filters for a new tab while preserving display settings', () => {
    expect(
      graphSettingsForNewTab({
        direction: 'in',
        finalStatementFilter: 'distrust',
        search: 'alice',
        showLabels: false,
        layout: 'radial',
        showUserIcons: false,
        colorByTrust: false,
        colorScheme: 'dark',
      }),
    ).toEqual({
      ...DEFAULT_GRAPH_VIEW_SETTINGS,
      showLabels: false,
      layout: 'radial',
      showUserIcons: false,
      colorByTrust: false,
      colorScheme: 'dark',
    })
  })

  it('persists only display settings', () => {
    expect(
      graphDisplaySettingsForStorage({
        ...DEFAULT_GRAPH_VIEW_SETTINGS,
        direction: 'out',
        finalStatementFilter: 'neutral',
        search: 'alice',
        showLabels: false,
        layout: 'radial',
        showUserIcons: false,
        colorByTrust: false,
        colorScheme: 'dark',
      }),
    ).toEqual({
      showLabels: false,
      layout: 'radial',
      showUserIcons: false,
      colorByTrust: false,
      colorScheme: 'dark',
    })
  })

  it('migrates Color by hop-distance to the trust-border checkbox off', () => {
    expect(normalizeGraphViewSettings({ colorBy: 'distance' }).colorByTrust).toBe(
      false,
    )
    expect(normalizeGraphViewSettings({ colorBy: 'trust' }).colorByTrust).toBe(
      true,
    )
    expect(normalizeGraphViewSettings({ colorByTrust: false }).colorByTrust).toBe(
      false,
    )
    expect(normalizeGraphViewSettings({}).colorByTrust).toBe(true)
    expect(normalizeGraphViewSettings({}).colorScheme).toBe('auto')
    expect(normalizeGraphViewSettings({ colorScheme: 'dark' }).colorScheme).toBe(
      'dark',
    )
  })
})
