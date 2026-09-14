import type { TrustQueryResult, TrustResolution } from '../graph'
import { trustScoreResolution } from '../shared/trust-score'
import type { TrustTone } from './types'
import type { FollowTrustBand } from '../shared/wot-follow-trust-threshold'

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
  /** Hitting-degree Neutral count. Not in the percent. Missing means 0. */
  neutralCount?: number
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

/** Share percent vs the follow-trust band (defaults 25 / 75). */
export function toneForTrustRatio(
  trust: number,
  distrust: number,
  connected: boolean,
  band?: FollowTrustBand,
): TrustTone {
  return toneForResolution(
    trustScoreResolution(trust, distrust, connected, band),
  )
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
  const neutralCount =
    typeof result.neutral === 'number'
      ? result.neutral
      : result.statements.filter((s) => s.value === 0).length

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

  const band = {
    red: result.followTrustRed,
    green: result.followTrustThreshold,
  }
  const connected = result.connected ?? trustCount + distrustCount > 0
  const resolution =
    result.resolution ??
    trustScoreResolution(trustCount, distrustCount, connected, band)

  return {
    resolution,
    tone: toneForResolution(resolution),
    ...(direct !== undefined ? { direct } : {}),
    ...(direct !== undefined ? { directContext: result.direct?.context ?? '' } : {}),
    ...(degree !== undefined ? { degree } : {}),
    trustCount,
    distrustCount,
    neutralCount,
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
    neutralCount: 0,
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
