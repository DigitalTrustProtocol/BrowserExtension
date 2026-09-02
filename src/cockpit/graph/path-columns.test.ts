import { describe, expect, it } from 'vitest'
import {
  PATH_COLUMN_PAGE_SIZE,
  isPathPageControlId,
  orderPathColumns,
  pagePathColumns,
  parsePathPageControl,
  pathPageControlId,
  positionPathColumns,
} from './path-columns'
import { linkEndpointId, type GraphVizData, type GraphVizLink, type GraphVizNode } from './types'

function person(
  id: string,
  depth: number,
  flags: { isRoot?: boolean; isFocus?: boolean } = {},
): GraphVizNode {
  return {
    id,
    kind: 'pubkey',
    depth,
    label: id,
    ...flags,
  }
}

function hop(from: string, to: string, depth: number): GraphVizLink {
  return {
    id: `${from}->${to}`,
    source: from,
    target: to,
    value: 1,
    context: '',
    eventId: `${from}->${to}`,
    depth,
  }
}

describe('path column paging', () => {
  it('parses prev/next control ids', () => {
    expect(PATH_COLUMN_PAGE_SIZE).toBe(7)
    expect(parsePathPageControl(pathPageControlId(3, 'next'))).toEqual({
      depth: 3,
      direction: 'next',
    })
    expect(isPathPageControlId('agg:p:abc')).toBe(false)
  })

  it('leaves columns of 7 or fewer people unchanged', () => {
    const data: GraphVizData = {
      nodes: [
        person('p:root', 0, { isRoot: true }),
        ...Array.from({ length: 7 }, (_, i) => person(`p:${i}`, 1)),
        person('i:user:id:nasa', 2, { isFocus: true }),
      ],
      links: [
        ...Array.from({ length: 7 }, (_, i) => hop('p:root', `p:${i}`, 1)),
        hop('p:0', 'i:user:id:nasa', 2),
      ],
    }
    const paged = pagePathColumns(data, {})
    expect(paged.nodes.filter((n) => n.kind !== 'aggregate')).toHaveLength(
      data.nodes.length,
    )
    expect(paged.nodes.some((n) => isPathPageControlId(n.id))).toBe(false)
  })

  it('shows 7 people plus a next control when a column has 10', () => {
    const data: GraphVizData = {
      nodes: [
        person('p:root', 0, { isRoot: true }),
        ...Array.from({ length: 10 }, (_, i) => person(`p:${i}`, 1)),
        person('i:user:id:nasa', 2, { isFocus: true }),
      ],
      links: Array.from({ length: 10 }, (_, i) => hop('p:root', `p:${i}`, 1)),
    }
    const first = pagePathColumns(data, {})
    expect(first.nodes.filter((n) => n.depth === 1 && n.kind === 'pubkey')).toHaveLength(
      7,
    )
    expect(first.nodes.some((n) => n.id === pathPageControlId(1, 'next'))).toBe(
      true,
    )
    expect(first.nodes.some((n) => n.id === pathPageControlId(1, 'prev'))).toBe(
      false,
    )
    expect(first.nodes.find((n) => n.id === pathPageControlId(1, 'next'))?.label).toBe(
      '+3',
    )

    const second = pagePathColumns(data, { 1: 1 })
    expect(
      second.nodes.filter((n) => n.depth === 1 && n.kind === 'pubkey'),
    ).toHaveLength(3)
    expect(second.nodes.some((n) => n.id === pathPageControlId(1, 'prev'))).toBe(
      true,
    )
    expect(second.nodes.some((n) => n.id === pathPageControlId(1, 'next'))).toBe(
      false,
    )
  })

  it('drops edges to people that are not on the current page', () => {
    const data: GraphVizData = {
      nodes: [
        person('p:root', 0, { isRoot: true }),
        ...Array.from({ length: 8 }, (_, i) => person(`p:${i}`, 1)),
      ],
      links: Array.from({ length: 8 }, (_, i) => hop('p:root', `p:${i}`, 1)),
    }
    const paged = pagePathColumns(data, {})
    expect(paged.links).toHaveLength(7)
    expect(
      paged.links.every((link) => {
        const target = linkEndpointId(link.target)
        return target !== 'p:7'
      }),
    ).toBe(true)
  })
})

describe('orderPathColumns', () => {
  it('reorders a crossed pair to reduce left-to-right crossings', () => {
    const data: GraphVizData = {
      nodes: [
        person('p:root', 0, { isRoot: true }),
        person('p:a', 1),
        person('p:b', 1),
        person('p:c', 2),
        person('p:d', 2),
        person('i:focus', 3, { isFocus: true }),
      ],
      links: [
        hop('p:root', 'p:a', 1),
        hop('p:root', 'p:b', 1),
        hop('p:a', 'p:d', 2),
        hop('p:b', 'p:c', 2),
        hop('p:c', 'i:focus', 3),
        hop('p:d', 'i:focus', 3),
      ],
    }
    const ordered = orderPathColumns(data)
    const depth1 = ordered.nodes.filter((n) => n.depth === 1).map((n) => n.id)
    const depth2 = ordered.nodes.filter((n) => n.depth === 2).map((n) => n.id)
    const aIndex = depth1.indexOf('p:a')
    const bIndex = depth1.indexOf('p:b')
    const cIndex = depth2.indexOf('p:c')
    const dIndex = depth2.indexOf('p:d')
    expect((aIndex - bIndex) * (dIndex - cIndex)).toBeGreaterThan(0)
  })
})

describe('positionPathColumns', () => {
  it('pins hop depths left-to-right with root left of focus', () => {
    const nodes: GraphVizNode[] = [
      person('p:root', 0, { isRoot: true }),
      person('p:a', 1),
      person('p:b', 2),
      person('p:c', 3),
      person('i:focus', 4, { isFocus: true }),
    ]
    positionPathColumns(nodes)
    const xs = nodes.map((node) => node.x)
    expect(xs.every((x) => typeof x === 'number')).toBe(true)
    for (let i = 1; i < nodes.length; i += 1) {
      expect(nodes[i]!.x).toBeGreaterThan(nodes[i - 1]!.x!)
      expect(nodes[i]!.fx).toBe(nodes[i]!.x)
      expect(nodes[i]!.fy).toBe(nodes[i]!.y)
    }
    const root = nodes.find((node) => node.isRoot)
    const focus = nodes.find((node) => node.isFocus)
    expect(root?.x).toBeLessThan(focus?.x ?? Infinity)
  })

  it('stacks same-depth nodes in a vertical column', () => {
    const nodes: GraphVizNode[] = [
      person('p:root', 0, { isRoot: true }),
      person('p:a', 1),
      person('p:b', 1),
      person('i:focus', 2, { isFocus: true }),
    ]
    positionPathColumns(nodes)
    const hop1 = nodes.filter((node) => node.depth === 1)
    expect(hop1[0]!.x).toBe(hop1[1]!.x)
    expect(hop1[0]!.y).not.toBe(hop1[1]!.y)
  })
})
