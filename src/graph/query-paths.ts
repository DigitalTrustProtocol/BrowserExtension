import type { Graph } from './trust/Graph'
import type { ResolvedStatement, TrustPath, TrustSubject } from './types'

const MAX_PATHS_PER_AUTHOR = 16
const MAX_TOTAL_PATHS = 128

interface PathParent {
  id: string
  eventId: string
}

interface BuildShortestTrustPathsArgs {
  graph: Graph
  root: string
  context: string
  now: number
  statements: readonly ResolvedStatement[]
  subject: TrustSubject
  maxAuthorDistance: number
}

/**
 * Rebuilds root→author hop chains for Path view.
 *
 * Hitting-degree statements only name the last trustee. Walking +1 `p` edges
 * from the root recovers every shortest-path predecessor so degree-4 evidence
 * renders as me → hop1 → hop2 → hop3 → subject, not me → hop3 → subject.
 *
 * Each returned path ends at a statement author so the UI can attach the
 * terminal evidence edge to the subject without drawing shortcut hops.
 */
export function buildShortestTrustPaths(
  args: BuildShortestTrustPathsArgs,
): TrustPath[] {
  const root = args.root.toLowerCase()
  if (args.statements.length === 0) return []

  const { parents } = walkPositivePParents(
    args.graph,
    root,
    args.context,
    args.now,
    args.maxAuthorDistance,
  )

  const statementAuthors = [
    ...new Set(args.statements.map((row) => row.author.toLowerCase())),
  ]

  const onPath = new Set<string>([root, ...statementAuthors])
  let grew = true
  while (grew) {
    grew = false
    for (const id of [...onPath]) {
      for (const parent of parents.get(id) ?? []) {
        if (onPath.has(parent.id)) continue
        onPath.add(parent.id)
        grew = true
      }
    }
  }

  const paths: TrustPath[] = []
  const seen = new Set<string>()

  const pushPath = (authors: string[], sourceEventIds: string[]): void => {
    if (authors.length === 0 || paths.length >= MAX_TOTAL_PATHS) return
    const key = `${authors.join('>')}|${sourceEventIds.join(',')}`
    if (seen.has(key)) return
    seen.add(key)
    paths.push({
      authors,
      subject: { ...args.subject },
      sourceEventIds,
    })
  }

  for (const author of statementAuthors) {
    if (author === root) {
      const eventId = args.statements.find(
        (row) => row.author.toLowerCase() === root,
      )?.eventId
      pushPath([root], eventId ? [eventId] : [])
      continue
    }

    const chains = shortestChainsToAuthor(
      author,
      root,
      parents,
      onPath,
      MAX_PATHS_PER_AUTHOR,
    )
    if (chains.length === 0) {
      const eventId = args.statements.find(
        (row) => row.author.toLowerCase() === author,
      )?.eventId
      pushPath([root, author], eventId ? [eventId] : [])
      continue
    }
    for (const chain of chains) {
      pushPath(chain.authors, chain.eventIds)
    }
  }

  if (paths.length === 0) {
    pushPath([root], [])
  }
  return paths
}

function walkPositivePParents(
  graph: Graph,
  root: string,
  context: string,
  now: number,
  maxAuthorDistance: number,
): {
  distance: Map<string, number>
  parents: Map<string, PathParent[]>
} {
  const distance = new Map<string, number>([[root, 0]])
  const parents = new Map<string, PathParent[]>([[root, []]])
  if (maxAuthorDistance <= 0) {
    return { distance, parents }
  }

  const queue = [root]
  let cursor = 0
  while (cursor < queue.length) {
    const from = queue[cursor]!
    cursor += 1
    const fromDist = distance.get(from)
    if (fromDist === undefined || fromDist >= maxAuthorDistance) continue

    const outgoing = graph.out(from, {
      context,
      now,
      subjectType: 'p',
      value: 1,
    })
    for (const connection of outgoing) {
      const to = connection.subject.toLowerCase()
      if (to === from) continue
      const nextDist = fromDist + 1
      const existing = distance.get(to)
      const hop: PathParent = {
        id: from,
        eventId: connection.edge.eventId ?? '',
      }
      if (existing === undefined) {
        distance.set(to, nextDist)
        parents.set(to, [hop])
        queue.push(to)
        continue
      }
      if (existing !== nextDist) continue
      const list = parents.get(to) ?? []
      if (list.some((row) => row.id === from)) continue
      list.push(hop)
      parents.set(to, list)
    }
  }

  return { distance, parents }
}

function shortestChainsToAuthor(
  author: string,
  root: string,
  parents: Map<string, PathParent[]>,
  onPath: Set<string>,
  cap: number,
): Array<{ authors: string[]; eventIds: string[] }> {
  const results: Array<{ authors: string[]; eventIds: string[] }> = []
  const memo = new Map<string, Array<{ authors: string[]; eventIds: string[] }>>()

  const chainsTo = (
    node: string,
    stack: Set<string>,
  ): Array<{ authors: string[]; eventIds: string[] }> => {
    const cached = memo.get(node)
    if (cached) return cached
    if (node === root) {
      const rootChain = [{ authors: [root], eventIds: [] }]
      memo.set(node, rootChain)
      return rootChain
    }
    if (stack.has(node)) return []

    const nextStack = new Set(stack)
    nextStack.add(node)
    const preds = (parents.get(node) ?? []).filter((parent) =>
      onPath.has(parent.id),
    )
    const collected: Array<{ authors: string[]; eventIds: string[] }> = []
    if (preds.length === 0) {
      collected.push({ authors: [root, node], eventIds: [] })
    } else {
      for (const pred of preds) {
        if (collected.length >= cap) break
        for (const prefix of chainsTo(pred.id, nextStack)) {
          if (collected.length >= cap) break
          collected.push({
            authors: [...prefix.authors, node],
            eventIds: [...prefix.eventIds, pred.eventId],
          })
        }
      }
    }
    memo.set(node, collected)
    return collected
  }

  for (const chain of chainsTo(author, new Set())) {
    if (results.length >= cap) break
    results.push(chain)
  }
  return results
}
