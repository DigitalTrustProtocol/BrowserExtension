/**
 * Page↔content protocol for experimental GraphQL JSON trust filtering.
 */

import { isXNumericId } from './observed-x-identity'
import type { TrustFilters } from './x-augmentation'
import type { JsonTrustResolution } from './timeline-json-filter'

export const JSON_TRUST_FILTER_SOURCE = 'attentionx-json-trust-filter' as const
export const JSON_TRUST_FILTER_VERSION = 1 as const

export const MAX_JSON_TRUST_FILTER_SUBJECTS = 80
export const MAX_JSON_TRUST_FILTER_REQUEST_ID_CHARS = 64

export type JsonTrustFilterConfigMessage = {
  source: typeof JSON_TRUST_FILTER_SOURCE
  version: typeof JSON_TRUST_FILTER_VERSION
  type: 'config'
  enabled: boolean
  filters: TrustFilters
  /** Optional seed cache: `user:<id>` / `post:<id>` → resolution */
  resolutions?: Record<string, JsonTrustResolution>
  /** Drop cached resolutions (follow-trust band / graph changed). */
  resetResolutions?: boolean
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

function isTrustResolution(value: unknown): value is JsonTrustResolution {
  return (
    value === 'trusted' ||
    value === 'mixed' ||
    value === 'distrusted' ||
    value === 'none'
  )
}

function sanitizeSubjects(
  value: unknown,
): Array<{ kind: 'user' | 'post'; id: string }> | undefined {
  if (!Array.isArray(value) || value.length > MAX_JSON_TRUST_FILTER_SUBJECTS) {
    return undefined
  }
  const subjects: Array<{ kind: 'user' | 'post'; id: string }> = []
  for (const entry of value) {
    if (!isRecord(entry)) return undefined
    if (
      (entry.kind !== 'user' && entry.kind !== 'post') ||
      !isXNumericId(entry.id)
    ) {
      return undefined
    }
    subjects.push({ kind: entry.kind, id: entry.id })
  }
  return subjects
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
    if (
      typeof value.requestId !== 'string' ||
      value.requestId.length === 0 ||
      value.requestId.length > MAX_JSON_TRUST_FILTER_REQUEST_ID_CHARS ||
      !isRecord(value.resolutions)
    ) {
      return undefined
    }
    for (const resolution of Object.values(value.resolutions)) {
      if (!isTrustResolution(resolution)) return undefined
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
  if (
    typeof value.requestId !== 'string' ||
    value.requestId.length === 0 ||
    value.requestId.length > MAX_JSON_TRUST_FILTER_REQUEST_ID_CHARS
  ) {
    return undefined
  }
  const subjects = sanitizeSubjects(value.subjects)
  if (!subjects) return undefined
  return {
    source: JSON_TRUST_FILTER_SOURCE,
    version: JSON_TRUST_FILTER_VERSION,
    type: 'resolve-request',
    requestId: value.requestId,
    subjects,
  }
}
