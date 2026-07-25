import type { ContextMatch } from './types'

export interface ContextCandidate {
  context: string
  match: ContextMatch
}

/**
 * Returns a requested context followed by its nearest parents and general
 * context. Parsed statements are expected to contain canonical contexts.
 */
export function contextCandidates(requestedContext: string): ContextCandidate[] {
  if (requestedContext === '') {
    return [{ context: '', match: 'general' }]
  }

  const segments = requestedContext.split(':')
  const candidates: ContextCandidate[] = [
    { context: requestedContext, match: 'exact' },
  ]

  for (let length = segments.length - 1; length > 0; length -= 1) {
    candidates.push({
      context: segments.slice(0, length).join(':'),
      match: 'parent',
    })
  }

  candidates.push({ context: '', match: 'general' })
  return candidates
}
