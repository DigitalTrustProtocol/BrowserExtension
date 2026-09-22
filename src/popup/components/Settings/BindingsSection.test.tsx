/** @vitest-environment happy-dom */
import type { PropsWithChildren } from 'react'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '../../../../public/locales/en.json'
import { BACKGROUND_API_VERSION } from '../../../shared/contracts'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

const accountContext = vi.hoisted(() => ({
  accounts: [
    {
      id: 'nostr-key',
      pubkey: 'a'.repeat(64),
      name: 'Primary key',
      type: 'generated',
    },
  ],
  reload: vi.fn(),
  reloadOperatorBindings: vi.fn(async () => undefined),
  operatorBindings: [
    {
      twitterId: '123',
      handle: 'alex',
      displayName: 'Alex',
      accountId: 'nostr-key',
      pubkey: 'a'.repeat(64),
      signedIn: true,
      completeness: {
        bound: true,
        bioOk: false,
        bioMismatch: false,
        nip39Ok: false,
        backupOk: false,
        complete: false,
      },
    },
  ],
  operatorBindingsReady: true,
  activeXHandle: 'alex',
  activeXTwitterId: '123',
}))

vi.mock('@lib/i18n.js', () => ({
  t: (key: string, params?: Record<string, string | number>) => {
    let text = (en as Record<string, string>)[key] ?? key
    for (const [name, value] of Object.entries(params ?? {})) {
      text = text.replaceAll(`{${name}}`, String(value))
    }
    return text
  },
}))

vi.mock('../../context/VaultContext', () => ({
  useVault: () => ({ exists: true, locked: false }),
}))

vi.mock('../../context/AccountContext', () => ({
  useAccount: () => accountContext,
}))

vi.mock('@shared/rpc.ts', () => ({ rpc: vi.fn() }))
vi.mock('./UnlinkPanel', () => ({ default: () => null }))
vi.mock('../Home/BioUpdateWizard', () => ({ default: () => null }))
vi.mock('@components/Avatar/Avatar', () => ({ default: () => null }))
vi.mock('@components/XUserBadges/XUserBadges', () => ({ default: () => null }))
vi.mock('@components/Card/Card', () => ({
  default: ({ children }: PropsWithChildren) => <div>{children}</div>,
}))
vi.mock('@components/Button/Button', () => ({
  default: ({
    children,
    onClick,
    disabled,
    title,
  }: PropsWithChildren<{
    onClick?: () => void
    disabled?: boolean
    title?: string
  }>) => (
    <button type="button" disabled={disabled} title={title} onClick={onClick}>
      {children}
    </button>
  ),
}))
vi.mock('@components/SectionLabel/SectionLabel', () => ({
  SectionLabel: ({ children }: PropsWithChildren) => <h2>{children}</h2>,
  SectionHint: ({ children }: PropsWithChildren) => <p>{children}</p>,
}))
vi.mock('./BindingsSection.module.css', () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}))

function buttonByText(host: HTMLElement, text: string): HTMLButtonElement {
  const button = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === text,
  )
  if (!button) throw new Error(`Button not found: ${text}`)
  return button
}

describe('BindingsSection setup steps', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    vi.clearAllMocks()
    Object.assign(accountContext.operatorBindings[0]!.completeness, {
      bound: true,
      bioOk: false,
      bioMismatch: false,
      nip39Ok: false,
      backupOk: false,
      complete: false,
    })
    host = document.createElement('div')
    document.body.replaceChildren(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    document.body.replaceChildren()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
    vi.restoreAllMocks()
  })

  async function renderDetail() {
    const { default: BindingsSection } = await import('./BindingsSection')
    await act(async () => {
      root.render(
        createElement(BindingsSection, {
          detailTwitterId: '123',
          onOpenNostrKeys: vi.fn(),
        }),
      )
    })
  }

  async function renderList(onOpenDetail = vi.fn()) {
    const { default: BindingsSection } = await import('./BindingsSection')
    await act(async () => {
      root.render(
        createElement(BindingsSection, {
          onOpenDetail,
          onOpenNostrKeys: vi.fn(),
        }),
      )
    })
    return onOpenDetail
  }

  it('presents recovery, bio, and Nostr key binding as three explained steps', async () => {
    await renderDetail()

    const steps = host.querySelectorAll('ol[aria-label] > li')
    expect(steps).toHaveLength(3)
    expect(steps[0]?.textContent).toContain('Recovery phrase')
    expect(steps[0]?.textContent).toContain('Save your recovery phrase')
    expect(steps[1]?.textContent).toContain('Bio')
    expect(steps[1]?.textContent).toContain('Add your npub')
    expect(steps[1]?.textContent).toContain('public hint')
    expect(steps[2]?.textContent).toContain('Nostr key binding')
    expect(steps[2]?.textContent).toContain('kind 10011 event')
    expect(steps[2]?.textContent).toContain('Bio is optional')
    expect(steps[2]?.textContent).toContain('does not create an X post')
    expect(buttonByText(host, 'Publish key binding').disabled).toBe(false)
    expect(host.querySelectorAll('[aria-label="Missing"]')).toHaveLength(3)
  })

  it('marks every completed step with a check and done-state background', async () => {
    Object.assign(accountContext.operatorBindings[0]!.completeness, {
      bioOk: true,
      nip39Ok: true,
      backupOk: true,
      complete: true,
    })

    await renderDetail()

    expect(host.querySelectorAll('[aria-label="Completed"]')).toHaveLength(3)
    expect(host.querySelectorAll('[aria-label="Missing"]')).toHaveLength(0)
    expect(host.querySelectorAll('li.setupStepDone')).toHaveLength(3)
  })

  it('publishes kind 10011 without preparing or opening an X post', async () => {
    const sendMessage = vi.fn(async (request: { type?: string }) => {
      if (request.type === 'PUBLISH_X_BINDING') {
        return {
          ok: true,
          version: BACKGROUND_API_VERSION,
          data: {
            status: 'published',
            eventId: 'event-id',
            proofPostId: '456',
            npub: `npub1${'q'.repeat(58)}`,
            handle: 'alex',
            twitterId: '123',
          },
        }
      }
      throw new Error(`Unexpected request: ${request.type}`)
    })
    chrome.runtime.sendMessage =
      sendMessage as unknown as typeof chrome.runtime.sendMessage
    const createTab = vi.fn(async () => ({ id: 9 }))
    chrome.tabs.create = createTab as unknown as typeof chrome.tabs.create

    await renderDetail()
    await act(async () => {
      buttonByText(host, 'Publish key binding').click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage.mock.calls[0]?.[0]).toMatchObject({
      type: 'PUBLISH_X_BINDING',
    })
    expect(createTab).not.toHaveBeenCalled()
    expect(host.textContent).toContain('Nostr key binding published')
  })

  it('opens binding detail from an explicit Detail button', async () => {
    const onOpenDetail = await renderList()
    await act(async () => {
      buttonByText(host, 'Detail').click()
    })
    expect(onOpenDetail).toHaveBeenCalledWith('123')
  })
})
