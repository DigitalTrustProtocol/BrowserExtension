/**
 * Content-side: merge GraphQL post chrome + DOM headlines, upsert when trusted.
 */

import { BACKGROUND_API_VERSION } from '../shared/contracts'
import {
  mergeXPostChrome,
  parseObservedXPostMessage,
  type XPostChromeInput,
} from '../shared/x-post-chrome'
import { canonicalTwitterPostSubject } from '../shared/x-identity'
import type { TrustQueryResult } from '../graph'
import { ensurePageWorldContentPort } from './page-world-port'
import { descriptorKey, sendMessage, trustStore } from './trust-store'
import { readPostHeadline } from './ui/card-title'
import { isXNumericId } from '../shared/observed-x-identity'

const MAX_PENDING = 400
const UPSERT_COALESCE_MS = 120

const pendingChrome = new Map<string, XPostChromeInput>()
const pendingUpsert = new Map<string, XPostChromeInput>()
let upsertTimer: ReturnType<typeof setTimeout> | undefined
let stopped = false
let unsubscribePort: (() => void) | undefined

function postSubjectKey(postId: string): string {
  return descriptorKey({
    subject: { type: 'i', value: canonicalTwitterPostSubject(postId) },
    context: '',
  })
}

function hasTrustEvidence(result: TrustQueryResult | undefined): boolean {
  if (!result) return false
  if (result.resolution !== 'none') return true
  return result.direct?.value === 1 || result.direct?.value === -1
}

function scheduleUpsertFlush(): void {
  if (upsertTimer !== undefined || stopped) return
  upsertTimer = setTimeout(() => {
    upsertTimer = undefined
    void flushUpserts()
  }, UPSERT_COALESCE_MS)
}

async function flushUpserts(): Promise<void> {
  if (stopped || pendingUpsert.size === 0) return
  const batch = [...pendingUpsert.values()].slice(0, 40)
  for (const item of batch) pendingUpsert.delete(item.postId)
  try {
    await sendMessage<{ upserted: number }>({
      type: 'UPSERT_X_POST_CHROME',
      version: BACKGROUND_API_VERSION,
      posts: batch,
    })
  } catch (error) {
    console.info('AttentionX xPosts chrome upsert failed', error)
  }
  if (pendingUpsert.size > 0) scheduleUpsertFlush()
}

function queueUpsertIfTrusted(postId: string): void {
  if (!isXNumericId(postId)) return
  const result = trustStore.get(postSubjectKey(postId))
  if (!hasTrustEvidence(result)) return
  const chrome = pendingChrome.get(postId) ?? { postId }
  pendingUpsert.set(postId, chrome)
  scheduleUpsertFlush()
}

export function noteDomPostChrome(
  postId: string,
  article: HTMLElement,
  author?: { twitterId?: string; handle?: string },
): void {
  if (stopped || !isXNumericId(postId)) return
  const headline = readPostHeadline(article, postId)
  const next: XPostChromeInput = {
    postId,
    ...(author?.twitterId && isXNumericId(author.twitterId)
      ? { authorTwitterId: author.twitterId }
      : {}),
    ...(author?.handle ? { authorHandle: author.handle } : {}),
    ...(headline ? { headline } : {}),
    observedAt: Date.now(),
  }
  const previous = pendingChrome.get(postId)
  if (!previous && pendingChrome.size >= MAX_PENDING) return
  pendingChrome.set(postId, mergeXPostChrome(previous, next))
  queueUpsertIfTrusted(postId)
}

/** Call when a post trust result arrives (or after publish). */
export function onPostTrustResolved(postId: string): void {
  queueUpsertIfTrusted(postId)
}

export interface PostChromeBridge {
  stop(): void
}

export function startPostChromeBridge(
  options: {
    subscribeInbound?: (handler: (data: unknown) => void) => () => void
  } = {},
): PostChromeBridge {
  stopped = false
  const onInbound = (data: unknown): void => {
    if (stopped) return
    const message = parseObservedXPostMessage(data)
    if (!message) return
    for (const post of message.posts) {
      const previous = pendingChrome.get(post.postId)
      if (!previous && pendingChrome.size >= MAX_PENDING) continue
      pendingChrome.set(post.postId, mergeXPostChrome(previous, post))
      queueUpsertIfTrusted(post.postId)
    }
  }

  unsubscribePort = options.subscribeInbound
    ? options.subscribeInbound(onInbound)
    : ensurePageWorldContentPort().subscribe(onInbound)

  return {
    stop() {
      stopped = true
      unsubscribePort?.()
      unsubscribePort = undefined
      if (upsertTimer !== undefined) {
        clearTimeout(upsertTimer)
        upsertTimer = undefined
      }
      pendingChrome.clear()
      pendingUpsert.clear()
    },
  }
}
