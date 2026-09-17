/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { BACKGROUND_API_VERSION } from '../../../shared/contracts'
import en from '../../../../public/locales/en.json'

vi.mock('@lib/i18n.js', () => ({
  t: (key: string, params?: Record<string, string | number>) => {
    let text = (en as Record<string, string>)[key] ?? key
    if (!params) return text
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value))
    }
    return text
  },
}))

const cssProxy = new Proxy({}, { get: (_target, prop) => String(prop) })
vi.mock('./Settings.module.css', () => ({ default: cssProxy }))
vi.mock('../Menu/MenuOverlay.module.css', () => ({ default: cssProxy }))
vi.mock('@components/Toggle/Toggle.module.css', () => ({ default: cssProxy }))
vi.mock('@components/SectionLabel/SectionLabel.module.css', () => ({
  default: cssProxy,
}))

describe('DisplaySettingsSection', () => {
  let root: Root
  let host: HTMLDivElement

  beforeEach(() => {
    host = document.createElement('div')
    document.body.replaceChildren(host)
    root = createRoot(host)
    chrome.runtime.sendMessage = (async (request: { type?: string }) => {
      if (request.type === 'GET_STATE') {
        return {
          ok: true,
          version: BACKGROUND_API_VERSION,
          data: {
            wotMaxDegree: 4,
            followTrustRed: 40,
            followTrustGreen: 60,
            relays: [],
            cachedEventCount: 0,
            hasIdentity: true,
          },
        }
      }
      return { ok: true, version: BACKGROUND_API_VERSION, data: {} }
    }) as unknown as typeof chrome.runtime.sendMessage
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    document.body.replaceChildren()
  })

  it('labels Trusted and Distrusted with the Graph follow-trust cuts', async () => {
    const { default: DisplaySettingsSection } = await import(
      './DisplaySettingsSection'
    )
    await act(async () => {
      root.render(createElement(DisplaySettingsSection))
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(host.textContent).toContain('Trusted (≥60%)')
    expect(host.textContent).toContain('Distrusted (<40%)')
    expect(host.textContent).toContain('newly loaded posts')
    expect(host.querySelectorAll('select')).toHaveLength(0)
    expect(host.querySelectorAll('input[type="range"]')).toHaveLength(0)
    expect(host.querySelectorAll('input[type="checkbox"]').length).toBeGreaterThanOrEqual(
      4,
    )
  })

  it('writes hide toggles to storage', async () => {
    const set = vi.fn<(items: Record<string, unknown>) => Promise<void>>()
    set.mockResolvedValue(undefined)
    chrome.storage.local.set = set as unknown as typeof chrome.storage.local.set
    const { default: DisplaySettingsSection } = await import(
      './DisplaySettingsSection'
    )
    await act(async () => {
      root.render(createElement(DisplaySettingsSection))
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    const checkboxes = [
      ...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ]
    const last = checkboxes.at(-1)
    expect(last).toBeTruthy()
    await act(async () => {
      last!.click()
    })
    expect(set).toHaveBeenCalled()
    const payload = set.mock.calls.at(-1)?.[0] as
      | {
          xAugmentationFeatures?: { trustFilters?: Record<string, boolean> }
        }
      | undefined
    expect(payload?.xAugmentationFeatures?.trustFilters?.none).toBe(true)
  })
})
