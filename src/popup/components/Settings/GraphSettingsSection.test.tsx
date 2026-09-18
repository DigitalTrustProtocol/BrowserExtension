/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { BACKGROUND_API_VERSION } from '../../../shared/contracts'

vi.mock('@lib/i18n.js', () => ({
  t: (key: string) => key,
}))

const cssProxy = new Proxy({}, { get: (_target, prop) => String(prop) })
vi.mock('./Settings.module.css', () => ({ default: cssProxy }))
vi.mock('./WotMaxDegreeControl.module.css', () => ({ default: cssProxy }))
vi.mock('./WotFollowTrustThresholdControl.module.css', () => ({
  default: cssProxy,
}))
vi.mock('@components/Button/Button.module.css', () => ({ default: cssProxy }))
vi.mock('@components/Select/Select.module.css', () => ({ default: cssProxy }))
vi.mock('@components/Toggle/Toggle.module.css', () => ({ default: cssProxy }))
vi.mock('@components/SectionLabel/SectionLabel.module.css', () => ({
  default: cssProxy,
}))

describe('GraphSettingsSection', () => {
  let root: Root
  let host: HTMLDivElement

  beforeEach(() => {
    host = document.createElement('div')
    document.body.replaceChildren(host)
    root = createRoot(host)
    chrome.runtime.sendMessage = (async (request: { type?: string }) => {
      const data = mockResponse(request.type)
      return { ok: true, version: BACKGROUND_API_VERSION, data }
    }) as unknown as typeof chrome.runtime.sendMessage
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    document.body.replaceChildren()
  })

  it('keeps degree and follow-trust controls and omits relay sync', async () => {
    const { default: GraphSettingsSection } = await import(
      './GraphSettingsSection'
    )
    await act(async () => {
      root.render(createElement(GraphSettingsSection))
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(host.textContent).toContain('settings.graph.degreeHintDemo')
    expect(host.textContent).toContain('settings.graph.followTrustHint')
    expect(host.textContent).not.toContain('settings.graph.syncNow')
    expect(host.textContent).not.toContain('settings.dataSync.syncNow')
    const ranges = host.querySelectorAll('input[type="range"]')
    expect(ranges.length).toBeGreaterThanOrEqual(2)
  })
})

function mockResponse(type: string | undefined): unknown {
  switch (type) {
    case 'GET_STATE':
      return {
        wotMaxDegree: 4,
        followTrustRed: 25,
        followTrustGreen: 75,
        relays: [],
        cachedEventCount: 0,
        hasIdentity: true,
      }
    case 'GET_WOT_AUTO_LOWER':
      return { enabled: true }
    case 'GET_APP_MODE':
      return { mode: 'demo' }
    default:
      return {}
  }
}
