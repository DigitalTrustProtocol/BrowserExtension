/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

vi.mock('../lib/i18n', () => ({
  t: (key: string) => key,
}))

vi.mock('./pages/GraphPage', () => ({ default: () => null }))
vi.mock('./pages/CockpitPage', () => ({ default: () => null }))
vi.mock('./pages/LogPage', () => ({ default: () => null }))
vi.mock('./pages/UsersPage', () => ({ default: () => null }))
vi.mock('./pages/UserEventsPage', () => ({ default: () => null }))
vi.mock('./pages/EventsPage', () => ({ default: () => null }))
vi.mock('./pages/PostsPage', () => ({ default: () => null }))
vi.mock('./pages/OutboxPage', () => ({ default: () => null }))
vi.mock('./pages/DangerZonePage', () => ({ default: () => null }))
vi.mock('./pages/AdminPage', () => ({ default: () => null }))
vi.mock('./application-tab-title', () => ({
  applyApplicationTabTitle: vi.fn(),
}))
vi.mock('./graph/graph-rpc', () => ({
  closeGraphPage: vi.fn(),
  loadActiveXAccount: vi.fn(() => Promise.resolve(undefined)),
}))

const listeners: Array<(message: unknown) => void> = []

function patchMessageListeners(): void {
  listeners.length = 0
  chrome.runtime.onMessage.addListener = (
    fn: (message: unknown) => void,
  ) => {
    listeners.push(fn)
  }
  chrome.runtime.onMessage.removeListener = (
    fn: (message: unknown) => void,
  ) => {
    const index = listeners.indexOf(fn)
    if (index >= 0) listeners.splice(index, 1)
  }
}

describe('ApplicationApp stale banner', () => {
  let root: Root
  let host: HTMLDivElement

  beforeEach(async () => {
    patchMessageListeners()
    host = document.createElement('div')
    document.body.replaceChildren(host)
    root = createRoot(host)
    const { default: ApplicationApp } = await import('./ApplicationApp')
    await act(async () => {
      root.render(createElement(ApplicationApp))
    })
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    chrome.runtime.onMessage.addListener = function addListener() {}
    chrome.runtime.onMessage.removeListener = function removeListener() {}
  })

  it('shows the banner and clears it on header Refresh', async () => {
    expect(host.querySelector('[data-application-stale]')).toBeNull()

    await act(async () => {
      for (const listener of [...listeners]) {
        listener({ type: 'ACTIVITY_CHANGED' })
      }
    })
    expect(host.querySelector('[data-application-stale]')).not.toBeNull()

    const buttons = [
      ...host.querySelectorAll<HTMLButtonElement>('button'),
    ]
    const refresh = buttons.find(
      (button) => button.textContent === 'application.refresh',
    )
    expect(refresh).toBeDefined()
    await act(async () => {
      refresh?.click()
    })
    expect(host.querySelector('[data-application-stale]')).toBeNull()
  })
})
