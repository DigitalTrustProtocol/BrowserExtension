import type { SerializableTrustSubject } from '../shared/contracts'

export type Verdict = 'trust' | 'question' | 'misleading' | 'neutral'
export type TargetType = 'post' | 'profile'
export type TrustTone = Verdict | 'neutral'

export interface Target {
  type: TargetType
  id: string
  url: string
  handle?: string
  twitterId?: string
}

export interface TrustDescriptor {
  subject: SerializableTrustSubject
  context?: string
}

export interface ObservedIdentityLookup {
  twitterId: string
  handle: string
  observedAt: number
}

export interface ArticleTargets {
  postTarget: Target
  profileTarget: Target
}
