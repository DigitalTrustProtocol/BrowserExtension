import type { TrustSubject, TrustValue } from './kind-32009'
import { canonicalTwitterAccountSubject } from './x-identity'

/** Tag name/value marking local-only demo trust events (never publish). */
export const DEMO_WOT_TAG_NAME = 'test'
export const DEMO_WOT_TAG_VALUE = 'attentionx-demo'
export const DEMO_WOT_EXTRA_TAGS: ReadonlyArray<readonly [string, string]> = [
  [DEMO_WOT_TAG_NAME, DEMO_WOT_TAG_VALUE],
]

export const DEMO_WOT_MAX_DEPTH = 5
export const DEMO_WOT_AUTHORS_PER_DEGREE = 4

/** Broadcast so content-script trust caches refresh after seed/clear. */
export const TRUST_GRAPH_UPDATED_MESSAGE = 'TRUST_GRAPH_UPDATED' as const

export function isDemoWotEvent(event: {
  tags: ReadonlyArray<readonly string[]>
}): boolean {
  return event.tags.some(
    (tag) =>
      tag[0] === DEMO_WOT_TAG_NAME && tag[1] === DEMO_WOT_TAG_VALUE,
  )
}

export type DemoWotSubjectRef =
  | { type: 'p'; authorIndex: number }
  | { type: 'i'; twitterId: string }

export interface DemoWotPlannedStatement {
  /** `-1` = active user (root); `0..n-1` = ephemeral fake authors. */
  authorIndex: number
  subject: DemoWotSubjectRef
  value: TrustValue
  context: string
}

export interface DemoWotPlan {
  fakeAuthorCount: number
  maxDepth: number
  statements: DemoWotPlannedStatement[]
}

/**
 * Builds a deterministic multi-hop WoT plan: positive `p` edges for traversal
 * (up to `maxDepth`), lateral criss-cross, and `i:user:id` trust/distrust
 * over real X identities. No post subjects.
 */
export function planDemoWotNetwork(input: {
  twitterIds: readonly string[]
  maxDepth?: number
  authorsPerDegree?: number
}): DemoWotPlan {
  const twitterIds = [
    ...new Set(
      input.twitterIds
        .map((id) => id.trim())
        .filter((id) => /^\d+$/.test(id)),
    ),
  ]
  if (twitterIds.length === 0) {
    throw new Error(
      'No X identities in IndexedDB yet — browse x.com so accounts are observed first',
    )
  }

  const maxDepth = Math.max(
    1,
    Math.min(input.maxDepth ?? DEMO_WOT_MAX_DEPTH, DEMO_WOT_MAX_DEPTH),
  )
  const authorsPerDegree = Math.max(
    2,
    input.authorsPerDegree ?? DEMO_WOT_AUTHORS_PER_DEGREE,
  )
  const fakeAuthorCount = maxDepth * authorsPerDegree
  const statements: DemoWotPlannedStatement[] = []

  const layerOf = (authorIndex: number): number =>
    Math.floor(authorIndex / authorsPerDegree) + 1

  const authorsInLayer = (degree: number): number[] => {
    const start = (degree - 1) * authorsPerDegree
    return Array.from({ length: authorsPerDegree }, (_, i) => start + i)
  }

  // Root → degree 1: positive p edges so the local user can traverse.
  for (const target of authorsInLayer(1)) {
    statements.push({
      authorIndex: -1,
      subject: { type: 'p', authorIndex: target },
      value: '1',
      context: '',
    })
  }

  // Degree d → d+1 positive hops + some distrust (non-traversable).
  for (let degree = 1; degree < maxDepth; degree += 1) {
    const sources = authorsInLayer(degree)
    const targets = authorsInLayer(degree + 1)
    for (let i = 0; i < sources.length; i += 1) {
      const source = sources[i]!
      const primary = targets[i % targets.length]!
      const secondary = targets[(i + 1) % targets.length]!
      statements.push({
        authorIndex: source,
        subject: { type: 'p', authorIndex: primary },
        value: '1',
        context: '',
      })
      if (primary !== secondary) {
        statements.push({
          authorIndex: source,
          subject: { type: 'p', authorIndex: secondary },
          value: '1',
          context: '',
        })
      }
      // Sparse distrust of a next-hop peer (evidence only; does not expand).
      if (i % 3 === 0) {
        const disliked = targets[(i + 2) % targets.length]!
        if (disliked !== primary && disliked !== secondary) {
          statements.push({
            authorIndex: source,
            subject: { type: 'p', authorIndex: disliked },
            value: '-1',
            context: '',
          })
        }
      }
    }
  }

  // Criss-cross: same-layer positive trusts (lateral, does not shorten depth).
  for (let authorIndex = 0; authorIndex < fakeAuthorCount; authorIndex += 1) {
    const degree = layerOf(authorIndex)
    const peers = authorsInLayer(degree).filter((peer) => peer !== authorIndex)
    if (peers.length === 0) continue
    const peer = peers[authorIndex % peers.length]!
    statements.push({
      authorIndex,
      subject: { type: 'p', authorIndex: peer },
      value: '1',
      context: '',
    })
    // Occasional second peer for denser lateral mesh.
    if (peers.length > 1 && authorIndex % 2 === 0) {
      const peer2 = peers[(authorIndex + 1) % peers.length]!
      if (peer2 !== peer) {
        statements.push({
          authorIndex,
          subject: { type: 'p', authorIndex: peer2 },
          value: '1',
          context: '',
        })
      }
    }
  }

  // Root directly trusts a slice of real X accounts (distance 0 evidence).
  const rootDirectCount = Math.min(8, twitterIds.length)
  for (let i = 0; i < rootDirectCount; i += 1) {
    statements.push({
      authorIndex: -1,
      subject: { type: 'i', twitterId: twitterIds[i]! },
      value: i % 7 === 0 ? '-1' : '1',
      context: '',
    })
  }

  // Distribute X identities across fake authors.
  for (let i = 0; i < twitterIds.length; i += 1) {
    const authorIndex = i % fakeAuthorCount
    statements.push({
      authorIndex,
      subject: { type: 'i', twitterId: twitterIds[i]! },
      value: i % 5 === 0 ? '-1' : '1',
      context: '',
    })
  }

  // Second opinion from a different hop for denser criss-cross evidence.
  for (let i = 0; i < twitterIds.length; i += 2) {
    const authorIndex = (i * 3 + 1) % fakeAuthorCount
    statements.push({
      authorIndex,
      subject: { type: 'i', twitterId: twitterIds[i]! },
      value: i % 4 === 0 ? '-1' : '1',
      context: '',
    })
  }

  return { fakeAuthorCount, maxDepth, statements }
}

export function materializeDemoSubject(
  subject: DemoWotSubjectRef,
  pubkeys: readonly string[],
): TrustSubject {
  if (subject.type === 'i') {
    return {
      type: 'i',
      value: canonicalTwitterAccountSubject(subject.twitterId),
    }
  }
  const pubkey = pubkeys[subject.authorIndex]
  if (!pubkey) {
    throw new Error(`Missing demo author pubkey at ${subject.authorIndex}`)
  }
  return { type: 'p', value: pubkey }
}
