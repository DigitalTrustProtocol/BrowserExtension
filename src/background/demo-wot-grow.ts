/**
 * Background queue that weaves newly observed X accounts into the demo graph.
 * One user per turn. Does not publish per statement.
 *
 * @module background/demo-wot-grow
 */

import {
  DEMO_WOT_MAX_STATEMENTS,
  isDemoWotChainTwitterId,
  planDemoWotUserGrow,
  type DemoWotGrowStatement,
} from '../shared/demo-wot'

export const DEMO_WOT_GROW_YIELD_MS = 50
export const DEMO_WOT_GROW_BROADCAST_TRAIL_MS = 1_000
export const DEMO_WOT_GROW_BROADCAST_MAX_MS = 2_000

export interface DemoWotGrowPort {
  isDemo(): boolean
  currentPubkey(): string
  currentTwitterId(): string | undefined
  statementCount(): number
  isWoven(twitterId: string): boolean
  pairExists(authorPubkey: string, subjectTwitterId: string): boolean
  peerTwitterIds(): readonly string[]
  prepare(): Promise<void>
  ensureAuthorKind0(twitterId: string): Promise<void>
  ingestUserTrust(row: DemoWotGrowStatement): Promise<void>
  publishTrustGraph(): void
}

export interface DemoWotGrowTiming {
  yieldMs: number
  trailMs: number
  maxMs: number
}

export interface DemoWotGrower {
  enqueue(twitterId: string): void
  abort(): Promise<void>
  settle(): Promise<void>
}

const TWITTER_ID = /^\d+$/

export function createDemoWotGrower(
  port: DemoWotGrowPort,
  timing: DemoWotGrowTiming = {
    yieldMs: DEMO_WOT_GROW_YIELD_MS,
    trailMs: DEMO_WOT_GROW_BROADCAST_TRAIL_MS,
    maxMs: DEMO_WOT_GROW_BROADCAST_MAX_MS,
  },
): DemoWotGrower {
  const pending: string[] = []
  const queued = new Set<string>()
  let draining: Promise<void> | undefined
  let restart = false
  let aborted = false
  let dirty = false
  let trailTimer: ReturnType<typeof setTimeout> | undefined
  let ceilingTimer: ReturnType<typeof setTimeout> | undefined

  const cancelBroadcast = (): void => {
    if (trailTimer !== undefined) clearTimeout(trailTimer)
    if (ceilingTimer !== undefined) clearTimeout(ceilingTimer)
    trailTimer = undefined
    ceilingTimer = undefined
    dirty = false
  }

  const flushBroadcast = (): void => {
    if (trailTimer !== undefined) clearTimeout(trailTimer)
    if (ceilingTimer !== undefined) clearTimeout(ceilingTimer)
    trailTimer = undefined
    ceilingTimer = undefined
    if (!dirty) return
    dirty = false
    port.publishTrustGraph()
  }

  const noteBroadcast = (): void => {
    dirty = true
    if (ceilingTimer === undefined) {
      ceilingTimer = setTimeout(flushBroadcast, timing.maxMs)
    }
    if (trailTimer !== undefined) clearTimeout(trailTimer)
    trailTimer = setTimeout(flushBroadcast, timing.trailMs)
  }

  const kick = (): void => {
    if (aborted) return
    if (draining) {
      restart = true
      return
    }
    restart = false
    draining = drain()
      .catch(() => undefined)
      .finally(() => {
        draining = undefined
        if (!aborted && restart && pending.length > 0) kick()
      })
  }

  const drain = async (): Promise<void> => {
    while (pending.length > 0) {
      if (aborted || !port.isDemo()) return
      if (port.statementCount() >= DEMO_WOT_MAX_STATEMENTS) return
      const twitterId = pending.shift()
      if (!twitterId) return
      queued.delete(twitterId)
      await port.prepare()
      if (aborted || !port.isDemo()) return
      if (port.statementCount() >= DEMO_WOT_MAX_STATEMENTS) {
        pending.unshift(twitterId)
        queued.add(twitterId)
        return
      }
      if (port.isWoven(twitterId)) continue
      const fresh = freshStatements(port, twitterId)
      if (fresh.length === 0) continue
      if (port.statementCount() + fresh.length > DEMO_WOT_MAX_STATEMENTS) {
        continue
      }
      await port.ensureAuthorKind0(twitterId)
      for (const row of fresh) {
        if (aborted || !port.isDemo()) return
        await port.ingestUserTrust(row)
        noteBroadcast()
      }
      if (aborted) return
      await delay(timing.yieldMs)
    }
  }

  return {
    enqueue(twitterId: string): void {
      if (aborted || !port.isDemo()) return
      const id = twitterId.trim()
      if (!TWITTER_ID.test(id) || isDemoWotChainTwitterId(id)) return
      if (queued.has(id)) return
      queued.add(id)
      pending.push(id)
      kick()
    },
    async abort(): Promise<void> {
      aborted = true
      pending.length = 0
      queued.clear()
      cancelBroadcast()
      const run = draining
      if (run) await run
      aborted = false
    },
    async settle(): Promise<void> {
      while (draining) await draining
      flushBroadcast()
    },
  }
}

function freshStatements(
  port: DemoWotGrowPort,
  twitterId: string,
): DemoWotGrowStatement[] {
  const planned = planDemoWotUserGrow({
    twitterId,
    currentPubkey: port.currentPubkey(),
    ...(port.currentTwitterId()
      ? { currentTwitterId: port.currentTwitterId() }
      : {}),
    peerTwitterIds: port.peerTwitterIds(),
  })
  return planned.filter(
    (row) => !port.pairExists(row.authorPubkey, row.subjectTwitterId),
  )
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
