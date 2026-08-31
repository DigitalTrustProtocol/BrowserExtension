import { describe, expect, it } from 'vitest'
import { MAX_BOUND_X_ACCOUNTS } from '../accounts/x-binding.ts'
import {
  atCapFromAccounts,
  buildPanelSnapshot,
  classifyBinding,
  classifyIntegrity,
  classifyVault,
  isNewerRevision,
  panelSessionSnapshotFromUnknown,
  resolvePanelRoute,
  type BindingAccountInput,
  type PanelSessionFacts,
} from './panel-session.ts'

function account(
  id: string,
  pubkey: string,
  bound?: string[],
  readOnly = false,
): BindingAccountInput {
  return {
    id,
    pubkey,
    readOnly,
    boundTwitterIds: bound,
  }
}

const HEX_A = 'aa'.repeat(32)
const HEX_B = 'bb'.repeat(32)

function facts(partial: Partial<PanelSessionFacts>): PanelSessionFacts {
  return {
    integrity: 'ok',
    vault: {
      kind: 'ready',
      neverLock: true,
      accountCount: 1,
      activeAccountId: 'a1',
    },
    lifecycle: 'active',
    site: {
      kind: 'connected',
      tabId: 1,
      windowId: 1,
      url: 'https://x.com/home',
      domain: 'x.com',
      isX: true,
    },
    x: { kind: 'identified', tabId: 1, twitterId: '42', handle: 'alice' },
    binding: {
      kind: 'localBound',
      twitterId: '42',
      accountId: 'a1',
      pubkey: HEX_A,
    },
    intent: {
      notesRequested: false,
      resumableFirstRunWizard: false,
      pendingApprovalCount: 0,
      pendingUnlockCount: 0,
    },
    atCap: false,
    ...partial,
  }
}

describe('classifyVault', () => {
  it('is absent when no vault and no accounts', () => {
    expect(
      classifyVault({
        vaultExists: false,
        locked: true,
        neverLock: false,
        accountCount: 0,
      }),
    ).toEqual({ kind: 'absent' })
  })

  it('treats read-only accounts without a vault as ready', () => {
    expect(
      classifyVault({
        vaultExists: false,
        locked: true,
        neverLock: false,
        accountCount: 1,
        activeAccountId: 'ro',
      }).kind,
    ).toBe('ready')
  })

  it('is starting for never-lock while still locked', () => {
    expect(
      classifyVault({
        vaultExists: true,
        locked: true,
        neverLock: true,
        accountCount: 1,
        activeAccountId: 'a1',
      }).kind,
    ).toBe('starting')
  })

  it('is locked for timed lock', () => {
    expect(
      classifyVault({
        vaultExists: true,
        locked: true,
        neverLock: false,
        accountCount: 1,
      }).kind,
    ).toBe('locked')
  })
})

describe('classifyBinding', () => {
  it('is notApplicable without a twitterId', () => {
    expect(
      classifyBinding({ twitterId: null, localAccounts: [account('a', HEX_A)] }),
    ).toEqual({ kind: 'notApplicable' })
  })

  it('returns localBound from the mirror', () => {
    expect(
      classifyBinding({
        twitterId: '42',
        localAccounts: [account('a1', HEX_A, ['42'])],
      }),
    ).toEqual({
      kind: 'localBound',
      twitterId: '42',
      accountId: 'a1',
      pubkey: HEX_A,
    })
  })

  it('does not treat Sync-only evidence as a usable local bind', () => {
    expect(
      classifyBinding({
        twitterId: '42',
        localAccounts: [account('a1', HEX_A)],
        syncPubkey: HEX_B,
      }),
    ).toEqual({ kind: 'remoteOnly', twitterId: '42', pubkey: HEX_B })
  })

  it('flags duplicate local bindings and local/Sync pubkey mismatch', () => {
    expect(
      classifyBinding({
        twitterId: '42',
        localAccounts: [
          account('a1', HEX_A, ['42']),
          account('a2', HEX_B, ['42']),
        ],
      }).kind,
    ).toBe('inconsistent')
    expect(
      classifyBinding({
        twitterId: '42',
        localAccounts: [account('a1', HEX_A, ['42'])],
        syncPubkey: HEX_B,
      }).kind,
    ).toBe('inconsistent')
  })

  it('flags a Sync pubkey that exists locally but is not bound to this X', () => {
    expect(
      classifyBinding({
        twitterId: '42',
        localAccounts: [account('a1', HEX_A, ['99'])],
        syncPubkey: HEX_A,
      }),
    ).toMatchObject({
      kind: 'inconsistent',
      reason: 'sync-pubkey-unbound-locally',
    })
  })
})

describe('classifyIntegrity', () => {
  it('is inconsistent for writable accounts without a vault', () => {
    expect(
      classifyIntegrity({
        vaultExists: false,
        vaultLocked: true,
        accounts: [account('a1', HEX_A)],
        binding: { kind: 'notApplicable' },
      }),
    ).toBe('inconsistent')
  })

  it('allows read-only accounts without a vault', () => {
    expect(
      classifyIntegrity({
        vaultExists: false,
        vaultLocked: true,
        accounts: [account('a1', HEX_A, undefined, true)],
        activeAccountId: 'a1',
        binding: { kind: 'notApplicable' },
      }),
    ).toBe('ok')
  })

  it('is repairing when the active id is missing from the mirror', () => {
    expect(
      classifyIntegrity({
        vaultExists: true,
        vaultLocked: false,
        accounts: [account('a1', HEX_A)],
        activeAccountId: 'missing',
        binding: { kind: 'notApplicable' },
      }),
    ).toBe('repairing')
  })
})

describe('resolvePanelRoute', () => {
  it('covers every named route', () => {
    expect(resolvePanelRoute(facts({ integrity: 'inconsistent' }))).toBe(
      'integrity',
    )
    expect(
      resolvePanelRoute(
        facts({
          vault: {
            kind: 'locked',
            neverLock: false,
            accountCount: 1,
            activeAccountId: 'a1',
          },
        }),
      ),
    ).toBe('unlock')
    expect(
      resolvePanelRoute(
        facts({
          vault: { kind: 'absent' },
          lifecycle: 'neverUsed',
          binding: { kind: 'notApplicable' },
          x: { kind: 'notApplicable' },
        }),
      ),
    ).toBe('firstRun')
    expect(
      resolvePanelRoute(
        facts({
          vault: { kind: 'absent' },
          lifecycle: 'keysCleared',
          binding: { kind: 'notApplicable' },
          x: { kind: 'notApplicable' },
        }),
      ),
    ).toBe('afterKeyClear')
    expect(
      resolvePanelRoute(facts({ site: { kind: 'unavailable' } })),
    ).toBe('noSite')
    expect(
      resolvePanelRoute(
        facts({
          site: {
            kind: 'disconnected',
            tabId: 1,
            windowId: 1,
            url: 'https://x.com/home',
            domain: 'x.com',
            isX: true,
          },
        }),
      ),
    ).toBe('siteDisconnected')
    expect(
      resolvePanelRoute(
        facts({
          site: {
            kind: 'connected',
            tabId: 2,
            windowId: 1,
            url: 'https://example.com',
            domain: 'example.com',
            isX: false,
          },
          x: { kind: 'notApplicable' },
          binding: { kind: 'notApplicable' },
        }),
      ),
    ).toBe('offXHome')
    expect(
      resolvePanelRoute(facts({ x: { kind: 'unknown', tabId: 1 } })),
    ).toBe('xUnknown')
    expect(
      resolvePanelRoute(facts({ x: { kind: 'loggedOut', tabId: 1 } })),
    ).toBe('xLoggedOut')
    expect(
      resolvePanelRoute(
        facts({
          binding: { kind: 'unbound', twitterId: '42' },
        }),
      ),
    ).toBe('xUnbound')
    expect(
      resolvePanelRoute(
        facts({
          binding: { kind: 'remoteOnly', twitterId: '42', pubkey: HEX_B },
        }),
      ),
    ).toBe('xUnbound')
    expect(resolvePanelRoute(facts({}))).toBe('xHome')
  })

  it('does not treat a timed-locked bound vault as unbound', () => {
    expect(
      resolvePanelRoute(
        facts({
          vault: {
            kind: 'locked',
            neverLock: false,
            accountCount: 1,
            activeAccountId: 'a1',
          },
          binding: {
            kind: 'localBound',
            twitterId: '42',
            accountId: 'a1',
            pubkey: HEX_A,
          },
        }),
      ),
    ).toBe('unlock')
  })

  it('does not send never-lock starting to unlock', () => {
    expect(
      resolvePanelRoute(
        facts({
          vault: {
            kind: 'starting',
            neverLock: true,
            accountCount: 1,
            activeAccountId: 'a1',
          },
        }),
      ),
    ).toBe('xHome')
  })

  it('never selects Home from inconsistent facts', () => {
    expect(
      resolvePanelRoute(
        facts({
          integrity: 'inconsistent',
          binding: {
            kind: 'inconsistent',
            twitterId: '42',
            reason: 'duplicate-local-binding',
          },
        }),
      ),
    ).toBe('integrity')
  })
})

describe('atCap / revision / snapshot parse', () => {
  it('reports at-cap from distinct twitterIds', () => {
    const ids = Array.from({ length: MAX_BOUND_X_ACCOUNTS }, (_, i) =>
      String(i + 1),
    )
    expect(atCapFromAccounts([account('a1', HEX_A, ids)])).toBe(true)
    expect(atCapFromAccounts([account('a1', HEX_A, ['1'])])).toBe(false)
  })

  it('rejects stale revisions', () => {
    expect(isNewerRevision(2, 1)).toBe(true)
    expect(isNewerRevision(1, 1)).toBe(false)
    expect(isNewerRevision(0, 4)).toBe(false)
  })

  it('round-trips a snapshot through the runtime parser', () => {
    const snap = buildPanelSnapshot(facts({}), 3, 1_000)
    expect(panelSessionSnapshotFromUnknown(snap)).toEqual(snap)
    expect(panelSessionSnapshotFromUnknown({ revision: 1 })).toBeNull()
  })
})
