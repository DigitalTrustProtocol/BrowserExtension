export const ATTENTIONX_LABEL_NAMESPACE = 'attentionx'
export const ATTENTIONX_EVENT_KIND = 1985
export const STORAGE_KEY = 'attentionx-state-v1'

export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
] as const

export type AssessmentVerdict = 'trust' | 'question' | 'misleading'
export type AssessmentTargetType = 'post' | 'profile'

export interface AssessmentTarget {
  type: AssessmentTargetType
  id: string
  url: string
  handle?: string
}

export interface VerdictCounts {
  trust: number
  question: number
  misleading: number
}

export interface ContextSummary {
  targetUrl: string
  counts: VerdictCounts
  myVerdict?: AssessmentVerdict
  contributors: number
  relayEvents: number
}

export interface PublicExtensionState {
  hasIdentity: boolean
  npub?: string
  pubkey?: string
  relays: string[]
  cachedEventCount: number
}

export interface PublishResult {
  eventId: string
  deliveredTo: number
  attemptedRelays: number
}

export type ExtensionRequest =
  | { type: 'GET_STATE' }
  | { type: 'GENERATE_IDENTITY' }
  | { type: 'IMPORT_IDENTITY'; nsec: string }
  | { type: 'CLEAR_IDENTITY' }
  | { type: 'SAVE_RELAYS'; relays: string[] }
  | { type: 'LOOKUP_CONTEXT'; targets: AssessmentTarget[] }
  | {
      type: 'PUBLISH_ASSESSMENT'
      target: AssessmentTarget
      verdict: AssessmentVerdict
      note?: string
    }

export type ExtensionResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }
