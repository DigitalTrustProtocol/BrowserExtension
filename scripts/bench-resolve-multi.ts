/**
 * Extension IndexResolver only: 20 subjects in one resolveMulti versus
 * 20 separate resolve calls. Path format is not supported on resolveMulti.
 *
 * direct — root trusts each post. Both stop at degree 1.
 * far    — same web, each post is degree 3. Singles repeat the walk.
 *
 * Run: npx tsx scripts/bench-resolve-multi.ts
 */

import { performance } from 'node:perf_hooks'
import { Graph } from '../src/graph/trust/Graph.ts'
import extensionResolver from '../src/graph/trust/IndexResolver.ts'
import { TrustScore, type Score } from '../src/graph/trust/Score.ts'

const MIDS = 100
const FANOUT = 100
const SUBJECTS = 20
const KIND = 32_009
const WARMUP = 2
const SAMPLES = 5

function hex(n: number): string {
  return n.toString(16).padStart(64, '0')
}

function apply(
  graph: Graph,
  from: number,
  subject: string,
  subjectType: 'p' | 'i',
  edges: { n: number },
): void {
  const pubkey = hex(from)
  const id = hex(edges.n)
  edges.n += 1
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
    subjectType,
    c_tag: 'identity',
    nValue: 1,
    addressableId: id,
  })
}

interface Loaded {
  graph: Graph
  root: string
  direct: string[]
  far: string[]
  hopEdges: number
  loadMs: number
}

function load(): Loaded {
  const graph = new Graph()
  const started = performance.now()
  const edges = { n: 0 }
  let next = 1
  const mids: number[] = []
  for (let i = 0; i < MIDS; i++) {
    const mid = next++
    apply(graph, 0, hex(mid), 'p', edges)
    mids.push(mid)
  }
  const leaves: number[] = []
  for (const mid of mids) {
    for (let k = 0; k < FANOUT; k++) {
      const leaf = next++
      apply(graph, mid, hex(leaf), 'p', edges)
      leaves.push(leaf)
    }
  }
  const hopEdges = edges.n
  const direct: string[] = []
  for (let i = 0; i < SUBJECTS; i++) {
    const id = `post:id:near-${i}`
    apply(graph, 0, id, 'i', edges)
    direct.push(id)
  }
  const far: string[] = []
  const step = Math.floor(leaves.length / SUBJECTS)
  for (let i = 0; i < SUBJECTS; i++) {
    const id = `post:id:far-${i}`
    apply(graph, leaves[i * step]!, id, 'i', edges)
    far.push(id)
  }
  return {
    graph,
    root: hex(0),
    direct,
    far,
    hopEdges,
    loadMs: performance.now() - started,
  }
}

function options(graph: Graph) {
  return {
    graph,
    format: 'default' as const,
    kind: KIND as 32009,
    trustContext: 'identity',
    scoreContext: 'identity',
    maxDepth: 4,
    followTrustThreshold: 75,
    now: 1_000,
  }
}

function view(score: Score | undefined): string {
  const trust = score instanceof TrustScore ? score.trust : -1
  const distrust = score instanceof TrustScore ? score.distrust : -1
  return [
    score?.subject ?? '',
    score?.connected === true,
    score?.degree ?? -1,
    score?.count ?? -1,
    trust,
    distrust,
  ].join(':')
}

function singles(root: string, subjects: readonly string[], graph: Graph): string {
  const opts = options(graph)
  return subjects
    .map((subject) => view(extensionResolver.resolve(root, subject, opts)[0]))
    .join('|')
}

function multi(root: string, subjects: readonly string[], graph: Graph): string {
  const scores = extensionResolver.resolveMulti(root, [...subjects], options(graph))
  return scores.map((score) => view(score)).join('|')
}

function assertSame(root: string, subjects: readonly string[], graph: Graph, shape: string): void {
  const one = singles(root, subjects, graph)
  const many = multi(root, subjects, graph)
  if (one !== many) {
    throw new Error(`${shape} resolveMulti diverged from single resolve`)
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}

function time(run: () => void): number {
  const started = performance.now()
  run()
  return performance.now() - started
}

function bench(
  shape: string,
  root: string,
  subjects: readonly string[],
  graph: Graph,
): void {
  assertSame(root, subjects, graph, shape)
  for (let i = 0; i < WARMUP; i++) {
    singles(root, subjects, graph)
    multi(root, subjects, graph)
  }
  const singleSamples: number[] = []
  const multiSamples: number[] = []
  for (let i = 0; i < SAMPLES; i++) {
    singleSamples.push(time(() => singles(root, subjects, graph)))
    multiSamples.push(time(() => multi(root, subjects, graph)))
  }
  const singleMedian = median(singleSamples)
  const multiMedian = median(multiSamples)
  const ratio = singleMedian / multiMedian
  const versus = singleMedian < 1 && multiMedian < 1
    ? 'both under 1 ms'
    : ratio >= 1
      ? `${ratio.toFixed(1)}× faster`
      : `${(1 / ratio).toFixed(1)}× slower`
  const fmt = (values: number[]) => values.map((ms) => ms.toFixed(1)).join(' / ')
  console.log(
    `${shape.padEnd(8)} 20×resolve     ${fmt(singleSamples).padEnd(34)} median ${singleMedian.toFixed(1)}`,
  )
  console.log(
    `${''.padEnd(8)} resolveMulti   ${fmt(multiSamples).padEnd(34)} median ${multiMedian.toFixed(1)}  ${versus}`,
  )
}

const loaded = load()
console.log(
  `extension IndexResolver, ${SUBJECTS} subjects, default format, no path`,
)
console.log(
  `graph: 1 root, ${MIDS} mids, ${MIDS * FANOUT} leaves (${loaded.hopEdges} hop edges), load ${loaded.loadMs.toFixed(0)} ms`,
)
console.log('shape     mode           samples ms                          median')
bench('direct', loaded.root, loaded.direct, loaded.graph)
bench('far', loaded.root, loaded.far, loaded.graph)
