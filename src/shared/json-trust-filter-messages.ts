/**
 * Page↔content protocol for experimental GraphQL JSON trust filtering.
 */

import type { TrustFilters } from './x-augmentation'
import type { JsonTrustResolution } from './timeline-json-filter'

export const JSON_TRUST_FILTER_SOURCE = 'attentionx-json-trust-filter' as const
export const JSON_TRUST_FILTER_VERSION = 1 as const

export type JsonTrustFilterConfigMessage = {
  source: typeof JSON_TRUST_FILTER_SOURCE
  version: typeof JSON_TRUST_FILTER_VERSION
  type: 'config'
  enabled: boolean
  filters: TrustFilters
  /** Optional seed cache: `user:<id>` / `post:<id>` → resolution */
  resolutions?: Record<string, JsonTrustResolution>
}

export type JsonTrustFilterResolveRequest = {
  source: typeof JSON_TRUST_FILTER_SOURCE
  version: typeof JSON_TRUST_FILTER_VERSION
  type: 'resolve-request'
  requestId: string
  subjects: Array<{ kind: 'user' | 'post'; id: string }>
}

export type JsonTrustFilterResolveResult = {
  source: typeof JSON_TRUST_FILTER_SOURCE
  version: typeof JSON_TRUST_FILTER_VERSION
  type: 'resolve-result'
  requestId: string
  resolutions: Record<string, JsonTrustResolution>
}

export type JsonTrustFilterPageMessage =
  | JsonTrustFilterConfigMessage
  | JsonTrustFilterResolveResult

export type JsonTrustFilterHostMessage = JsonTrustFilterResolveRequest

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function parseJsonTrustFilterPageMessage(
  value: unknown,
): JsonTrustFilterPageMessage | undefined {
  if (!isRecord(value)) return undefined
  if (
    value.source !== JSON_TRUST_FILTER_SOURCE ||
    value.version !== JSON_TRUST_FILTER_VERSION
  ) {
    return undefined
  }
  if (value.type === 'config') {
    if (typeof value.enabled !== 'boolean' || !isRecord(value.filters)) {
      return undefined
    }
    return value as JsonTrustFilterConfigMessage
  }
  if (value.type === 'resolve-result') {
    if (typeof value.requestId !== 'string' || !isRecord(value.resolutions)) {
      return undefined
    }
    return value as JsonTrustFilterResolveResult
  }
  return undefined
}

export function parseJsonTrustFilterHostMessage(
  value: unknown,
): JsonTrustFilterHostMessage | undefined {
  if (!isRecord(value)) return undefined
  if (
    value.source !== JSON_TRUST_FILTER_SOURCE ||
    value.version !== JSON_TRUST_FILTER_VERSION ||
    value.type !== 'resolve-request'
  ) {
    return undefined
  }
  if (typeof value.requestId !== 'string' || !Array.isArray(value.subjects)) {
    return undefined
  }
  return value as JsonTrustFilterResolveRequest
}
