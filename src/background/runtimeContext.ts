/**
 * Service-worker accessor for shared background services.
 * Not settings, RPC session, overlay, or graph-tab chrome.
 */

import { attachGraphChrome } from '../graph/chrome'
import { Graph } from '../graph/trust/Graph'
import { DEFAULT_APP_MODE, type AppMode } from '../shared/app-mode'
import type { AttentionXRepository } from '../storage'
import { GraphManager } from './graphManager.ts'

export interface RuntimeContext {
  repository: AttentionXRepository
  graph: Graph
  graphManager: GraphManager
  abortController: AbortController
  appMode: AppMode
  /** Signed-in X id bound to the demo sentinel root. RAM-only. */
  demoRootTwitterId?: string
}

export function createRuntimeContext(input: {
  repository: AttentionXRepository
  appMode?: AppMode
  abortController?: AbortController
  demoRootTwitterId?: string
}): RuntimeContext {
  const graph = new Graph()
  attachGraphChrome(graph)
  const ctx = {
    repository: input.repository,
    graph,
    abortController: input.abortController ?? new AbortController(),
    appMode: input.appMode ?? DEFAULT_APP_MODE,
    ...(input.demoRootTwitterId
      ? { demoRootTwitterId: input.demoRootTwitterId }
      : {}),
  } as RuntimeContext
  ctx.graphManager = new GraphManager(ctx)
  return ctx
}
