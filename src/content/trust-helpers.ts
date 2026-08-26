import type { TrustQueryResult, TrustResolution } from '../graph'
import {
  contextField,
  trustQueryContextForSubject,
} from '../shared/trust-context'
import {
  canonicalTwitterAccountSubject,
  canonicalTwitterPostSubject,
} from '../shared/x-identity'
import { toneForResolution, type TrustSummary } from './trust-summary'
import type { Target, TrustDescriptor, TrustTone, Verdict } from './types'

export function trustDescriptor(target: Target): TrustDescriptor | undefined {
  if (target.type === 'profile') {
    if (!target.twitterId) return undefined
    const subject = {
      type: 'i' as const,
      value: canonicalTwitterAccountSubject(target.twitterId),
    }
    return {
      subject,
      ...contextField(trustQueryContextForSubject(subject)),
    }
  }

  const subject = {
    type: 'i' as const,
    value: canonicalTwitterPostSubject(target.id),
  }
  return {
    subject,
    ...contextField(trustQueryContextForSubject(subject)),
  }
}

/** Cancel must target the winning slot, including legacy global (`''`). */
export function cancelContextFromSummary(
  summary: TrustSummary,
): string | undefined {
  return summary.directContext
}

export function publishValueForVerdict(
  verdict: Verdict,
): '1' | '0' | '-1' | undefined {
  if (verdict === 'trust') return '1'
  if (verdict === 'misleading') return '-1'
  if (verdict === 'neutral') return '0'
  return undefined
}

export interface TrustDisplay {
  resolution: TrustResolution
  tone: TrustTone
  evidence?: 'direct' | 'network'
  freshness: {
    unit: 'now' | 'minute' | 'hour' | 'day'
    count?: number
  }
  truncated: boolean
}

export function trustDisplay(
  result: TrustQueryResult,
  nowSeconds = Math.floor(Date.now() / 1_000),
): TrustDisplay {
  const ageSeconds = Math.max(0, nowSeconds - result.computedAt)
  let freshness: TrustDisplay['freshness']
  if (ageSeconds < 60) {
    freshness = { unit: 'now' }
  } else if (ageSeconds < 3_600) {
    freshness = { unit: 'minute', count: Math.floor(ageSeconds / 60) }
  } else if (ageSeconds < 86_400) {
    freshness = { unit: 'hour', count: Math.floor(ageSeconds / 3_600) }
  } else {
    freshness = { unit: 'day', count: Math.floor(ageSeconds / 86_400) }
  }

  return {
    resolution: result.resolution,
    tone: toneForResolution(result.resolution),
    ...(result.direct
      ? { evidence: 'direct' as const }
      : result.statements.length > 0
        ? { evidence: 'network' as const }
        : {}),
    freshness,
    truncated: result.truncated,
  }
}
