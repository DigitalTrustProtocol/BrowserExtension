/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  BACKGROUND_API_VERSION,
  type AppMode,
  type OperatorXBindingRow,
} from '../../../shared/contracts'
import type { OperatorBindingCompleteness } from '../../../shared/operator-binding-status.ts'

vi.mock('@lib/i18n.js', () => ({
  t: (key: string) => key,
}))

const cssProxy = new Proxy({}, { get: (_target, prop) => String(prop) })
vi.mock('./AttentionXPanel.module.css', () => ({ default: cssProxy }))
vi.mock('@components/Button/Button.module.css', () => ({ default: cssProxy }))
vi.mock('@components/Card/Card.module.css', () => ({ default: cssProxy }))
vi.mock('@components/SectionLabel/SectionLabel.module.css', () => ({
  default: cssProxy,
}))

const incompleteCompleteness: OperatorBindingCompleteness = {
  bound: true,
  bioOk: false,
  bioMismatch: false,
  nip39Ok: false,
  backupOk: false,
  complete: false,
}

const completeCompleteness: OperatorBindingCompleteness = {
  bound: true,
  bioOk: true,
  bioMismatch: false,
  nip39Ok: true,
  backupOk: true,
  complete: true,
}

const sessionState: { snapshot: { appMode: AppMode } } = {
  snapshot: { appMode: 'production' },
}

const accountState: { operatorBindings: OperatorXBindingRow[] } = {
  operatorBindings: [],
}

vi.mock('../../context/PanelSessionContext', () => ({
  usePanelSession: () => sessionState,
}))

vi.mock('../../context/AccountContext', () => ({
  useAccount: () => accountState,
}))

type MockRpc = {
  mode: AppMode
  demoEvents: number
  trustEvents: number
  xIdentities: number
}

const rpc: MockRpc = {
  mode: 'production',
  demoEvents: 12,
  trustEvents: 7,
  xIdentities: 4,
}

function signedInBinding(
  completeness: OperatorBindingCompleteness,
): OperatorXBindingRow {
  return {
    twitterId: '44196397',
    handle: 'elonmusk',
    signedIn: true,
    completeness,
  }
}

function mockResponse(type: string | undefined): unknown {
  switch (type) {
    case 'GET_APP_MODE':
      return { mode: rpc.mode }
    case 'GET_DEMO_WOT_STATUS':
      return { eventCount: rpc.demoEvents }
    case 'GET_STATE':
      return {
        hasIdentity: true,
        vaultLocked: false,
        cachedEventCount: rpc.trustEvents,
        relays: [],
      }
    case 'GET_COCKPIT_STATE':
      return {
        generatedAt: 0,
        storage: {
          stores: { xIdentities: rpc.xIdentities },
          eventsByKind: { '32009': rpc.trustEvents },
          outboxByStatus: { pending: 9 },
        },
      }
    case 'QUERY_TRUST_BATCH':
      return {
        graphVersion: 1,
        results: {
          '44196397': { degree: 1, connected: true },
          '13298072': { degree: 3, connected: true },
          '34743251': { degree: 2, connected: true },
        },
      }
    default:
      return {}
  }
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('AttentionXPanel', () => {
  let root: Root
  let host: HTMLDivElement
  let onOpenIdentity: ReturnType<typeof vi.fn<() => void>>
  let sendMessage: ReturnType<
    typeof vi.fn<(request: { type?: string }) => Promise<unknown>>
  >

  beforeEach(() => {
    rpc.mode = 'production'
    rpc.demoEvents = 12
    rpc.trustEvents = 7
    rpc.xIdentities = 4
    sessionState.snapshot = { appMode: 'production' }
    accountState.operatorBindings = [signedInBinding(incompleteCompleteness)]
    onOpenIdentity = vi.fn(() => undefined)
    host = document.createElement('div')
    document.body.replaceChildren(host)
    root = createRoot(host)
    sendMessage = vi.fn(async (request: { type?: string }) => {
      return {
        ok: true,
        version: BACKGROUND_API_VERSION,
        data: mockResponse(request.type),
      }
    })
    chrome.runtime.sendMessage =
      sendMessage as unknown as typeof chrome.runtime.sendMessage
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    document.body.replaceChildren()
  })

  async function renderPanel() {
    const { default: AttentionXPanel } = await import('./AttentionXPanel')
    await act(async () => {
      root.render(
        createElement(AttentionXPanel, { onOpenIdentity }),
      )
    })
    await flush()
  }

  it('shows Live/Demo controls and sparse Live stats without degree or identity tools', async () => {
    await renderPanel()

    expect(host.textContent).toContain('panel.modeLive')
    expect(host.textContent).toContain('panel.modeDemo')
    expect(host.textContent).toContain('panel.modeHintLive')
    expect(host.textContent).toContain('panel.liveTrustData')
    expect(host.textContent).toContain('panel.trustStatements')
    expect(host.textContent).toContain('panel.xIdentities')
    expect(host.textContent).toContain('7')
    expect(host.textContent).toContain('4')
    expect(host.querySelectorAll('input[type="range"]')).toHaveLength(0)
    expect(host.textContent).not.toContain('Check for bio')
    expect(host.textContent).not.toContain('Update Profile')
    expect(host.textContent).not.toContain('Sync relays')
    expect(host.textContent).not.toContain('Identity links')
    expect(host.textContent).not.toContain('Outbox pending')
    expect(host.textContent).not.toContain('Elon')
    expect(host.textContent).not.toContain('SpaceX')
    expect(
      host.querySelector('[title="panel.modeTitleLive"]'),
    ).not.toBeNull()
    expect(
      host.querySelector('[title="panel.modeTitleDemo"]'),
    ).not.toBeNull()
  })

  it('shows Complete setup when Live binding is incomplete', async () => {
    await renderPanel()

    expect(host.textContent).toContain('account.completeSetup')
    expect(host.textContent).toContain('account.completeSetupHint')
    const button = [...host.querySelectorAll('button')].find((el) =>
      el.textContent?.includes('account.completeSetup'),
    )
    expect(button).toBeDefined()
    await act(async () => {
      button?.click()
    })
    expect(onOpenIdentity).toHaveBeenCalledTimes(1)
  })

  it('hides Complete setup when Live binding is complete', async () => {
    accountState.operatorBindings = [signedInBinding(completeCompleteness)]
    await renderPanel()

    expect(host.textContent).not.toContain('account.completeSetup')
    expect(host.textContent).toContain('panel.modeLive')
  })

  it('shows Demo stats and hides Complete setup in Demo', async () => {
    rpc.mode = 'demo'
    sessionState.snapshot = { appMode: 'demo' }
    await renderPanel()

    expect(host.textContent).toContain('panel.modeHintDemo')
    expect(host.textContent).toContain('panel.demoBanner')
    expect(host.textContent).toContain('panel.demoTrustData')
    expect(host.textContent).toContain('panel.demoEvents')
    expect(host.textContent).toContain('12')
    expect(host.textContent).toContain('4')
    expect(host.textContent).not.toContain('account.completeSetup')
    expect(host.textContent).not.toContain('panel.trustStatements')
    expect(host.querySelectorAll('input[type="range"]')).toHaveLength(0)
    expect(host.textContent).toContain('Elon')
    expect(host.textContent).toContain('Tesla')
    expect(host.textContent).toContain('SpaceX')
    expect(
      host.querySelector('[title="panel.modeTitleDemo"]'),
    ).not.toBeNull()
  })

  it('opens the user panel when a Demo account is clicked', async () => {
    rpc.mode = 'demo'
    sessionState.snapshot = { appMode: 'demo' }
    await renderPanel()

    const elon = [...host.querySelectorAll('button')].find((el) =>
      el.textContent?.includes('Elon'),
    )
    expect(elon).toBeDefined()
    await act(async () => {
      elon?.click()
    })
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'SELECT_SUBJECT',
        subject: { type: 'i', value: 'user:id:44196397' },
      }),
    )
  })
})
