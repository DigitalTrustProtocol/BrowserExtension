import 'fake-indexeddb/auto'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRuntimeContext } from './runtimeContext'
import { buildKind32009Event } from '../shared/kind-32009'
import { buildKind32014Event } from '../shared/kind-32014'
import {
  AttentionXRepository,
  deleteAttentionXDatabase,
} from '../storage'
import { GRAPH_COLUMNS_BACKFILL_KEY } from './graphManager'
import { resetChromeStorage } from './test-chrome-mock'

const names: string[] = []
let sequence = 0

afterEach(async () => {
  for (const name of names.splice(0)) {
    await deleteAttentionXDatabase(name)
  }
  resetChromeStorage()
})

async function openRepo(): Promise<AttentionXRepository> {
  const name = `attentionx-gm-${sequence++}`
  names.push(name)
  return AttentionXRepository.open({ name })
}

describe('GraphManager load', () => {
  it('loads live 32009, skips demo, and does not walk 32014 as hops', async () => {
    const repository = await openRepo()
    const liveKey = generateSecretKey()
    const livePubkey = getPublicKey(liveKey)
    const demoKey = generateSecretKey()
    const raterKey = generateSecretKey()

    const live = finalizeEvent(
      await buildKind32009Event({
        subject: { type: 'i', value: 'user:id:100' },
        value: '1',
        context: 'identity',
        scopes: ['x.com'],
        k: 'user:id',
        content: '',
        createdAt: 10,
      }),
      liveKey,
    )
    const demo = finalizeEvent(
      await buildKind32009Event({
        subject: { type: 'i', value: 'user:id:200' },
        value: '1',
        context: 'identity',
        scopes: ['x.com'],
        k: 'user:id',
        content: '',
        createdAt: 11,
      }),
      demoKey,
    )
    const rating = finalizeEvent(
      await buildKind32014Event({
        subject: { type: 'i', value: 'post:id:9' },
        score: '80',
        context: '',
        scopes: ['x.com'],
        k: 'post:id',
        content: '',
        createdAt: 12,
      }),
      raterKey,
    )

    await repository.ingestEvent({ event: live })
    await repository.ingestEvent({ event: demo, state: 'demo' })
    await repository.ingestEvent({ event: rating })

    const ctx = createRuntimeContext({
      repository,
      appMode: 'production',
    })
    await ctx.graphManager.load()

    const liveHit = ctx.graphManager.query({
      rootPubkey: livePubkey,
      subject: { type: 'i', value: 'user:id:100' },
      context: 'identity',
      now: 20,
    })
    expect(liveHit.resolution).toBe('trusted')

    const demoMiss = ctx.graphManager.query({
      rootPubkey: getPublicKey(demoKey),
      subject: { type: 'i', value: 'user:id:200' },
      context: 'identity',
      now: 20,
    })
    expect(demoMiss.resolution).toBe('none')

    const ratingTrust = ctx.graphManager.query({
      rootPubkey: getPublicKey(raterKey),
      subject: { type: 'i', value: 'post:id:9' },
      context: '',
      now: 20,
    })
    expect(ratingTrust.resolution).toBe('none')
    expect(ctx.graphManager.listClaims()).toHaveLength(1)

    ctx.appMode = 'demo'
    await ctx.graphManager.load()
    const demoHit = ctx.graphManager.query({
      rootPubkey: getPublicKey(demoKey),
      subject: { type: 'i', value: 'user:id:200' },
      context: 'identity',
      now: 20,
    })
    expect(demoHit.resolution).toBe('trusted')
    expect(
      ctx.graphManager.query({
        rootPubkey: livePubkey,
        subject: { type: 'i', value: 'user:id:100' },
        context: 'identity',
        now: 20,
      }).resolution,
    ).toBe('none')

    repository.close()
  })
})

describe('GraphManager applyRecord', () => {
  it('applies ingest without a Dexie rescan and unapplies Delete', async () => {
    const repository = await openRepo()
    const key = generateSecretKey()
    const pubkey = getPublicKey(key)
    const trust = finalizeEvent(
      await buildKind32009Event({
        subject: { type: 'i', value: 'user:id:100' },
        value: '1',
        context: 'identity',
        scopes: ['x.com'],
        k: 'user:id',
        content: '',
        createdAt: 10,
      }),
      key,
    )
    const tombstone = finalizeEvent(
      await buildKind32009Event({
        subject: { type: 'i', value: 'user:id:100' },
        value: '',
        context: 'identity',
        scopes: ['x.com'],
        k: 'user:id',
        content: '',
        createdAt: 11,
      }),
      key,
    )
    const rating = finalizeEvent(
      await buildKind32014Event({
        subject: { type: 'i', value: 'post:id:9' },
        score: '80',
        context: '',
        scopes: ['x.com'],
        k: 'post:id',
        content: '',
        createdAt: 12,
      }),
      key,
    )

    const ctx = createRuntimeContext({
      repository,
      appMode: 'production',
    })
    await ctx.graphManager.load()
    const iterate = vi.spyOn(repository, 'iterateEvents')
    const versionAfterLoad = ctx.graphManager.graphVersion

    const storedTrust = await repository.ingestEvent({ event: trust })
    expect(ctx.graphManager.applyRecord(storedTrust)).toBe(true)
    expect(ctx.graphManager.graphVersion).toBe(versionAfterLoad + 1)
    expect(iterate).not.toHaveBeenCalled()
    expect(
      ctx.graphManager.query({
        rootPubkey: pubkey,
        subject: { type: 'i', value: 'user:id:100' },
        context: 'identity',
        now: 20,
      }).resolution,
    ).toBe('trusted')

    const storedRating = await repository.ingestEvent({ event: rating })
    expect(ctx.graphManager.applyRecord(storedRating)).toBe(true)
    expect(ctx.graphManager.listClaims()).toHaveLength(1)
    expect(iterate).not.toHaveBeenCalled()

    const storedDelete = await repository.ingestEvent({ event: tombstone })
    expect(ctx.graphManager.applyRecord(storedDelete)).toBe(true)
    expect(
      ctx.graphManager.query({
        rootPubkey: pubkey,
        subject: { type: 'i', value: 'user:id:100' },
        context: 'identity',
        now: 20,
      }).resolution,
    ).toBe('none')
    const deleted = ctx.graphManager
      .listStatements()
      .find((row) => row.subject === 'user:id:100')
    expect(deleted?.nValue).toBeUndefined()
    expect(deleted?.id).toBe(storedDelete.id)

    iterate.mockRestore()
    repository.close()
  })

  it('strips leftover native p-trust when applying user:id distrust', async () => {
    const repository = await openRepo()
    const rootKey = generateSecretKey()
    const rootPubkey = getPublicKey(rootKey)
    const neveKey = generateSecretKey()
    const nevePubkey = getPublicKey(neveKey)

    const nativeP = finalizeEvent(
      await buildKind32009Event({
        subject: { type: 'p', value: nevePubkey },
        value: '1',
        context: 'identity',
        scopes: ['x.com'],
        content: '',
        createdAt: 10,
      }),
      rootKey,
    )
    const distrust = finalizeEvent(
      await buildKind32009Event({
        subject: { type: 'i', value: 'user:id:16224' },
        value: '-1',
        context: 'identity',
        scopes: ['x.com'],
        k: 'user:id',
        content: '',
        createdAt: 11,
      }),
      rootKey,
    )

    const ctx = createRuntimeContext({
      repository,
      appMode: 'production',
    })
    await ctx.graphManager.load()
    ctx.twitterIdToPubkey.set('16224', nevePubkey.toLowerCase())
    ctx.graph.bindIdentity('user:id:16224', nevePubkey.toLowerCase())

    ctx.graphManager.applyRecord(await repository.ingestEvent({ event: nativeP }))
    ctx.graphManager.applyRecord(
      await repository.ingestEvent({ event: distrust }),
    )

    expect(
      ctx.graphManager.query({
        rootPubkey: rootPubkey,
        subject: { type: 'p', value: nevePubkey },
        context: 'identity',
        now: 20,
      }).resolution,
    ).toBe('distrusted')
    expect(
      ctx.graphManager.query({
        rootPubkey: rootPubkey,
        subject: { type: 'i', value: 'user:id:16224' },
        context: 'identity',
        now: 20,
      }).resolution,
    ).toBe('distrusted')

    repository.close()
  })

  it('runs graph-column backfill once per chrome.storage marker', async () => {
    const repository = await openRepo()
    const spy = vi.spyOn(repository, 'backfillGraphColumns')
    const ctx = createRuntimeContext({
      repository,
      appMode: 'production',
    })
    await ctx.graphManager.load()
    ctx.graphManager.invalidate()
    await ctx.graphManager.load()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(
      (await chrome.storage.local.get(GRAPH_COLUMNS_BACKFILL_KEY))[
        GRAPH_COLUMNS_BACKFILL_KEY
      ],
    ).toEqual(expect.any(Number))
    spy.mockRestore()
    repository.close()
  })
})
