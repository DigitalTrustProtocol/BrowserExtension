import {
  DEFAULT_FOLLOW_TRUST_BAND,
  type FollowTrustBand,
  type FollowTrustResolution,
} from './wot-follow-trust-threshold'

/** Trust + distrust. Neutrals are not scored. */
export function trustScoredCount(trust: number, distrust: number): number {
  return trust + distrust
}

/**
 * Share percent: `Math.round((trust * 100) / scored)`.
 * Null when there are no Trust or Distrust edges.
 */
export function trustScorePercent(
  trust: number,
  distrust: number,
): number | null {
  const scored = trustScoredCount(trust, distrust)
  if (scored <= 0) return null
  return Math.round((trust * 100) / scored)
}

/** Green hop / Trusted cut: rounded share percent at or above green. */
export function meetsFollowTrustGreen(
  trust: number,
  distrust: number,
  green: number,
): boolean {
  const percent = trustScorePercent(trust, distrust)
  return percent !== null && percent >= green
}

/**
 * Band resolution from hitting-degree counts.
 * Disconnected or unscored → `none`.
 */
export function trustScoreResolution(
  trust: number,
  distrust: number,
  connected: boolean,
  band: FollowTrustBand = DEFAULT_FOLLOW_TRUST_BAND,
): FollowTrustResolution {
  if (!connected) return 'none'
  const percent = trustScorePercent(trust, distrust)
  if (percent === null) return 'none'
  if (percent >= band.green) return 'trusted'
  if (percent < band.red) return 'distrusted'
  return 'mixed'
}
