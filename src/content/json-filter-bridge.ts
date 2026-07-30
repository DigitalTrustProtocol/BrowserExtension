/**
 * Content-script bridge for experimental GraphQL JSON trust filtering.
 * Pushes hide filters + resolves trust for page-world fetch rewriting.
 */

import type { TrustResolution } from '../graph'
import {
  BACKGROUND_API_VERSION,
  MAX_TRUST_BATCH_ITEMS,
  type QueryTrustBatchResult,
} from '../shared/contracts'
import {
  JSON_TRUST_FILTER_SOURCE,
  JSON_TRUST_FILTER_VERSION,
  parseJsonTrustFilterHostMessage,
  type JsonTrustFilterConfigMessage,
  type JsonTrustFilterResolveResult,
} from '../shared/json-trust-filter-messages'
import {
  resolutionKey,
  type JsonTrustResolution,
} from '../shared/timeline-json-filter'
import type { TrustFilters } from '../shared/x-augmentation'
import { writeTrustFiltersDataset } from '../shared/trust-filters-dataset'
import { clearTimelineDecorateDataset } from '../shared/timeline-decorate'
import {
  canonicalTwitterAccountSubject,
  canonicalTwitterPostSubject,
} from '../shared/x-identity'
import { descriptorKey, sendMessage, trustStore } from './trust-store'
import type { TrustDescriptor } from './types'

/** Flip to re-enable DOM hide/collapse while JSON filtering is experimental. */
export const UI_TIMELINE_FILTERING_ENABLED = false

/** JSON GraphQL hide filtering master switch (page-world rewrite). */
export const JSON_TIMELINE_FILTERING_ENABLED = true

export interface JsonTrustFilterBridge {
  pushConfig(filters: TrustFilters): void
  pushResolutions(
    resolutions: Record<string, JsonTrustResolution>,
  ): void
  /** Called after JSON resolve seeds trustStore (refresh collapse labels). */
  setOnStoreSeeded(callback: (() => void) | undefined): void
  stop(): void
}

export function startJsonTrustFilterBridge(
  targetWindow: Window = window,
): JsonTrustFilterBridge {
  let stopped = false
  let lastFilters: TrustFilters | undefined
  let onStoreSeeded: (() => void) | undefined

  const publishConfig = (filters: TrustFilters): void => {
    if (stopped) return
    lastFilters = filters
    // Stale collapse/ad decorate must not survive filter changes.
    clearTimelineDecorateDataset(targetWindow.document)
    writeTrustFiltersDataset(targetWindow.document, filters)
    const message: JsonTrustFilterConfigMessage = {
      source: JSON_TRUST_FILTER_SOURCE,
      version: JSON_TRUST_FILTER_VERSION,
      type: 'config',
      enabled: JSON_TIMELINE_FILTERING_ENABLED,
      filters,
    }
    targetWindow.postMessage(message, targetWindow.location.origin)
  }

  const onMessage = (event: MessageEvent<unknown>): void => {
    if (stopped) return
    // Page MAIN-world posts may not always match event.source === window.
    const request = parseJsonTrustFilterHostMessage(event.data)
    if (!request) return
    void resolveAndReply(request.requestId, request.subjects)
  }

  const resolveAndReply = async (
    requestId: string,
    subjects: Array<{ kind: 'user' | 'post'; id: string }>,
  ): Promise<void> => {
    const resolutions: Record<string, JsonTrustResolution> = {}
    const items = subjects.slice(0, MAX_TRUST_BATCH_ITEMS).map((subject) => {
      const filterKey = resolutionKey(subject.kind, subject.id)
      const descriptor: TrustDescriptor = {
        subject: {
          type: 'i',
          value:
            subject.kind === 'user'
              ? canonicalTwitterAccountSubject(subject.id)
              : canonicalTwitterPostSubject(subject.id),
        },
        context: '',
      }
      return {
        filterKey,
        storeKey: descriptorKey(descriptor),
        descriptor,
      }
    })

    try {
      if (items.length > 0) {
        const response = await sendMessage<QueryTrustBatchResult>({
          type: 'QUERY_TRUST_BATCH',
          version: BACKGROUND_API_VERSION,
          items: items.map((item) => ({
            key: item.filterKey,
            subject: item.descriptor.subject,
            context: item.descriptor.context,
          })),
        })
        const seedEntries: Array<{
          key: string
          descriptor: TrustDescriptor
          result: NonNullable<(typeof response.results)[string]>
        }> = []
        for (const item of items) {
          const result = response.results[item.filterKey]
          if (result) {
            seedEntries.push({
              key: item.storeKey,
              descriptor: item.descriptor,
              result,
            })
            const resolution = result.resolution as TrustResolution
            if (
              resolution === 'trusted' ||
              resolution === 'mixed' ||
              resolution === 'distrusted' ||
              resolution === 'none'
            ) {
              resolutions[item.filterKey] = resolution
            }
          }
        }
        if (seedEntries.length > 0) {
          trustStore.seed(seedEntries)
          onStoreSeeded?.()
        }
      }
    } catch {
      // Timeouts in page-world still apply; leave resolutions empty.
    }

    if (stopped) return
    const message: JsonTrustFilterResolveResult = {
      source: JSON_TRUST_FILTER_SOURCE,
      version: JSON_TRUST_FILTER_VERSION,
      type: 'resolve-result',
      requestId,
      resolutions,
    }
    targetWindow.postMessage(message, targetWindow.location.origin)
  }

  targetWindow.addEventListener('message', onMessage)

  return {
    pushConfig(filters) {
      publishConfig(filters)
    },
    pushResolutions(resolutions) {
      if (stopped || !lastFilters) return
      const message: JsonTrustFilterConfigMessage = {
        source: JSON_TRUST_FILTER_SOURCE,
        version: JSON_TRUST_FILTER_VERSION,
        type: 'config',
        enabled: JSON_TIMELINE_FILTERING_ENABLED,
        filters: lastFilters,
        resolutions,
      }
      targetWindow.postMessage(message, targetWindow.location.origin)
    },
    setOnStoreSeeded(callback) {
      onStoreSeeded = callback
    },
    stop() {
      stopped = true
      onStoreSeeded = undefined
      targetWindow.removeEventListener('message', onMessage)
    },
  }
}
