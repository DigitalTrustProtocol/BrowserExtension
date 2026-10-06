/**
 * Batch queries match one execute*Query per subject.
 * Two or more default subjects use resolveMulti. Path stays on resolve.
 */
import { describe, expect, it } from 'vitest'
import { HeapTrustHarness, ratingRecord, trustRecord } from './heap-test-harness'
import { executeTrustQuery, executeTrustQueryBatch } from './query'
import {
  executeRatingQuery,
  executeRatingQueryBatch,
} from './ratings/ArtifactRatingResolver'
import { indexResolver } from './trust'
import type { IResolveStrategy } from './trust/IResolveStrategy'
import type { RatingQuery, TrustQuery, TrustSubject } from './types'

const NOW = 10
const root = 'root'
const postA: TrustSubject = { type: 'i', value: 'post:id:a' }
const postB: TrustSubject = { type: 'i', value: 'post:id:b' }
const postMissing: TrustSubject = { type: 'i', value: 'post:id:missing' }
const alice: TrustSubject = { type: 'p', value: 'alice' }

function countingResolver(): {
  resolver: IResolveStrategy
  calls: { single: number; multi: number }
} {
  const calls = { single: 0, multi: 0 }
  return {
    calls,
    resolver: {
      name: indexResolver.name,
      resolve: (observer, subject, options) => {
        calls.single += 1
        return indexResolver.resolve(observer, subject, options)
      },
      resolveMulti: (observer, subjects, options) => {
        calls.multi += 1
        return indexResolver.resolveMulti(observer, subjects, options)
      },
    },
  }
}

function graph() {
  return new HeapTrustHarness([
    trustRecord('root-alice', root, alice, 1),
    trustRecord('root-post-b', root, postB, 1),
    trustRecord('alice-post-a', 'alice', postA, 1),
    ratingRecord('root-rate-b', root, postB, 10, { labels: ['news'] }),
    ratingRecord('alice-rate-a', 'alice', postA, 40),
  ])
}

describe('executeTrustQueryBatch', () => {
  const queries: TrustQuery[] = [
    { rootPubkey: root, subject: postA, now: NOW },
    { rootPubkey: root, subject: alice, now: NOW },
    { rootPubkey: root, subject: postMissing, now: NOW },
    { rootPubkey: root, subject: postB, now: NOW },
    { rootPubkey: root, subject: postA, now: NOW },
  ]

  it('matches one resolve per subject and walks them together', () => {
    const harness = graph()
    const counted = countingResolver()
    const singles = queries.map((query) =>
      executeTrustQuery(harness.graph, counted.resolver, query, harness.graphVersion),
    )
    const before = { ...counted.calls }
    const batch = executeTrustQueryBatch(
      harness.graph,
      counted.resolver,
      queries,
      harness.graphVersion,
    )
    expect(batch).toEqual(singles)
    expect(counted.calls.multi - before.multi).toBe(1)
    expect(counted.calls.single).toBe(before.single)
    expect(batch[0]?.connected).toBe(true)
    expect(batch[0]?.degree).toBe(2)
    expect(batch[2]?.connected).toBe(false)
  })

  it('uses resolve for a single subject and for path', () => {
    const harness = graph()
    const counted = countingResolver()
    const one = queries[0]!
    executeTrustQueryBatch(harness.graph, counted.resolver, [one], harness.graphVersion)
    expect(counted.calls).toEqual({ single: 1, multi: 0 })

    const pathQueries = queries.map((query) => ({ ...query, format: 'path' as const }))
    const singles = pathQueries.map((query) =>
      executeTrustQuery(harness.graph, indexResolver, query, harness.graphVersion),
    )
    const batch = executeTrustQueryBatch(
      harness.graph,
      counted.resolver,
      pathQueries,
      harness.graphVersion,
    )
    expect(batch).toEqual(singles)
    expect(counted.calls.multi).toBe(0)
    expect(counted.calls.single).toBe(1 + pathQueries.length)
  })
})

describe('executeRatingQueryBatch', () => {
  it('matches one rating query per subject, including label filters', () => {
    const harness = graph()
    const counted = countingResolver()
    const queries: RatingQuery[] = [
      { rootPubkey: root, subject: postA, now: NOW },
      { rootPubkey: root, subject: postB, now: NOW, labels: ['nope'] },
      { rootPubkey: root, subject: postB, now: NOW },
      { rootPubkey: root, subject: postMissing, now: NOW },
    ]
    const singles = queries.map((query) =>
      executeRatingQuery(
        harness.graph,
        counted.resolver,
        query,
        harness.graphVersion,
        harness.defaultBounds,
      ),
    )
    const beforeMulti = counted.calls.multi
    const batch = executeRatingQueryBatch(
      harness.graph,
      counted.resolver,
      queries,
      harness.graphVersion,
      harness.defaultBounds,
    )
    expect(batch).toEqual(singles)
    expect(counted.calls.multi - beforeMulti).toBe(1)
    expect(batch[1]?.claimCount).toBe(0)
    expect(batch[2]?.claimCount).toBe(1)
    expect(batch[2]?.averageScore).toBe(10)
  })

  it('uses resolve for rating path', () => {
    const harness = graph()
    const counted = countingResolver()
    const queries: RatingQuery[] = [
      { rootPubkey: root, subject: postA, now: NOW, format: 'path' },
      { rootPubkey: root, subject: postB, now: NOW, format: 'path' },
    ]
    const singles = queries.map((query) =>
      executeRatingQuery(
        harness.graph,
        indexResolver,
        query,
        harness.graphVersion,
        harness.defaultBounds,
      ),
    )
    const batch = executeRatingQueryBatch(
      harness.graph,
      counted.resolver,
      queries,
      harness.graphVersion,
      harness.defaultBounds,
    )
    expect(batch).toEqual(singles)
    expect(counted.calls).toEqual({ single: queries.length, multi: 0 })
    const first = singles[0]
    if (!first) throw new Error('missing rating path')
    expect(first.pathView?.nodes.length ?? 0).toBeGreaterThan(0)
  })
})
