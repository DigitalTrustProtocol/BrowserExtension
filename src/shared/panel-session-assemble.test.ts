import { describe, expect, it } from 'vitest'
import { assemblePanelSessionFacts } from './panel-session-assemble.ts'
import type { AssemblePanelSessionInput } from './panel-session-assemble.ts'
import {
  panelNotesBodyVisible,
  resolvePanelRoute,
  type BindingAccountInput,
} from './panel-session.ts'

const PUB = 'aa'.repeat(32)
const SYNC_PUB = 'bb'.repeat(32)

function localBound(): BindingAccountInput {
  return {
    id: 'acct-1',
    pubkey: PUB,
    boundTwitterIds: ['44196397'],
    boundTwitterId: '44196397',
    readOnly: false,
  }
}

function base(overrides: Partial<AssemblePanelSessionInput> = {}): AssemblePanelSessionInput {
  return {
    vaultExists: true,
    vaultLocked: false,
    neverLock: true,
    accounts: [localBound()],
    activeAccountId: 'acct-1',
    lifecycleRaw: {
      version: 1,
      revision: 1,
      everHadAccounts: true,
      restoreSuppressed: false,
      changedAt: 1,
      reason: 'accountPersisted',
    },
    focused: {
      kind: 'ok',
      tabId: 2,
      windowId: 1,
      url: 'https://x.com/home',
      domain: 'x.com',
      isX: true,
    },
    allowedDomains: ['x.com'],
    autoConnectDone: true,
    xObservation: {
      tabId: 2,
      windowId: 1,
      status: 'identified',
      observedAt: 1,
      navigationEpoch: 1,
      account: {
        handle: 'elonmusk',
        twitterId: '44196397',
        detectedAt: 1,
      },
    },
    syncBindingsRaw: {
      version: 1,
      byTwitterId: { '44196397': { pubkey: PUB, updatedAt: 1 } },
    },
    notesRequested: false,
    selected: null,
    canBack: false,
    canForward: false,
    wizardState: null,
    signerPending: [],
    now: 1_000,
    ...overrides,
  }
}

describe('assemblePanelSessionFacts', () => {
  it('routes local bound + identified focused tab to xHome', () => {
    const facts = assemblePanelSessionFacts(base())
    expect(facts.binding.kind).toBe('localBound')
    expect(facts.x.kind).toBe('identified')
    expect(facts.integrity).toBe('ok')
    expect(resolvePanelRoute(facts)).toBe('xHome')
  })

  it('routes timed lock to unlock even when locally bound', () => {
    const facts = assemblePanelSessionFacts(
      base({ vaultLocked: true, neverLock: false }),
    )
    expect(facts.vault.kind).toBe('locked')
    expect(facts.binding.kind).toBe('localBound')
    expect(resolvePanelRoute(facts)).toBe('unlock')
  })

  it('classifies Sync-only binding as remoteOnly, never localBound', () => {
    const facts = assemblePanelSessionFacts(
      base({
        accounts: [
          {
            id: 'other',
            pubkey: PUB,
            boundTwitterIds: [],
            boundTwitterId: null,
            readOnly: false,
          },
        ],
        activeAccountId: 'other',
        syncBindingsRaw: {
          version: 1,
          byTwitterId: { '44196397': { pubkey: SYNC_PUB, updatedAt: 1 } },
        },
      }),
    )
    expect(facts.binding).toEqual({
      kind: 'remoteOnly',
      twitterId: '44196397',
      pubkey: SYNC_PUB,
    })
    expect(resolvePanelRoute(facts)).toBe('xUnbound')
  })

  it('does not treat background tab A identity as focused tab B', () => {
    const facts = assemblePanelSessionFacts(
      base({
        focused: {
          kind: 'ok',
          tabId: 9,
          windowId: 1,
          url: 'https://x.com/home',
          domain: 'x.com',
          isX: true,
        },
        xObservation: undefined,
      }),
    )
    expect(facts.x).toEqual({ kind: 'unknown', tabId: 9 })
  })

  it('keeps first-observed logout distinct from unknown', () => {
    const loggedOut = assemblePanelSessionFacts(
      base({
        xObservation: {
          tabId: 2,
          windowId: 1,
          status: 'loggedOut',
          observedAt: 1,
          navigationEpoch: 1,
        },
      }),
    )
    expect(loggedOut.x).toEqual({ kind: 'loggedOut', tabId: 2 })
    const unknown = assemblePanelSessionFacts(base({ xObservation: undefined }))
    expect(unknown.x).toEqual({ kind: 'unknown', tabId: 2 })
  })

  it('optimistically connects X on the one-time auto-connect offer', () => {
    const facts = assemblePanelSessionFacts(
      base({ allowedDomains: [], autoConnectDone: false }),
    )
    expect(facts.site.kind).toBe('connected')
    expect(facts.site.kind === 'connected' && facts.site.isX).toBe(true)
  })

  it('never-lock locked vault is starting, not timed unlock', () => {
    const facts = assemblePanelSessionFacts(
      base({ vaultLocked: true, neverLock: true }),
    )
    expect(facts.vault.kind).toBe('starting')
  })

  it('resumes first-run wizard only while lifecycle is neverUsed', () => {
    const wizard = { step: 'method', ts: 900 }
    const first = assemblePanelSessionFacts(
      base({
        accounts: [],
        vaultExists: false,
        lifecycleRaw: null,
        wizardState: wizard,
      }),
    )
    expect(first.lifecycle).toBe('neverUsed')
    expect(first.intent.resumableFirstRunWizard).toBe(true)

    const afterClear = assemblePanelSessionFacts(
      base({
        accounts: [],
        vaultExists: false,
        lifecycleRaw: {
          version: 1,
          revision: 2,
          everHadAccounts: true,
          restoreSuppressed: true,
          changedAt: 2,
          reason: 'lastKeyDelete',
        },
        wizardState: wizard,
      }),
    )
    expect(afterClear.lifecycle).toBe('keysCleared')
    expect(afterClear.intent.resumableFirstRunWizard).toBe(false)
  })

  it('counts approvals and unlock waiters separately', () => {
    const facts = assemblePanelSessionFacts(
      base({
        signerPending: [
          { id: '1', waitingForUnlock: false },
          { id: '2', waitingForUnlock: true },
          { id: '3' },
        ],
        notesRequested: true,
      }),
    )
    expect(facts.intent.pendingApprovalCount).toBe(2)
    expect(facts.intent.pendingUnlockCount).toBe(1)
    expect(facts.intent.notesRequested).toBe(true)
  })

  it('copies selected Notes subject independently of the focused X identity', () => {
    const selected = {
      subject: { type: 'i' as const, value: 'user:id:99' },
    }
    const facts = assemblePanelSessionFacts(
      base({
        notesRequested: true,
        selected,
        canBack: true,
        canForward: false,
      }),
    )
    expect(resolvePanelRoute(facts)).toBe('xHome')
    expect(facts.intent.selected).toEqual(selected)
    expect(facts.intent.canBack).toBe(true)
    expect(facts.x).toMatchObject({ twitterId: '44196397' })
    expect(
      panelNotesBodyVisible({
        route: resolvePanelRoute(facts),
        intent: facts.intent,
      }),
    ).toBe(true)
  })

  it('keeps Notes pending through firstRun until accounts exist', () => {
    const selected = {
      subject: { type: 'i' as const, value: 'user:id:44196397' },
    }
    const firstRun = assemblePanelSessionFacts(
      base({
        accounts: [],
        vaultExists: false,
        activeAccountId: null,
        lifecycleRaw: null,
        notesRequested: true,
        selected,
      }),
    )
    expect(resolvePanelRoute(firstRun)).toBe('firstRun')
    expect(firstRun.intent.notesRequested).toBe(true)
    expect(firstRun.intent.selected).toEqual(selected)
    expect(
      panelNotesBodyVisible({
        route: resolvePanelRoute(firstRun),
        intent: firstRun.intent,
      }),
    ).toBe(false)

    const afterCreate = assemblePanelSessionFacts(
      base({
        notesRequested: true,
        selected,
      }),
    )
    expect(resolvePanelRoute(afterCreate)).toBe('xHome')
    expect(
      panelNotesBodyVisible({
        route: resolvePanelRoute(afterCreate),
        intent: afterCreate.intent,
      }),
    ).toBe(true)
  })
})
