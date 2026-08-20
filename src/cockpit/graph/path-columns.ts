import type { GraphVizData, GraphVizNode } from './types'

export const PATH_COLUMN_PAGE_SIZE = 7

export type PathPageDirection = 'prev' | 'next'

const PATH_PAGE_PREFIX = 'agg:pathcol:'

function endpointId(ref: string | GraphVizNode): string {
  return typeof ref === 'string' ? ref : ref.id
}

export function pathPageControlId(
  depth: number,
  direction: PathPageDirection,
): string {
  return `${PATH_PAGE_PREFIX}${depth}:${direction}`
}

export function isPathPageControlId(id: string): boolean {
  return id.startsWith(PATH_PAGE_PREFIX)
}

export function parsePathPageControl(
  id: string,
): { depth: number; direction: PathPageDirection } | undefined {
  if (!isPathPageControlId(id)) return undefined
  const rest = id.slice(PATH_PAGE_PREFIX.length)
  const sep = rest.lastIndexOf(':')
  if (sep <= 0) return undefined
  const depth = Number(rest.slice(0, sep))
  const direction = rest.slice(sep + 1)
  if (!Number.isInteger(depth) || depth < 0) return undefined
  if (direction !== 'prev' && direction !== 'next') return undefined
  return { depth, direction }
}

/**
 * Sugiyama barycenter: reorder each degree column to cut left-to-right crossings.
 */
export function orderPathColumns(data: GraphVizData): GraphVizData {
  const byDepth = new Map<number, GraphVizNode[]>()
  for (const node of data.nodes) {
    const list = byDepth.get(node.depth) ?? []
    list.push(node)
    byDepth.set(node.depth, list)
  }
  const depths = [...byDepth.keys()].sort((a, b) => a - b)
  if (depths.length <= 1) return { nodes: [...data.nodes], links: data.links }

  const neighborIds = (id: string, otherDepth: number): string[] => {
    const other = new Set(
      (byDepth.get(otherDepth) ?? []).map((node) => node.id),
    )
    const ids: string[] = []
    for (const link of data.links) {
      const source = endpointId(link.source)
      const target = endpointId(link.target)
      if (source === id && other.has(target)) ids.push(target)
      else if (target === id && other.has(source)) ids.push(source)
    }
    return ids
  }

  const sortToward = (depth: number, otherDepth: number): void => {
    const otherList = byDepth.get(otherDepth) ?? []
    const indexOf = new Map(otherList.map((node, index) => [node.id, index]))
    const column = byDepth.get(depth) ?? []
    const ranked = column.map((node, original) => {
      const positions = neighborIds(node.id, otherDepth)
        .map((id) => indexOf.get(id))
        .filter((index): index is number => index !== undefined)
      const bary =
        positions.length === 0
          ? original
          : positions.reduce((sum, index) => sum + index, 0) / positions.length
      return { node, bary, original }
    })
    ranked.sort((a, b) => a.bary - b.bary || a.original - b.original)
    byDepth.set(
      depth,
      ranked.map((row) => row.node),
    )
  }

  for (let iter = 0; iter < 3; iter += 1) {
    for (let i = 1; i < depths.length; i += 1) {
      sortToward(depths[i]!, depths[i - 1]!)
    }
    for (let i = depths.length - 2; i >= 0; i -= 1) {
      sortToward(depths[i]!, depths[i + 1]!)
    }
  }

  return {
    nodes: depths.flatMap((depth) => byDepth.get(depth) ?? []),
    links: data.links,
  }
}

function makePathPageControl(
  depth: number,
  direction: PathPageDirection,
  count: number,
): GraphVizNode {
  return {
    id: pathPageControlId(depth, direction),
    kind: 'aggregate',
    depth,
    label: direction === 'prev' ? `▲${count}` : `+${count}`,
    aggregateRemaining: count,
  }
}

/**
 * Keep at most `pageSize` people visible in each degree column, with prev/next
 * pager nodes when a column is larger.
 */
export function pagePathColumns(
  data: GraphVizData,
  pageByDepth: Readonly<Record<number, number>>,
  pageSize: number = PATH_COLUMN_PAGE_SIZE,
): GraphVizData {
  const size = Math.max(1, pageSize)
  const byDepth = new Map<number, GraphVizNode[]>()
  for (const node of data.nodes) {
    if (isPathPageControlId(node.id)) continue
    const list = byDepth.get(node.depth) ?? []
    list.push(node)
    byDepth.set(node.depth, list)
  }

  const depths = [...byDepth.keys()].sort((a, b) => a - b)
  const nodes: GraphVizNode[] = []
  const visibleIds = new Set<string>()

  for (const depth of depths) {
    const column = byDepth.get(depth) ?? []
    const pageable = column.filter(
      (node) => !node.isRoot && !node.isFocus && node.kind !== 'aggregate',
    )
    const pageableIds = pageable.map((node) => node.id)
    const pageCount = Math.max(1, Math.ceil(pageableIds.length / size) || 1)
    const page = Math.min(
      pageCount - 1,
      Math.max(0, Math.floor(pageByDepth[depth] ?? 0)),
    )
    const start = pageableIds.length === 0 ? 0 : page * size
    const visiblePageable = new Set(pageableIds.slice(start, start + size))
    const hiddenBefore = start
    const hiddenAfter = Math.max(
      0,
      pageableIds.length - start - visiblePageable.size,
    )

    const columnNodes: GraphVizNode[] = []
    if (hiddenBefore > 0) {
      columnNodes.push(
        makePathPageControl(depth, 'prev', Math.min(size, hiddenBefore)),
      )
    }
    for (const node of column) {
      if (node.isRoot || node.isFocus || visiblePageable.has(node.id)) {
        columnNodes.push(node)
      }
    }
    if (hiddenAfter > 0) {
      columnNodes.push(makePathPageControl(depth, 'next', hiddenAfter))
    }
    for (const node of columnNodes) {
      nodes.push(node)
      visibleIds.add(node.id)
    }
  }

  const links = data.links.filter((link) => {
    const source = endpointId(link.source)
    const target = endpointId(link.target)
    return visibleIds.has(source) && visibleIds.has(target)
  })
  return { nodes, links }
}
