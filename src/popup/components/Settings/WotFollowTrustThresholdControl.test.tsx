/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_FOLLOW_TRUST_BAND } from '../../../shared/wot-follow-trust-threshold'

vi.mock('@lib/i18n.js', () => ({
  t: (key: string) => key,
}))

const cssProxy = new Proxy({}, { get: (_target, prop) => String(prop) })
vi.mock('./WotFollowTrustThresholdControl.module.css', () => ({
  default: cssProxy,
}))

function setRangeValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

describe('WotFollowTrustThresholdControl', () => {
  let root: Root
  let host: HTMLDivElement

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    document.body.replaceChildren()
  })

  it('renders two thumbs with color-blind labels and commits the red knob', async () => {
    host = document.createElement('div')
    document.body.replaceChildren(host)
    root = createRoot(host)
    const onCommit = vi.fn()
    const { default: Control } = await import(
      './WotFollowTrustThresholdControl'
    )
    await act(async () => {
      root.render(
        createElement(Control, {
          band: DEFAULT_FOLLOW_TRUST_BAND,
          description: 'hint',
          onCommit,
        }),
      )
    })

    const red = host.querySelector(
      'input[aria-label="settings.graph.followTrustRedSlider"]',
    )
    const green = host.querySelector(
      'input[aria-label="settings.graph.followTrustGreenSlider"]',
    )
    expect(red).toBeInstanceOf(HTMLInputElement)
    expect(green).toBeInstanceOf(HTMLInputElement)
    expect((red as HTMLInputElement).step).toBe('1')
    expect((green as HTMLInputElement).step).toBe('1')
    expect((red as HTMLInputElement).min).toBe('0')
    expect((green as HTMLInputElement).max).toBe('100')
    expect((red as HTMLInputElement).value).toBe('25')
    expect((green as HTMLInputElement).value).toBe('75')
    expect(host.textContent).toContain('settings.graph.followTrustRed')
    expect(host.textContent).toContain('settings.graph.followTrustYellow')
    expect(host.textContent).toContain('settings.graph.followTrustGreen')

    await act(async () => {
      setRangeValue(red as HTMLInputElement, '40')
      red?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    })

    expect(onCommit).toHaveBeenCalledWith({ red: 40, green: 75 })
  })

  it('pushes the red knob down when green is dragged past it', async () => {
    host = document.createElement('div')
    document.body.replaceChildren(host)
    root = createRoot(host)
    const onCommit = vi.fn()
    const { default: Control } = await import(
      './WotFollowTrustThresholdControl'
    )
    await act(async () => {
      root.render(
        createElement(Control, {
          band: DEFAULT_FOLLOW_TRUST_BAND,
          description: 'hint',
          onCommit,
        }),
      )
    })

    const green = host.querySelector(
      'input[aria-label="settings.graph.followTrustGreenSlider"]',
    )
    await act(async () => {
      setRangeValue(green as HTMLInputElement, '4')
      green?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    })

    expect((green as HTMLInputElement).value).toBe('4')
    const red = host.querySelector(
      'input[aria-label="settings.graph.followTrustRedSlider"]',
    )
    expect((red as HTMLInputElement).value).toBe('4')
    expect(onCommit).toHaveBeenCalledWith({ red: 4, green: 4 })
  })

  it('pushes the green knob up when red is dragged past it', async () => {
    host = document.createElement('div')
    document.body.replaceChildren(host)
    root = createRoot(host)
    const onCommit = vi.fn()
    const { default: Control } = await import(
      './WotFollowTrustThresholdControl'
    )
    await act(async () => {
      root.render(
        createElement(Control, {
          band: DEFAULT_FOLLOW_TRUST_BAND,
          description: 'hint',
          onCommit,
        }),
      )
    })

    const red = host.querySelector(
      'input[aria-label="settings.graph.followTrustRedSlider"]',
    )
    await act(async () => {
      setRangeValue(red as HTMLInputElement, '80')
      red?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    })

    expect((red as HTMLInputElement).value).toBe('80')
    const green = host.querySelector(
      'input[aria-label="settings.graph.followTrustGreenSlider"]',
    )
    expect((green as HTMLInputElement).value).toBe('80')
    expect(onCommit).toHaveBeenCalledWith({ red: 80, green: 80 })
  })
})
