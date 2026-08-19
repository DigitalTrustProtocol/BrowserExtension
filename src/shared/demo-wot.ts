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

/**
 * Spine depth so NASA lands at degree 4:
 * root → Elon (1) → SpaceX (2) → Tesla (3) → NASA (4).
 */
export const DEMO_WOT_MAX_DEPTH = 4
export const DEMO_WOT_AUTHORS_PER_DEGREE = 4
/** Extra hop-1 authors (no outbound `p`) so Elon/SpaceX latest posts have a dense panel. */
export const DEMO_WOT_DEGREE1_CHORUS = 16
/** Cap observed X accounts considered for user:id demo trusts (chain ids are always added). */
export const DEMO_WOT_MAX_USER_SUBJECTS = 400
/** Inclusive max network (non-root) trust statements about a single non-chain X user. */
export const DEMO_WOT_MAX_TRUSTS_PER_USER = 10
/** Operator (root) directly trusts only this many recent X accounts (includes Elon). */
export const DEMO_WOT_ROOT_DIRECT_USERS = 8
/** Operator (root) directly trusts only this many non-featured demo posts. */
export const DEMO_WOT_ROOT_DIRECT_POSTS = 8
/** Minimum post:id trusts when budget allows. */
export const DEMO_WOT_MIN_POST_SUBJECTS = 400
/** Upper bound for post subjects when many users leave room under the cap. */
export const DEMO_WOT_MAX_POST_SUBJECTS = 1000
/** Hard cap for kind 32009 statements. */
export const DEMO_WOT_MAX_STATEMENTS = 2000
/** Hard cap for kind 32014 ratings (seeded in addition to statements). */
export const DEMO_WOT_MAX_RATINGS = 600
/** Synthetic posts per chain account when none were observed on X. */
export const DEMO_WOT_CHAIN_FALLBACK_POSTS = 8

/** @deprecated Prefer DEMO_WOT_MIN_POST_SUBJECTS — kept for older imports/tests. */
export const DEMO_WOT_POST_SUBJECTS = DEMO_WOT_MIN_POST_SUBJECTS

/** Broadcast so content-script trust caches refresh after seed/clear. */
export const TRUST_GRAPH_UPDATED_MESSAGE = 'TRUST_GRAPH_UPDATED' as const

/** Well-known public X accounts used as the manual degree-test spine. */
export const DEMO_WOT_CHAIN: readonly DemoWotChainMember[] = [
  { handle: 'elonmusk', twitterId: '44196397', degree: 1 },
  { handle: 'spacex', twitterId: '34743251', degree: 2 },
  { handle: 'tesla', twitterId: '13298072', degree: 3 },
  { handle: 'nasa', twitterId: '11348282', degree: 4 },
]

const CHAIN_SYNTHETIC_POST_BASE = 50_000

const DEMO_RATING_PRESETS: ReadonlyArray<{
  score: string
  labels: readonly string[]
}> = [
  { score: '100', labels: ['insightful'] },
  { score: '80', labels: ['genuine'] },
  { score: '60', labels: ['funny'] },
  { score: '40', labels: ['ai-slop'] },
  { score: '20', labels: ['misleading'] },
  { score: '0', labels: ['spam'] },
]

export interface DemoWotChainMember {
  handle: string
  twitterId: string
  degree: number
}

export interface DemoWotUserCandidate {
  twitterId: string
  handle?: string
  /** Prefer higher values — recently seen accounts are likelier on the timeline. */
  lastSeen: number
}

export interface DemoWotPostCandidate {
  postId: string
  authorTwitterId?: string
  lastSeen: number
  createdAt?: number
}

export interface DemoWotResolvedChainMember extends DemoWotChainMember {
  latestPostId: string
  postIds: string[]
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

export function isDemoWotChainTwitterId(twitterId: string): boolean {
  return DEMO_WOT_CHAIN.some((member) => member.twitterId === twitterId)
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

export interface DemoWotPlannedRating {
  authorIndex: number
  subject: { type: 'post'; postId: string }
  score: string
  labels: string[]
}

export interface DemoWotPlan {
  fakeAuthorCount: number
  maxDepth: number
  userSubjects: number
  postSubjects: number
  statements: DemoWotPlannedStatement[]
  ratings: DemoWotPlannedRating[]
  chain: DemoWotResolvedChainMember[]
}

function hashDigits(twitterId: string): number {
  let h = 0
  for (let i = 0; i < twitterId.length; i += 1) {
    h = (h * 31 + twitterId.charCodeAt(i)) >>> 0
  }
  return h
}

/** Deterministic 0..DEMO_WOT_MAX_TRUSTS_PER_USER trusts for one non-chain user. */
export function demoTrustsPerUser(twitterId: string): number {
  return hashDigits(twitterId) % (DEMO_WOT_MAX_TRUSTS_PER_USER + 1)
}

function normalizeHandle(handle: string | undefined): string {
  return (handle ?? '').trim().replace(/^@/, '').toLowerCase()
}

function normalizeCandidates(input: {
  users?: readonly DemoWotUserCandidate[]
  twitterIds?: readonly string[]
}): DemoWotUserCandidate[] {
  const fromUsers = (input.users ?? []).map((row) => ({
    twitterId: row.twitterId.trim(),
    handle: normalizeHandle(row.handle),
    lastSeen:
      typeof row.lastSeen === 'number' && Number.isFinite(row.lastSeen)
        ? row.lastSeen
        : 0,
  }))
  const fromIds = (input.twitterIds ?? []).map((id) => ({
    twitterId: id.trim(),
    handle: '',
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
      continue
    }
    if (!previous.handle && row.handle) {
      byId.set(row.twitterId, { ...previous, handle: row.handle })
    }
  }

  return [...byId.values()].sort((a, b) => {
    if (b.lastSeen !== a.lastSeen) return b.lastSeen - a.lastSeen
    return a.twitterId < b.twitterId ? -1 : a.twitterId > b.twitterId ? 1 : 0
  })
}

function normalizePosts(
  posts: readonly DemoWotPostCandidate[] | undefined,
): DemoWotPostCandidate[] {
  const byId = new Map<string, DemoWotPostCandidate>()
  for (const row of posts ?? []) {
    const postId = row.postId.trim()
    if (!/^\d+$/.test(postId)) continue
    const authorTwitterId = row.authorTwitterId?.trim()
    const next: DemoWotPostCandidate = {
      postId,
      lastSeen:
        typeof row.lastSeen === 'number' && Number.isFinite(row.lastSeen)
          ? row.lastSeen
          : 0,
      ...(authorTwitterId && /^\d+$/.test(authorTwitterId)
        ? { authorTwitterId }
        : {}),
      ...(typeof row.createdAt === 'number' && Number.isFinite(row.createdAt)
        ? { createdAt: row.createdAt }
        : {}),
    }
    const previous = byId.get(postId)
    if (!previous || next.lastSeen > previous.lastSeen) {
      byId.set(postId, next)
    }
  }
  return [...byId.values()].sort(comparePostsLatestFirst)
}

function comparePostsLatestFirst(
  a: DemoWotPostCandidate,
  b: DemoWotPostCandidate,
): number {
  if (b.lastSeen !== a.lastSeen) return b.lastSeen - a.lastSeen
  const aCreated = a.createdAt ?? 0
  const bCreated = b.createdAt ?? 0
  if (bCreated !== aCreated) return bCreated - aCreated
  if (a.postId === b.postId) return 0
  return a.postId < b.postId ? 1 : -1
}

export function resolveDemoWotChain(
  users: readonly DemoWotUserCandidate[],
): DemoWotChainMember[] {
  return DEMO_WOT_CHAIN.map((member) => {
    const byHandle = users.find(
      (row) => row.handle && row.handle === member.handle,
    )
    const byId = users.find((row) => row.twitterId === member.twitterId)
    return {
      ...member,
      twitterId: byHandle?.twitterId ?? byId?.twitterId ?? member.twitterId,
    }
  })
}

function syntheticChainPostId(degree: number, index: number): string {
  return demoPostId(CHAIN_SYNTHETIC_POST_BASE + degree * 100 + index)
}

function postsForAuthor(
  posts: readonly DemoWotPostCandidate[],
  twitterId: string,
): DemoWotPostCandidate[] {
  return posts.filter((row) => row.authorTwitterId === twitterId)
}

function resolveChainPosts(
  chain: readonly DemoWotChainMember[],
  observed: readonly DemoWotPostCandidate[],
): DemoWotResolvedChainMember[] {
  return chain.map((member) => {
    const authored = postsForAuthor(observed, member.twitterId)
    const postIds =
      authored.length > 0
        ? authored.map((row) => row.postId)
        : Array.from({ length: DEMO_WOT_CHAIN_FALLBACK_POSTS }, (_, i) =>
            syntheticChainPostId(member.degree, i),
          )
    return {
      ...member,
      postIds,
      latestPostId: postIds[0]!,
    }
  })
}

function ratingPreset(index: number): { score: string; labels: string[] } {
  const preset = DEMO_RATING_PRESETS[index % DEMO_RATING_PRESETS.length]!
  return { score: preset.score, labels: [...preset.labels] }
}

function highRatingPreset(index: number): { score: string; labels: string[] } {
  const preset = DEMO_RATING_PRESETS[index % 3]!
  return { score: preset.score, labels: [...preset.labels] }
}

/**
 * Builds a deterministic multi-hop WoT plan:
 * - Elon / SpaceX / Tesla / NASA form a degree 1→2→3→4 spine (no shortcuts)
 * - hop-1 chorus densely trusts Elon + SpaceX latest posts (panel evidence)
 * - remaining observed users/posts fill the statement and rating budgets
 */
export function planDemoWotNetwork(input: {
  users?: readonly DemoWotUserCandidate[]
  posts?: readonly DemoWotPostCandidate[]
  /** @deprecated Prefer `users` with `lastSeen`. */
  twitterIds?: readonly string[]
  maxDepth?: number
  authorsPerDegree?: number
  maxUserSubjects?: number
  postSubjects?: number
}): DemoWotPlan {
  const observedUsers = normalizeCandidates(input)
  const chain = resolveDemoWotChain(observedUsers)
  const chainIds = new Set(chain.map((member) => member.twitterId))
  const protectedLaterIds = new Set(
    chain.filter((member) => member.degree > 1).map((member) => member.twitterId),
  )

  const recentUsers = observedUsers
    .filter((row) => !chainIds.has(row.twitterId))
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
  const twitterIds = [
    ...chain.map((member) => member.twitterId),
    ...recentUsers.map((row) => row.twitterId),
  ]

  const observedPosts = normalizePosts(input.posts)
  const resolvedChain = resolveChainPosts(chain, observedPosts)

  const maxDepth = Math.max(
    DEMO_WOT_CHAIN.length,
    Math.min(input.maxDepth ?? DEMO_WOT_MAX_DEPTH, DEMO_WOT_MAX_DEPTH),
  )
  const authorsPerDegree = Math.max(
    2,
    input.authorsPerDegree ?? DEMO_WOT_AUTHORS_PER_DEGREE,
  )
  const spineCount = maxDepth * authorsPerDegree
  const chorusCount = DEMO_WOT_DEGREE1_CHORUS
  const fakeAuthorCount = spineCount + chorusCount
  const statements: DemoWotPlannedStatement[] = []
  const ratings: DemoWotPlannedRating[] = []
  const usedPostIds = new Set<string>()

  const pushStatement = (row: DemoWotPlannedStatement): boolean => {
    if (statements.length >= DEMO_WOT_MAX_STATEMENTS) return false
    statements.push(row)
    if (row.subject.type === 'post') usedPostIds.add(row.subject.postId)
    return true
  }
  const pushRating = (row: DemoWotPlannedRating): boolean => {
    if (ratings.length >= DEMO_WOT_MAX_RATINGS) return false
    ratings.push(row)
    return true
  }

  const hopOf = (authorIndex: number): number => {
    if (authorIndex < 0) return 0
    if (authorIndex >= spineCount) return 1
    return Math.floor(authorIndex / authorsPerDegree) + 1
  }

  const authorsInLayer = (degree: number): number[] => {
    const start = (degree - 1) * authorsPerDegree
    return Array.from({ length: authorsPerDegree }, (_, i) => start + i)
  }
  const chorusAuthors = (): number[] =>
    Array.from({ length: chorusCount }, (_, i) => spineCount + i)
  const hop1Authors = (): number[] => [...authorsInLayer(1), ...chorusAuthors()]
  const authorsAtHop = (hop: number): number[] => {
    if (hop <= 0) return []
    if (hop === 1) return hop1Authors()
    if (hop > maxDepth) return []
    return authorsInLayer(hop)
  }

  const done = (): DemoWotPlan =>
    finish(
      fakeAuthorCount,
      maxDepth,
      twitterIds.length,
      usedPostIds.size,
      statements,
      ratings,
      resolvedChain,
    )

  // Root → every hop-1 author (spine layer 1 + chorus).
  for (const target of hop1Authors()) {
    if (
      !pushStatement({
        authorIndex: -1,
        subject: { type: 'p', authorIndex: target },
        value: '1',
        context: '',
      })
    ) {
      return done()
    }
  }

  // Spine only: degree d → d+1 positive hops. No skip edges.
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
        return done()
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
          return done()
        }
      }
    }
  }

  // Lateral same-layer mesh on the spine (does not shorten later chain degrees).
  for (let authorIndex = 0; authorIndex < spineCount; authorIndex += 1) {
    const degree = hopOf(authorIndex)
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
      return done()
    }
  }

  const elon = resolvedChain[0]!
  const spacex = resolvedChain[1]!
  const tesla = resolvedChain[2]!
  const nasa = resolvedChain[3]!

  // Root trusts Elon only among the chain (degree 1).
  if (
    !pushStatement({
      authorIndex: -1,
      subject: { type: 'user', twitterId: elon.twitterId },
      value: '1',
      context: '',
    })
  ) {
    return done()
  }

  const trustUsersFromHop = (
    twitterId: string,
    hop: number,
  ): boolean => {
    for (const authorIndex of authorsAtHop(hop)) {
      if (
        !pushStatement({
          authorIndex,
          subject: { type: 'user', twitterId },
          value: '1',
          context: '',
        })
      ) {
        return false
      }
    }
    return true
  }

  // Hitting-degree witnesses only — never closer, so NASA stays 4, Tesla 3, SpaceX 2.
  if (!trustUsersFromHop(spacex.twitterId, 1)) return done()
  if (!trustUsersFromHop(tesla.twitterId, 2)) return done()
  if (!trustUsersFromHop(nasa.twitterId, 3)) return done()

  const trustAndRatePostsFromHop = (
    postIds: readonly string[],
    hop: number,
    dense: boolean,
  ): boolean => {
    const authors = authorsAtHop(hop)
    for (let p = 0; p < postIds.length; p += 1) {
      const postId = postIds[p]!
      const raters = dense ? authors : authors.slice(0, Math.min(4, authors.length))
      for (let a = 0; a < raters.length; a += 1) {
        const authorIndex = raters[a]!
        if (
          !pushStatement({
            authorIndex,
            subject: { type: 'post', postId },
            value: '1',
            context: '',
          })
        ) {
          return false
        }
        const preset = dense ? highRatingPreset(a) : ratingPreset(p + a)
        pushRating({
          authorIndex,
          subject: { type: 'post', postId },
          score: preset.score,
          labels: preset.labels,
        })
      }
    }
    return true
  }

  // Elon + SpaceX latest posts: every hop-1 author trusts and rates them.
  if (!trustAndRatePostsFromHop([elon.latestPostId], 1, true)) return done()
  if (!trustAndRatePostsFromHop([spacex.latestPostId], 1, true)) return done()

  // Older / other posts from the four chain accounts: still rated, no shortcuts.
  const remainingChainPosts = (member: DemoWotResolvedChainMember, hop: number) =>
    member.postIds.filter((postId) => postId !== member.latestPostId || hop > 1)

  if (
    !trustAndRatePostsFromHop(remainingChainPosts(elon, 1), 1, false)
  ) {
    return done()
  }
  if (
    !trustAndRatePostsFromHop(
      spacex.postIds.filter((postId) => postId !== spacex.latestPostId),
      1,
      false,
    )
  ) {
    return done()
  }
  if (!trustAndRatePostsFromHop(tesla.postIds, 2, false)) return done()
  if (!trustAndRatePostsFromHop(nasa.postIds, 3, false)) return done()

  // Root directly trusts a small recent slice, never SpaceX / Tesla / NASA.
  const rootDirectPool = twitterIds.filter((id) => !protectedLaterIds.has(id))
  const rootDirectUsers = Math.min(DEMO_WOT_ROOT_DIRECT_USERS, rootDirectPool.length)
  for (let i = 0; i < rootDirectUsers; i += 1) {
    const twitterId = rootDirectPool[i]!
    if (twitterId === elon.twitterId) continue
    if (
      !pushStatement({
        authorIndex: -1,
        subject: { type: 'user', twitterId },
        value: i % 7 === 0 ? '-1' : '1',
        context: '',
      })
    ) {
      return done()
    }
  }

  const otherUserIds = twitterIds.filter((id) => !chainIds.has(id))
  const remainingAfterChain = DEMO_WOT_MAX_STATEMENTS - statements.length
  const scaledPosts = Math.min(
    DEMO_WOT_MAX_POST_SUBJECTS,
    Math.max(
      DEMO_WOT_MIN_POST_SUBJECTS,
      Math.floor(otherUserIds.length * 2) + DEMO_WOT_MIN_POST_SUBJECTS,
    ),
  )
  const targetOtherPosts = Math.max(
    0,
    Math.min(input.postSubjects ?? scaledPosts, DEMO_WOT_MAX_POST_SUBJECTS),
  )
  const postReserve = Math.min(
    remainingAfterChain,
    Math.max(
      Math.min(targetOtherPosts, remainingAfterChain),
      Math.floor(remainingAfterChain * 0.5),
    ),
  )
  const userStatementLimit =
    statements.length + Math.max(0, remainingAfterChain - postReserve)

  // Network opinions on other observed X users. Chain ids already handled.
  for (let i = 0; i < otherUserIds.length; i += 1) {
    if (statements.length >= userStatementLimit) break
    const twitterId = otherUserIds[i]!
    const trustCount = demoTrustsPerUser(twitterId)
    const authors = authorsAtHop(1)
    const max = Math.min(trustCount, authors.length)
    const start = i % Math.max(1, authors.length)
    for (let j = 0; j < max; j += 1) {
      if (statements.length >= userStatementLimit) break
      const authorIndex = authors[(start + j) % authors.length]!
      const value: TrustValue =
        (hashDigits(twitterId) + j) % 5 === 0 ? '-1' : '1'
      if (
        !pushStatement({
          authorIndex,
          subject: { type: 'user', twitterId },
          value,
          context: '',
        })
      ) {
        return done()
      }
    }
  }

  const chainPostIdSet = new Set(
    resolvedChain.flatMap((member) => member.postIds),
  )
  const otherObservedPosts = observedPosts.filter(
    (row) => !chainPostIdSet.has(row.postId),
  )
  const otherPostCount = Math.min(
    targetOtherPosts,
    DEMO_WOT_MAX_STATEMENTS - statements.length,
  )

  const otherPostIds: string[] = []
  for (const row of otherObservedPosts) {
    if (otherPostIds.length >= otherPostCount) break
    otherPostIds.push(row.postId)
  }
  let syntheticIndex = 0
  while (otherPostIds.length < otherPostCount) {
    const postId = demoPostId(syntheticIndex)
    syntheticIndex += 1
    if (chainPostIdSet.has(postId) || usedPostIds.has(postId)) continue
    otherPostIds.push(postId)
  }

  const rootDirectPosts = Math.min(DEMO_WOT_ROOT_DIRECT_POSTS, otherPostIds.length)
  const hop1 = hop1Authors()
  const laterAuthors: number[] = []
  for (let degree = 2; degree <= maxDepth; degree += 1) {
    laterAuthors.push(...authorsInLayer(degree))
  }

  for (let i = 0; i < otherPostIds.length; i += 1) {
    const postId = otherPostIds[i]!
    const authorIndex = i < rootDirectPosts ? -1 : hop1[i % hop1.length]!
    if (
      !pushStatement({
        authorIndex,
        subject: { type: 'post', postId },
        value: i % 9 === 0 ? '-1' : '1',
        context: '',
      })
    ) {
      return done()
    }

    const secondAuthor = laterAuthors[i % laterAuthors.length]!
    if (secondAuthor !== authorIndex && statements.length < DEMO_WOT_MAX_STATEMENTS) {
      if (
        !pushStatement({
          authorIndex: secondAuthor,
          subject: { type: 'post', postId },
          value: i % 11 === 0 ? '-1' : '1',
          context: '',
        })
      ) {
        return done()
      }
    }

    if (i % 2 === 0) {
      const rater =
        authorIndex === -1 ? hop1[i % hop1.length]! : authorIndex
      const preset = ratingPreset(i)
      pushRating({
        authorIndex: rater,
        subject: { type: 'post', postId },
        score: preset.score,
        labels: preset.labels,
      })
    }
  }

  return done()
}

function finish(
  fakeAuthorCount: number,
  maxDepth: number,
  userSubjects: number,
  postSubjects: number,
  statements: DemoWotPlannedStatement[],
  ratings: DemoWotPlannedRating[],
  chain: DemoWotResolvedChainMember[],
): DemoWotPlan {
  return {
    fakeAuthorCount,
    maxDepth,
    userSubjects,
    postSubjects,
    statements,
    ratings,
    chain,
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

/** Positive-`p` hop distance from root (`-1`). Missing authors are omitted. */
export function demoWotAuthorHops(
  plan: DemoWotPlan,
): Map<number, number> {
  const distance = new Map<number, number>()
  const queue = [-1]
  distance.set(-1, 0)
  const pEdges = plan.statements.filter(
    (row) => row.subject.type === 'p' && row.value === '1',
  )
  while (queue.length > 0) {
    const author = queue.shift()!
    const depth = distance.get(author) ?? 0
    for (const edge of pEdges) {
      if (edge.authorIndex !== author || edge.subject.type !== 'p') continue
      const child = edge.subject.authorIndex
      if (distance.has(child)) continue
      distance.set(child, depth + 1)
      queue.push(child)
    }
  }
  return distance
}

/** Hitting degree for a user:id / post:id subject, or `undefined` if untrusted. */
export function demoWotSubjectDegree(
  plan: DemoWotPlan,
  subject: { type: 'user'; twitterId: string } | { type: 'post'; postId: string },
): number | undefined {
  const hops = demoWotAuthorHops(plan)
  let best: number | undefined
  for (const row of plan.statements) {
    if (row.value !== '1') continue
    if (subject.type === 'user') {
      if (row.subject.type !== 'user' || row.subject.twitterId !== subject.twitterId) {
        continue
      }
    } else if (
      row.subject.type !== 'post' ||
      row.subject.postId !== subject.postId
    ) {
      continue
    }
    const hop =
      row.authorIndex === -1 ? 0 : hops.get(row.authorIndex)
    if (hop === undefined) continue
    const degree = hop + 1
    if (best === undefined || degree < best) best = degree
  }
  return best
}
