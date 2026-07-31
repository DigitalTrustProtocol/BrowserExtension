import type { TrustSubject, TrustValue } from './kind-32009'
import {
  canonicalTwitterAccountSubject,
  canonicalTwitterPostSubject,
} from './x-identity'

import { DEMO_EVENT_STATE } from '../storage/schema'

/** Tag name/value marking local-only demo trust events (never publish). */
export const DEMO_WOT_TAG_NAME = 'test'
export const DEMO_WOT_TAG_VALUE = 'attentionx-demo'
export const DEMO_WOT_EXTRA_TAGS: ReadonlyArray<readonly [string, string]> = [
  [DEMO_WOT_TAG_NAME, DEMO_WOT_TAG_VALUE],
]

export const DEMO_WOT_MAX_DEPTH = 3
export const DEMO_WOT_AUTHORS_PER_DEGREE = 4
/** Cap observed X accounts considered for user:id demo trusts. */
export const DEMO_WOT_MAX_USER_SUBJECTS = 400
/** Inclusive max network (non-root) trust statements about a single X user. */
export const DEMO_WOT_MAX_TRUSTS_PER_USER = 10
/** Operator (root) directly trusts only this many recent X accounts. */
export const DEMO_WOT_ROOT_DIRECT_USERS = 8
/** Operator (root) directly trusts only this many demo posts. */
export const DEMO_WOT_ROOT_DIRECT_POSTS = 8
/** Minimum synthetic post:id trusts when budget allows. */
export const DEMO_WOT_MIN_POST_SUBJECTS = 500
/** Upper bound for post subjects when many users leave room under the cap. */
export const DEMO_WOT_MAX_POST_SUBJECTS = 1200
/** Hard cap so seed stays within ~2k events. */
export const DEMO_WOT_MAX_STATEMENTS = 2000

/** @deprecated Prefer DEMO_WOT_MIN_POST_SUBJECTS — kept for older imports/tests. */
export const DEMO_WOT_POST_SUBJECTS = DEMO_WOT_MIN_POST_SUBJECTS

/** Broadcast so content-script trust caches refresh after seed/clear. */
export const TRUST_GRAPH_UPDATED_MESSAGE = 'TRUST_GRAPH_UPDATED' as const

export interface DemoWotUserCandidate {
  twitterId: string
  /** Prefer higher values — recently seen accounts are likelier on the timeline. */
  lastSeen: number
}

/** Deterministic snowflake-range post ids for demo post subjects. */
export function demoPostId(index: number): string {
  const n = Math.max(0, Math.floor(index))
  return String(1_900_000_000_000_000_000n + BigInt(n))
}

export function isDemoWotEvent(event: {
  tags: ReadonlyArray<readonly string[]>
  state?: string
}): boolean {
  if (event.state === DEMO_EVENT_STATE) return true
  return event.tags.some(
    (tag) =>
      tag[0] === DEMO_WOT_TAG_NAME && tag[1] === DEMO_WOT_TAG_VALUE,
  )
}

export type DemoWotSubjectRef =
  | { type: 'p'; authorIndex: number }
  | { type: 'user'; twitterId: string }
  | { type: 'post'; postId: string }

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
  userSubjects: number
  postSubjects: number
  statements: DemoWotPlannedStatement[]
}

function hashDigits(twitterId: string): number {
  let h = 0
  for (let i = 0; i < twitterId.length; i += 1) {
    h = (h * 31 + twitterId.charCodeAt(i)) >>> 0
  }
  return h
}

/** Deterministic 0..DEMO_WOT_MAX_TRUSTS_PER_USER trusts for one user. */
export function demoTrustsPerUser(twitterId: string): number {
  return hashDigits(twitterId) % (DEMO_WOT_MAX_TRUSTS_PER_USER + 1)
}

function normalizeCandidates(input: {
  users?: readonly DemoWotUserCandidate[]
  twitterIds?: readonly string[]
}): DemoWotUserCandidate[] {
  const fromUsers = (input.users ?? []).map((row) => ({
    twitterId: row.twitterId.trim(),
    lastSeen:
      typeof row.lastSeen === 'number' && Number.isFinite(row.lastSeen)
        ? row.lastSeen
        : 0,
  }))
  const fromIds = (input.twitterIds ?? []).map((id) => ({
    twitterId: id.trim(),
    lastSeen: 0,
  }))
  const merged = [...fromUsers, ...fromIds].filter((row) =>
    /^\d+$/.test(row.twitterId),
  )

  const byId = new Map<string, DemoWotUserCandidate>()
  for (const row of merged) {
    const previous = byId.get(row.twitterId)
    if (!previous || row.lastSeen > previous.lastSeen) {
      byId.set(row.twitterId, row)
    }
  }

  return [...byId.values()].sort((a, b) => {
    if (b.lastSeen !== a.lastSeen) return b.lastSeen - a.lastSeen
    return a.twitterId < b.twitterId ? -1 : a.twitterId > b.twitterId ? 1 : 0
  })
}

function authorsForUserTrusts(
  rank: number,
  count: number,
  fakeAuthorCount: number,
): number[] {
  if (count <= 0 || fakeAuthorCount <= 0) return []
  const max = Math.min(count, fakeAuthorCount)
  const authors: number[] = []
  const start = rank % fakeAuthorCount
  for (let offset = 0; offset < fakeAuthorCount && authors.length < max; offset += 1) {
    authors.push((start + offset) % fakeAuthorCount)
  }
  return authors
}

/**
 * Builds a deterministic multi-hop WoT plan:
 * - positive `p` edges for traversal (root only seeds degree-1)
 * - root directly trusts a small slice of recent X users / posts (operator budget)
 * - remaining user opinions (0–10 each) and most posts come from fake WoT authors
 * - post trusts fill remaining budget toward 2000 (at least ~500 when room)
 */
export function planDemoWotNetwork(input: {
  users?: readonly DemoWotUserCandidate[]
  /** @deprecated Prefer `users` with `lastSeen`. */
  twitterIds?: readonly string[]
  maxDepth?: number
  authorsPerDegree?: number
  maxUserSubjects?: number
  postSubjects?: number
}): DemoWotPlan {
  const twitterIds = normalizeCandidates(input)
    .slice(
      0,
      Math.max(
        0,
        Math.min(
          input.maxUserSubjects ?? DEMO_WOT_MAX_USER_SUBJECTS,
          DEMO_WOT_MAX_USER_SUBJECTS,
        ),
      ),
    )
    .map((row) => row.twitterId)

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
  const pushStatement = (row: DemoWotPlannedStatement): boolean => {
    if (statements.length >= DEMO_WOT_MAX_STATEMENTS) return false
    statements.push(row)
    return true
  }

  const layerOf = (authorIndex: number): number =>
    Math.floor(authorIndex / authorsPerDegree) + 1

  const authorsInLayer = (degree: number): number[] => {
    const start = (degree - 1) * authorsPerDegree
    return Array.from({ length: authorsPerDegree }, (_, i) => start + i)
  }

  // Root → degree 1: positive p edges so the local user can traverse.
  for (const target of authorsInLayer(1)) {
    if (
      !pushStatement({
        authorIndex: -1,
        subject: { type: 'p', authorIndex: target },
        value: '1',
        context: '',
      })
    ) {
      return finish(fakeAuthorCount, maxDepth, twitterIds.length, 0, statements)
    }
  }

  // Degree d → d+1 positive hops + sparse distrust.
  for (let degree = 1; degree < maxDepth; degree += 1) {
    const sources = authorsInLayer(degree)
    const targets = authorsInLayer(degree + 1)
    for (let i = 0; i < sources.length; i += 1) {
      const source = sources[i]!
      const primary = targets[i % targets.length]!
      const secondary = targets[(i + 1) % targets.length]!
      if (
        !pushStatement({
          authorIndex: source,
          subject: { type: 'p', authorIndex: primary },
          value: '1',
          context: '',
        })
      ) {
        return finish(fakeAuthorCount, maxDepth, twitterIds.length, 0, statements)
      }
      if (primary !== secondary) {
        if (
          !pushStatement({
            authorIndex: source,
            subject: { type: 'p', authorIndex: secondary },
            value: '1',
            context: '',
          })
        ) {
          return finish(
            fakeAuthorCount,
            maxDepth,
            twitterIds.length,
            0,
            statements,
          )
        }
      }
      if (i % 3 === 0) {
        const disliked = targets[(i + 2) % targets.length]!
        if (disliked !== primary && disliked !== secondary) {
          if (
            !pushStatement({
              authorIndex: source,
              subject: { type: 'p', authorIndex: disliked },
              value: '-1',
              context: '',
            })
          ) {
            return finish(
              fakeAuthorCount,
              maxDepth,
              twitterIds.length,
              0,
              statements,
            )
          }
        }
      }
    }
  }

  // Lateral same-layer mesh (sparse).
  for (let authorIndex = 0; authorIndex < fakeAuthorCount; authorIndex += 1) {
    const degree = layerOf(authorIndex)
    const peers = authorsInLayer(degree).filter((peer) => peer !== authorIndex)
    if (peers.length === 0) continue
    const peer = peers[authorIndex % peers.length]!
    if (
      !pushStatement({
        authorIndex,
        subject: { type: 'p', authorIndex: peer },
        value: '1',
        context: '',
      })
    ) {
      return finish(fakeAuthorCount, maxDepth, twitterIds.length, 0, statements)
    }
  }

  // Root directly trusts a small recent slice (old Generate Trust Event behaviour).
  const rootDirectUsers = Math.min(DEMO_WOT_ROOT_DIRECT_USERS, twitterIds.length)
  for (let i = 0; i < rootDirectUsers; i += 1) {
    if (
      !pushStatement({
        authorIndex: -1,
        subject: { type: 'user', twitterId: twitterIds[i]! },
        value: i % 7 === 0 ? '-1' : '1',
        context: '',
      })
    ) {
      return finish(fakeAuthorCount, maxDepth, twitterIds.length, 0, statements)
    }
  }

  // Network opinions on observed X users (recent lastSeen first): 0–10 each from
  // fake authors only — keeps the operator's own trust list small.
  for (let i = 0; i < twitterIds.length; i += 1) {
    const twitterId = twitterIds[i]!
    const trustCount = demoTrustsPerUser(twitterId)
    const authors = authorsForUserTrusts(i, trustCount, fakeAuthorCount)
    for (let j = 0; j < authors.length; j += 1) {
      const value: TrustValue =
        (hashDigits(twitterId) + j) % 5 === 0 ? '-1' : '1'
      if (
        !pushStatement({
          authorIndex: authors[j]!,
          subject: { type: 'user', twitterId },
          value,
          context: '',
        })
      ) {
        return finish(fakeAuthorCount, maxDepth, twitterIds.length, 0, statements)
      }
    }
  }

  // Post trusts: grow with remaining budget (aim toward 2000 when users are many).
  const remaining = DEMO_WOT_MAX_STATEMENTS - statements.length
  const scaledPosts = Math.min(
    DEMO_WOT_MAX_POST_SUBJECTS,
    Math.max(
      DEMO_WOT_MIN_POST_SUBJECTS,
      Math.floor(twitterIds.length * 2.5) + DEMO_WOT_MIN_POST_SUBJECTS,
    ),
  )
  const postSubjectCount = Math.max(
    0,
    Math.min(
      input.postSubjects ?? scaledPosts,
      remaining,
      DEMO_WOT_MAX_POST_SUBJECTS,
    ),
  )

  let postsPlanned = 0
  for (let i = 0; i < postSubjectCount; i += 1) {
    const postId = demoPostId(i)
    const authorIndex =
      i < DEMO_WOT_ROOT_DIRECT_POSTS ? -1 : i % fakeAuthorCount
    if (
      !pushStatement({
        authorIndex,
        subject: { type: 'post', postId },
        value: i % 9 === 0 ? '-1' : '1',
        context: '',
      })
    ) {
      return finish(
        fakeAuthorCount,
        maxDepth,
        twitterIds.length,
        postsPlanned,
        statements,
      )
    }
    postsPlanned += 1

    // Second opinions on posts while budget remains (especially with many users).
    if (
      twitterIds.length >= 40 &&
      statements.length < DEMO_WOT_MAX_STATEMENTS
    ) {
      const secondAuthor = (i + 3) % fakeAuthorCount
      if (
        secondAuthor !== authorIndex &&
        !pushStatement({
          authorIndex: secondAuthor,
          subject: { type: 'post', postId },
          value: i % 11 === 0 ? '-1' : '1',
          context: '',
        })
      ) {
        return finish(
          fakeAuthorCount,
          maxDepth,
          twitterIds.length,
          postsPlanned,
          statements,
        )
      }
    }
  }

  return finish(
    fakeAuthorCount,
    maxDepth,
    twitterIds.length,
    postsPlanned,
    statements,
  )
}

function finish(
  fakeAuthorCount: number,
  maxDepth: number,
  userSubjects: number,
  postSubjects: number,
  statements: DemoWotPlannedStatement[],
): DemoWotPlan {
  return {
    fakeAuthorCount,
    maxDepth,
    userSubjects,
    postSubjects,
    statements,
  }
}

export function materializeDemoSubject(
  subject: DemoWotSubjectRef,
  pubkeys: readonly string[],
): TrustSubject {
  if (subject.type === 'user') {
    return {
      type: 'i',
      value: canonicalTwitterAccountSubject(subject.twitterId),
    }
  }
  if (subject.type === 'post') {
    return {
      type: 'i',
      value: canonicalTwitterPostSubject(subject.postId),
    }
  }
  const pubkey = pubkeys[subject.authorIndex]
  if (!pubkey) {
    throw new Error(`Missing demo author pubkey at ${subject.authorIndex}`)
  }
  return { type: 'p', value: pubkey }
}
