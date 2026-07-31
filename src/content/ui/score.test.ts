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
  it('opens path mode from the visible trust detail text', () => {
    const openPath = vi.fn()
    const label = createTrustScoreLabel()
    label.setOnOpenPath(openPath)
    label.set('Trusted · 2°', 'trust')
    document.body.append(label.host)

    const button = label.host.shadowRoot?.querySelector('button')
    expect(button?.textContent).toBe('Trusted · 2°')
    expect(button?.getAttribute('aria-label')).toContain('Open trust path')

    button?.click()
    expect(openPath).toHaveBeenCalledOnce()
  })

  it('uses a 14px compact line-box for timeline headlines', () => {
    const label = createTrustScoreLabel({ compact: true })
    expect(label.host.style.fontSize).toBe('14px')
    expect(label.host.style.maxHeight).toBe('16px')
    expect(label.host.style.lineHeight).toBe('16px')
    const style = label.host.shadowRoot?.querySelector('style')?.textContent ?? ''
    expect(style).toContain('font-size: 14px')
    expect(style).toContain('line-height: 16px')
    label.destroy()
  })
})
