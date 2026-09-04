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
  maxDepth?: number
  stopWhenFound?: boolean
  context?: string
  followTrustThreshold?: number
  respectDirectDistrust?: boolean
  format?: ResolveFormat
  /** Unix seconds for edge activate/expire checks (default: now). */
  now?: number
  /** Protocol subject type for evidence buckets (`i` vs `p`). Walk still unions both. */
  subjectType?: 'p' | 'e' | 'i'
}

export interface IResolveStrategy {
  readonly name: string
  resolve(
    authorId: string,
    subjectId: string,
    options?: IResolveStrategyOptions,
  ): Score[]
}
