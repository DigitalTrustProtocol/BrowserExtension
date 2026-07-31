/**
 * Vendored Trust heap graph + resolvers (DigitalTrustProtocol/Trust).
 */

export { EdgeT1, type IEdge } from './Edge'
export {
  Graph,
  type GraphTrustConnectionOptions,
  type GraphTrustConnectionPayload,
  type GraphTrustEdgePayload,
  type GraphTrustValue,
  type IGraph,
} from './Graph'
export type {
  IResolveStrategy,
  IResolveStrategyOptions,
  ResolveFormat,
} from './IResolveStrategy'
export { IndexResolver } from './IndexResolver'
export { default as indexResolver } from './IndexResolver'
export { Node } from './Node'
export { default as pathStrategyJson } from './pathStrategyJson'
export { IndexScoreMap, Score, type IScore } from './Score'
export type {
  ExtractedSubject,
  ITrustEvent,
  Identity,
  SubjectType,
} from './types'
