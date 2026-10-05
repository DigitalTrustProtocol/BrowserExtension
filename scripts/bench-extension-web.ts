/**
 * Same degree 1–4 web as the Rust bench, on the extension IndexResolver.
 * One default search per degree. The search is stopped if it runs past 10s.
 *
 * Run: npx tsx scripts/bench-extension-web.ts
 */

import { spawn } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { Graph } from '../src/graph/trust/Graph.ts'
import extensionResolver from '../src/graph/trust/IndexResolver.ts'

const LAYER_NODES = [10, 100, 1_000, 100_000] as const
const LAST_HOP_EDGES = 10_000_000
const KIND = 32_009
const SEARCH_LIMIT_MS = 10_000
const EMPTY_TAGS: string[][] = []
const nodeIds = new Map<number, string>()

function hex(n: number): string {
  const cached = nodeIds.get(n)
  if (cached) return cached
  const id = n.toString(16).padStart(64, '0')
  nodeIds.set(n, id)
  return id
}

function apply(graph: Graph, from: number, to: number, edge: { n: number }): void {
  const id = edge.n.toString(16).padStart(64, '0')
  const pubkey = hex(from)
  edge.n += 1
  graph.applyTrustEvent({
    id,
    pubkey,
    created_at: 1,
    kind: KIND,
    tags: EMPTY_TAGS,
    content: '',
    sig: '',
    firstSeenAt: 0,
    addressKey: id,
    subject: hex(to),
    subjectType: 'p',
    c_tag: 'identity',
    nValue: 1,
    addressableId: id,
  })
  if (edge.n % 1_000_000 === 0) {
    const heap = Math.round(process.memoryUsage().heapUsed / 1_048_576)
    console.log(`  edges ${edge.n} heap ${heap} MB`)
  }
}

function search(graph: Graph, root: string, subject: string, maxDepth: number) {
  const started = performance.now()
  const score = extensionResolver.resolve(root, subject, {
    graph,
    format: 'default',
    kind: KIND,
    trustContext: 'identity',
    scoreContext: 'identity',
    maxDepth,
    followTrustThreshold: 75,
    now: 1_000,
  })[0]
  return {
    ms: performance.now() - started,
    connected: score?.connected === true,
    degree: score?.degree ?? 0,
    trust: score && 'trust' in score ? score.trust : 0,
  }
}

function runLayers(): void {
  console.log('extension IndexResolver, one default search per degree, stop a search after 10s')
  console.log('degree  layer_nodes  edges_into_layer  search_ms  connected  found  trust')
  const graph = new Graph()
  const root = hex(0)
  let nextNode = 1
  const edge = { n: 0 }
  let previous: number[] = [0]

  for (let index = 0; index < LAYER_NODES.length; index++) {
    const degree = index + 1
    const count = LAYER_NODES[index]!
    console.log(`building degree ${degree}`)
    const layer: number[] = []
    for (let i = 0; i < count; i++) layer.push(nextNode++)
    const edgesBefore = edge.n
    if (index + 1 === LAYER_NODES.length) {
      const sources = previous.length
      const outs = LAST_HOP_EDGES / sources
      for (let s = 0; s < sources; s++) {
        const from = previous[s]!
        for (let k = 0; k < outs; k++) {
          const target = (s * outs + k) % count
          apply(graph, from, layer[target]!, edge)
        }
      }
    } else {
      for (const from of previous) {
        for (const to of layer) apply(graph, from, to, edge)
      }
    }
    const edgesInto = edge.n - edgesBefore
    if (process.send) process.send({ type: 'search', degree })
    const result = search(graph, root, hex(layer[0]!), degree)
    const stopped = result.ms > SEARCH_LIMIT_MS
    console.log(
      `${String(degree).padEnd(7)} ${String(count).padEnd(12)} ${String(edgesInto).padEnd(17)} ${result.ms.toFixed(1).padStart(8)}  ${String(result.connected).padEnd(10)} ${String(result.degree).padEnd(6)} ${result.trust}${stopped ? '  STOPPED' : ''}`,
    )
    if (process.send) process.send({ type: 'done', degree, ms: result.ms })
    if (stopped) break
    previous = layer
  }
}

if (process.argv.includes('--run')) {
  runLayers()
} else {
  const child = spawn(
    process.execPath,
    [...process.execArgv, fileURLToPath(import.meta.url), '--run'],
    { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] },
  )
  let timer: NodeJS.Timeout | undefined
  child.on('message', (message: { type?: string; degree?: number }) => {
    if (message.type === 'search') {
      timer = setTimeout(() => {
        console.log(`degree ${message.degree} search exceeded ${SEARCH_LIMIT_MS / 1000}s, stopping IndexResolver`)
        child.kill()
      }, SEARCH_LIMIT_MS)
    } else if (message.type === 'done') {
      if (timer) clearTimeout(timer)
    }
  })
  child.on('exit', (code, signal) => {
    if (signal) process.exit(0)
    process.exit(code ?? 0)
  })
}
