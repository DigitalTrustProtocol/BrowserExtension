/**
 * MAIN-world state + helpers for rewriting timeline GraphQL JSON (hide only)
 * and emitting collapse / demoted-ad decorate for sync DOM.
 */

import {
  DEFAULT_TRUST_FILTERS,
  normalizeTrustFilters,
  type TrustFilters,
} from '../shared/x-augmentation'
import {
  anyJsonTimelineFilterActive,
  anyHideTrustFilterActive,
  backfillFilteredTimeline,
  collectTimelineTweetSubjects,
  countTimelineContentEntries,
  hidesAllOrganicTimelineItems,
  isTimelineJsonFilterOperation,
  processTimelineGraphqlPayload,
  relabelPromotedEntriesAsTweets,
  resolutionKey,
  TIMELINE_BACKFILL_MIN_ITEMS,
  timelineHasOrganicContent,
  type JsonFilterResolutionMap,
  type JsonTrustResolution,
  type TimelinePageFetcher,
} from '../shared/timeline-json-filter'
import {
  JSON_TRUST_FILTER_SOURCE,
  JSON_TRUST_FILTER_VERSION,
  parseJsonTrustFilterPageMessage,
  type JsonTrustFilterResolveRequest,
} from '../shared/json-trust-filter-messages'
import { readTrustFiltersDataset } from '../shared/trust-filters-dataset'
import {
  writeTimelineDecorateDataset,
  type TimelineDecorateState,
} from '../shared/timeline-decorate'

/** Trust batch + SW wake can exceed a few hundred ms on cold start. */
const RESOLVE_TIMEOUT_MS = 2_500
/** Wait for content to push storage filters before the first timeline rewrite. */
const CONFIG_WAIT_MS = 1_200

export interface JsonTrustFilterController {
  enabled: boolean
  filters: TrustFilters
  resolutions: JsonFilterResolutionMap
  applyConfig(message: {
    enabled: boolean
    filters: unknown
    resolutions?: Record<string, JsonTrustResolution>
  }): void
  mergeResolutions(resolutions: Record<string, JsonTrustResolution>): void
  /**
   * Sync path for XHR (no await). Uses cache + Hide-all fast path.
   * Always publishes collapse/demoted-ad decorate when relevant.
   */
  filterPayloadSync(
    payload: unknown,
    options?: { fetchNextPage?: TimelinePageFetcher },
  ): { payload: unknown; removed: number; pagesFetched?: number } | undefined
  maybeFilterResponse(
    response: Response,
    operation: string,
    target: Window,
    options?: { fetchNextPage?: TimelinePageFetcher },
  ): Promise<Response>
  uninstall(): void
}

export function createJsonTrustFilterController(
  target: Window = window,
): JsonTrustFilterController {
  const state: {
    enabled: boolean
    filters: TrustFilters
    resolutions: JsonFilterResolutionMap
    receivedConfig: boolean
  } = {
    enabled: true,
    filters: { ...DEFAULT_TRUST_FILTERS },
    resolutions: {},
    receivedConfig: false,
  }

  const pending = new Map<
    string,
    {
      resolve: (value: Record<string, JsonTrustResolution>) => void
      timer: number
    }
  >()
  const configWaiters: Array<() => void> = []

  const notifyConfig = (): void => {
    while (configWaiters.length > 0) configWaiters.shift()?.()
  }

  const waitForConfig = (): Promise<void> => {
    if (state.receivedConfig) return Promise.resolve()
    return new Promise((resolve) => {
      const timer = target.setTimeout(() => {
        const index = configWaiters.indexOf(done)
        if (index >= 0) configWaiters.splice(index, 1)
        resolve()
      }, CONFIG_WAIT_MS)
      const done = (): void => {
        target.clearTimeout(timer)
        resolve()
      }
      configWaiters.push(done)
    })
  }

  const onMessage = (event: MessageEvent<unknown>): void => {
    const message = parseJsonTrustFilterPageMessage(event.data)
    if (!message) return
    if (message.type === 'config') {
      state.enabled = message.enabled
      state.filters = normalizeTrustFilters({ trustFilters: message.filters })
      if (message.resolutions) {
        Object.assign(state.resolutions, message.resolutions)
      }
      state.receivedConfig = true
      notifyConfig()
      return
    }
    if (message.type === 'resolve-result') {
      Object.assign(state.resolutions, message.resolutions)
      const waiter = pending.get(message.requestId)
      if (!waiter) return
      pending.delete(message.requestId)
      target.clearTimeout(waiter.timer)
      waiter.resolve(message.resolutions)
    }
  }

  target.addEventListener('message', onMessage)

  const requestResolutions = (
    subjects: Array<{ kind: 'user' | 'post'; id: string }>,
  ): Promise<Record<string, JsonTrustResolution>> => {
    const missing = subjects.filter((subject) => {
      const key = resolutionKey(subject.kind, subject.id)
      return state.resolutions[key] === undefined
    })
    if (missing.length === 0) return Promise.resolve({})

    const requestId = `jtf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const request: JsonTrustFilterResolveRequest = {
      source: JSON_TRUST_FILTER_SOURCE,
      version: JSON_TRUST_FILTER_VERSION,
      type: 'resolve-request',
      requestId,
      subjects: missing.slice(0, 80),
    }

    return new Promise((resolve) => {
      const timer = target.setTimeout(() => {
        pending.delete(requestId)
        resolve({})
      }, RESOLVE_TIMEOUT_MS)
      pending.set(requestId, { resolve, timer })
      target.postMessage(request, target.location.origin)
    })
  }

  const publishDecorate = (patch: TimelineDecorateState): void => {
    if (
      Object.keys(patch.collapse).length === 0 &&
      patch.demotedAds.length === 0
    ) {
      return
    }
    writeTimelineDecorateDataset(target.document, patch)
  }

  const finishProcess = (
    processed: ReturnType<typeof processTimelineGraphqlPayload>,
    options?: { fetchNextPage?: TimelinePageFetcher },
  ): {
    payload: unknown
    removed: number
    changed: boolean
    pagesFetched?: number
  } => {
    let payload = processed.payload
    let removed = processed.removed
    let collapse = { ...processed.collapse }
    let demotedAds = [...processed.demotedAds]
    let changed = processed.changed
    let pagesFetched = 0

    if (
      anyHideTrustFilterActive(state.filters) &&
      removed > 0 &&
      options?.fetchNextPage &&
      countTimelineContentEntries(payload) < TIMELINE_BACKFILL_MIN_ITEMS
    ) {
      const backfilled = backfillFilteredTimeline({
        payload,
        removed,
        filters: state.filters,
        resolutions: state.resolutions,
        fetchNextPage: options.fetchNextPage,
      })
      payload = backfilled.payload
      removed = backfilled.removed
      pagesFetched = backfilled.pagesFetched
      Object.assign(collapse, backfilled.collapse)
      demotedAds = [...new Set([...demotedAds, ...backfilled.demotedAds])]
      changed = changed || backfilled.changed
    } else if (
      anyHideTrustFilterActive(state.filters) &&
      removed > 0 &&
      countTimelineContentEntries(payload) > 0 &&
      !timelineHasOrganicContent(payload)
    ) {
      const more = relabelPromotedEntriesAsTweets(payload)
      if (more.length > 0) {
        demotedAds = [...new Set([...demotedAds, ...more])]
        changed = true
      }
    }

    publishDecorate({ collapse, demotedAds })
    return { payload, removed, changed, pagesFetched }
  }

  return {
    get enabled() {
      return state.enabled
    },
    get filters() {
      return state.filters
    },
    get resolutions() {
      return state.resolutions
    },

    applyConfig(message) {
      state.enabled = message.enabled
      state.filters = normalizeTrustFilters({ trustFilters: message.filters })
      if (message.resolutions) {
        Object.assign(state.resolutions, message.resolutions)
      }
      state.receivedConfig = true
      notifyConfig()
    },

    mergeResolutions(resolutions) {
      Object.assign(state.resolutions, resolutions)
    },

    filterPayloadSync(payload, options) {
      const fromDom = readTrustFiltersDataset(target.document)
      if (fromDom) {
        state.filters = fromDom
        state.receivedConfig = true
      }
      if (!state.receivedConfig || !state.enabled) return undefined
      if (!anyJsonTimelineFilterActive(state.filters)) return undefined

      const processed = processTimelineGraphqlPayload(payload, {
        filters: state.filters,
        resolutions: state.resolutions,
      })

      // HomeTimeline is XHR/sync — cannot await trust here. Fire resolve so
      // content seeds trustStore and refresh collapse labels when ready.
      if (!hidesAllOrganicTimelineItems(state.filters)) {
        void requestResolutions(collectTimelineTweetSubjects(processed.payload))
      }

      const finished = finishProcess(processed, options)
      // Collapse decorate is published even when JSON is unchanged.
      if (!finished.changed) return undefined
      return {
        payload: finished.payload,
        removed: Math.max(finished.removed, 1),
        pagesFetched: finished.pagesFetched,
      }
    },

    async maybeFilterResponse(response, operation, _target, options) {
      if (!isTimelineJsonFilterOperation(operation)) return response
      if (!response.ok) return response

      await waitForConfig()

      const fromDom = readTrustFiltersDataset(target.document)
      if (fromDom) {
        state.filters = fromDom
        state.receivedConfig = true
      }

      if (!state.enabled) return response
      if (!anyJsonTimelineFilterActive(state.filters)) return response

      const contentType = response.headers.get('content-type') ?? ''
      if (!/json/i.test(contentType)) return response

      let text: string
      try {
        text = await response.clone().text()
      } catch {
        return response
      }

      let payload: unknown
      try {
        payload = JSON.parse(text)
      } catch {
        return response
      }

      if (!hidesAllOrganicTimelineItems(state.filters)) {
        const subjects = collectTimelineTweetSubjects(payload)
        await requestResolutions(subjects)
      }

      const processed = processTimelineGraphqlPayload(payload, {
        filters: state.filters,
        resolutions: state.resolutions,
      })
      const finished = finishProcess(processed, options)
      if (!finished.changed) return response

      const headers = new Headers(response.headers)
      headers.delete('content-encoding')
      headers.delete('content-length')
      headers.set('content-type', 'application/json; charset=utf-8')

      return new Response(JSON.stringify(finished.payload), {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    },

    uninstall() {
      target.removeEventListener('message', onMessage)
      for (const waiter of pending.values()) target.clearTimeout(waiter.timer)
      pending.clear()
      configWaiters.length = 0
    },
  }
}
