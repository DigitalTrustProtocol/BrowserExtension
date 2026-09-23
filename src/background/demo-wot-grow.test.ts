import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEMO_WOT_MAX_STATEMENTS } from '../shared/demo-wot'
import {
  createDemoWotGrower,
  type DemoWotGrowPort,
} from './demo-wot-grow'

const CURRENT = 'a'.repeat(64)

function port(overrides: Partial<DemoWotGrowPort> = {}): DemoWotGrowPort & {
  ingested: string[]
  publishes: number
} {
  const ingested: string[] = []
  const api = {
    ingested,
    publishes: 0,
    isDemo: () => true,
    currentPubkey: () => CURRENT,
    currentTwitterId: () => '42',
    statementCount: () => ingested.length,
    isWoven: () => false,
    pairExists: () => false,
    peerTwitterIds: () => [],
    prepare: async () => undefined,
    ensureAuthorKind0: async () => undefined,
    ingestUserTrust: async (row: { subjectTwitterId: string }) => {
      ingested.push(row.subjectTwitterId)
    },
    publishTrustGraph: () => {
      api.publishes += 1
    },
    ...overrides,
  }
  return api
}

describe('createDemoWotGrower', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('stops when kind 32009 statements are already at the cap', async () => {
    const api = port({ statementCount: () => DEMO_WOT_MAX_STATEMENTS })
    const grower = createDemoWotGrower(api, { yieldMs: 0, trailMs: 1_000, maxMs: 2_000 })
    grower.enqueue('555001')
    await grower.settle()
    expect(api.ingested).toEqual([])
    expect(api.publishes).toBe(0)
  })

  it('does not enqueue in production', async () => {
    const api = port({ isDemo: () => false })
    const grower = createDemoWotGrower(api, { yieldMs: 0, trailMs: 20, maxMs: 40 })
    grower.enqueue('555001')
    await grower.settle()
    expect(api.ingested).toEqual([])
  })

  it('coalesces trustGraph across a batch', async () => {
    vi.useFakeTimers()
    const api = port()
    const grower = createDemoWotGrower(api, {
      yieldMs: 0,
      trailMs: 1_000,
      maxMs: 2_000,
    })
    for (let n = 0; n < 8; n += 1) grower.enqueue(String(700_000 + n))
    await vi.advanceTimersByTimeAsync(50)
    expect(api.ingested.length).toBeGreaterThan(0)
    expect(api.publishes).toBe(0)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(api.publishes).toBe(1)
    expect(api.publishes).toBeLessThan(api.ingested.length)
    await grower.settle()
  })

  it('abort drops the queue before further ingests', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let calls = 0
    const api = port({
      ingestUserTrust: async (row) => {
        calls += 1
        api.ingested.push(row.subjectTwitterId)
        if (calls === 1) await gate
      },
    })
    const grower = createDemoWotGrower(api, { yieldMs: 0, trailMs: 1_000, maxMs: 2_000 })
    grower.enqueue('555010')
    grower.enqueue('555011')
    await vi.waitFor(() => {
      expect(calls).toBe(1)
    })
    const aborted = grower.abort()
    release!()
    await aborted
    expect(api.ingested.length).toBeLessThan(4)
    grower.enqueue('555012')
    await grower.settle()
    expect(api.ingested).toContain('555012')
  })
})
