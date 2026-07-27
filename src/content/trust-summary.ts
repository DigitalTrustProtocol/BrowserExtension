import type { TrustQueryResult, TrustResolution } from '../graph'
import type { TrustTone } from './types'

export interface TrustSummary {
  resolution: TrustResolution
  tone: TrustTone
  /** The operator's own statement, when one exists. */
  direct?: 1 | -1
  /** Fewest positive pubkey hops from the operator to any evidence author. */
  degree?: number
  trustCount: number
  distrustCount: number
  paths: number
  truncated: boolean
}

export function toneForResolution(resolution: TrustResolution): TrustTone {
  if (resolution === 'trusted') return 'trust'
  if (resolution === 'distrusted') return 'misleading'
  if (resolution === 'mixed') return 'question'
  return 'neutral'
}

export function summarizeTrust(result: TrustQueryResult): TrustSummary {
  let trustCount = 0
  let distrustCount = 0
  let degree: number | undefined

  for (const statement of result.statements) {
    if (statement.value === 1) trustCount += 1
    else if (statement.value === -1) distrustCount += 1
    if (degree === undefined || statement.distance < degree) {
      degree = statement.distance
    }
  }

  const direct =
    result.direct?.value === 1 || result.direct?.value === -1
      ? result.direct.value
      : undefined

  return {
    resolution: result.resolution,
    tone: toneForResolution(result.resolution),
    ...(direct !== undefined ? { direct } : {}),
    ...(degree !== undefined ? { degree } : {}),
    trustCount,
    distrustCount,
    paths: result.paths.length,
    truncated: result.truncated,
  }
}

export function emptyTrustSummary(): TrustSummary {
  return {
    resolution: 'none',
    tone: 'neutral',
    trustCount: 0,
    distrustCount: 0,
    paths: 0,
    truncated: false,
  }
}
