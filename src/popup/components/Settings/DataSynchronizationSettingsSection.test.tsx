/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { BACKGROUND_API_VERSION } from '../../../shared/contracts'

vi.mock('@lib/i18n.js', () => ({
  t: (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}))

const cssProxy = new Proxy({}, { get: (_target, prop) => String(prop) })
vi.mock('./Settings.module.css', () => ({ default: cssProxy }))
vi.mock('@components/Button/Button.module.css', () => ({ default: cssProxy }))
vi.mock('@components/Select/Select.module.css', () => ({ default: cssProxy }))
vi.mock('@components/Toggle/Toggle.module.css', () => ({ default: cssProxy }))
vi.mock('@components/SectionLabel/SectionLabel.module.css', () => ({
  default: cssProxy,
}))

type MockState = {
  mode: 'demo' | 'production'
  intervalMinutes: number
  strategy: string
  enabled: boolean
  status: { state: string; error?: string; finishedAt?: number; result?: { eventsStored: number } }
  failInterval?: boolean
  failStrategy?: boolean
}

const state: MockState = {
  mode: 'demo',
  intervalMinutes: 15,
  strategy: 'frontier-interval',
  enabled: true,
  status: { state: 'idle' },
}

describe('DataSynchronizationSettingsSection', () => {
  let root: Root
  let host: HTMLDivElement

  beforeEach(() => {
    state.mode = 'demo'
    state.intervalMinutes = 15
    state.strategy = 'frontier-interval'
    state.enabled = true
    state.status = { state: 'idle' }
    state.failInterval = false
    state.failStrategy = false
    host = document.createElement('div')
    document.body.replaceChildren(host)
    root = createRoot(host)
    chrome.runtime.sendMessage = (async (request: {
      type?: string
      intervalMinutes?: number
      strategy?: string
      enabled?: boolean
    }) => {
      switch (request.type) {
        case 'GET_WOT_SYNC_INTERVAL':
          return {
            ok: true,
            version: BACKGROUND_API_VERSION,
            data: { intervalMinutes: state.intervalMinutes },
          }
        case 'GET_APP_MODE':
          return {
            ok: true,
            version: BACKGROUND_API_VERSION,
            data: { mode: state.mode },
          }
        case 'GET_SYNC_STRATEGY':
          return {
            ok: true,
            version: BACKGROUND_API_VERSION,
            data: { strategy: state.strategy },
          }
        case 'GET_EXTERNAL_PROFILES':
          return {
            ok: true,
            version: BACKGROUND_API_VERSION,
            data: { enabled: state.enabled },
          }
        case 'GET_WOT_SYNC_STATUS':
          return {
            ok: true,
            version: BACKGROUND_API_VERSION,
            data: state.status,
          }
        case 'SET_WOT_SYNC_INTERVAL':
          if (state.failInterval) {
            return { ok: false, version: BACKGROUND_API_VERSION, error: 'interval failed' }
          }
          state.intervalMinutes = request.intervalMinutes ?? state.intervalMinutes
          return {
            ok: true,
            version: BACKGROUND_API_VERSION,
            data: { intervalMinutes: state.intervalMinutes },
          }
        case 'SET_SYNC_STRATEGY':
          if (state.failStrategy) {
            return { ok: false, version: BACKGROUND_API_VERSION, error: 'strategy failed' }
          }
          state.strategy = request.strategy ?? state.strategy
          return {
            ok: true,
            version: BACKGROUND_API_VERSION,
            data: { strategy: state.strategy },
          }
        case 'SET_EXTERNAL_PROFILES':
          state.enabled = request.enabled ?? state.enabled
          return {
            ok: true,
            version: BACKGROUND_API_VERSION,
            data: { enabled: state.enabled },
          }
        case 'START_WOT_SYNC':
          state.status = { state: 'running' }
          return {
            ok: true,
            version: BACKGROUND_API_VERSION,
            data: state.status,
          }
        default:
          return { ok: true, version: BACKGROUND_API_VERSION, data: {} }
      }
    }) as unknown as typeof chrome.runtime.sendMessage
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    document.body.replaceChildren()
  })

  async function renderSection() {
    const { default: DataSynchronizationSettingsSection } = await import(
      './DataSynchronizationSettingsSection'
    )
    await act(async () => {
      root.render(createElement(DataSynchronizationSettingsSection))
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  it('disables Sync now and shows demo copy in demo mode', async () => {
    await renderSection()
    expect(host.textContent).toContain('settings.dataSync.syncDemo')
    expect(host.textContent).toContain('settings.dataSync.strategy')
    expect(host.textContent).toContain('settings.dataSync.externalProfiles')
    const syncNow = [...host.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('settings.dataSync.syncNow'),
    )
    expect(syncNow).toBeDefined()
    expect(syncNow?.disabled).toBe(true)
    expect(host.querySelector('select')?.getAttribute('aria-label')).toBe(
      'settings.dataSync.strategy',
    )
  })

  it('shows subscribe-all warning and starts a manual sync in live mode', async () => {
    state.mode = 'production'
    state.strategy = 'global-continuous'
    await renderSection()
    expect(host.textContent).toContain('settings.dataSync.strategy.subscribeAllHint')
    expect(host.textContent).toContain('settings.dataSync.strategy.continuousHint')
    expect(
      host.querySelector('[aria-label="settings.dataSync.refresh"]'),
    ).toBeNull()
    const syncNow = [...host.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('settings.dataSync.syncNow'),
    )
    expect(syncNow?.disabled).toBe(false)
    await act(async () => {
      syncNow?.click()
    })
    expect(state.status.state).toBe('running')
  })

  it('shows the refresh interval only for interval strategy', async () => {
    await renderSection()
    expect(
      host.querySelector('[aria-label="settings.dataSync.refresh"]'),
    ).not.toBeNull()
    const strategy = host.querySelector('select') as HTMLSelectElement
    await act(async () => {
      strategy.value = 'frontier-continuous'
      strategy.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(
      host.querySelector('[aria-label="settings.dataSync.refresh"]'),
    ).toBeNull()
    expect(host.textContent).toContain('settings.dataSync.strategy.continuousHint')
  })

  it('rolls interval changes back when save fails', async () => {
    state.mode = 'production'
    state.failInterval = true
    await renderSection()
    const interval = host.querySelectorAll('select')[1] as HTMLSelectElement
    expect(interval.value).toBe('15')
    await act(async () => {
      interval.value = '0'
      interval.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(host.textContent).toContain('interval failed')
    expect(interval.value).toBe('15')
  })
})
