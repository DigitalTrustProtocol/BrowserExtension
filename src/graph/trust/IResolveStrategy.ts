/**
 * Vendored from DigitalTrustProtocol/Trust (IResolveStrategy.ts).
 * AttentionX: resolve returns Score[] (no server ApiEnvelope).
 */

import type { IGraph } from './Graph'
import type { Score } from './Score'

/** Output format: default (counts + degree). `path` is handled in query.ts. */
export type ResolveFormat = 'number' | 'default' | 'path'

export interface IResolveStrategyOptions {
  graph?: IGraph
  maxDepth?: number // Default: 4
  stopWhenFound?: boolean 
  context?: string // Default: undefined
  followTrustThreshold?: number // Default: 75
  respectDirectDistrust?: boolean // Default: true
  format?: ResolveFormat // Default: 'default'
  /** Unix seconds for edge activate/expire checks (default: now). */
  now?: number // Default: now
  /** Protocol subject type for evidence buckets (`i` vs `p`). Walk still unions both. */
  subjectType?: 'p' | 'e' | 'i' // Default: 'p'
  scoreKind?: 32009 | 32014 // Default: 32009
  /** Kind 32014 incoming evidence only. Hitting degree uses matching labels first. */
  labels?: readonly string[] // Default: undefined
}

export interface IResolveStrategy {
  readonly name: string
  resolve(
    authorId: string,
    subjectId: string,
    options?: IResolveStrategyOptions,
  ): Score[]
}
