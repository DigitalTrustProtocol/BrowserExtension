/**
 * Vendored Trust heap graph + resolvers (DigitalTrustProtocol/Trust).
 *
 * Do not modify this package unless there is a very good reason, and always
 * ask first. It is fragile under AI interference. Change AttentionX wrappers
 * in `src/graph` (`graph.ts`, `adapter.ts`, `query.ts`, `ratings/`) instead.
 */

export { isValidAt, trustEdgeValue, type IEdge } from './Edge'
export {
  Graph,
  heapEdgeKey,
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
  HeapEventFields,
  ITrustEvent,
  Identity,
  SubjectType,
} from './types'
