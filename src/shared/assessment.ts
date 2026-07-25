import type { Event } from 'nostr-tools'
import {
  ATTENTIONX_EVENT_KIND,
  ATTENTIONX_LABEL_NAMESPACE,
  type AssessmentVerdict,
  type ContextSummary,
} from './contracts'

const VERDICTS = new Set<AssessmentVerdict>([
  'trust',
  'question',
  'misleading',
])

export function getAssessmentVerdict(
  event: Event,
): AssessmentVerdict | undefined {
  if (event.kind !== ATTENTIONX_EVENT_KIND) {
    return undefined
  }

  const label = event.tags.find(
    ([name, value, namespace]) =>
      name === 'l' &&
      namespace === ATTENTIONX_LABEL_NAMESPACE &&
      VERDICTS.has(value as AssessmentVerdict),
  )

  return label?.[1] as AssessmentVerdict | undefined
}

export function getAssessmentTargets(event: Event): string[] {
  return event.tags
    .filter(([name, value]) => name === 'r' && Boolean(value))
    .map(([, value]) => value)
}

export function summarizeAssessments(
  events: Event[],
  targetUrls: string[],
  myPubkey?: string,
): Record<string, ContextSummary> {
  const targets = new Set(targetUrls)
  const latestByAuthorAndTarget = new Map<string, Event>()

  for (const event of events) {
    if (!getAssessmentVerdict(event)) {
      continue
    }

    for (const targetUrl of getAssessmentTargets(event)) {
      if (!targets.has(targetUrl)) {
        continue
      }

      const key = `${targetUrl}:${event.pubkey}`
      const previous = latestByAuthorAndTarget.get(key)
      if (!previous || event.created_at > previous.created_at) {
        latestByAuthorAndTarget.set(key, event)
      }
    }
  }

  const summaries: Record<string, ContextSummary> = Object.fromEntries(
    targetUrls.map((targetUrl) => [
      targetUrl,
      {
        targetUrl,
        counts: { trust: 0, question: 0, misleading: 0 },
        contributors: 0,
        relayEvents: 0,
      } satisfies ContextSummary,
    ]),
  )

  for (const [key, event] of latestByAuthorAndTarget) {
    const targetUrl = key.slice(0, key.lastIndexOf(':'))
    const summary = summaries[targetUrl]
    const verdict = getAssessmentVerdict(event)
    if (!summary || !verdict) {
      continue
    }

    summary.counts[verdict] += 1
    summary.contributors += 1
    summary.relayEvents += 1
    if (event.pubkey === myPubkey) {
      summary.myVerdict = verdict
    }
  }

  return summaries
}

export function mergeEvents(
  current: Event[],
  incoming: Event[],
  limit = 500,
): Event[] {
  const byId = new Map(current.map((event) => [event.id, event]))
  for (const event of incoming) {
    byId.set(event.id, event)
  }

  return [...byId.values()]
    .sort((left, right) => right.created_at - left.created_at)
    .slice(0, limit)
}
