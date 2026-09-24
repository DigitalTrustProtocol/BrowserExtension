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
  mergeObservedXVerifiedChrome,
  readXVerifiedChrome,
  spreadObservedXVerifiedChrome,
} from '../shared/x-verified'
import {
  normalizeXDisplayName,
  normalizeXProfileBannerPath,
  normalizeXProfileIconPath,
  preferXProfileIconChrome,
} from '../shared/x-profile-display'
import { ensurePageWorldPagePort } from './page-world-port'
import { createJsonTrustFilterController } from './json-trust-filter'
import { isTimelineJsonFilterOperation } from '../shared/timeline-json-filter'
import {
  createObservedXPostMessage,
  extractXPostChromeFromTweet,
  mergeXPostChrome,
  MAX_X_POST_CHROME_PER_MESSAGE,
  readTweetAuthor,
  readTweetText,
  type XPostChromeInput,
} from '../shared/x-post-chrome'
import {
  createObservedXProofMessage,
  extractXProofCandidateFromTweet,
  MAX_X_PROOF_CANDIDATES_PER_MESSAGE,
  type ObservedXProofCandidate,
} from '../shared/observed-x-proof'
import {
  createObservedXBioMessage,
  extractXBioCandidateFromTweet,
  extractXBioCandidateFromUser,
  isPreferredBioCandidate,
  MAX_X_BIO_CANDIDATES_PER_MESSAGE,
  type ObservedXBioCandidate,
} from '../shared/observed-x-bio'

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
  if (isAllowedXOperation(decoded)) {
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
    const bannerPath = readProfileBannerPath(item.value)
    const verifiedChrome = readXVerifiedChrome(item.value)
    if (twitterId && handle) {
      const key = `${twitterId}:${handle}`
      const previous = identities.get(key)
      const mergedPostIds = [
        ...new Set([...(previous?.postIds ?? []), ...postIds]),
      ].slice(0, 20)
      const mergedIconPath = preferXProfileIconChrome(
        iconPath,
        previous?.iconPath,
      )
      const mergedVerified = mergeObservedXVerifiedChrome(
        verifiedChrome,
        previous,
      )
      identities.set(key, {
        twitterId,
        handle,
        observedAt,
        sourceOperation,
        ...(mergedPostIds.length > 0 ? { postIds: mergedPostIds } : {}),
        ...(displayName || previous?.displayName
          ? { displayName: displayName ?? previous?.displayName }
          : {}),
        ...(mergedIconPath ? { iconPath: mergedIconPath } : {}),
        ...(bannerPath || previous?.bannerPath
          ? { bannerPath: bannerPath ?? previous?.bannerPath }
          : {}),
        ...spreadObservedXVerifiedChrome(mergedVerified),
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

/** Collect validated banner stems from public pbs.twimg.com URLs (img/srcset/JSON). */
export function collectProfileBannersFromUrls(
  urls: readonly string[],
): Map<string, string> {
  const banners = new Map<string, string>()
  const embedded =
    /https?:\/\/pbs\.twimg\.com\/profile_banners\/\d{1,24}\/\d{1,16}(?:\/[^\s"'<>)]*)?/gi
  for (const raw of urls) {
    const extracted = raw.match(embedded) ?? raw.split(',')
    for (const token of extracted) {
      const url = token.trim().split(/\s+/u)[0]
      if (!url) continue
      const bannerPath = normalizeXProfileBannerPath(url)
      if (!bannerPath) continue
      const twitterId = bannerPath.split('/')[1]
      if (twitterId) banners.set(twitterId, bannerPath)
    }
  }
  return banners
}

function documentBannerUrls(document: Document): string[] {
  const urls: string[] = []
  const images = document.images
  const imgLimit = Math.min(images.length, 80)
  for (let index = 0; index < imgLimit; index += 1) {
    const src = images[index]?.currentSrc || images[index]?.src
    if (src) urls.push(src)
  }
  const styled = document.querySelectorAll(
    '[style*="profile_banners"], link[href*="profile_banners"], link[imagesrcset*="profile_banners"]',
  )
  const styleLimit = Math.min(styled.length, 40)
  for (let index = 0; index < styleLimit; index += 1) {
    const el = styled[index]
    if (!el) continue
    const href = el.getAttribute('href')
    const srcset =
      el.getAttribute('srcset') ?? el.getAttribute('imagesrcset')
    const style = el.getAttribute('style')
    if (href) urls.push(href)
    if (srcset) urls.push(srcset)
    if (style) urls.push(style)
  }
  return urls
}

function mergeDocumentBanners(
  observations: readonly ObservedXIdentity[],
  document: Document,
): ObservedXIdentity[] {
  if (observations.length === 0) return []
  const banners = collectProfileBannersFromUrls(documentBannerUrls(document))
  if (banners.size === 0) return [...observations]
  return observations.map((observation) => {
    if (observation.bannerPath) return observation
    const bannerPath = banners.get(observation.twitterId)
    return bannerPath ? { ...observation, bannerPath } : observation
  })
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

/** Extract loose NIP-39-ish proof candidates from allowlisted GraphQL tweets. */
export function extractObservedXProofCandidates(
  payload: unknown,
  sourceOperation: string,
  observedAt = Date.now(),
): ObservedXProofCandidate[] {
  if (!isAllowedXOperation(sourceOperation) || !Number.isSafeInteger(observedAt)) {
    return []
  }

  const candidates = new Map<string, ObservedXProofCandidate>()
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
      const candidate = extractXProofCandidateFromTweet(
        item.value,
        observedAt,
        readTweetText,
        readTweetAuthor,
      )
      if (candidate) {
        const previous = candidates.get(candidate.postId)
        if (
          !previous ||
          candidate.observedAt >= previous.observedAt
        ) {
          candidates.set(candidate.postId, candidate)
        }
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

  return [...candidates.values()]
}

/** Extract Bio (primary X) npub candidates from allowlisted GraphQL tweets. */
export function extractObservedXBioCandidates(
  payload: unknown,
  sourceOperation: string,
  observedAt = Date.now(),
): ObservedXBioCandidate[] {
  if (!isAllowedXOperation(sourceOperation) || !Number.isSafeInteger(observedAt)) {
    return []
  }

  const candidates = new Map<string, ObservedXBioCandidate>()
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
      const candidate = extractXBioCandidateFromTweet(item.value, observedAt)
      if (candidate) {
        const previous = candidates.get(candidate.twitterId)
        if (!previous || isPreferredBioCandidate(candidate, previous)) {
          candidates.set(candidate.twitterId, candidate)
        }
      }
    } else {
      // Bare User nodes (UserByScreenName / UsersByRestIds) carry
      // legacy.description without a carrier tweet.
      const userCandidate = extractXBioCandidateFromUser(item.value, observedAt)
      if (userCandidate) {
        const previous = candidates.get(userCandidate.twitterId)
        if (!previous || isPreferredBioCandidate(userCandidate, previous)) {
          candidates.set(userCandidate.twitterId, userCandidate)
        }
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

  return [...candidates.values()]
}

export function installXIdentityObserver(
  target: Window = window,
): InstalledObserver {
  const pagePort = ensurePageWorldPagePort(target)
  const pending = new Map<string, ObservedXIdentity>()
  const pendingPosts = new Map<string, XPostChromeInput>()
  const pendingProofs = new Map<string, ObservedXProofCandidate>()
  const pendingBios = new Map<string, ObservedXBioCandidate>()
  let flushTimer: number | undefined
  let stopped = false
  const jsonTrustFilter = createJsonTrustFilterController(target, {
    post: (data) => pagePort.post(data),
    subscribe: (handler) => pagePort.subscribe(handler),
  })

  const flush = (): void => {
    flushTimer = undefined
    if (stopped) return

    if (pending.size > 0) {
      const observations = mergeDocumentBanners(
        [...pending.values()].slice(0, MAX_OBSERVATIONS_PER_MESSAGE),
        target.document,
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

    if (pendingProofs.size > 0) {
      const candidates = [...pendingProofs.values()].slice(
        0,
        MAX_X_PROOF_CANDIDATES_PER_MESSAGE,
      )
      for (const candidate of candidates) {
        pendingProofs.delete(candidate.postId)
      }
      pagePort.post(createObservedXProofMessage(candidates))
    }

    if (pendingBios.size > 0) {
      const candidates = [...pendingBios.values()].slice(
        0,
        MAX_X_BIO_CANDIDATES_PER_MESSAGE,
      )
      for (const candidate of candidates) {
        pendingBios.delete(candidate.twitterId)
      }
      pagePort.post(createObservedXBioMessage(candidates))
    }

    if (
      pending.size > 0 ||
      pendingPosts.size > 0 ||
      pendingProofs.size > 0 ||
      pendingBios.size > 0
    ) {
      scheduleFlush()
    }
  }

  const scheduleFlush = (): void => {
    if (flushTimer !== undefined || stopped) return
    flushTimer = target.setTimeout(flush, OBSERVER_LIMITS.flushIntervalMs)
  }

  const accept = (observations: readonly ObservedXIdentity[]): void => {
    const withBanners = mergeDocumentBanners(observations, target.document)
    for (const observation of withBanners) {
      const key = `${observation.twitterId}:${observation.handle}`
      const previous = pending.get(key)
      if (!previous && pending.size >= OBSERVER_LIMITS.maxPendingObservations) {
        continue
      }
      pending.set(key, {
        ...(previous ?? {}),
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

  const acceptProofs = (candidates: readonly ObservedXProofCandidate[]): void => {
    for (const candidate of candidates) {
      const previous = pendingProofs.get(candidate.postId)
      if (
        !previous &&
        pendingProofs.size >= OBSERVER_LIMITS.maxPendingObservations
      ) {
        continue
      }
      if (!previous || candidate.observedAt >= previous.observedAt) {
        pendingProofs.set(candidate.postId, candidate)
      }
    }
    scheduleFlush()
  }

  const acceptBios = (candidates: readonly ObservedXBioCandidate[]): void => {
    for (const candidate of candidates) {
      const previous = pendingBios.get(candidate.twitterId)
      if (
        !previous &&
        pendingBios.size >= OBSERVER_LIMITS.maxPendingObservations
      ) {
        continue
      }
      if (!previous || isPreferredBioCandidate(candidate, previous)) {
        pendingBios.set(candidate.twitterId, candidate)
      }
    }
    scheduleFlush()
  }

  const acceptPayload = (payload: unknown, operation: string): void => {
    accept(extractObservedXIdentities(payload, operation))
    acceptPosts(extractObservedXPosts(payload, operation))
    acceptProofs(extractObservedXProofCandidates(payload, operation))
    acceptBios(extractObservedXBioCandidates(payload, operation))
  }

  const inspectOperation = async (
    response: Response,
    operation: string,
  ): Promise<void> => {
    const payload = await readJsonPayload(response)
    if (payload !== undefined) acceptPayload(payload, operation)
  }

  const inspectXhrOperation = (
    xhr: XMLHttpRequest,
    operation: string,
  ): void => {
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

  const originalFetch = target.fetch

  const wrappedFetch: typeof fetch = async (input, init) => {
    const requestUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    const response = await originalFetch.call(target, input, init)
    const operation = operationNameFromUrl(requestUrl, target.location.href)
    if (operation) {
      // Observe identities on the original payload (before hide filtering).
      void inspectOperation(response, operation)
      return jsonTrustFilter.maybeFilterResponse(response, operation, target)
    }
    return response
  }
  target.fetch = wrappedFetch

  const xhrMetadata = new WeakMap<XMLHttpRequest, { operation?: string }>()
  const xhrPrototype = (target as Window & typeof globalThis).XMLHttpRequest
    .prototype
  const originalOpen = xhrPrototype.open
  const originalSend = xhrPrototype.send

  xhrPrototype.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ): void {
    const href = String(url)
    const operation = operationNameFromUrl(href, target.location.href)
    xhrMetadata.set(this, { operation })
    Reflect.apply(originalOpen, this, [method, url, ...rest])
  } as typeof xhrPrototype.open

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
    if (meta?.operation) {
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

        const computeFilter = (): void => {
          if (computed || xhr.readyState !== 4) return
          computed = true
          try {
            if (xhr.status < 200 || xhr.status >= 300) return
            const raw = nativeResponseTextGet.call(xhr)
            if (!raw || typeof raw !== 'string') return
            const payload = JSON.parse(raw) as unknown
            const filtered = jsonTrustFilter.filterPayloadSync(payload)
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
      jsonTrustFilter.uninstall()
      if (flushTimer !== undefined) target.clearTimeout(flushTimer)
      if (target.fetch === wrappedFetch) target.fetch = originalFetch
      if (xhrPrototype.open !== originalOpen) xhrPrototype.open = originalOpen
      if (xhrPrototype.send !== originalSend) xhrPrototype.send = originalSend
      pending.clear()
      pendingPosts.clear()
      pendingProofs.clear()
      pendingBios.clear()
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

function readProfileBannerPath(
  value: Record<string, unknown>,
): string | undefined {
  const legacy = isRecord(value.legacy) ? value.legacy : undefined
  const banner = isRecord(value.banner) ? value.banner : undefined
  const candidates: unknown[] = [
    legacy?.profile_banner_url,
    value.profile_banner_url,
    banner?.image_url,
  ]
  if (legacy) {
    for (const extra of Object.values(legacy)) {
      if (typeof extra === 'string') candidates.push(extra)
    }
  }
  for (const extra of Object.values(value)) {
    if (typeof extra === 'string') candidates.push(extra)
  }
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate.trim() === '') continue
    const bannerPath = normalizeXProfileBannerPath(candidate)
    if (bannerPath) return bannerPath
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
