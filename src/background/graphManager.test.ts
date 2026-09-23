import 'fake-indexeddb/auto'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRuntimeContext } from './runtimeContext'
import { npubFromPubkey } from '../identity/x-identity-row'
import { demoActorPubkey } from '../shared/demo-actor-key.ts'
import { buildKind32009Event } from '../lib/nostr/kind-32009'
import { buildKind32014Event } from '../lib/nostr/kind-32014'
import {
  AttentionXRepository,
  deleteAttentionXDatabase,
} from '../storage'
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

  it('loads xIdentities/xPosts chrome onto the Graph and binds verified rows', async () => {
    const repository = await openRepo()
    const key = generateSecretKey()
    const pubkey = getPublicKey(key)
    const npub = npubFromPubkey(pubkey)
    expect(npub).toBeTruthy()
    await repository.putXIdentity({
      twitterId: '16224',
      handle: 'neve',
      displayName: 'Neve',
      postNpub: npub,
      state: 'verified',
      verifiedAt: 1,
      createdAt: 1,
      updatedAt: 1,
      lastSeen: 1,
    })
    await repository.upsertXPostChrome(
      { postId: '9', headline: 'hello', authorHandle: 'neve' },
      1,
    )
    const ctx = createRuntimeContext({
      repository,
      appMode: 'production',
    })
    await ctx.graphManager.load()
    expect(ctx.graphManager.identityDisplay('16224')).toMatchObject({
      twitterId: '16224',
      handle: 'neve',
      displayName: 'Neve',
    })
    expect(ctx.graphManager.postDisplay('9')).toMatchObject({
      headline: 'hello',
      authorHandle: 'neve',
    })
    expect(ctx.graphManager.pubkeyForTwitterId('16224')).toBe(
      pubkey.toLowerCase(),
    )
    expect(ctx.graphManager.twitterIdForPubkey(pubkey)).toBe('16224')
    repository.close()
  })
})

describe('GraphManager incomingRecords', () => {
  it('returns post trust without c, identity trust, and ratings per subject', async () => {
    const repository = await openRepo()
    const trusterKey = generateSecretKey()
    const raterKey = generateSecretKey()
    const postTrust = finalizeEvent(
      await buildKind32009Event({
        subject: { type: 'i', value: 'post:id:9' },
        value: '1',
        context: '',
        scopes: ['x.com'],
        k: 'post:id',
        content: '',
        createdAt: 10,
      }),
      trusterKey,
    )
    const rating = finalizeEvent(
      await buildKind32014Event({
        subject: { type: 'i', value: 'post:id:9' },
        score: '80',
        context: '',
        scopes: ['x.com'],
        k: 'post:id',
        content: '',
        createdAt: 11,
      }),
      raterKey,
    )
    const userTrust = finalizeEvent(
      await buildKind32009Event({
        subject: { type: 'i', value: 'user:id:100' },
        value: '0',
        context: 'identity',
        scopes: ['x.com'],
        k: 'user:id',
        content: '',
        createdAt: 12,
      }),
      trusterKey,
    )
    for (const event of [postTrust, rating, userTrust]) {
      await repository.ingestEvent({ event })
    }
    const ctx = createRuntimeContext({ repository, appMode: 'production' })
    await ctx.graphManager.load()

    expect(
      ctx.graphManager
        .incomingRecords(['post:id:9'])
        .map((record) => record.id)
        .sort(),
    ).toEqual([postTrust.id, rating.id].sort())
    expect(
      ctx.graphManager.incomingRecords(['user:id:100']).map((r) => r.id),
    ).toEqual([userTrust.id])
    expect(ctx.graphManager.incomingRecords(['post:id:404'])).toEqual([])
    repository.close()
  })

  it('keeps a bound user:id apart from follows aimed at its pubkey', async () => {
    const repository = await openRepo()
    const boundKey = generateSecretKey()
    const boundPubkey = getPublicKey(boundKey)
    const trusterKey = generateSecretKey()
    await repository.putXIdentity({
      twitterId: '100',
      handle: 'bound',
      postNpub: npubFromPubkey(boundPubkey),
      state: 'verified',
      verifiedAt: 1,
      createdAt: 1,
      updatedAt: 1,
      lastSeen: 1,
    })
    const aboutXUser = finalizeEvent(
      await buildKind32009Event({
        subject: { type: 'i', value: 'user:id:100' },
        value: '1',
        context: 'identity',
        scopes: ['x.com'],
        k: 'user:id',
        content: '',
        createdAt: 10,
      }),
      trusterKey,
    )
    const follow = finalizeEvent(
      await buildKind32009Event({
        subject: { type: 'p', value: boundPubkey },
        value: '1',
        context: 'identity',
        scopes: [],
        content: '',
        createdAt: 11,
      }),
      trusterKey,
    )
    await repository.ingestEvent({ event: aboutXUser })
    await repository.ingestEvent({ event: follow })
    const ctx = createRuntimeContext({ repository, appMode: 'production' })
    await ctx.graphManager.load()
    expect(ctx.graphManager.pubkeyForTwitterId('100')).toBe(boundPubkey)

    expect(
      ctx.graphManager.incomingRecords(['user:id:100']).map((r) => r.id),
    ).toEqual([aboutXUser.id])
    expect(
      ctx.graphManager.incomingRecords([boundPubkey]).map((r) => r.id),
    ).toEqual([follow.id])
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

  it('keeps leftover native p-trust on the heap when applying user:id distrust', async () => {
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

    ctx.graphManager.applyRecord(await repository.ingestEvent({ event: nativeP }))
    ctx.graphManager.applyRecord(
      await repository.ingestEvent({ event: distrust }),
    )

    expect(
      ctx.graphManager
        .listStatements()
        .some(
          (row) =>
            row.subjectType === 'p' &&
            row.subject === nevePubkey.toLowerCase() &&
            row.nValue === 1,
        ),
    ).toBe(true)
    expect(
      ctx.graphManager.query({
        rootPubkey: rootPubkey,
        subject: { type: 'p', value: nevePubkey },
        context: 'identity',
        now: 20,
      }).resolution,
    ).toBe('trusted')
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
})

describe('GraphManager person bind (one heap index)', () => {
  it('holds unbound user:id as i, then rewrites Node.id in place when bound', async () => {
    const repository = await openRepo()
    const rootKey = generateSecretKey()
    const subjectKey = generateSecretKey()
    const subjectPubkey = getPublicKey(subjectKey)
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
      rootKey,
    )
    const ctx = createRuntimeContext({
      repository,
      appMode: 'production',
    })
    await ctx.graphManager.load()
    expect(ctx.graphManager.pubkeyForTwitterId('100')).toBeUndefined()

    expect(
      ctx.graphManager.applyRecord(await repository.ingestEvent({ event: trust })),
    ).toBe(true)
    const before = ctx.graph.getNode('user:id:100')
    expect(before?.type).toBe('i')
    expect(before?.id).toBe('user:id:100')
    const index = before!.index

    ctx.graphManager.bindTwitterIdentity('100', subjectPubkey)
    const after = ctx.graph.getNode('user:id:100')
    expect(after?.index).toBe(index)
    expect(after?.type).toBe('p')
    expect(after?.id).toBe(subjectPubkey.toLowerCase())
    expect(ctx.graph.getNode(subjectPubkey)?.index).toBe(index)

    repository.close()
  })

  it('does not bind an unverified row with no eventNpub', async () => {
    const repository = await openRepo()
    await repository.putXIdentity({
      twitterId: '100',
      handle: 'nobody',
      state: 'unverified',
      createdAt: 1,
      updatedAt: 1,
      lastSeen: 1,
    })
    const ctx = createRuntimeContext({
      repository,
      appMode: 'production',
    })
    await ctx.graphManager.load()
    expect(ctx.graphManager.pubkeyForTwitterId('100')).toBeUndefined()
    repository.close()
  })

  it('in demo binds the derived X-id pubkey even when bio would win', async () => {
    const repository = await openRepo()
    const bioKey = generateSecretKey()
    const bioPubkey = getPublicKey(bioKey)
    const bioNpub = npubFromPubkey(bioPubkey)
    expect(bioNpub).toBeTruthy()
    await repository.putXIdentity({
      twitterId: '44196397',
      handle: 'elonmusk',
      xNpub: bioNpub,
      state: 'verified',
      proofSource: 'bio',
      verifiedAt: 1,
      createdAt: 1,
      updatedAt: 1,
      lastSeen: 1,
    })
    const ctx = createRuntimeContext({
      repository,
      appMode: 'demo',
    })
    await ctx.graphManager.load()
    expect(ctx.graphManager.pubkeyForTwitterId('44196397')).toBe(
      demoActorPubkey('44196397'),
    )
    expect(ctx.graphManager.pubkeyForTwitterId('44196397')).not.toBe(
      bioPubkey.toLowerCase(),
    )
    repository.close()
  })

  it('in demo binds every X id to its derived key', async () => {
    const repository = await openRepo()
    await repository.putXIdentity({
      twitterId: '42',
      handle: 'alice',
      state: 'unverified',
      createdAt: 1,
      updatedAt: 1,
      lastSeen: 1,
    })
    const ctx = createRuntimeContext({
      repository,
      appMode: 'demo',
      demoRootTwitterId: '42',
    })
    await ctx.graphManager.load()
    expect(ctx.graphManager.pubkeyForTwitterId('42')).toBe(demoActorPubkey('42'))
    repository.close()
  })

  it('in production ignores leftover demo-actor eventNpub', async () => {
    const repository = await openRepo()
    const demoNpub = npubFromPubkey(demoActorPubkey('100'))
    expect(demoNpub).toBeTruthy()
    await repository.putXIdentity({
      twitterId: '100',
      handle: 'nobody',
      eventNpub: demoNpub,
      state: 'verified',
      proofSource: 'trust32009',
      createdAt: 1,
      updatedAt: 1,
      lastSeen: 1,
    })
    const ctx = createRuntimeContext({
      repository,
      appMode: 'production',
    })
    await ctx.graphManager.load()
    expect(ctx.graphManager.pubkeyForTwitterId('100')).toBeUndefined()
    repository.close()
  })

  it('aliases operator user:id onto the existing vault p index', async () => {
    const repository = await openRepo()
    const rootKey = generateSecretKey()
    const rootPubkey = getPublicKey(rootKey)
    const hop = finalizeEvent(
      await buildKind32009Event({
        subject: { type: 'i', value: 'user:id:999' },
        value: '1',
        context: 'identity',
        scopes: ['x.com'],
        k: 'user:id',
        content: '',
        createdAt: 10,
      }),
      rootKey,
    )
    const ctx = createRuntimeContext({
      repository,
      appMode: 'production',
    })
    await ctx.graphManager.load()
    ctx.graphManager.applyRecord(await repository.ingestEvent({ event: hop }))
    const rootIndex = ctx.graph.getNode(rootPubkey)?.index
    expect(rootIndex).toBeDefined()

    ctx.graphManager.bindTwitterIdentity('555', rootPubkey)
    expect(ctx.graph.getNode('user:id:555')?.index).toBe(rootIndex)
    expect(ctx.graph.getNode(rootPubkey)?.index).toBe(rootIndex)

    repository.close()
  })

  it('expands positive children through verified X-to-Nostr aliases', async () => {
    const repository = await openRepo()
    const rootKey = generateSecretKey()
    const rootPubkey = getPublicKey(rootKey)
    const boundKey = generateSecretKey()
    const boundPubkey = getPublicKey(boundKey)
    const hop = finalizeEvent(
      await buildKind32009Event({
        subject: { type: 'i', value: 'user:id:777' },
        value: '1',
        context: 'identity',
        scopes: ['x.com'],
        k: 'user:id',
        content: '',
        createdAt: 10,
      }),
      rootKey,
    )
    const ctx = createRuntimeContext({
      repository,
      appMode: 'production',
    })
    await ctx.graphManager.load()
    ctx.graphManager.applyRecord(await repository.ingestEvent({ event: hop }))
    ctx.graphManager.bindTwitterIdentity('777', boundPubkey)

    expect(ctx.graphManager.positiveChildren([rootPubkey], 20)).toEqual([
      boundPubkey,
    ])
    expect(
      ctx.graphManager.authorsFromRoots([rootPubkey], 20, {
        maxDepth: 1,
        maxAuthorsPerLevel: 10,
        maxTotalAuthors: 10,
      }).authors,
    ).toEqual(expect.arrayContaining([rootPubkey, boundPubkey]))
    expect(ctx.graphManager.referencedTwitterIds()).toContain('777')
    repository.close()
  })
})
