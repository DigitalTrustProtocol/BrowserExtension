/**
 * Timeline GraphQL JSON filtering (experimental).
 * Hide actions remove entries before X renders.
 * Collapse actions keep entries and emit decorate targets for sync DOM collapse.
 */

import {
  TRUST_FILTER_RESOLUTIONS,
  resolveTimelineFilter,
  type TrustFilterAction,
  type TrustFilters,
  type TrustFilterResolution,
} from './x-augmentation'
import type { TimelineCollapseTarget } from './timeline-decorate'
import {
  DEFAULT_FOLLOW_TRUST_BAND,
  resolutionFromPercent,
  type FollowTrustBand,
} from './wot-follow-trust-threshold'

export type JsonTrustResolution = TrustFilterResolution

/** Feed-style ops safe to rewrite before render. */
export function isTimelineJsonFilterOperation(operation: string): boolean {
  return (
    /^(?:Home|HomeLatest|Search|ListLatestTweets)Timeline$/.test(operation) ||
    /^(?:UserTweets|UserTweetsAndReplies)$/.test(operation)
  )
}

/** True when any dropdown is set to a hide* action. */
export function anyHideTrustFilterActive(filters: TrustFilters): boolean {
  return TRUST_FILTER_RESOLUTIONS.some((key) =>
    filters[key].startsWith('hide'),
  )
}

/** True when any dropdown is set to a collapse* action. */
export function anyCollapseTrustFilterActive(filters: TrustFilters): boolean {
  return TRUST_FILTER_RESOLUTIONS.some((key) =>
    filters[key].startsWith('collapse'),
  )
}

export function anyJsonTimelineFilterActive(filters: TrustFilters): boolean {
  return anyHideTrustFilterActive(filters) || anyCollapseTrustFilterActive(filters)
}

function hideActionFor(
  action: TrustFilterAction,
): 'none' | 'hidePost' | 'hideUser' | 'hideAll' {
  if (action === 'hidePost' || action === 'hideUser' || action === 'hideAll') {
    return action
  }
  return 'none'
}

function actionMatchesTarget(
  action: ReturnType<typeof hideActionFor>,
  target: 'author' | 'post',
): boolean {
  if (action === 'none') return false
  if (action === 'hideAll') return true
  if (action === 'hideUser') return target === 'author'
  if (action === 'hidePost') return target === 'post'
  return false
}

function isFilterResolution(
  value: string | undefined,
): value is TrustFilterResolution {
  return (
    value === 'trusted' ||
    value === 'mixed' ||
    value === 'distrusted' ||
    value === 'none'
  )
}

/**
 * Whether a timeline item should be stripped from GraphQL JSON.
 * Collapse settings are ignored; ads/promoted must pass promoted=true.
 */
export function shouldHideTimelineJsonItem(options: {
  filters: TrustFilters
  authorResolution?: string
  postResolution?: string
  promoted: boolean
}): boolean {
  if (options.promoted) return false

  const candidates: Array<'author' | 'post'> = []

  if (isFilterResolution(options.authorResolution)) {
    const action = hideActionFor(options.filters[options.authorResolution])
    if (actionMatchesTarget(action, 'author')) candidates.push('author')
  }
  if (isFilterResolution(options.postResolution)) {
    const action = hideActionFor(options.filters[options.postResolution])
    if (actionMatchesTarget(action, 'post')) candidates.push('post')
  }

  return candidates.length > 0
}

export interface TimelineTweetRef {
  postId?: string
  userId?: string
  promoted: boolean
  displayName?: string
  handle?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function coerceId(value: unknown): string | undefined {
  if (typeof value === 'string' && /^\d{1,24}$/.test(value)) return value
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return String(value)
  }
  return undefined
}

function unwrapTweetResult(result: unknown): Record<string, unknown> | undefined {
  if (!isRecord(result)) return undefined
  if (result.__typename === 'TweetWithVisibilityResults' && isRecord(result.tweet)) {
    return result.tweet
  }
  if (result.__typename === 'Tweet' || coerceId(result.rest_id)) {
    return result
  }
  if (isRecord(result.tweet)) return unwrapTweetResult(result.tweet)
  return result
}

function readUserIdFromTweet(tweet: Record<string, unknown>): string | undefined {
  const core = isRecord(tweet.core) ? tweet.core : undefined
  const userResults = isRecord(core?.user_results)
    ? core.user_results
    : isRecord(core?.user_result)
      ? core.user_result
      : undefined
  const user = isRecord(userResults?.result) ? userResults.result : undefined
  if (!user) return undefined
  return coerceId(user.rest_id)
}

function readUserProfileFromTweet(tweet: Record<string, unknown>): {
  userId?: string
  displayName?: string
  handle?: string
} {
  const core = isRecord(tweet.core) ? tweet.core : undefined
  const userResults = isRecord(core?.user_results)
    ? core.user_results
    : isRecord(core?.user_result)
      ? core.user_result
      : undefined
  const user = isRecord(userResults?.result) ? userResults.result : undefined
  if (!user) return {}
  const legacy = isRecord(user.legacy) ? user.legacy : undefined
  const core2 = isRecord(user.core) ? user.core : undefined
  const displayName =
    (typeof legacy?.name === 'string' && legacy.name) ||
    (typeof core2?.name === 'string' && core2.name) ||
    undefined
  const screen =
    (typeof legacy?.screen_name === 'string' && legacy.screen_name) ||
    (typeof core2?.screen_name === 'string' && core2.screen_name) ||
    undefined
  return {
    userId: coerceId(user.rest_id),
    ...(displayName ? { displayName } : {}),
    ...(screen ? { handle: screen } : {}),
  }
}

function readTweetRefFromTweetResults(tweetResults: unknown): TimelineTweetRef | undefined {
  if (!isRecord(tweetResults)) return undefined
  const tweet = unwrapTweetResult(tweetResults.result)
  if (!tweet) return undefined
  const profile = readUserProfileFromTweet(tweet)
  return {
    postId: coerceId(tweet.rest_id) ?? coerceId(isRecord(tweet.legacy) ? tweet.legacy.id_str : undefined),
    userId: profile.userId ?? readUserIdFromTweet(tweet),
    promoted: false,
    ...(profile.displayName ? { displayName: profile.displayName } : {}),
    ...(profile.handle ? { handle: profile.handle } : {}),
  }
}

function nodeHasPromotedMetadata(node: unknown, depth = 0): boolean {
  if (depth > 12 || node == null) return false
  if (Array.isArray(node)) {
    return node.some((item) => nodeHasPromotedMetadata(item, depth + 1))
  }
  if (!isRecord(node)) return false
  if ('promotedMetadata' in node && node.promotedMetadata != null) return true
  if (typeof node.entryId === 'string') {
    const id = node.entryId.toLowerCase()
    if (id.startsWith('promoted-') || id.includes('-promoted')) return true
  }
  // Shallow check of common nests only (avoid full DFS cost).
  for (const key of ['content', 'itemContent', 'item', 'items']) {
    if (key in node && nodeHasPromotedMetadata(node[key], depth + 1)) return true
  }
  return false
}

/** Pull the primary tweet ref from a URT timeline entry. */
export function readTimelineEntryTweetRef(entry: unknown): TimelineTweetRef | undefined {
  if (!isRecord(entry)) return undefined
  const promoted = nodeHasPromotedMetadata(entry)
  const content = isRecord(entry.content) ? entry.content : undefined
  if (!content) return undefined

  // Single item
  const itemContent = isRecord(content.itemContent) ? content.itemContent : undefined
  if (itemContent) {
    const ref = readTweetRefFromTweetResults(itemContent.tweet_results)
    if (ref) return { ...ref, promoted: promoted || ref.promoted }
  }

  // Module with items (conversation / carousel)
  const items = content.items
  if (Array.isArray(items) && items.length > 0) {
    for (const raw of items) {
      if (!isRecord(raw)) continue
      const item = isRecord(raw.item) ? raw.item : raw
      const moduleItemContent = isRecord(item.itemContent) ? item.itemContent : undefined
      const ref = moduleItemContent
        ? readTweetRefFromTweetResults(moduleItemContent.tweet_results)
        : undefined
      if (ref?.postId || ref?.userId) {
        return { ...ref, promoted: promoted || ref.promoted }
      }
    }
  }

  return promoted ? { promoted: true } : undefined
}

export function isTimelineCursorEntry(entry: unknown): boolean {
  if (!isRecord(entry)) return false
  const entryId = typeof entry.entryId === 'string' ? entry.entryId : ''
  if (entryId.startsWith('cursor-')) return true
  const content = isRecord(entry.content) ? entry.content : undefined
  const typename = typeof content?.__typename === 'string' ? content.__typename : ''
  return typename === 'TimelineTimelineCursor'
}

export interface JsonFilterResolutionMap {
  /** `user:<twitterId>` / `post:<postId>` → resolution */
  [key: string]: JsonTrustResolution | undefined
}

export function resolutionKey(kind: 'user' | 'post', id: string): string {
  return `${kind}:${id}`
}

function isJsonTrustResolution(value: unknown): value is JsonTrustResolution {
  return (
    value === 'trusted' ||
    value === 'mixed' ||
    value === 'distrusted' ||
    value === 'none'
  )
}

/**
 * Post hide/collapse bucket: rating score vs the follow-trust band when a
 * rating exists; otherwise kind 32009 trust resolution.
 */
export function postTimelineFilterResolution(options: {
  ratingScore?: number | null
  ratingBand?: FollowTrustBand
  trustResolution?: JsonTrustResolution
}): JsonTrustResolution {
  if (options.ratingScore != null) {
    return resolutionFromPercent(
      options.ratingScore,
      options.ratingBand ?? DEFAULT_FOLLOW_TRUST_BAND,
    )
  }
  return options.trustResolution ?? 'none'
}

export function mergeTimelineJsonFilterResolutions(options: {
  subjects: Array<{ kind: 'user' | 'post'; id: string }>
  trustByKey: Record<string, { resolution?: string } | undefined>
  ratingByKey: Record<
    string,
    | {
        averageScore: number | null
        followTrustRed: number
        followTrustThreshold: number
      }
    | undefined
  >
}): Record<string, JsonTrustResolution> {
  const resolutions: Record<string, JsonTrustResolution> = {}
  for (const subject of options.subjects) {
    const key = resolutionKey(subject.kind, subject.id)
    const trustResolution = isJsonTrustResolution(
      options.trustByKey[key]?.resolution,
    )
      ? options.trustByKey[key]!.resolution
      : undefined
    if (subject.kind === 'user') {
      if (trustResolution) resolutions[key] = trustResolution
      continue
    }
    const rating = options.ratingByKey[key]
    if (!rating && !trustResolution) continue
    resolutions[key] = postTimelineFilterResolution({
      ...(rating
        ? {
            ratingScore: rating.averageScore,
            ratingBand: {
              red: rating.followTrustRed,
              green: rating.followTrustThreshold,
            },
          }
        : {}),
      ...(trustResolution ? { trustResolution } : {}),
    })
  }
  return resolutions
}

export function collectTimelineTweetSubjects(payload: unknown): Array<{
  kind: 'user' | 'post'
  id: string
}> {
  const found = new Map<string, { kind: 'user' | 'post'; id: string }>()
  visitTimelineEntries(payload, (entry) => {
    if (isTimelineCursorEntry(entry)) return 'keep'
    const ref = readTimelineEntryTweetRef(entry)
    if (!ref || ref.promoted) return 'keep'
    if (ref.userId) found.set(resolutionKey('user', ref.userId), { kind: 'user', id: ref.userId })
    if (ref.postId) found.set(resolutionKey('post', ref.postId), { kind: 'post', id: ref.postId })
    return 'keep'
  })
  return [...found.values()]
}

/**
 * Hide-strip + collapse decorate + optional ads-only demote.
 * Collapse keeps entries; hide removes them. Missing resolutions ≈ `none`.
 */
export function processTimelineGraphqlPayload(
  payload: unknown,
  options: {
    filters: TrustFilters
    resolutions: JsonFilterResolutionMap
  },
): {
  payload: unknown
  removed: number
  collapse: Record<string, TimelineCollapseTarget>
  demotedAds: string[]
  changed: boolean
} {
  const hideActive = anyHideTrustFilterActive(options.filters)
  const collapseActive = anyCollapseTrustFilterActive(options.filters)
  if (!hideActive && !collapseActive) {
    return {
      payload,
      removed: 0,
      collapse: {},
      demotedAds: [],
      changed: false,
    }
  }

  const stripAllOrganic = hidesAllOrganicTimelineItems(options.filters)
  const working = hideActive ? structuredClone(payload) : payload
  let removed = 0
  const collapse: Record<string, TimelineCollapseTarget> = {}

  const decide = (entry: unknown): 'keep' | 'remove' => {
    if (isTimelineCursorEntry(entry)) return 'keep'
    const ref = readTimelineEntryTweetRef(entry)
    if (!ref) return 'keep'
    if (ref.promoted) return 'keep'

    const authorResolution = ref.userId
      ? (options.resolutions[resolutionKey('user', ref.userId)] ?? 'none')
      : undefined
    const postResolution = ref.postId
      ? (options.resolutions[resolutionKey('post', ref.postId)] ?? 'none')
      : undefined

    if (hideActive) {
      if (stripAllOrganic) {
        removed += 1
        return 'remove'
      }
      const hide = shouldHideTimelineJsonItem({
        filters: options.filters,
        authorResolution,
        postResolution,
        promoted: false,
      })
      if (hide) {
        removed += 1
        return 'remove'
      }
    }

    if (collapseActive && ref.postId) {
      const resolved = resolveTimelineFilter({
        filters: options.filters,
        authorResolution,
        postResolution,
        promoted: false,
      })
      if (resolved.mode === 'collapse' && resolved.basis !== 'none') {
        const resolution: TrustFilterResolution =
          resolved.basis === 'post'
            ? ((postResolution ?? 'none') as TrustFilterResolution)
            : ((authorResolution ?? 'none') as TrustFilterResolution)
        collapse[ref.postId] = {
          postId: ref.postId,
          resolution,
          basis: resolved.basis,
          ...(ref.userId ? { userId: ref.userId } : {}),
          ...(ref.displayName ? { displayName: ref.displayName } : {}),
          ...(ref.handle ? { handle: ref.handle } : {}),
        }
      }
    }
    return 'keep'
  }

  if (hideActive) {
    visitTimelineEntries(working, decide)
  } else {
    visitTimelineEntriesReadOnly(working, decide)
  }

  return {
    payload: working,
    removed,
    collapse,
    demotedAds: [],
    changed: removed > 0,
  }
}

/**
 * Returns a deep-cloned payload with matching tweet entries removed.
 * Cursor / promoted entries are always kept.
 */
export function filterTimelineGraphqlPayload(
  payload: unknown,
  options: {
    filters: TrustFilters
    resolutions: JsonFilterResolutionMap
  },
): { payload: unknown; removed: number } {
  const result = processTimelineGraphqlPayload(payload, options)
  return { payload: result.payload, removed: result.removed }
}

/**
 * True when every resolution dropdown is Hide all — every organic tweet can be
 * stripped without waiting on trust resolve.
 */
export function hidesAllOrganicTimelineItems(filters: TrustFilters): boolean {
  return TRUST_FILTER_RESOLUTIONS.every((key) => filters[key] === 'hideAll')
}

/** Keep fetching until the client has about one viewport of items. */
export const TIMELINE_BACKFILL_MIN_ITEMS = 12
/** Hard cap on extra HomeTimeline pages per intercepted response. */
export const TIMELINE_BACKFILL_MAX_PAGES = 5

export function readTimelineBottomCursor(payload: unknown): string | undefined {
  const add = findTimelineAddEntries(payload)
  if (!add) return undefined
  for (const entry of add.entries) {
    if (!isTimelineCursorEntry(entry) || !isRecord(entry)) continue
    const content = isRecord(entry.content) ? entry.content : undefined
    if (content?.cursorType !== 'Bottom') continue
    if (typeof content.value === 'string' && content.value.length > 0) {
      return content.value
    }
  }
  return undefined
}

/** Non-cursor URT entries (tweets, modules, promoted, etc.). */
export function countTimelineContentEntries(payload: unknown): number {
  const add = findTimelineAddEntries(payload)
  if (!add) return 0
  let count = 0
  for (const entry of add.entries) {
    if (!isTimelineCursorEntry(entry)) count += 1
  }
  return count
}

function entryIdOf(entry: unknown): string | undefined {
  return isRecord(entry) && typeof entry.entryId === 'string'
    ? entry.entryId
    : undefined
}

/**
 * Append keepable content from `nextPage` into `basePage`, advancing the Bottom
 * cursor. Top cursor on `basePage` is preserved. Mutates `basePage`.
 */
export function mergeTimelineGraphqlPages(
  basePage: unknown,
  nextPage: unknown,
): { added: number } {
  const baseInstructions = findTimelineAddEntries(basePage)
  const nextInstructions = findTimelineAddEntries(nextPage)
  if (!baseInstructions || !nextInstructions) return { added: 0 }

  const existing = new Set(
    baseInstructions.entries
      .map(entryIdOf)
      .filter((id): id is string => Boolean(id)),
  )

  const nextContent: unknown[] = []
  let nextBottom: unknown | undefined
  for (const entry of nextInstructions.entries) {
    if (isTimelineCursorEntry(entry)) {
      const content =
        isRecord(entry) && isRecord(entry.content) ? entry.content : undefined
      if (content?.cursorType === 'Bottom') nextBottom = entry
      continue
    }
    const id = entryIdOf(entry)
    if (id && existing.has(id)) continue
    if (id) existing.add(id)
    nextContent.push(entry)
  }

  const merged: unknown[] = []
  let insertedBottom = false
  for (const entry of baseInstructions.entries) {
    if (isTimelineCursorEntry(entry)) {
      const content =
        isRecord(entry) && isRecord(entry.content) ? entry.content : undefined
      if (content?.cursorType === 'Bottom') {
        for (const item of nextContent) merged.push(item)
        merged.push(nextBottom ?? entry)
        insertedBottom = true
        continue
      }
    }
    merged.push(entry)
  }
  if (!insertedBottom) {
    for (const item of nextContent) merged.push(item)
    if (nextBottom) merged.push(nextBottom)
  }
  baseInstructions.entries = merged
  return { added: nextContent.length }
}

function findTimelineAddEntries(
  root: unknown,
): { entries: unknown[] } | undefined {
  const stack: unknown[] = [root]
  let steps = 0
  while (stack.length > 0 && steps < 30_000) {
    steps += 1
    const node = stack.pop()
    if (Array.isArray(node)) {
      for (const item of node) stack.push(item)
      continue
    }
    if (!isRecord(node)) continue
    if (
      (node.type === 'TimelineAddEntries' ||
        node.__typename === 'TimelineAddEntries') &&
      Array.isArray(node.entries)
    ) {
      return node as { entries: unknown[] }
    }
    if (Array.isArray(node.instructions)) {
      for (const inst of node.instructions) stack.push(inst)
    }
    for (const key of Object.keys(node)) {
      const value = node[key]
      if (value && typeof value === 'object') stack.push(value)
    }
  }
  return undefined
}

/**
 * Re-label promoted entries as ordinary tweets and drop placement metadata.
 * Returns demoted post ids (for Ad marker redraw).
 */
export function relabelPromotedEntriesAsTweets(payload: unknown): string[] {
  const demoted: string[] = []
  visitTimelineEntries(payload, (entry) => {
    if (!isRecord(entry) || typeof entry.entryId !== 'string') return 'keep'
    const id = entry.entryId
    const wasPromoted =
      id.startsWith('promoted-tweet-') ||
      id.startsWith('promoted-') ||
      nodeHasPromotedMetadata(entry)
    if (!wasPromoted) return 'keep'

    const ref = readTimelineEntryTweetRef(entry)
    if (ref?.postId) demoted.push(ref.postId)

    if (id.startsWith('promoted-tweet-')) {
      entry.entryId = `tweet-${id.slice('promoted-tweet-'.length)}`
    } else if (id.startsWith('promoted-')) {
      entry.entryId = `tweet-${id.slice('promoted-'.length)}`
    }
    stripPromotedMetadata(entry)
    return 'keep'
  })
  return [...new Set(demoted)]
}

function stripPromotedMetadata(node: unknown, depth = 0): void {
  if (depth > 12 || node == null) return
  if (Array.isArray(node)) {
    for (const item of node) stripPromotedMetadata(item, depth + 1)
    return
  }
  if (!isRecord(node)) return
  if ('promotedMetadata' in node) delete node.promotedMetadata
  for (const key of ['content', 'itemContent', 'item', 'items']) {
    if (key in node) stripPromotedMetadata(node[key], depth + 1)
  }
}

export type TimelinePageFetcher = (cursor: string) => unknown | undefined

/**
 * After hiding entries, pull more cursor pages until enough content remains.
 */
export function backfillFilteredTimeline(options: {
  payload: unknown
  removed: number
  filters: TrustFilters
  resolutions: JsonFilterResolutionMap
  fetchNextPage: TimelinePageFetcher
  minItems?: number
  maxPages?: number
}): {
  payload: unknown
  removed: number
  pagesFetched: number
  collapse: Record<string, TimelineCollapseTarget>
  demotedAds: string[]
  changed: boolean
} {
  const minItems = options.minItems ?? TIMELINE_BACKFILL_MIN_ITEMS
  const maxPages = options.maxPages ?? TIMELINE_BACKFILL_MAX_PAGES
  let payload = options.payload
  let removed = options.removed
  let pagesFetched = 0
  const collapse: Record<string, TimelineCollapseTarget> = {}
  let demotedAds: string[] = []

  while (
    pagesFetched < maxPages &&
    countTimelineContentEntries(payload) < minItems
  ) {
    const cursor = readTimelineBottomCursor(payload)
    if (!cursor) break
    const rawNext = options.fetchNextPage(cursor)
    if (rawNext == null) break
    pagesFetched += 1
    const filteredNext = processTimelineGraphqlPayload(rawNext, {
      filters: options.filters,
      resolutions: options.resolutions,
    })
    removed += filteredNext.removed
    Object.assign(collapse, filteredNext.collapse)
    demotedAds = [...new Set([...demotedAds, ...filteredNext.demotedAds])]
    const { added } = mergeTimelineGraphqlPages(payload, filteredNext.payload)
    const nextCursor = readTimelineBottomCursor(payload)
    if (!nextCursor || nextCursor === cursor) break
    if (added === 0 && filteredNext.removed === 0) break
  }

  let changed = removed > 0 || demotedAds.length > 0
  if (
    countTimelineContentEntries(payload) > 0 &&
    !timelineHasOrganicContent(payload)
  ) {
    const more = relabelPromotedEntriesAsTweets(payload)
    if (more.length > 0) {
      demotedAds = [...new Set([...demotedAds, ...more])]
      changed = true
    }
  }

  return { payload, removed, pagesFetched, collapse, demotedAds, changed }
}

export function timelineHasOrganicContent(payload: unknown): boolean {
  const add = findTimelineAddEntries(payload)
  if (!add) return false
  for (const entry of add.entries) {
    if (isTimelineCursorEntry(entry)) continue
    const ref = readTimelineEntryTweetRef(entry)
    if (ref && !ref.promoted) return true
  }
  return false
}

type EntryDecision = 'keep' | 'remove'

function visitTimelineEntriesReadOnly(
  root: unknown,
  decide: (entry: unknown) => EntryDecision,
): void {
  const add = findTimelineAddEntries(root)
  if (!add) return
  for (const entry of add.entries) {
    decide(entry)
  }
}

function visitTimelineEntries(
  root: unknown,
  decide: (entry: unknown) => EntryDecision,
): void {
  const stack: unknown[] = [root]
  let steps = 0
  while (stack.length > 0 && steps < 30_000) {
    steps += 1
    const node = stack.pop()
    if (Array.isArray(node)) {
      for (const item of node) stack.push(item)
      continue
    }
    if (!isRecord(node)) continue

    if (Array.isArray(node.entries)) {
      const next: unknown[] = []
      for (const entry of node.entries) {
        if (decide(entry) === 'keep') next.push(entry)
      }
      node.entries = next
    }

    if (Array.isArray(node.instructions)) {
      for (const inst of node.instructions) stack.push(inst)
    }
    for (const key of Object.keys(node)) {
      if (key === 'entries') continue
      const value = node[key]
      if (value && typeof value === 'object') stack.push(value)
    }
  }
}

