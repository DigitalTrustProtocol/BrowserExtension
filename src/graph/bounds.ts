import type { GraphBounds, ResolveBounds } from './types'

/** Defaults for IndexResolver / QUERY_TRUST (fan-out caps do not apply). */
export const DEFAULT_RESOLVE_BOUNDS: Readonly<ResolveBounds> = Object.freeze({
  maxDepth: 4,
})

/**
 * Defaults for WoT sync expansion when callers pass GraphBounds-shaped limits.
 * Relay synchronizer also has its own DEFAULT_GRAPH_SYNC_LIMITS.
 */
export const DEFAULT_GRAPH_BOUNDS: Readonly<GraphBounds> = Object.freeze({
  maxDepth: 4,
  maxAuthorsPerLevel: 250,
  maxTotalAuthors: 1_000,
  maxEvents: 5_000,
})

function bound(
  name: string,
  value: number | undefined,
  fallback: number,
): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`)
  }
  return resolved
}

export function normalizeResolveBounds(
  bounds: Partial<ResolveBounds> = {},
): ResolveBounds {
  return {
    maxDepth: bound('maxDepth', bounds.maxDepth, DEFAULT_RESOLVE_BOUNDS.maxDepth),
  }
}

export function normalizeBounds(
  bounds: Partial<GraphBounds> = {},
): GraphBounds {
  return {
    maxDepth: bound('maxDepth', bounds.maxDepth, DEFAULT_GRAPH_BOUNDS.maxDepth),
    maxAuthorsPerLevel: bound(
      'maxAuthorsPerLevel',
      bounds.maxAuthorsPerLevel,
      DEFAULT_GRAPH_BOUNDS.maxAuthorsPerLevel,
    ),
    maxTotalAuthors: bound(
      'maxTotalAuthors',
      bounds.maxTotalAuthors,
      DEFAULT_GRAPH_BOUNDS.maxTotalAuthors,
    ),
    maxEvents: bound(
      'maxEvents',
      bounds.maxEvents,
      DEFAULT_GRAPH_BOUNDS.maxEvents,
    ),
  }
}
