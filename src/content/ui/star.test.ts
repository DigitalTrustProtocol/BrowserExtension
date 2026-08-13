/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRatingStar } from './star'

describe('createRatingStar', () => {
  afterEach(() => {
    document.body.replaceChildren()
    vi.useRealTimers()
  })

  it('pulses the star after a rating lands', () => {
    vi.useFakeTimers()
    const star = createRatingStar({
      title: 'AttentionX post rating',
      onClick: () => undefined,
    })
    document.body.append(star.host)
    const button = star.host.shadowRoot?.querySelector('button')
    star.setScore(80)
    star.flashConfirm()
    expect(button?.classList.contains('is-confirm')).toBe(true)

    button?.dispatchEvent(new Event('animationend'))
    expect(button?.classList.contains('is-confirm')).toBe(false)
    star.destroy()
  })

  it('does not flash while the star is loading', () => {
    const star = createRatingStar({
      title: 'AttentionX post rating',
      onClick: () => undefined,
    })
    document.body.append(star.host)
    star.setLoading(true)
    star.flashConfirm()
    const button = star.host.shadowRoot?.querySelector('button')
    expect(button?.classList.contains('is-confirm')).toBe(false)
    star.destroy()
  })
})
