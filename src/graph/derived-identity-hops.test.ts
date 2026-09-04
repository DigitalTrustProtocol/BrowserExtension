import { describe, expect, it } from 'vitest'
import { applyIdentityPubkeyHops } from './derived-identity-hops'
import { LocalTrustGraph } from './graph'
import { indexResolver } from './trust'
import type { ReducedTrustStatement, TrustSubject, TrustValue } from './types'

const ROOT = 'root'
const NEVE_PK = 'neve'
const ARCHIVE_PK = 'archive'
const NEVE_X = 'user:id:16224'
const ARCHIVE_X = 'user:id:999'
const BINDINGS = new Map([
  ['16224', NEVE_PK],
  ['999', ARCHIVE_PK],
])

function stmt(
  eventId: string,
  author: string,
  subject: TrustSubject,
  value: TrustValue,
): ReducedTrustStatement {
  return {
    eventId,
    author,
    subject,
    value,
    context: 'identity',
    createdAt: 1,
  }
}

function iUser(twitterId: string): TrustSubject {
  return { type: 'i', value: `user:id:${twitterId}` }
}

function pKey(value: string): TrustSubject {
  return { type: 'p', value }
}

function edgeList(statements: readonly ReducedTrustStatement[]) {
  return statements.map((row) => ({
    from: row.author,
    to: row.subject.value,
    type: row.subject.type,
    value: row.value,
    derived: Boolean(row.derivedFrom),
  }))
}

function resolvePath(
  statements: readonly ReducedTrustStatement[],
  subject: string,
) {
  const graph = new LocalTrustGraph(
    applyIdentityPubkeyHops(statements, BINDINGS),
  )
  return indexResolver.resolve(ROOT, subject, {
    graph: graph.trustGraph,
    format: 'path',
    followTrustThreshold: 1,
    now: 10,
    context: 'identity',
  })
}

function pathEdges(
  statements: readonly ReducedTrustStatement[],
  subject: string,
) {
  const graph = new LocalTrustGraph(
    applyIdentityPubkeyHops(statements, BINDINGS),
  )
  const heap = graph.trustGraph
  const scores = indexResolver.resolve(ROOT, subject, {
    graph: heap,
    format: 'path',
    followTrustThreshold: 1,
    now: 10,
    context: 'identity',
  })
  return scores.flatMap((score) => {
    const to =
      score.subjectIndex !== undefined
        ? heap.nodesList[score.subjectIndex]?.id
        : score.subject
    return (score.edges ?? []).flatMap((index) => {
      const edge = heap.edgesList[index]
      if (!edge) return []
      return [{ from: edge.author, to, value: edge.value }]
    })
  })
}

describe('applyIdentityPubkeyHops', () => {
  it('copies user:id trust onto the bound pubkey so that person is a hop', () => {
    const real = [
      stmt('root-neve', ROOT, iUser('16224'), 1),
      stmt('neve-archive', NEVE_PK, iUser('999'), 1),
    ]
    const next = applyIdentityPubkeyHops(real, BINDINGS)
    expect(edgeList(next)).toEqual(
      expect.arrayContaining([
        {
          from: ROOT,
          to: NEVE_X,
          type: 'i',
          value: 1,
          derived: false,
        },
        {
          from: ROOT,
          to: NEVE_PK,
          type: 'p',
          value: 1,
          derived: true,
        },
        {
          from: NEVE_PK,
          to: ARCHIVE_PK,
          type: 'p',
          value: 1,
          derived: true,
        },
      ]),
    )

    const scores = resolvePath(real, ARCHIVE_X)
    const hit = scores.find((row) => row.subject === ARCHIVE_X)
    expect(hit?.connected || (hit?.count ?? 0) > 0).toBe(true)
    expect(pathEdges(real, ARCHIVE_X)).toEqual(
      expect.arrayContaining([
        { from: ROOT, to: NEVE_PK, value: 1 },
        { from: NEVE_PK, to: ARCHIVE_X, value: 1 },
      ]),
    )
  })

  it('does not walk a distrusted user:id as a trusted hop to their trustee', () => {
    // root --(-1)--> @neve16224
    // @neve16224 --(+1)--> @archiveney
    const real = [
      stmt('root-neve', ROOT, iUser('16224'), -1),
      stmt('neve-archive', NEVE_PK, iUser('999'), 1),
    ]
    const next = applyIdentityPubkeyHops(real, BINDINGS)
    expect(edgeList(next)).toEqual(
      expect.arrayContaining([
        {
          from: ROOT,
          to: NEVE_X,
          type: 'i',
          value: -1,
          derived: false,
        },
        {
          from: ROOT,
          to: NEVE_PK,
          type: 'p',
          value: -1,
          derived: true,
        },
      ]),
    )
    expect(
      next.some(
        (row) =>
          row.author === ROOT &&
          row.subject.type === 'p' &&
          row.subject.value === NEVE_PK &&
          row.value === 1,
      ),
    ).toBe(false)

    expect(pathEdges(real, ARCHIVE_X)).not.toEqual(
      expect.arrayContaining([{ from: ROOT, to: NEVE_PK, value: 1 }]),
    )
    const archive = new LocalTrustGraph(
      applyIdentityPubkeyHops(real, BINDINGS),
    ).query({
      rootPubkey: ROOT,
      subject: iUser('999'),
      context: 'identity',
      now: 10,
      format: 'path',
    })
    expect(archive.connected).toBe(false)
    expect(
      archive.pathView?.edges.some(
        (edge) => edge.value === 1 && edge.eventId === 'root-neve',
      ),
    ).toBe(false)

    const neveDirect = new LocalTrustGraph(
      applyIdentityPubkeyHops(real, BINDINGS),
    ).query({
      rootPubkey: ROOT,
      subject: iUser('16224'),
      context: 'identity',
      now: 10,
      format: 'path',
    })
    expect(neveDirect.direct).toMatchObject({ value: -1 })
    expect(neveDirect.resolution).toBe('distrusted')
  })

  it('strips a leftover native p-trust from the same author after user:id distrust', () => {
    const real = [
      stmt('root-neve-x', ROOT, iUser('16224'), -1),
      stmt('root-neve-p', ROOT, pKey(NEVE_PK), 1),
      stmt('neve-archive', NEVE_PK, iUser('999'), 1),
    ]
    const next = applyIdentityPubkeyHops(real, BINDINGS)
    expect(
      next.some(
        (row) =>
          row.eventId === 'root-neve-p' &&
          row.subject.type === 'p' &&
          row.value === 1,
      ),
    ).toBe(false)
    expect(
      next.some(
        (row) =>
          row.author === ROOT &&
          row.subject.type === 'p' &&
          row.subject.value === NEVE_PK &&
          row.value === -1,
      ),
    ).toBe(true)

    expect(pathEdges(real, ARCHIVE_X)).not.toEqual(
      expect.arrayContaining([{ from: ROOT, to: NEVE_PK, value: 1 }]),
    )
  })
})
