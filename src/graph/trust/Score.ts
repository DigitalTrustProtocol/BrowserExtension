/**
 * Vendored from DigitalTrustProtocol/Trust (src/lib/trust/resolvers/Score.ts).
 */

import { RATING_STATEMENT_KIND } from '@shared/kind-32014'
import { trustEdgeValue, type IEdge } from './Edge'
import { TRUST_STATEMENT_KIND } from '@shared/kind-32009'

export interface IScore {
  subject?: string
  count: number
  degree: number
  connected: boolean
  visited: boolean
  authorIndex?: number
  edges?: number[]
  kind?: number
  addTrust(edge: IEdge, degree: number): void
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

  constructor(subjectIndex: number, degree = 0, kind?: number) {
    this.subjectIndex = subjectIndex
    this.degree = degree
    this.kind = kind
  }

  addTrust(edge: IEdge, degree: number): void {
    this.degree = degree

    if (edge.index === undefined) return
    if (!this.edges) this.edges = []
    this.edges.push(edge.index)
  }


}

export class TrustScore extends Score implements ITrustScore {
  trustValue = 0
  trust = 0
  neutral = 0
  distrust = 0


  addTrust(edge: IEdge, degree: number): void {
    if (edge.kind !== TRUST_STATEMENT_KIND) return
    const value = trustEdgeValue(edge)
    if (value !== undefined && value !== 0) {
      this.count += 1
      this.trustValue += value

      if (value === 1) {
        this.trust += 1
      } else if (value === -1) {
        this.distrust += 1
      }
    }

    super.addTrust(edge, degree)
  }

}

export class RatingScore extends Score implements IRatingScore {
  ratingValue = 0
  
  addTrust(edge: IEdge, degree: number): void {
    if (edge.kind !== RATING_STATEMENT_KIND) return
    const value = edge.nValue; 
    if (value == undefined) return;
    this.count += 1
    this.ratingValue += value

    super.addTrust(edge, degree)
  }
}

export class IndexScoreMap extends Map<number, IScore> {
  getSubject(subjectIndex: number, degree: number, kind: number): IScore {
    let subjectScore = this.get(subjectIndex)
    if (!subjectScore) {

      if (kind === TRUST_STATEMENT_KIND) {
        subjectScore = new TrustScore(subjectIndex, degree, kind)
      } else if (kind === RATING_STATEMENT_KIND) {
        subjectScore = new RatingScore(subjectIndex, degree, kind)
      } else {
        throw new Error(`Invalid kind: ${kind}`)
      }
      this.set(subjectIndex, subjectScore)
    }
    return subjectScore
  }
}
