import type { TrustQueryResult, TrustResolution } from '../graph'
import { resolutionFromCounts } from '../graph'
import type { TrustTone } from './types'

export interface TrustSummary {
  resolution: TrustResolution
  tone: TrustTone
  /** The operator's own statement, when one exists. */
  direct?: 1 | 0 | -1
  /** Slot context of the operator's own statement (legacy global is ''). */
  directContext?: string
  /** Hitting degree from IndexResolver (Me=0, direct=1). */
  degree?: number
  trustCount: number
  distrustCount: number
  /** Unused leftover of TrustPath counting; always 0. */
  paths: number
  truncated: boolean
}

export function toneForResolution(resolution: TrustResolution): TrustTone {
  if (resolution === 'trusted') return 'trust'
  if (resolution === 'distrusted') return 'misleading'
  if (resolution === 'mixed') return 'question'
  return 'neutral'
}

/** Percent tone: trust/(trust+distrust); green ≥80%, yellow ≥30%, else red. */
export function toneForTrustRatio(
  trust: number,
  distrust: number,
  connected: boolean,
): TrustTone {
  return toneForResolution(resolutionFromCounts(trust, distrust, connected))
}

export function summarizeTrust(result: TrustQueryResult): TrustSummary {
  const trustCount =
    typeof result.trust === 'number'
      ? result.trust
      : result.statements.filter((s) => s.value === 1).length
  const distrustCount =
    typeof result.distrust === 'number'
      ? result.distrust
      : result.statements.filter((s) => s.value === -1).length

  const degree =
    result.connected && typeof result.degree === 'number'
      ? result.degree
      : undefined

  const direct =
    result.direct?.value === 1 ||
    result.direct?.value === -1 ||
    result.direct?.value === 0
      ? result.direct.value
      : undefined

  const resolution =
    result.resolution ??
    resolutionFromCounts(
      trustCount,
      distrustCount,
      result.connected ?? trustCount + distrustCount > 0,
    )

  return {
    resolution,
    tone: toneForTrustRatio(
      trustCount,
      distrustCount,
      result.connected ?? trustCount + distrustCount > 0,
    ),
    ...(direct !== undefined ? { direct } : {}),
    ...(direct !== undefined ? { directContext: result.direct?.context ?? '' } : {}),
    ...(degree !== undefined ? { degree } : {}),
    trustCount,
    distrustCount,
    paths: 0,
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

/** Chip icon color: only when the operator has a direct trust/distrust statement. */
export function chipToneForSummary(summary: TrustSummary): TrustTone {
  if (summary.direct === 1) return 'trust'
  if (summary.direct === -1) return 'misleading'
  return 'neutral'
}
