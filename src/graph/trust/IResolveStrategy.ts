/**
 * Vendored from DigitalTrustProtocol/Trust (IResolveStrategy.ts).
 * Attention: resolve returns Score[] (no server ApiEnvelope).
 */

import type { IGraph } from './Graph'
import type { Score } from './Score'

/** Output format: default (counts + degree). `path` is handled in query.ts. */
export type ResolveFormat = 'number' | 'default' | 'path' | 'statements'

export type ScoreKind = 32009 | 32014

export interface IResolveStrategyOptions {
  graph?: IGraph
  maxDepth?: number // Default: 4
  stopWhenFound?: boolean 
  trustContext?: string // Default: identity
  scoreContext?: string // Default: undefined
  followTrustThreshold?: number // Default: 75
  respectDirectDistrust?: boolean // Default: true
  format?: ResolveFormat // Default: 'default'
  /** Unix seconds for edge activate/expire checks (default: now). */
  now?: number // Default: now
  /** Evidence kind to score. Default: 32009. Hops always walk 32009 Trust(+1). */
  kind?: ScoreKind
  /**
   * How many degrees may start. Checked once before each degree, not on a
   * wall clock: `0` stops before degree 1. Omit for no time limit.
   * A hit from a degree that was allowed to start still stands.
   */
  deadline?: number
  /** Set when `deadline` stops the walk before a degree. */
  timeStop?: { truncated?: 'time' }
}

export interface IResolveStrategy {
  readonly name: string
  resolve(
    authorId: string,
    subjectId: string,
    options?: IResolveStrategyOptions,
  ): Score[]
}
