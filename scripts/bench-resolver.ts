/**
 * Heap load and IndexResolver timing.
 *
 * Same graph for the extension heap and @dtp/trust-graph:
 * root → 1,000 nodes → 1,000,000 leaves, then one subject under the last
 * leaf (degree 3). Resolving that subject expands the million leaf edges.
 *
 * Run: npx tsx scripts/bench-resolver.ts
 */

import { performance } from 'node:perf_hooks'
import { Graph as ExtensionGraph } from '../src/graph/trust/Graph.ts'
import extensionResolver from '../src/graph/trust/IndexResolver.ts'
import { Graph as LibraryGraph, indexResolver as libraryResolver } from '../../TrustGraph/packages/trust-graph/dist/main.js'

const MIDS = 1_000
const FANOUT = 1_000
const KIND = 32_009

function hex(n: number): string {
  return n.toString(16).padStart(64, '0')
}

interface Loaded {
  root: string
  subject: string
  edges: number
  nodes: number
  loadMs: number
}

function loadExtension(): { graph: ExtensionGraph } & Loaded {
  const graph = new ExtensionGraph()
  const started = performance.now()
  let next = 1
  let edges = 0
  const mids: number[] = []
  const apply = (from: number, to: number): void => {
    const pubkey = hex(from)
    const subject = hex(to)
    const id = hex(edges)
    graph.applyTrustEvent({
      id,
      pubkey,
      created_at: 1,
      kind: KIND,
      tags: [],
      content: '',
      sig: '',
      firstSeenAt: 0,
      addressKey: `${KIND}:${pubkey}:${id}`,
      subject,
      subjectType: 'p',
      c_tag: 'identity',
      nValue: 1,
      addressableId: id,
    })
    edges += 1
  }
  for (let i = 0; i < MIDS; i++) {
    const mid = next++
    apply(0, mid)
    mids.push(mid)
  }
  let lastLeaf = 0
  for (const mid of mids) {
    for (let k = 0; k < FANOUT; k++) {
      const leaf = next++
      apply(mid, leaf)
      lastLeaf = leaf
    }
  }
  const subject = next++
  apply(lastLeaf, subject)
  return {
    graph,
    root: hex(0),
    subject: hex(subject),
    edges,
    nodes: next,
    loadMs: performance.now() - started,
  }
}

function loadLibrary(): { graph: LibraryGraph } & Loaded {
  const graph = new LibraryGraph()
  const started = performance.now()
  let next = 1
  let edges = 0
  const mids: number[] = []
  const apply = (from: number, to: number): void => {
    const pubkey = hex(from)
    const subject = hex(to)
    const id = hex(edges)
    graph.applyTrustEvent({
      id,
      pubkey,
      created_at: 1,
      kind: KIND,
      content: '',
      addressKey: `${KIND}:${pubkey}:${id}`,
      subject,
      subjectType: 'p',
      c_tag: 'identity',
      nValue: 1,
      addressableId: id,
    })
    edges += 1
  }
  for (let i = 0; i < MIDS; i++) {
    const mid = next++
    apply(0, mid)
    mids.push(mid)
  }
  let lastLeaf = 0
  for (const mid of mids) {
    for (let k = 0; k < FANOUT; k++) {
      const leaf = next++
      apply(mid, leaf)
      lastLeaf = leaf
    }
  }
  const subject = next++
  apply(lastLeaf, subject)
  return {
    graph,
    root: hex(0),
    subject: hex(subject),
    edges,
    nodes: next,
    loadMs: performance.now() - started,
  }
}

function timeResolve(
  label: string,
  run: () => { connected: boolean; degree: number; trust: number },
): number[] {
  for (let i = 0; i < 2; i++) run()
  const samples: number[] = []
  for (let i = 0; i < 5; i++) {
    const started = performance.now()
    const score = run()
    const ms = performance.now() - started
    if (!score.connected || score.degree !== 3 || score.trust !== 1) {
      throw new Error(`${label} sample ${i} got ${JSON.stringify(score)}`)
    }
    samples.push(ms)
  }
  return samples
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}

const ALL_FORMATS = ['default', 'statements', 'path'] as const
type BenchFormat = (typeof ALL_FORMATS)[number]

const which = process.argv[2] ?? 'extension'
const only = process.argv[3]
const FORMATS: readonly BenchFormat[] =
  only === 'default' || only === 'statements' || only === 'path' ? [only] : ALL_FORMATS
console.log(`graph: 1 root, ${MIDS} mids, ${MIDS * FANOUT} leaves, subject at degree 3`)

function timeFormats(
  label: string,
  loaded: Loaded,
  resolve: (format: (typeof FORMATS)[number]) => { connected: boolean; degree: number; trust: number },
): void {
  console.log(`${label}  load ${(loaded.loadMs / 1000).toFixed(2)}s`)
  for (const format of FORMATS) {
    const samples = timeResolve(`${label} ${format}`, () => resolve(format))
    const sorted = [...samples].sort((a, b) => a - b)
    console.log(
      `${label}  ${format}  ${samples.map((ms) => ms.toFixed(1)).join(' / ')}  min ${sorted[0]!.toFixed(1)}  median ${median(samples).toFixed(1)}`,
    )
  }
}

if (which === 'personal') {
  const library = loadLibrary()
  timeFormats('personal', library, (format) => {
    const score = libraryResolver.resolve(library.root, library.subject, {
      graph: library.graph,
      format,
      kind: KIND,
      trustContext: 'identity',
      scoreContext: 'identity',
      maxDepth: 4,
      followTrustThreshold: 75,
      now: 1_000,
      bindingMode: 'lenient',
    })[0]
    return {
      connected: score?.connected === true,
      degree: score?.degree ?? -1,
      trust: 'trust' in (score ?? {}) ? (score as { trust: number }).trust : -1,
    }
  })
} else {
  const extension = loadExtension()
  timeFormats('extension', extension, (format) => {
    const score = extensionResolver.resolve(extension.root, extension.subject, {
      graph: extension.graph,
      format,
      kind: KIND,
      trustContext: 'identity',
      scoreContext: 'identity',
      maxDepth: 4,
      followTrustThreshold: 75,
      now: 1_000,
    })[0]
    return {
      connected: score?.connected === true,
      degree: score?.degree ?? -1,
      trust: 'trust' in (score ?? {}) ? (score as { trust: number }).trust : -1,
    }
  })
}
