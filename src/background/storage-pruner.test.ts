import 'fake-indexeddb/auto'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import { afterEach, describe, expect, it } from 'vitest'
import { buildKind32009Event } from '../lib/nostr/kind-32009'
import type { TrustSubject } from '../lib/nostr/kind-32009'
import {
  STORAGE_RETENTION_DEFAULTS,
  type StorageRetentionSettings,
} from '../shared/storage-retention'
import { AttentionXRepository, deleteAttentionXDatabase } from '../storage'
import { DAY_MS } from '../storage/seen-days'
import { createRuntimeContext } from './runtimeContext'
import { StoragePruner, type StoragePrunerPorts } from './storage-pruner'
import { resetChromeStorage } from './test-chrome-mock'

const NOW = 100 * DAY_MS
const OLD = 1
const FRESH = NOW - DAY_MS
const OVER_BUDGET = 600 * 1024 * 1024

const names: string[] = []
let sequence = 0

afterEach(async () => {
  for (const name of names.splice(0)) await deleteAttentionXDatabase(name)
  resetChromeStorage()
})

async function openRepo(): Promise<AttentionXRepository> {
  const name = `attentionx-pruner-${sequence++}`
  names.push(name)
  return AttentionXRepository.open({ name })
}

async function statement(
  key: Uint8Array,
  subject: TrustSubject,
  createdAt: number,
): Promise<ReturnType<typeof finalizeEvent>> {
  const isPost = subject.type === 'i' && subject.value.startsWith('post:id:')
  const isUser = subject.type === 'i' && subject.value.startsWith('user:id:')
  return finalizeEvent(
    await buildKind32009Event({
      subject,
      value: '1',
      ...(isPost ? {} : { context: 'identity' }),
      scopes: subject.type === 'p' ? [] : ['x.com'],
      ...(isPost ? { k: 'post:id' } : isUser ? { k: 'user:id' } : {}),
      content: '',
      createdAt,
    }),
    key,
  )
}

interface Fixture {
  repository: AttentionXRepository
  ctx: ReturnType<typeof createRuntimeContext>
  rootKey: Uint8Array
  pruner(
    overrides?: Partial<StoragePrunerPorts>,
    settings?: Partial<StorageRetentionSettings>,
  ): StoragePruner
}

async function fixture(): Promise<Fixture> {
  const repository = await openRepo()
  const ctx = createRuntimeContext({ repository, appMode: 'production' })
  const rootKey = generateSecretKey()
  return {
    repository,
    ctx,
    rootKey,
    pruner(overrides = {}, settings = {}) {
      return new StoragePruner({
        now: () => NOW,
        clockMs: () => 0,
        settings: () => ({
          ...STORAGE_RETENTION_DEFAULTS,
          pruneUserEvents: true,
          ...settings,
        }),
        wotMaxDegree: () => 2,
        isDemoMode: () => false,
        isBatchSyncRunning: () => false,
        usageBytes: async () => OVER_BUDGET,
        rootPubkeys: async () => [getPublicKey(rootKey)],
        ensureGraphReady: async () => {},
        graph: ctx.graphManager,
        repository,
        onPostsPruned: (rows) => {
          for (const row of rows) ctx.graphManager.putPostChrome(row)
        },
        onEventsRemoved: () => {},
        yieldToEventLoop: async () => {},
        ...overrides,
      })
    },
  }
}

describe('StoragePruner user events', () => {
  it('removes old events by authors outside every local key WoT and keeps the rest', async () => {
    const f = await fixture()
    const reachableKey = generateSecretKey()
    const reachable = getPublicKey(reachableKey)
    const outsideKey = generateSecretKey()
    const outside = getPublicKey(outsideKey)

    const follow = await statement(f.rootKey, { type: 'p', value: reachable }, 10)
    const insideAboutUser = await statement(
      reachableKey,
      { type: 'i', value: 'user:id:600' },
      11,
    )
    const outsideOld = await statement(
      outsideKey,
      { type: 'i', value: 'user:id:500' },
      12,
    )
    const outsideFresh = await statement(
      outsideKey,
      { type: 'i', value: 'user:id:501' },
      13,
    )
    await f.repository.ingestEvent({ event: follow, firstSeenAt: OLD })
    await f.repository.ingestEvent({ event: insideAboutUser, firstSeenAt: OLD })
    await f.repository.ingestEvent({ event: outsideOld, firstSeenAt: OLD })
    await f.repository.ingestEvent({ event: outsideFresh, firstSeenAt: FRESH })
    await f.repository.putXIdentity({
      twitterId: '500',
      handle: 'quiet',
      state: 'unverified',
      createdAt: 1,
      updatedAt: 1,
      lastSeen: 1,
    })
    const cursor = (author: string) => ({
      relayUrl: 'wss://relay.example',
      scopeHash: `x:kind:32009:author:${author}`,
      lastSeenCreatedAt: 20,
      retry: { attempts: 0 },
      updatedAt: 1,
    })
    await f.repository.putSyncCursor(cursor(outside))
    await f.repository.putSyncCursor(cursor(reachable))
    await f.ctx.graphManager.load()

    const status = await f.pruner().tick()

    expect(status).toMatchObject({ lastRunAt: NOW, lastDeleted: 1, totalDeleted: 1 })
    expect(await f.repository.getEvent(outsideOld.id)).toBeUndefined()
    for (const kept of [follow, insideAboutUser, outsideFresh]) {
      expect(await f.repository.getEvent(kept.id)).toBeDefined()
    }
    expect(f.ctx.graphManager.incomingRecords(['user:id:500'])).toEqual([])
    expect(await f.repository.getXIdentity('500')).toBeDefined()
    const cursors = (
      await f.repository.getSyncCursorsForRelay('wss://relay.example')
    ).map((row) => row.scopeHash)
    expect(cursors).toEqual([`x:kind:32009:author:${reachable}`])
    f.repository.close()
  })

  it('honors the per-tick delete cap and resumes on the next tick', async () => {
    const f = await fixture()
    const outsideKey = generateSecretKey()
    const a = await statement(outsideKey, { type: 'i', value: 'user:id:1' }, 10)
    const b = await statement(outsideKey, { type: 'i', value: 'user:id:2' }, 11)
    await f.repository.ingestEvent({ event: a, firstSeenAt: OLD })
    await f.repository.ingestEvent({ event: b, firstSeenAt: OLD })
    await f.ctx.graphManager.load()
    const pruner = f.pruner({ limits: { maxDeletesPerTick: 1 } })

    expect((await pruner.tick()).lastDeleted).toBe(1)
    expect((await pruner.tick()).lastDeleted).toBe(1)
    expect(await f.repository.countEvents()).toBe(0)
    expect(pruner.status().totalDeleted).toBe(2)
    f.repository.close()
  })

  it.each([
    ['disabled', {}, { pruneUserEvents: false }],
    ['demo', { isDemoMode: () => true }, {}],
    ['syncRunning', { isBatchSyncRunning: () => true }, {}],
    [
      'withinBudget',
      { usageBytes: async (): Promise<number | undefined> => 1024 },
      {},
    ],
    [
      'withinBudget',
      { usageBytes: async (): Promise<number | undefined> => undefined },
      {},
    ],
  ] as const)('skips (%s) without deleting', async (reason, ports, settings) => {
    const f = await fixture()
    const outside = await statement(
      generateSecretKey(),
      { type: 'i', value: 'user:id:1' },
      10,
    )
    await f.repository.ingestEvent({ event: outside, firstSeenAt: OLD })
    await f.ctx.graphManager.load()

    const status = await f.pruner(ports, settings).tick()

    expect(status.lastSkipped).toBe(reason)
    expect(await f.repository.getEvent(outside.id)).toBeDefined()
    f.repository.close()
  })

  it('removes nothing when there are no local keys', async () => {
    const f = await fixture()
    const outside = await statement(
      generateSecretKey(),
      { type: 'i', value: 'user:id:1' },
      10,
    )
    await f.repository.ingestEvent({ event: outside, firstSeenAt: OLD })
    await f.ctx.graphManager.load()

    const status = await f.pruner({ rootPubkeys: async () => [] }).tick()

    expect(status.lastDeleted).toBe(0)
    expect(await f.repository.getEvent(outside.id)).toBeDefined()
    f.repository.close()
  })
})

describe('StoragePruner post events', () => {
  it('removes events on idle posts, keeps own statements, and marks the row pruned', async () => {
    const f = await fixture()
    const otherKey = generateSecretKey()
    const otherOnIdle = await statement(
      otherKey,
      { type: 'i', value: 'post:id:9' },
      10,
    )
    const ownOnIdle = await statement(
      f.rootKey,
      { type: 'i', value: 'post:id:9' },
      11,
    )
    const otherOnFresh = await statement(
      otherKey,
      { type: 'i', value: 'post:id:10' },
      12,
    )
    for (const event of [otherOnIdle, ownOnIdle, otherOnFresh]) {
      await f.repository.ingestEvent({ event, firstSeenAt: FRESH })
    }
    await f.repository.upsertXPostChrome({ postId: '9', headline: 'old' }, OLD)
    await f.repository.upsertXPostChrome({ postId: '10' }, FRESH)
    await f.ctx.graphManager.load()

    const status = await f
      .pruner({}, { pruneUserEvents: false, prunePostEvents: true, postIdleDays: 7 })
      .tick()

    expect(status.lastDeleted).toBe(1)
    expect(await f.repository.getEvent(otherOnIdle.id)).toBeUndefined()
    expect(await f.repository.getEvent(ownOnIdle.id)).toBeDefined()
    expect(await f.repository.getEvent(otherOnFresh.id)).toBeDefined()
    expect(await f.repository.getXPost('9')).toMatchObject({
      headline: 'old',
      prunedAt: NOW,
    })
    expect((await f.repository.getXPost('10'))?.prunedAt).toBeUndefined()
    expect(f.ctx.graphManager.postDisplay('9')?.prunedAt).toBe(NOW)

    expect((await f.pruner({}, { prunePostEvents: true, pruneUserEvents: false }).tick()).lastDeleted).toBe(0)
    f.repository.close()
  })
})
