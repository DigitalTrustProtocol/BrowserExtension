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

  it('paints green, yellow, and red from the rating tone', () => {
    const star = createRatingStar({
      title: 'AttentionX post rating',
      onClick: () => undefined,
    })
    document.body.append(star.host)
    const button = star.host.shadowRoot?.querySelector('button')

    star.setScore(100)
    star.setTone('trust')
    expect(button?.classList.contains('tone-trust')).toBe(true)
    expect(button?.classList.contains('has-score')).toBe(true)

    star.setScore(50)
    star.setTone('question')
    expect(button?.classList.contains('tone-question')).toBe(true)

    star.setScore(10)
    star.setTone('misleading')
    expect(button?.classList.contains('tone-misleading')).toBe(true)

    star.setScore(null)
    star.setTone('neutral')
    expect(button?.classList.contains('tone-neutral')).toBe(true)
    expect(button?.classList.contains('has-score')).toBe(false)
    star.destroy()
  })
})
