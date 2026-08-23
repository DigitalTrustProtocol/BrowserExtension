import type { TrustSubject } from '../graph'
import { parseCanonicalTwitterSubject } from './x-identity'

export function twitterIdFromSubject(
  subject: TrustSubject | undefined,
): string | undefined {
  if (!subject || subject.type !== 'i') return undefined
  const parsed = parseCanonicalTwitterSubject(subject.value)
  return parsed?.type === 'account' ? parsed.twitterId : undefined
}

export function postIdFromSubject(
  subject: TrustSubject | undefined,
): string | undefined {
  if (!subject || subject.type !== 'i') return undefined
  const parsed = parseCanonicalTwitterSubject(subject.value)
  return parsed?.type === 'post' ? parsed.postId : undefined
}

export function isUnboundPubkeySubject(
  subject: TrustSubject | undefined,
): boolean {
  return subject?.type === 'p' && /^[0-9a-f]{64}$/i.test(subject.value)
}