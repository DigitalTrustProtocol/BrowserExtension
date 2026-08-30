/** @vitest-environment happy-dom */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetContentI18nForTests } from '../i18n'
import { createTrustScoreLabel } from './score'

beforeAll(() => {
  resetContentI18nForTests()
})

beforeEach(() => {
  document.body.replaceChildren()
  resetContentI18nForTests()
})

describe('createTrustScoreLabel', () => {
  it('opens Notes from the visible trust detail text', () => {
    const openPath = vi.fn()
    const label = createTrustScoreLabel()
    label.setOnOpenPath(openPath)
    label.set('Trusted · 2°', 'trust')
    document.body.append(label.host)

    const button = label.host.shadowRoot?.querySelector('button')
    expect(button?.textContent).toBe('Trusted · 2°')
    expect(button?.getAttribute('aria-label')).toContain('Open in Notes')

    button?.click()
    expect(openPath).toHaveBeenCalledOnce()
  })

  it('opens Notes from a host click (document hit target is often the host)', () => {
    const openPath = vi.fn()
    const label = createTrustScoreLabel()
    label.setOnOpenPath(openPath)
    label.set('Trusted · 2°', 'trust')
    document.body.append(label.host)

    label.host.click()
    expect(openPath).toHaveBeenCalledOnce()

    label.destroy()
  })

  it('opens Notes on pointerdown so X cannot swallow the first click', () => {
    const openPath = vi.fn()
    const label = createTrustScoreLabel()
    label.setOnOpenPath(openPath)
    label.set('Trusted · 2°', 'trust')
    document.body.append(label.host)

    label.host.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0 }),
    )
    expect(openPath).toHaveBeenCalledOnce()
    label.host.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(openPath).toHaveBeenCalledOnce()

    label.destroy()
  })

  it('uses a 14px compact line-box for timeline headlines', () => {
    const label = createTrustScoreLabel({ compact: true })
    expect(label.host.style.fontSize).toBe('14px')
    expect(label.host.style.maxHeight).toBe('16px')
    expect(label.host.style.lineHeight).toBe('16px')
    const style = label.host.shadowRoot?.querySelector('style')?.textContent ?? ''
    expect(style).toContain('font-size: 14px')
    expect(style).toContain('line-height: 16px')
    expect(style).toContain('height: 14px')
    expect(style).toContain('line-height: 1')
    expect(style).toContain('.score:hover')
    expect(style).toContain('text-decoration: underline')
    label.destroy()
  })

  it('underlines clickable Trust / degree labels on hover', () => {
    for (const options of [{ compact: true }, { rail: true }, {}] as const) {
      const label = createTrustScoreLabel(options)
      const style = label.host.shadowRoot?.querySelector('style')?.textContent ?? ''
      expect(style).toContain('.score:hover')
      expect(style).toContain('text-decoration: underline')
      expect(label.host.style.textDecoration).toBe('none')
      label.destroy()
    }
  })
})
