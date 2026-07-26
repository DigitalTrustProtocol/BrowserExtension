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
  PROOF_CAPTURE_SOURCE,
  PROOF_CAPTURE_VERSION,
  extractCreateTweetProof,
  isCreateTweetOperation,
  type ProofCaptureHostMessage,
  type ProofCapturePageMessage,
} from './proof-capture'
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

export function installXIdentityObserver(
  target: Window = window,
): InstalledObserver {
  const pending = new Map<string, ObservedXIdentity>()
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

  const flush = (): void => {
    flushTimer = undefined
    if (stopped || pending.size === 0) return

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
    target.postMessage(message, target.location.origin)
    if (pending.size > 0) scheduleFlush()
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
    target.postMessage(message, target.location.origin)
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
      target.postMessage(message, target.location.origin)
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
    target.postMessage(message, target.location.origin)
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
        accept(extractObservedXIdentities(payload, operation))
      }
      return
    }
    accept(await inspectFetchResponse(response, operation))
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
        accept(extractObservedXIdentities(payload, operation))
      } catch {
        /* ignore */
      }
      return
    }
    accept(inspectXhrResponse(xhr, operation))
  }

  const onProofCaptureMessage = (event: MessageEvent<unknown>): void => {
    if (event.source !== target) return
    const message = parseProofCapturePageMessage(event.data)
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

  const onProofSearchMessage = (event: MessageEvent<unknown>): void => {
    if (event.source !== target) return
    const message = parseProofSearchPageMessage(event.data)
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
  target.addEventListener('message', onProofCaptureMessage)
  target.addEventListener('message', onProofSearchMessage)

  const originalFetch = target.fetch
  unboundFetch = originalFetch.bind(target)
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
      void inspectOperation(response, operation)
    }
    return response
  }
  target.fetch = wrappedFetch

  const xhrMetadata = new WeakMap<
    XMLHttpRequest,
    { operation?: string; url?: string; headers: Record<string, string> }
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
    if (meta?.operation) {
      this.addEventListener(
        'loadend',
        () => inspectXhrOperation(this, meta.operation!),
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
      target.removeEventListener('message', onProofCaptureMessage)
      target.removeEventListener('message', onProofSearchMessage)
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

function parseProofCapturePageMessage(
  value: unknown,
): ProofCapturePageMessage | undefined {
  if (!isRecord(value)) return undefined
  if (
    value.source !== PROOF_CAPTURE_SOURCE ||
    value.version !== PROOF_CAPTURE_VERSION
  ) {
    return undefined
  }
  if (value.type === 'disable-proof-capture') {
    return {
      source: PROOF_CAPTURE_SOURCE,
      version: PROOF_CAPTURE_VERSION,
      type: 'disable-proof-capture',
    }
  }
  if (
    value.type === 'enable-proof-capture' &&
    typeof value.expectedProofText === 'string' &&
    value.expectedProofText.length > 0 &&
    value.expectedProofText.length <= 500
  ) {
    const expectedHandle =
      typeof value.expectedHandle === 'string'
        ? normalizeObservedHandle(value.expectedHandle)
        : undefined
    return {
      source: PROOF_CAPTURE_SOURCE,
      version: PROOF_CAPTURE_VERSION,
      type: 'enable-proof-capture',
      expectedProofText: value.expectedProofText,
      ...(expectedHandle ? { expectedHandle } : {}),
    }
  }
  return undefined
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
