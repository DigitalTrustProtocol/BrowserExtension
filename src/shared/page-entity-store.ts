import type { TrustSubject } from '../graph'
import type { XIdentityRecord, XPostRecord } from '../storage/types'
import {
  BACKGROUND_API_VERSION,
  type ExtensionRequest,
  type ExtensionResponse,
  type QueryOutgoingTrustResult,
  type XPostDisplay,
} from './contracts'
import { npubForIdentityRow } from './npub-lookup'
import {
  postIdFromSubject,
  twitterIdFromSubject,
} from './selected-ids'
import type { SelectedSubject } from './selected-subject'
import { subscribeStateTopic } from './state-topics.ts'

export type PageEntityStoreListener = () => void

export type OutgoingTrustState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; result: QueryOutgoingTrustResult }
  | { status: 'unavailable' }
  | { status: 'error'; error: string }

async function send<T>(request: ExtensionRequest): Promise<T> {
  const response = (await chrome.runtime.sendMessage(
    request,
  )) as ExtensionResponse<T>
  if (response.version !== BACKGROUND_API_VERSION) {
    throw new Error('Unsupported Attention background API version')
  }
  if (!response.ok) {
    throw new Error(response.error || 'Attention background request failed')
  }
  return response.data
}

/**
 * Per-document keyed identity/post cache plus selection prefetch for outgoing
 * trust. Mirrors TrustStore: coalesce, subscribe, one RPC per id.
 */
export class PageEntityStore {
  readonly #users = new Map<string, XIdentityRecord | null>()
  readonly #posts = new Map<string, XPostDisplay | XPostRecord | null>()
  readonly #userInflight = new Map<string, Promise<XIdentityRecord | null>>()
  readonly #postInflight = new Map<string, Promise<XPostDisplay | null>>()
  readonly #outgoing = new Map<string, OutgoingTrustState>()
  readonly #outgoingRequestEpochs = new Map<string, number>()
  readonly #listeners = new Set<PageEntityStoreListener>()
  #selected: SelectedSubject | null = null
  #listeningRuntime = false
  #outgoingEpoch = 0
  #outgoingRefreshTimer: ReturnType<typeof setTimeout> | undefined
  #runtimeUnsubscribers: Array<() => void> = []

  subscribe(listener: PageEntityStoreListener): () => void {
    this.#listeners.add(listener)
    this.#ensureRuntimeListener()
    return () => {
      this.#listeners.delete(listener)
    }
  }

  getUser(twitterId: string): XIdentityRecord | null | undefined {
    return this.#users.get(twitterId)
  }

  getPost(postId: string): XPostDisplay | XPostRecord | null | undefined {
    return this.#posts.get(postId)
  }

  getSelected(): SelectedSubject | null {
    return this.#selected
  }

  getOutgoing(subject: TrustSubject): OutgoingTrustState {
    return this.#outgoing.get(this.#subjectKey(subject)) ?? { status: 'idle' }
  }

  requestUser(twitterId: string): void {
    if (!/^\d+$/.test(twitterId)) return
    if (this.#users.has(twitterId) || this.#userInflight.has(twitterId)) return
    const pending = send<{ identity?: XIdentityRecord } | undefined>({
      type: 'GET_X_IDENTITY',
      version: BACKGROUND_API_VERSION,
      twitterId,
    })
      .then((result) => result?.identity ?? null)
      .catch(() => null)
    this.#userInflight.set(twitterId, pending)
    void pending.then((row) => {
      this.#userInflight.delete(twitterId)
      this.#users.set(twitterId, row)
      const selected = this.#selected?.subject
      if (selected && twitterIdFromSubject(selected) === twitterId) {
        this.#prefetchOutgoing(selected)
      }
      this.#notify()
    })
  }

  requestPost(postId: string): void {
    if (!/^\d+$/.test(postId)) return
    if (this.#posts.has(postId) || this.#postInflight.has(postId)) return
    const pending = send<Record<string, XPostDisplay>>({
      type: 'GET_X_POST_DISPLAYS',
      version: BACKGROUND_API_VERSION,
      postIds: [postId],
    })
      .then((displays) => displays[postId] ?? null)
      .catch(() => null)
    this.#postInflight.set(postId, pending)
    void pending.then((row) => {
      this.#postInflight.delete(postId)
      this.#posts.set(postId, row)
      this.#notify()
    })
  }

  prefetchSelection(selected: SelectedSubject | null): void {
    this.#selected = selected
    if (!selected) {
      this.#notify()
      return
    }
    const twitterId = twitterIdFromSubject(selected.subject)
    const postId = postIdFromSubject(selected.subject)
    if (twitterId) this.requestUser(twitterId)
    if (postId) this.requestPost(postId)
    this.#prefetchOutgoing(selected.subject)
    this.#notify()
  }

  #prefetchOutgoing(subject: TrustSubject): void {
    const key = this.#subjectKey(subject)
    if (subject.type === 'p') {
      this.#requestOutgoing(subject)
      return
    }
    const twitterId = twitterIdFromSubject(subject)
    if (!twitterId) return
    const row = this.#users.get(twitterId)
    if (row === undefined) return
    if (row === null || !npubForIdentityRow(row)) {
      this.#outgoing.set(key, { status: 'unavailable' })
      this.#notify()
      return
    }
    this.#requestOutgoing(subject)
  }

  #requestOutgoing(subject: TrustSubject): void {
    const key = this.#subjectKey(subject)
    const current = this.#outgoing.get(key)
    if (current?.status === 'ready' || current?.status === 'loading') return
    const requestEpoch = ++this.#outgoingEpoch
    this.#outgoingRequestEpochs.set(key, requestEpoch)
    this.#outgoing.set(key, { status: 'loading' })
    void send<QueryOutgoingTrustResult>({
      type: 'QUERY_OUTGOING_TRUST',
      version: BACKGROUND_API_VERSION,
      subject,
    })
      .then((result) => {
        if (this.#outgoingRequestEpochs.get(key) !== requestEpoch) return
        this.#outgoing.set(
          key,
          result.unavailable
            ? { status: 'unavailable' }
            : { status: 'ready', result },
        )
        this.#outgoingRequestEpochs.delete(key)
        this.#notify()
      })
      .catch((error: unknown) => {
        if (this.#outgoingRequestEpochs.get(key) !== requestEpoch) return
        this.#outgoing.set(key, {
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        })
        this.#outgoingRequestEpochs.delete(key)
        this.#notify()
      })
  }

  #subjectKey(subject: TrustSubject): string {
    return `${subject.type}:${subject.value}`
  }

  #queueOutgoingRefresh(): void {
    if (this.#outgoingRefreshTimer !== undefined) return
    this.#outgoingRefreshTimer = setTimeout(() => {
      this.#outgoingRefreshTimer = undefined
      const selected = this.#selected
      if (selected) this.prefetchSelection(selected)
    }, 0)
  }

  #invalidateOutgoing(): void {
    this.#outgoingEpoch += 1
    this.#outgoing.clear()
    this.#outgoingRequestEpochs.clear()
    this.#notify()
    this.#queueOutgoingRefresh()
  }

  #invalidateOutgoingForTwitterId(twitterId: string): void {
    const key = this.#subjectKey({
      type: 'i',
      value: `user:id:${twitterId}`,
    })
    this.#outgoingEpoch += 1
    this.#outgoing.delete(key)
    this.#outgoingRequestEpochs.delete(key)
    this.#notify()
    const selected = this.#selected?.subject
    if (selected && twitterIdFromSubject(selected) === twitterId) {
      this.#queueOutgoingRefresh()
    }
  }

  #ensureRuntimeListener(): void {
    if (this.#listeningRuntime) return
    this.#listeningRuntime = true
    this.#runtimeUnsubscribers = [
      subscribeStateTopic('selectedSubject', (message) => {
        this.prefetchSelection({
          subject: message.subject,
          ...(message.context !== undefined
            ? { context: message.context }
            : {}),
        })
      }),
      subscribeStateTopic('identity', (message) => {
        this.#users.delete(message.twitterId)
        this.#invalidateOutgoingForTwitterId(message.twitterId)
        this.requestUser(message.twitterId)
      }),
      subscribeStateTopic('viewer', () => {
        this.#invalidateOutgoing()
      }),
      subscribeStateTopic('trustGraph', (message) => {
        if (message.scope === 'ratings') return
        this.#invalidateOutgoing()
      }),
    ]
  }

  dispose(): void {
    if (this.#outgoingRefreshTimer !== undefined) {
      clearTimeout(this.#outgoingRefreshTimer)
      this.#outgoingRefreshTimer = undefined
    }
    for (const unsubscribe of this.#runtimeUnsubscribers) unsubscribe()
    this.#runtimeUnsubscribers = []
    this.#listeningRuntime = false
  }

  #notify(): void {
    for (const listener of this.#listeners) listener()
  }
}

let documentStore: PageEntityStore | undefined

export function getPageEntityStore(): PageEntityStore {
  documentStore ??= new PageEntityStore()
  return documentStore
}

export function resetPageEntityStoreForTests(): void {
  documentStore?.dispose()
  documentStore = undefined
}