import { describe, expect, it, beforeEach } from 'vitest'
import {
  activityReasonFromError,
  handlers,
  logActivity,
  normalizeActivityEntry,
} from './bg/activity-handlers.ts'
import {
  ACTIVITY_LOG_GLOBAL_MAX,
  ACTIVITY_LOG_MAX_PER_DOMAIN,
} from '../../../vault/constants.ts'
import { resetChromeStorage } from '../../../background/test-chrome-mock.ts'

describe('normalizeActivityEntry', () => {
  it('keeps the minimal generic shape', () => {
    expect(
      normalizeActivityEntry({
        timestamp: 100,
        domain: 'example.com',
        method: 'signEvent',
        decision: 'approved',
        kind: 1,
        eventId: 'ab'.repeat(32),
      }),
    ).toEqual({
      timestamp: 100,
      domain: 'example.com',
      method: 'signEvent',
      decision: 'approved',
      kind: 1,
      eventId: 'ab'.repeat(32),
    })
  })

  it('scrubs legacy event payloads down to id/kind when possible', () => {
    const normalized = normalizeActivityEntry({
      timestamp: 50,
      domain: 'legacy.com',
      method: 'signEvent',
      decision: 'approved',
      event: {
        id: 'cd'.repeat(32),
        kind: 1,
        content: 'secret',
        tags: [['t', 'x']],
      },
    })
    expect(normalized).toEqual({
      timestamp: 50,
      domain: 'legacy.com',
      method: 'signEvent',
      decision: 'approved',
      kind: 1,
      eventId: 'cd'.repeat(32),
    })
    expect(JSON.stringify(normalized)).not.toContain('secret')
  })
})

describe('logActivity', () => {
  beforeEach(() => {
    resetChromeStorage()
  })

  it('stores eventId for approved signed actions', async () => {
    await logActivity({
      domain: 'example.com',
      method: 'signEvent',
      decision: 'approved',
      kind: 1,
      eventId: 'ef'.repeat(32),
    })
    const get = handlers.get('getActivityLog')!
    const log = (await get({})) as Array<Record<string, unknown>>
    expect(log).toEqual([
      expect.objectContaining({
        domain: 'example.com',
        method: 'signEvent',
        decision: 'approved',
        kind: 1,
        eventId: 'ef'.repeat(32),
      }),
    ])
    expect(log[0].event).toBeUndefined()
    expect(log[0].eventSummary).toBeUndefined()
    expect(log[0].reason).toBeUndefined()
  })

  it('stores reason for unsuccessful actions', async () => {
    await logActivity({
      domain: 'example.com',
      method: 'signEvent',
      decision: 'rejected',
      kind: 1,
      reason: activityReasonFromError(new Error('User denied signing')),
    })
    const get = handlers.get('getActivityLog')!
    const log = (await get({})) as Array<Record<string, unknown>>
    expect(log[0]).toMatchObject({
      decision: 'rejected',
      reason: 'User denied signing',
    })
    expect(log[0].eventId).toBeUndefined()
  })

  it('migrates legacy rows on read', async () => {
    const browser =
      (globalThis as unknown as { browser?: typeof chrome }).browser ?? chrome
    await browser.storage.local.set({
      activityLog: [
        {
          timestamp: Date.now(),
          domain: 'legacy.com',
          method: 'signEvent',
          kind: 4,
          decision: 'approved',
          event: {
            kind: 4,
            content: 'ciphertext-should-not-persist',
            tags: [['p', 'aa'.repeat(32)]],
            id: '11'.repeat(32),
          },
        },
      ],
    })
    const get = handlers.get('getActivityLog')!
    const log = (await get({})) as Array<Record<string, unknown>>
    expect(log[0]).toMatchObject({
      kind: 4,
      eventId: '11'.repeat(32),
    })
    expect(JSON.stringify(log)).not.toContain('ciphertext-should-not-persist')
    const stored = (await browser.storage.local.get(['activityLog'])) as {
      activityLog: Array<Record<string, unknown>>
    }
    expect(stored.activityLog[0].event).toBeUndefined()
  })

  it('enforces the global activity log cap', async () => {
    for (let i = 0; i < ACTIVITY_LOG_GLOBAL_MAX + 25; i += 1) {
      await logActivity({
        domain: `site-${i % 40}.com`,
        method: 'getPublicKey',
        decision: 'approved',
      })
    }
    const get = handlers.get('getActivityLog')!
    const log = (await get({})) as unknown[]
    expect(log.length).toBeLessThanOrEqual(ACTIVITY_LOG_GLOBAL_MAX)
    expect(log.length).toBeGreaterThan(ACTIVITY_LOG_MAX_PER_DOMAIN)
  })
})
