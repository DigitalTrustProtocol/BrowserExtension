/** @vitest-environment happy-dom */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { resetContentI18nForTests } from '../i18n'
import { createTrustChip } from './chip'

beforeAll(() => {
  resetContentI18nForTests()
})

beforeEach(() => {
  document.body.replaceChildren()
  resetContentI18nForTests()
})

describe('createTrustChip', () => {
  it('shows a spinner while loading and restores the brand mark afterward', () => {
    const chip = createTrustChip({
      title: 'AttentionX author trust',
      onClick: () => {},
    })
    document.body.append(chip.host)

    const button = chip.host.shadowRoot?.querySelector('button')
    expect(button?.classList.contains('is-loading')).toBe(false)

    chip.setLoading(true)
    expect(button?.classList.contains('is-loading')).toBe(true)
    expect(button?.getAttribute('aria-busy')).toBe('true')
    expect(button?.querySelector('.spinner')).toBeTruthy()

    chip.setTone('trust')
    chip.setLoading(false)
    expect(button?.classList.contains('is-loading')).toBe(false)
    expect(button?.classList.contains('tone-trust')).toBe(true)
    expect(button?.querySelector('.spinner')).toBeFalsy()

    chip.destroy()
  })
})
