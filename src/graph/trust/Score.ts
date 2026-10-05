/**
 * Vendored from DigitalTrustProtocol/Trust (src/lib/trust/resolvers/Score.ts).
 */

import { RATING_STATEMENT_KIND } from '../../lib/nostr/kind-32014'
import { trustEdgeValue, type IEdge } from './Edge'
import { TRUST_STATEMENT_KIND } from '../../lib/nostr/kind-32009'
import type { ScoreKind } from './IResolveStrategy'

const TRUST_SCORE_SLOT = 1
const RATING_SCORE_SLOT = 2
const SCORE_KIND_STRIDE = 10

type scoreFactoryParams = {
  subjectIndex: number
  degree: number
  kind: number
  /** When false, `add` updates counts and skips the edge-index list. */
  keepEdges: boolean
}

export interface IScore {
  subjectIndex?: number
  subject?: string
  count: number
  degree: number
  connected: boolean
  visited: boolean
  authorIndex?: number
  edges?: number[]
  kind?: number
  /** False on hop scores unless the caller asked for a path. */
  keepEdges: boolean
  add(edge: IEdge): boolean
  reset(): void
}

export interface ITrustScore extends IScore {
  trustValue: number
  trust: number
  neutral: number
  distrust: number
}

export interface IRatingScore extends IScore {
  ratingValue: number
}

export class Score implements IScore {
  subject?: string
  subjectIndex?: number
  count = 0
  degree = 0
  connected = false
  visited = false
  authorIndex?: number
  kind?: number
  context?: string
  edges?: number[]
  keepEdges: boolean

  constructor(options: scoreFactoryParams) {
    this.subjectIndex = options.subjectIndex
    this.degree = options.degree
    this.kind = options.kind
    this.keepEdges = options.keepEdges
  }

  add(edge: IEdge): boolean {
    if (edge.index === undefined) return false // The edge index is missing, this should never happen
    if (this.keepEdges) {
      if (!this.edges) this.edges = []
      this.edges.push(edge.index!)
    }

    return true
  }

  reset(): void {
    this.edges = undefined
    this.degree = 0
    this.count = 0
  }
}




export class TrustScore extends Score implements ITrustScore {
  private _nDegree = 0
  _trustValue = 0
  trust = 0
  neutral = 0
  distrust = 0

  get trustValue(): number {
    return this._trustValue
  }
  set trustValue(value: number) {
    this._trustValue = value
  }

  add(edge: IEdge): boolean {
    if (edge.kind !== TRUST_STATEMENT_KIND) return false
    const value = trustEdgeValue(edge)
    if (value === undefined) return false // The edge value is missing, tombstone
    if(!super.add(edge)) return false

    if (value === 0) {
        this.neutral += 1 
        return true
    }

    this.count += 1
    this.trustValue += value
    if (value === 1) {
      this.trust += 1
    } else {
      this.distrust += 1
    }

    return true
  }

  reset(): void {
    this.neutral = 0
    this.distrust = 0
    this.trust = 0
    this.trustValue = 0
    super.reset()
  }
}

export class RatingScore extends Score implements IRatingScore {
  ratingValue = 0

  add(edge: IEdge): boolean {
    if (edge.kind !== RATING_STATEMENT_KIND) return false
    const value = edge.nValue
    if (value === undefined) return false
    if(!super.add(edge)) return false

    this.count += 1
    this.ratingValue += value
    
    return true
  }

  reset(): void {
    this.ratingValue = 0
    super.reset()
  }
}

export class IndexScoreMap extends Map<number, IScore> {
  getScoreIndex(subjectIndex: number, kind: number): number {
    switch (kind) {
      case TRUST_STATEMENT_KIND:
        return subjectIndex * SCORE_KIND_STRIDE + TRUST_SCORE_SLOT
      case RATING_STATEMENT_KIND:
        return subjectIndex * SCORE_KIND_STRIDE + RATING_SCORE_SLOT
      default:
        throw new Error(`Invalid kind: ${kind}`)
    }
  }

  peek(
    nodeIndex: number,
    kind: number = TRUST_STATEMENT_KIND,
  ): IScore | undefined {
    return super.get(this.getScoreIndex(nodeIndex, kind))
  }

  ensure(
    nodeIndex: number,
    degree: number,
    kind: ScoreKind = TRUST_STATEMENT_KIND,
    keepEdges: boolean = false,
  ): IScore {
    const index = this.getScoreIndex(nodeIndex, kind)
    let score = super.get(index)
    if (!score) {
      score = ScoreFactory({ subjectIndex: nodeIndex, degree, kind, keepEdges })
      this.set(index, score)
    } else if (keepEdges) {
      score.keepEdges = true
    }
    return score
  }

  getTrust(nodeIndex: number): ITrustScore | undefined {
    const score = this.peek(nodeIndex, TRUST_STATEMENT_KIND)
    if (!score || !(score instanceof TrustScore)) return undefined
    return score
  }
}

export function ScoreFactory(options: scoreFactoryParams): IScore {
  if (options.kind === TRUST_STATEMENT_KIND) {
    return new TrustScore(options)
  }
  if (options.kind === RATING_STATEMENT_KIND) {
    return new RatingScore(options)
  }
  throw new Error(`Invalid kind: ${options.kind}`)
}
