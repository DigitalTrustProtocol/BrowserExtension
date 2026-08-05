import {
  MAX_OBSERVATIONS_PER_MESSAGE,
  OBSERVED_X_IDENTITY_MESSAGE,
  OBSERVED_X_IDENTITY_SOURCE,
  OBSERVED_X_IDENTITY_VERSION,
  coerceXNumericId,
  isAllowedXOperation,
  normalizeObservedHandle,
  type ObservedXIdentity,
  type ObservedXIdentityMessage,
} from '../shared/observed-x-identity'
import {
  normalizeXDisplayName,
  normalizeXProfileIconPath,
} from '../shared/x-profile-display'
import {
  PROOF_CAPTURE_SOURCE,
  PROOF_CAPTURE_VERSION,
  extractCreateTweetProof,
  isCreateTweetOperation,
  parseProofCapturePageMessage,
  type ProofCaptureHostMessage,
} from './proof-capture'
import { ensurePageWorldPagePort } from './page-world-port'
import {
  PROOF_SEARCH_SOURCE,
  PROOF_SEARCH_VERSION,
  buildProofSearchQueryFromCriteria,
  extractProofFromSearchTimelineWithCriteria,
  isSearchTimelineOperation,
  parseProofSearchPageMessage,
  resolveProofSearchCriteria,
  type ProofSearchCriteria,
  type ProofSearchHostMessage,
} from './proof-search'
import {
  createXGraphqlSession,
  fetchSearchTimeline,
  noteGraphqlRequest,
  readCt0Cookie,
} from './x-graphql-session'
import { createJsonTrustFilterController } from './json-trust-filter'
import { isTimelineJsonFilterOperation } from '../shared/timeline-json-filter'
import {
  createObservedXPostMessage,
  extractXPostChromeFromTweet,
  mergeXPostChrome,
  MAX_X_POST_CHROME_PER_MESSAGE,
  type XPostChromeInput,
} from '../shared/x-post-chrome'

export const OBSERVER_LIMITS = {
  // TweetDetail reply trees are large; keep a hard cap but allow typical threads.
  maxResponseBytes: 4_000_000,
  // Conversation modules nest item → itemContent → tweet_results → visibility
  // wrappers → core → user_results; 16 was enough for timeline items but dropped
  // reply authors under VerticalConversation.
  maxDepth: 28,
  maxContainers: 20_000,
  maxKeysPerObject: 200,
  maxArrayItems: 800,
  maxQueuedItems: 30_000,
  maxPendingObservations: 400,
  flushIntervalMs: 100,
} as const

const JSON_CONTENT_TYPE = /^(?:application|text)\/(?:[\w.+-]*\+)?json\b/i

const PRIORITY_WALK_KEYS = [
  'data',
  'home',
  'home_timeline_urt',
  'threaded_conversation_with_injections_v2',
  'threaded_conversation_with_injections',
  'instructions',
  'entries',
  'content',
  'itemContent',
  'items',
  'item',
  'tweet_results',
  'tweet_result',
  'result',
  'tweet',
  'core',
  'user_results',
  'user_result',
  'legacy',
  'rest_id',
  'quoted_status_result',
  'retweeted_status_result',
] as const

interface WalkItem {
  value: unknown
  depth: number
  postIds: readonly string[]
}

interface InstalledObserver {
  uninstall(): void
}

export function operationNameFromUrl(
  value: string,
  baseUrl = 'https://x.com/',
): string | undefined {
  let url: URL
  try {
    url = new URL(value, baseUrl)
  } catch {
    return undefined
  }

  const segments = url.pathname.split('/').filter(Boolean)
  const graphqlIndex = segments.indexOf('graphql')
  const operation =
    graphqlIndex >= 0 ? segments[graphqlIndex + 2] : url.searchParams.get('operationName')
  if (!operation) return undefined

  let decoded: string
  try {
    decoded = decodeURIComponent(operation)
  } catch {
    return undefined
  }
  if (isAllowedXOperation(decoded) || isCreateTweetOperation(decoded)) {
    return decoded
  }
  return undefined
}

export function extractObservedXIdentities(
  payload: unknown,
  sourceOperation: string,
  observedAt = Date.now(),
): ObservedXIdentity[] {
  if (!isAllowedXOperation(sourceOperation) || !Number.isSafeInteger(observedAt)) {
    return []
  }

  const identities = new Map<string, ObservedXIdentity>()
  const stack: WalkItem[] = [{ value: payload, depth: 0, postIds: [] }]
  let containers = 0

  while (stack.length > 0 && containers < OBSERVER_LIMITS.maxContainers) {
    const item = stack.pop()
    if (!item || item.depth > OBSERVER_LIMITS.maxDepth) continue

    if (Array.isArray(item.value)) {
      containers += 1
      const limit = Math.min(item.value.length, OBSERVER_LIMITS.maxArrayItems)
      for (let index = limit - 1; index >= 0; index -= 1) {
        if (stack.length >= OBSERVER_LIMITS.maxQueuedItems) break
        stack.push({
          value: item.value[index],
          depth: item.depth + 1,
          postIds: item.postIds,
        })
      }
      continue
    }

    if (!isRecord(item.value)) continue
    containers += 1

    const currentPostId = readPostId(item.value)
    const postIds = currentPostId ? [currentPostId] : item.postIds
    const twitterId = coerceXNumericId(item.value.rest_id)
    const handle = readUsername(item.value)
    const displayName = readDisplayName(item.value)
    const iconPath = readProfileIconPath(item.value)
    if (twitterId && handle) {
      const key = `${twitterId}:${handle}`
      const previous = identities.get(key)
      const mergedPostIds = [
        ...new Set([...(previous?.postIds ?? []), ...postIds]),
      ].slice(0, 20)
      identities.set(key, {
        twitterId,
        handle,
        observedAt,
        sourceOperation,
        ...(mergedPostIds.length > 0 ? { postIds: mergedPostIds } : {}),
        ...(displayName || previous?.displayName
          ? { displayName: displayName ?? previous?.displayName }
          : {}),
        ...(iconPath || previous?.iconPath
          ? { iconPath: iconPath ?? previous?.iconPath }
          : {}),
      })
    }

    const entries = prioritizeObjectEntries(item.value).slice(
      0,
      OBSERVER_LIMITS.maxKeysPerObject,
    )
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      if (stack.length >= OBSERVER_LIMITS.maxQueuedItems) break
      stack.push({
        value: entries[index]?.[1],
        depth: item.depth + 1,
        postIds,
      })
    }
  }

  return [...identities.values()]
}

/** Extract trust-gated candidate chrome (role/author/text) from allowlisted GraphQL. */
export function extractObservedXPosts(
  payload: unknown,
  sourceOperation: string,
  observedAt = Date.now(),
): XPostChromeInput[] {
  if (!isAllowedXOperation(sourceOperation) || !Number.isSafeInteger(observedAt)) {
    return []
  }

  const posts = new Map<string, XPostChromeInput>()
  const stack: WalkItem[] = [{ value: payload, depth: 0, postIds: [] }]
  let containers = 0

  while (stack.length > 0 && containers < OBSERVER_LIMITS.maxContainers) {
    const item = stack.pop()
    if (!item || item.depth > OBSERVER_LIMITS.maxDepth) continue

    if (Array.isArray(item.value)) {
      containers += 1
      const limit = Math.min(item.value.length, OBSERVER_LIMITS.maxArrayItems)
      for (let index = limit - 1; index >= 0; index -= 1) {
        if (stack.length >= OBSERVER_LIMITS.maxQueuedItems) break
        stack.push({
          value: item.value[index],
          depth: item.depth + 1,
          postIds: item.postIds,
        })
      }
      continue
    }

    if (!isRecord(item.value)) continue
    containers += 1

    const currentPostId = readPostId(item.value)
    if (currentPostId) {
      const chrome = extractXPostChromeFromTweet(item.value)
      if (chrome) {
        const previous = posts.get(chrome.postId)
        posts.set(
          chrome.postId,
          mergeXPostChrome(previous, { ...chrome, observedAt }),
        )
      }
    }

    const postIds = currentPostId ? [currentPostId] : item.postIds
    const entries = prioritizeObjectEntries(item.value).slice(
      0,
      OBSERVER_LIMITS.maxKeysPerObject,
    )
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      if (stack.length >= OBSERVER_LIMITS.maxQueuedItems) break
      stack.push({
        value: entries[index]?.[1],
        depth: item.depth + 1,
        postIds,
      })
    }
  }

  return [...posts.values()]
}

export function installXIdentityObserver(
  target: Window = window,
): InstalledObserver {
  const pagePort = ensurePageWorldPagePort(target)
  const pending = new Map<string, ObservedXIdentity>()
  const pendingPosts = new Map<string, XPostChromeInput>()
  let flushTimer: number | undefined
  let stopped = false
  let proofCapture:
    | { expectedProofText: string; expectedHandle?: string }
    | undefined
  let proofSearch: { criteria: ProofSearchCriteria } | undefined
  const graphqlSession = createXGraphqlSession()
  const csrf = readCt0Cookie(target.document.cookie)
  if (csrf) graphqlSession.csrf = csrf
  let unboundFetch: typeof fetch = target.fetch.bind(target)
  const jsonTrustFilter = createJsonTrustFilterController(target, {
    post: (data) => pagePort.post(data),
    subscribe: (handler) => pagePort.subscribe(handler),
  })

  const flush = (): void => {
    flushTimer = undefined
    if (stopped) return

    if (pending.size > 0) {
      const observations = [...pending.values()].slice(
        0,
        MAX_OBSERVATIONS_PER_MESSAGE,
      )
      for (const observation of observations) {
        pending.delete(`${observation.twitterId}:${observation.handle}`)
      }
      const message: ObservedXIdentityMessage = {
        source: OBSERVED_X_IDENTITY_SOURCE,
        type: OBSERVED_X_IDENTITY_MESSAGE,
        version: OBSERVED_X_IDENTITY_VERSION,
        observations,
      }
      pagePort.post(message)
    }

    if (pendingPosts.size > 0) {
      const posts = [...pendingPosts.values()].slice(
        0,
        MAX_X_POST_CHROME_PER_MESSAGE,
      )
      for (const post of posts) {
        pendingPosts.delete(post.postId)
      }
      pagePort.post(createObservedXPostMessage(posts))
    }

    if (pending.size > 0 || pendingPosts.size > 0) scheduleFlush()
  }

  const scheduleFlush = (): void => {
    if (flushTimer !== undefined || stopped) return
    flushTimer = target.setTimeout(flush, OBSERVER_LIMITS.flushIntervalMs)
  }

  const accept = (observations: readonly ObservedXIdentity[]): void => {
    for (const observation of observations) {
      const key = `${observation.twitterId}:${observation.handle}`
      const previous = pending.get(key)
      if (!previous && pending.size >= OBSERVER_LIMITS.maxPendingObservations) {
        continue
      }
      pending.set(key, {
        ...observation,
        postIds: [
          ...new Set([
            ...(previous?.postIds ?? []),
            ...(observation.postIds ?? []),
          ]),
        ].slice(0, 20),
      })
    }
    scheduleFlush()
  }

  const acceptPosts = (posts: readonly XPostChromeInput[]): void => {
    for (const post of posts) {
      const previous = pendingPosts.get(post.postId)
      if (!previous && pendingPosts.size >= OBSERVER_LIMITS.maxPendingObservations) {
        continue
      }
      pendingPosts.set(post.postId, mergeXPostChrome(previous, post))
    }
    scheduleFlush()
  }

  const acceptPayload = (payload: unknown, operation: string): void => {
    accept(extractObservedXIdentities(payload, operation))
    acceptPosts(extractObservedXPosts(payload, operation))
  }

  const publishProofCapture = (payload: unknown): void => {
    if (!proofCapture) return
    const captured = extractCreateTweetProof(
      payload,
      proofCapture.expectedProofText,
      proofCapture.expectedHandle,
    )
    if (!captured) return
    const message: ProofCaptureHostMessage = {
      source: PROOF_CAPTURE_SOURCE,
      version: PROOF_CAPTURE_VERSION,
      type: 'proof-post-created',
      postId: captured.postId,
      ...(captured.handle ? { handle: captured.handle } : {}),
      ...(captured.twitterId ? { twitterId: captured.twitterId } : {}),
    }
    pagePort.post(message)
  }

  const publishProofSearch = (
    payload: unknown,
    options: { completeIfEmpty?: boolean; query?: string } = {},
  ): void => {
    if (!proofSearch) return
    const criteria = proofSearch.criteria
    const found = extractProofFromSearchTimelineWithCriteria(
      payload,
      criteria,
    )
    if (found) {
      const message: ProofSearchHostMessage = {
        source: PROOF_SEARCH_SOURCE,
        version: PROOF_SEARCH_VERSION,
        type: 'proof-search-found',
        postId: found.postId,
        handle: found.handle,
        fullText: found.fullText,
      }
      pagePort.post(message)
      proofSearch = undefined
      return
    }
    if (options.completeIfEmpty) {
      finishProofSearchEmpty(
        criteria.expectedHandle,
        'no-matching-post',
        options.query ??
          buildProofSearchQueryFromCriteria(criteria),
      )
    }
  }

  const finishProofSearchEmpty = (
    handle: string,
    reason: string,
    query?: string,
  ): void => {
    if (!proofSearch) return
    const message: ProofSearchHostMessage = {
      source: PROOF_SEARCH_SOURCE,
      version: PROOF_SEARCH_VERSION,
      type: 'proof-search-empty',
      handle,
      reason,
      ...(query ? { query } : {}),
    }
    pagePort.post(message)
    proofSearch = undefined
  }

  const runActiveProofSearch = async (
    criteria: ProofSearchCriteria,
  ): Promise<void> => {
    proofSearch = { criteria }
    const query = buildProofSearchQueryFromCriteria(criteria)
    try {
      const payload = await fetchSearchTimeline(
        target,
        graphqlSession,
        query,
        unboundFetch,
      )
      if (payload === undefined) {
        finishProofSearchEmpty(
          criteria.expectedHandle,
          'no-payload',
          query,
        )
        return
      }
      // Empty active results keep proofSearch open for the finally timer /
      // racing passive SearchTimeline; only found finishes immediately here.
      publishProofSearch(payload, { completeIfEmpty: false, query })
    } catch {
      finishProofSearchEmpty(
        criteria.expectedHandle,
        'graphql-error',
        query,
      )
    } finally {
      // Keep proofSearch briefly so a racing passive SearchTimeline can still match.
      target.setTimeout(() => {
        if (proofSearch?.criteria === criteria) {
          finishProofSearchEmpty(
            criteria.expectedHandle,
            'stale-window',
            query,
          )
        }
      }, 2_000)
    }
  }

  const inspectOperation = async (
    response: Response,
    operation: string,
  ): Promise<void> => {
    if (isCreateTweetOperation(operation)) {
      if (!proofCapture) return
      const payload = await readJsonPayload(response)
      if (payload !== undefined) publishProofCapture(payload)
      return
    }
    if (isSearchTimelineOperation(operation) && proofSearch) {
      const payload = await readJsonPayload(response)
      if (payload !== undefined) {
        publishProofSearch(payload)
        acceptPayload(payload, operation)
      }
      return
    }
    const payload = await readJsonPayload(response)
    if (payload !== undefined) acceptPayload(payload, operation)
  }

  const inspectXhrOperation = (
    xhr: XMLHttpRequest,
    operation: string,
  ): void => {
    if (isCreateTweetOperation(operation)) {
      if (!proofCapture) return
      try {
        const payload =
          xhr.responseType === 'json'
            ? xhr.response
            : JSON.parse(xhr.responseText)
        publishProofCapture(payload)
      } catch {
        // Ignore malformed CreateTweet responses.
      }
      return
    }
    if (isSearchTimelineOperation(operation) && proofSearch) {
      try {
        const payload =
          xhr.responseType === 'json'
            ? xhr.response
            : JSON.parse(xhr.responseText)
        publishProofSearch(payload)
        acceptPayload(payload, operation)
      } catch {
        /* ignore */
      }
      return
    }
    try {
      const payload =
        xhr.responseType === 'json'
          ? xhr.response
          : JSON.parse(xhr.responseText as string)
      acceptPayload(payload, operation)
    } catch {
      accept(inspectXhrResponse(xhr, operation))
    }
  }

  const onProofCaptureMessage = (data: unknown): void => {
    const message = parseProofCapturePageMessage(data)
    if (!message) return
    if (message.type === 'disable-proof-capture') {
      proofCapture = undefined
      return
    }
    proofCapture = {
      expectedProofText: message.expectedProofText,
      ...(message.expectedHandle
        ? { expectedHandle: message.expectedHandle }
        : {}),
    }
  }

  const onProofSearchMessage = (data: unknown): void => {
    const message = parseProofSearchPageMessage(data)
    if (!message) return
    if (message.type === 'disable-proof-search') {
      proofSearch = undefined
      return
    }
    const criteria = resolveProofSearchCriteria({
      expectedHandle: message.expectedHandle,
      expectedNpub: message.expectedNpub,
      expectedProofText: message.expectedProofText,
    })
    if (!criteria) return
    void runActiveProofSearch(criteria)
  }
  const unsubscribeProofCapture = pagePort.subscribe(onProofCaptureMessage)
  const unsubscribeProofSearch = pagePort.subscribe(onProofSearchMessage)

  const originalFetch = target.fetch
  unboundFetch = originalFetch.bind(target)
  /** Skip JSON rewrite while we sync/async backfill cursor pages. */
  let timelineBackfillDepth = 0

  const fetchTimelinePageWithCursor = (
    requestUrl: string,
    headers: Record<string, string>,
    requestBody: string,
    cursor: string,
    sync: boolean,
  ): unknown | undefined => {
    let parsed: {
      variables?: Record<string, unknown>
      features?: unknown
      queryId?: string
    }
    try {
      parsed = JSON.parse(requestBody) as typeof parsed
    } catch {
      return undefined
    }
    if (!parsed.variables || typeof parsed.variables !== 'object') {
      return undefined
    }
    const nextBody = JSON.stringify({
      ...parsed,
      variables: { ...parsed.variables, cursor },
    })

    timelineBackfillDepth += 1
    try {
      if (sync) {
        const xhr = new (target as Window & typeof globalThis).XMLHttpRequest()
        xhr.open('POST', requestUrl, false)
        for (const [name, value] of Object.entries(headers)) {
          try {
            xhr.setRequestHeader(name, value)
          } catch {
            // Forbidden headers (e.g. user-agent) are set by the browser.
          }
        }
        xhr.send(nextBody)
        if (xhr.status < 200 || xhr.status >= 300) return undefined
        const text = xhr.responseText
        if (!text) return undefined
        return JSON.parse(text) as unknown
      }
      // Async path is wired via maybeFilterResponse's Promise wrapper below.
      return undefined
    } catch {
      return undefined
    } finally {
      timelineBackfillDepth -= 1
    }
  }

  const wrappedFetch: typeof fetch = async (input, init) => {
    const requestUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    if (requestUrl.includes('/graphql/')) {
      noteGraphqlRequest(
        graphqlSession,
        requestUrl,
        init?.headers,
        init?.body,
      )
      if (!graphqlSession.csrf) {
        const fromCookie = readCt0Cookie(target.document.cookie)
        if (fromCookie) graphqlSession.csrf = fromCookie
      }
    }
    const response = await originalFetch.call(target, input, init)
    const operation = operationNameFromUrl(requestUrl, target.location.href)
    if (operation) {
      // Observe identities on the original payload (before hide filtering).
      void inspectOperation(response, operation)
      if (timelineBackfillDepth > 0) return response
      const requestBody =
        typeof init?.body === 'string'
          ? init.body
          : undefined
      const headerMap: Record<string, string> = {}
      if (init?.headers) {
        const normalized =
          init.headers instanceof Headers
            ? init.headers
            : new Headers(init.headers as HeadersInit)
        normalized.forEach((value, key) => {
          headerMap[key] = value
        })
      }
      return jsonTrustFilter.maybeFilterResponse(
        response,
        operation,
        target,
        requestBody
          ? {
              fetchNextPage: (cursor) =>
                fetchTimelinePageWithCursor(
                  requestUrl,
                  headerMap,
                  requestBody,
                  cursor,
                  true,
                ),
            }
          : undefined,
      )
    }
    return response
  }
  target.fetch = wrappedFetch

  const xhrMetadata = new WeakMap<
    XMLHttpRequest,
    {
      operation?: string
      url?: string
      method?: string
      headers: Record<string, string>
    }
  >()
  const xhrPrototype = (target as Window & typeof globalThis).XMLHttpRequest
    .prototype
  const originalOpen = xhrPrototype.open
  const originalSetRequestHeader = xhrPrototype.setRequestHeader
  const originalSend = xhrPrototype.send

  xhrPrototype.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ): void {
    const href = String(url)
    const operation = operationNameFromUrl(href, target.location.href)
    xhrMetadata.set(this, {
      operation,
      url: href,
      method: String(method).toUpperCase(),
      headers: {},
    })
    Reflect.apply(originalOpen, this, [method, url, ...rest])
  } as typeof xhrPrototype.open

  xhrPrototype.setRequestHeader = function (
    this: XMLHttpRequest,
    name: string,
    value: string,
  ): void {
    const meta = xhrMetadata.get(this)
    if (meta) meta.headers[name] = value
    return originalSetRequestHeader.call(this, name, value)
  }

  const responseTextDescriptor = Object.getOwnPropertyDescriptor(
    xhrPrototype,
    'responseText',
  )
  const responseDescriptor = Object.getOwnPropertyDescriptor(
    xhrPrototype,
    'response',
  )
  const nativeResponseTextGet = responseTextDescriptor?.get
  const nativeResponseGet = responseDescriptor?.get

  xhrPrototype.send = function (
    this: XMLHttpRequest,
    body?: Document | XMLHttpRequestBodyInit | null,
  ) {
    const meta = xhrMetadata.get(this)
    if (meta?.url?.includes('/graphql/')) {
      noteGraphqlRequest(
        graphqlSession,
        meta.url,
        meta.headers,
        typeof body === 'string' ? body : undefined,
      )
      if (!graphqlSession.csrf) {
        const fromCookie = readCt0Cookie(target.document.cookie)
        if (fromCookie) graphqlSession.csrf = fromCookie
      }
    }
    if (meta?.operation && timelineBackfillDepth === 0) {
      const operation = meta.operation
      // X loads HomeTimeline over XHR. Install lazy getters before send so the
      // first responseText/response read (any listener order) sees filtered JSON.
      if (
        isTimelineJsonFilterOperation(operation) &&
        nativeResponseTextGet &&
        nativeResponseGet
      ) {
        const xhr = this
        let computed = false
        let filteredText: string | undefined
        let filteredJson: unknown
        const requestBody = typeof body === 'string' ? body : undefined

        const computeFilter = (): void => {
          if (computed || xhr.readyState !== 4) return
          computed = true
          try {
            if (xhr.status < 200 || xhr.status >= 300) return
            const raw = nativeResponseTextGet.call(xhr)
            if (!raw || typeof raw !== 'string') return
            const payload = JSON.parse(raw) as unknown
            const filtered = jsonTrustFilter.filterPayloadSync(payload, {
              fetchNextPage:
                requestBody && meta.url
                  ? (cursor) =>
                      fetchTimelinePageWithCursor(
                        meta.url!,
                        meta.headers,
                        requestBody,
                        cursor,
                        true,
                      )
                  : undefined,
            })
            if (!filtered || filtered.removed === 0) return
            filteredText = JSON.stringify(filtered.payload)
            filteredJson = filtered.payload
          } catch {
            // Keep native payload.
          }
        }

        Object.defineProperty(xhr, 'responseText', {
          configurable: true,
          enumerable: true,
          get(): string {
            computeFilter()
            if (filteredText !== undefined) return filteredText
            return nativeResponseTextGet.call(xhr)
          },
        })
        Object.defineProperty(xhr, 'response', {
          configurable: true,
          enumerable: true,
          get(): unknown {
            computeFilter()
            if (filteredJson !== undefined) {
              return xhr.responseType === 'json' || xhr.responseType === ''
                ? filteredJson
                : filteredText
            }
            return nativeResponseGet.call(xhr)
          },
        })
      }
      this.addEventListener(
        'loadend',
        () => inspectXhrOperation(this, operation),
        { once: true },
      )
    }
    return originalSend.call(this, body)
  }

  return {
    uninstall(): void {
      stopped = true
      proofCapture = undefined
      proofSearch = undefined
      unsubscribeProofCapture()
      unsubscribeProofSearch()
      jsonTrustFilter.uninstall()
      if (flushTimer !== undefined) target.clearTimeout(flushTimer)
      if (target.fetch === wrappedFetch) target.fetch = originalFetch
      if (xhrPrototype.open !== originalOpen) xhrPrototype.open = originalOpen
      if (xhrPrototype.setRequestHeader !== originalSetRequestHeader) {
        xhrPrototype.setRequestHeader = originalSetRequestHeader
      }
      if (xhrPrototype.send !== originalSend) xhrPrototype.send = originalSend
      pending.clear()
    },
  }
}

async function readJsonPayload(response: Response): Promise<unknown> {
  if (!isInspectableResponse(response.status, response.headers.get('content-type'))) {
    return undefined
  }
  try {
    const text = await readResponseTextWithinByteBudget(
      response.clone(),
      OBSERVER_LIMITS.maxResponseBytes,
    )
    if (text === undefined) return undefined
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

export async function inspectFetchResponse(
  response: Response,
  operation: string,
): Promise<ObservedXIdentity[]> {
  if (!isInspectableResponse(response.status, response.headers.get('content-type'))) {
    return []
  }
  const declaredLength = Number(response.headers.get('content-length'))
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > OBSERVER_LIMITS.maxResponseBytes
  ) {
    return []
  }

  try {
    const text = await readResponseTextWithinByteBudget(
      response.clone(),
      OBSERVER_LIMITS.maxResponseBytes,
    )
    if (text === undefined) return []
    const payload: unknown = JSON.parse(text)
    return extractObservedXIdentities(payload, operation)
  } catch {
    return []
  }
}

async function readResponseTextWithinByteBudget(
  response: Response,
  maxBytes: number,
): Promise<string | undefined> {
  const reader = response.body?.getReader()
  if (!reader) return undefined

  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) return text + decoder.decode()
    if (!value) continue

    bytes += value.byteLength
    if (bytes > maxBytes) {
      void reader.cancel()
      return undefined
    }
    text += decoder.decode(value, { stream: true })
  }
}

export function inspectXhrResponse(
  xhr: XMLHttpRequest,
  operation: string,
): ObservedXIdentity[] {
  if (!isInspectableResponse(xhr.status, xhr.getResponseHeader('content-type'))) {
    return []
  }
  const declaredLength = Number(xhr.getResponseHeader('content-length'))
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > OBSERVER_LIMITS.maxResponseBytes
  ) {
    return []
  }

  try {
    if (xhr.responseType === 'json') {
      if (!isJsonValueWithinByteBudget(xhr.response)) return []
      return extractObservedXIdentities(structuredClone(xhr.response), operation)
    }
    if (xhr.responseType !== '' && xhr.responseType !== 'text') return []
    if (xhr.responseText.length * 2 > OBSERVER_LIMITS.maxResponseBytes) return []
    const payload: unknown = JSON.parse(xhr.responseText)
    return extractObservedXIdentities(payload, operation)
  } catch {
    return []
  }
}

function isInspectableResponse(
  status: number,
  contentType: string | null,
): boolean {
  return status >= 200 && status < 300 && Boolean(contentType?.match(JSON_CONTENT_TYPE))
}

function readUsername(value: Record<string, unknown>): string | undefined {
  const legacy = isRecord(value.legacy) ? value.legacy : undefined
  const core = isRecord(value.core) ? value.core : undefined
  const candidates = [
    core?.screen_name,
    core?.username,
    legacy?.screen_name,
    legacy?.username,
    value.screen_name,
    value.username,
  ]
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate.trim() === '') continue
    const handle = normalizeObservedHandle(candidate)
    if (handle) return handle
  }
  return undefined
}

function readDisplayName(value: Record<string, unknown>): string | undefined {
  const legacy = isRecord(value.legacy) ? value.legacy : undefined
  const core = isRecord(value.core) ? value.core : undefined
  const candidates = [core?.name, legacy?.name, value.name]
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate.trim() === '') continue
    const displayName = normalizeXDisplayName(candidate)
    if (displayName) return displayName
  }
  return undefined
}

function readProfileIconPath(
  value: Record<string, unknown>,
): string | undefined {
  const legacy = isRecord(value.legacy) ? value.legacy : undefined
  const avatar = isRecord(value.avatar) ? value.avatar : undefined
  const candidates = [
    legacy?.profile_image_url_https,
    legacy?.profile_image_url,
    avatar?.image_url,
  ]
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate.trim() === '') continue
    const iconPath = normalizeXProfileIconPath(candidate)
    if (iconPath) return iconPath
  }
  return undefined
}

function readPostId(value: Record<string, unknown>): string | undefined {
  const legacy = isRecord(value.legacy) ? value.legacy : undefined
  const noteTweet = isRecord(value.note_tweet) ? value.note_tweet : undefined
  const noteResults = isRecord(noteTweet?.note_tweet_results)
    ? noteTweet.note_tweet_results
    : undefined
  const noteResult = isRecord(noteResults?.result) ? noteResults.result : undefined
  const tweetLike =
    value.__typename === 'Tweet' ||
    value.__typename === 'TweetWithVisibilityResults' ||
    typeof legacy?.full_text === 'string' ||
    typeof value.full_text === 'string' ||
    typeof noteResult?.text === 'string' ||
    'tweet_results' in value
  if (!tweetLike) return undefined

  return (
    coerceXNumericId(value.rest_id) ??
    coerceXNumericId(legacy?.id_str) ??
    coerceXNumericId(value.id_str)
  )
}

function prioritizeObjectEntries(
  value: Record<string, unknown>,
): Array<[string, unknown]> {
  const remaining = new Map(Object.entries(value))
  const ordered: Array<[string, unknown]> = []
  for (const key of PRIORITY_WALK_KEYS) {
    if (!remaining.has(key)) continue
    ordered.push([key, remaining.get(key)])
    remaining.delete(key)
  }
  for (const entry of remaining) ordered.push(entry)
  return ordered
}

function isJsonValueWithinByteBudget(value: unknown): boolean {
  const stack = [value]
  const seen = new WeakSet<object>()
  let bytes = 0
  let containers = 0

  while (stack.length > 0) {
    const item = stack.pop()
    if (
      item === null ||
      typeof item === 'boolean' ||
      typeof item === 'number'
    ) {
      bytes += 16
    } else if (typeof item === 'string') {
      bytes += new TextEncoder().encode(item).byteLength + 2
    } else if (typeof item === 'object') {
      if (seen.has(item)) return false
      seen.add(item)
      containers += 1
      if (containers > OBSERVER_LIMITS.maxContainers) return false

      if (Array.isArray(item)) {
        if (item.length > OBSERVER_LIMITS.maxArrayItems) return false
        bytes += item.length + 2
        stack.push(...item)
      } else {
        const entries = Object.entries(item)
        if (entries.length > OBSERVER_LIMITS.maxKeysPerObject) return false
        bytes += entries.length + 2
        for (const [key, child] of entries) {
          bytes += new TextEncoder().encode(key).byteLength + 3
          stack.push(child)
        }
      }
    } else {
      return false
    }
    if (
      bytes > OBSERVER_LIMITS.maxResponseBytes ||
      stack.length > OBSERVER_LIMITS.maxQueuedItems
    ) {
      return false
    }
  }
  return true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
