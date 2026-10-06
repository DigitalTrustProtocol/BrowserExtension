/**
 * resolveMulti matches one IndexResolver.resolve per subject on the same graph.
 * Path format is not supported on resolveMulti and is not compared here.
 */
import { describe, expect, it } from 'vitest'
import { RATING_STATEMENT_KIND } from '../lib/nostr/kind-32014'
import { TRUST_STATEMENT_KIND } from '../lib/nostr/kind-32009'
import type { EventRecord } from '../storage/types'
import { WOT_MAX_DEGREE_DEFAULT } from '../shared/wot-max-degree'
import { HeapTrustHarness, ratingRecord, trustRecord } from './heap-test-harness'
import { indexResolver } from './trust'
import type { Graph } from './trust/Graph'
import type { ResolveFormat, ScoreKind } from './trust/IResolveStrategy'
import { RatingScore, TrustScore, type Score } from './trust/Score'
import type { TrustSubject, TrustValue } from './types'

const NOW = 10
const root = 'root'

/** `path` is single-resolve only. */
type BatchFormat = Exclude<ResolveFormat, 'path'>

function pubkey(id: string): TrustSubject {
  return { type: 'p', value: id }
}

function post(id: string): TrustSubject {
  return { type: 'i', value: `post:id:${id}` }
}

function trust(
  eventId: string,
  author: string,
  subject: TrustSubject,
  value: TrustValue,
  activeFrom?: number,
): EventRecord {
  return trustRecord(eventId, author, subject, value, {
    context: 'identity',
    ...(activeFrom !== undefined ? { activeFrom } : {}),
  })
}

function rate(
  eventId: string,
  author: string,
  subject: TrustSubject,
  score: number,
): EventRecord {
  return ratingRecord(eventId, author, subject, score, { context: 'identity' })
}

/** root → alice → bob → carol → dave, plus posts at each degree. */
function depthGraph(): EventRecord[] {
  return [
    trust('root-alice', root, pubkey('alice'), 1),
    trust('alice-bob', 'alice', pubkey('bob'), 1),
    trust('bob-carol', 'bob', pubkey('carol'), 1),
    trust('carol-dave', 'carol', pubkey('dave'), 1),
    trust('alice-root', 'alice', pubkey(root), 1),
    trust('root-post-a', root, post('a'), 1),
    trust('foe-post-a', 'foe', post('a'), -1),
    trust('root-foe', root, pubkey('foe'), -1),
    trust('alice-post-b', 'alice', post('b'), 1),
    trust('bob-post-b', 'bob', post('b'), -1),
    trust('bob-post-c', 'bob', post('c'), -1),
    trust('carol-post-d', 'carol', post('d'), 1),
    trust('dave-post-e', 'dave', post('e'), 1),
    trust('stranger-post-f', 'stranger', post('f'), 1),
    trust('root-n1', root, pubkey('n1'), 1),
    trust('root-n2', root, pubkey('n2'), 1),
    trust('n1-post-g', 'n1', post('g'), 1),
    trust('n2-post-g', 'n2', post('g'), 0),
    trust('root-post-future', root, post('future'), 1, NOW + 100),
    rate('root-rate-a', root, post('a'), 10),
    rate('alice-rate-b', 'alice', post('b'), 20),
    rate('bob-rate-c', 'bob', post('c'), 30),
    rate('carol-rate-d', 'carol', post('d'), 0),
    rate('dave-rate-e', 'dave', post('e'), 40),
    rate('stranger-rate-f', 'stranger', post('f'), 99),
    rate('n1-rate-g', 'n1', post('g'), 5),
    rate('n2-rate-g', 'n2', post('g'), 7),
  ]
}

const depthSubjects = [
  'post:id:c',
  'alice',
  'post:id:missing',
  '  Post:id:A  ',
  'root',
  'post:id:f',
  'post:id:e',
  'bob',
  'Post:id:B',
  'post:id:d',
  'post:id:g',
  'carol',
  'dave',
  'post:id:future',
  'post:id:a',
]

function mixedPeerGraph(): EventRecord[] {
  return [
    trust('root-a', root, pubkey('a'), 1),
    trust('root-b', root, pubkey('b'), 1),
    trust('a-peer', 'a', pubkey('peer'), 1),
    trust('b-peer', 'b', pubkey('peer'), -1),
    trust('peer-far', 'peer', post('far'), 1),
    trust('root-near', root, post('near'), 1),
    trust('a-mid', 'a', post('mid'), 1),
  ]
}

const mixedSubjects = ['post:id:far', 'peer', 'post:id:near', 'post:id:mid']

interface BatchOptions {
  kind: ScoreKind
  format?: BatchFormat
  followTrustThreshold?: number
  maxDepth?: number
  deadline?: number
}

function batchOptions(graph: Graph, options: BatchOptions) {
  return {
    graph,
    format: options.format ?? 'default',
    followTrustThreshold: options.followTrustThreshold ?? 1,
    now: NOW,
    kind: options.kind,
    maxDepth: options.maxDepth ?? WOT_MAX_DEGREE_DEFAULT,
    trustContext: 'identity',
    scoreContext: 'identity',
    ...(options.deadline !== undefined ? { deadline: options.deadline } : {}),
  }
}

function scoreView(score: Score): Record<string, unknown> {
  const view: Record<string, unknown> = {
    type: score instanceof TrustScore
      ? 'trust'
      : score instanceof RatingScore
        ? 'rating'
        : 'score',
    subject: score.subject,
    kind: score.kind,
    count: score.count,
    degree: score.degree,
    connected: score.connected,
  }
  if (score instanceof TrustScore) {
    view.trust = score.trust
    view.distrust = score.distrust
    view.neutral = score.neutral
    view.trustValue = score.trustValue
  } else if (score instanceof RatingScore) {
    view.ratingValue = score.ratingValue
  }
  if (score.edges) view.edges = [...score.edges]
  return view
}

function expectResolveMultiMatchesSingles(
  graph: Graph,
  subjectIds: readonly string[],
  options: BatchOptions,
): Record<string, unknown>[] {
  const shared = batchOptions(graph, options)
  const singles = subjectIds.flatMap((subjectId) =>
    indexResolver.resolve(root, subjectId, shared).map(scoreView),
  )
  const multi = indexResolver.resolveMulti(root, [...subjectIds], shared).map(scoreView)
  expect(multi).toEqual(singles)
  return singles
}

describe('IndexResolver.resolveMulti matches single resolve', () => {
  it('32009: one batch equals a resolve per subject across degrees', () => {
    const graph = new HeapTrustHarness(depthGraph()).graph
    const scores = expectResolveMultiMatchesSingles(graph, depthSubjects, {
      kind: TRUST_STATEMENT_KIND,
    })
    expect(scores.some((row) => row.connected === true)).toBe(true)
    expect(scores.some((row) => row.connected === false)).toBe(true)
    const postB = scores.find((row) => row.subject === 'post:id:b')
    expect(postB).toMatchObject({
      connected: true,
      degree: 2,
      trust: 1,
      distrust: 0,
    })
  })

  it('32014: one batch equals a resolve per subject across degrees', () => {
    const graph = new HeapTrustHarness(depthGraph()).graph
    const scores = expectResolveMultiMatchesSingles(graph, depthSubjects, {
      kind: RATING_STATEMENT_KIND,
    })
    const postG = scores.find((row) => row.subject === 'post:id:g')
    expect(postG).toMatchObject({
      connected: true,
      degree: 2,
      count: 2,
      ratingValue: 12,
    })
  })

  it('statements lists the same edges as each single resolve', () => {
    const graph = new HeapTrustHarness(depthGraph()).graph
    const scores = expectResolveMultiMatchesSingles(graph, depthSubjects, {
      kind: TRUST_STATEMENT_KIND,
      format: 'statements',
    })
    const postG = scores.find((row) => row.subject === 'post:id:g')
    expect(postG?.edges).toHaveLength(2)
  })

  it('followTrustThreshold 1 and 75 agree with single resolves', () => {
    const graph = new HeapTrustHarness(mixedPeerGraph()).graph
    const open = expectResolveMultiMatchesSingles(graph, mixedSubjects, {
      kind: TRUST_STATEMENT_KIND,
      followTrustThreshold: 1,
    })
    const strict = expectResolveMultiMatchesSingles(graph, mixedSubjects, {
      kind: TRUST_STATEMENT_KIND,
      followTrustThreshold: 75,
    })
    expect(open.find((row) => row.subject === 'post:id:far')?.connected).toBe(true)
    expect(strict.find((row) => row.subject === 'post:id:far')?.connected).toBe(false)
  })

  it('deadline and maxDepth cut the batch the same way as single resolves', () => {
    const graph = new HeapTrustHarness(depthGraph()).graph
    const subjects = ['post:id:a', 'post:id:b', 'post:id:d']
    const timed = expectResolveMultiMatchesSingles(graph, subjects, {
      kind: TRUST_STATEMENT_KIND,
      deadline: 1,
    })
    expect(timed.find((row) => row.subject === 'post:id:a')?.connected).toBe(true)
    expect(timed.find((row) => row.subject === 'post:id:b')?.connected).toBe(false)

    const shallow = expectResolveMultiMatchesSingles(graph, subjects, {
      kind: TRUST_STATEMENT_KIND,
      maxDepth: 2,
    })
    expect(shallow.find((row) => row.subject === 'post:id:b')?.connected).toBe(true)
    expect(shallow.find((row) => row.subject === 'post:id:d')?.connected).toBe(false)
  })

  it('missing observer and an empty subject list both return no scores', () => {
    const graph = new HeapTrustHarness(depthGraph()).graph
    const shared = batchOptions(graph, { kind: TRUST_STATEMENT_KIND })
    const missingObserver = depthSubjects.flatMap((subjectId) =>
      indexResolver.resolve('nobody', subjectId, shared).map(scoreView),
    )
    expect(
      indexResolver.resolveMulti('nobody', [...depthSubjects], shared).map(scoreView),
    ).toEqual(missingObserver)
    expect(indexResolver.resolveMulti(root, [], shared)).toEqual([])
  })
})
