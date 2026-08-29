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

  it('does not open Notes from a host click (handler is on the inner button)', () => {
    const openPath = vi.fn()
    const label = createTrustScoreLabel()
    label.setOnOpenPath(openPath)
    label.set('Trusted · 2°', 'trust')
    document.body.append(label.host)

    label.host.click()
    expect(openPath).not.toHaveBeenCalled()

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
    expect(style).not.toContain('text-decoration: underline')
    label.destroy()
  })

  it('never underlines compact or rail Trust / degree labels', () => {
    for (const options of [{ compact: true }, { rail: true }, {}] as const) {
      const label = createTrustScoreLabel(options)
      const style = label.host.shadowRoot?.querySelector('style')?.textContent ?? ''
      expect(style).toContain('text-decoration: none')
      expect(style).not.toMatch(/\.score:hover\s*\{\s*text-decoration:\s*underline/)
      expect(label.host.style.textDecoration).toBe('none')
      label.destroy()
    }
  })
})
