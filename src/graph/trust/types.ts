/**
 * Vendored from DigitalTrustProtocol/Trust — minimal types for heap Graph.
 * AttentionX adaptations: kind 32009 subjects (p|e|i); no nip32010 tag parsing.
 */

export type SubjectType = 'p' | 'e' | 'i'

export type GraphTrustValue = 1 | 0 | -1

export interface ExtractedSubject {
  tag: SubjectType
  value: string
}

/** Trust event shape consumed by Graph.applyTrustEvent (fields already reduced). */
export interface ITrustEvent {
  kind: number
  pubkey: string
  created_at: number
  content?: string
  /** Replacement slot id (AttentionX: author|subject|context). */
  addressableId: string
  /** Event id for tie-break when created_at ties. */
  eventId: string
  value: GraphTrustValue
  c_tag: string
  activate?: number
  expire?: number
  subjects: ExtractedSubject[]
}

export type Identity = Record<string, string>
