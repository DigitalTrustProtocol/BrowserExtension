/**
 * Vendored from DigitalTrustProtocol/Trust (src/lib/trust/resolvers/Score.ts).
 */

import type { IEdge } from './Edge'

export interface IScore {
  subject?: string
  count: number
  trustValue: number
  degree: number
  trust: number
  distrust: number
  connected: boolean
  visited: boolean
  authorIndex?: number
  edges?: number[]
  addTrust(edge: IEdge, degree: number): void
}

export class Score implements IScore {
  subject?: string
  subjectIndex?: number
  count = 0
  trustValue = 0
  degree = 0
  trust = 0
  distrust = 0
  connected = false
  visited = false
  authorIndex?: number
  kind?: number
  context?: string
  edges?: number[]

  constructor(
    count = 0,
    trustValue = 0,
    degree = 0,
    trust = 0,
    distrust = 0,
    connected = false,
    visited = false,
  ) {
    this.count = count
    this.trustValue = trustValue
    this.degree = degree
    this.trust = trust
    this.distrust = distrust
    this.connected = connected
    this.visited = visited
  }

  addTrust(edge: IEdge, degree: number): void {
    if (edge.value === 0) {
      this.degree = degree
      if (!this.edges) this.edges = []
      if (edge.index !== undefined) this.edges.push(edge.index)
      return
    }

    this.count += 1
    this.trustValue += edge.value
    if (edge.value === 1) {
      this.trust += 1
    } else if (edge.value === -1) {
      this.distrust += 1
    }
    this.degree = degree

    if (!this.edges) this.edges = []
    if (edge.index !== undefined) this.edges.push(edge.index)
  }
}

export class IndexScoreMap extends Map<number, Score> {
  getSubject(subjectIndex: number, degree: number): Score {
    let subjectScore = this.get(subjectIndex)
    if (!subjectScore) {
      subjectScore = new Score()
      subjectScore.subjectIndex = subjectIndex
      subjectScore.degree = degree
      this.set(subjectIndex, subjectScore)
    }
    return subjectScore
  }
}
