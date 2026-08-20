/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHIP_LOADING_DELAY_MS, createTrustChip } from './chip'

describe('createTrustChip', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('fires onClick from host clicks (document hit target is often the host)', () => {
    const onClick = vi.fn()
    const chip = createTrustChip({
      title: 'AttentionX author trust',
      onClick,
    })
    document.body.append(chip.host)

    // Parent flex row that previously stretched chips to 100px+.
    const row = document.createElement('div')
    row.style.cssText = 'display:flex;width:400px;'
    row.append(chip.host)
    document.body.append(row)

    chip.host.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onClick).toHaveBeenCalledWith(chip.host)

    // Stay shrink-wrapped even inside a wide flex row.
    expect(chip.host.style.flexGrow).toBe('0')
    expect(chip.host.style.maxWidth).toBe('max-content')

    chip.destroy()
  })

  it('does not open while loading', () => {
    const onClick = vi.fn()
    const chip = createTrustChip({
      title: 'AttentionX author trust',
      onClick,
    })
    document.body.append(chip.host)
    chip.setLoading(true)
    chip.host.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onClick).not.toHaveBeenCalled()
    chip.destroy()
  })

  it('does not flash a spinner when loading ends before the delay', () => {
    const chip = createTrustChip({
      title: 'AttentionX author trust',
      onClick: () => undefined,
    })
    document.body.append(chip.host)
    const button = chip.host.shadowRoot?.querySelector('button')
    chip.setLoading(true)
    expect(button?.classList.contains('is-loading')).toBe(false)
    expect(button?.querySelector('.spinner')).toBeNull()

    chip.setLoading(false)
    vi.advanceTimersByTime(CHIP_LOADING_DELAY_MS + 20)
    expect(button?.classList.contains('is-loading')).toBe(false)
    expect(button?.querySelector('.spinner')).toBeNull()
    chip.destroy()
  })

  it('shows a spinner only after the loading delay', () => {
    const chip = createTrustChip({
      title: 'AttentionX author trust',
      onClick: () => undefined,
    })
    document.body.append(chip.host)
    const button = chip.host.shadowRoot?.querySelector('button')
    chip.setLoading(true)
    vi.advanceTimersByTime(CHIP_LOADING_DELAY_MS - 1)
    expect(button?.querySelector('.spinner')).toBeNull()

    vi.advanceTimersByTime(1)
    expect(button?.classList.contains('is-loading')).toBe(true)
    expect(button?.querySelector('.spinner')).toBeTruthy()
    chip.destroy()
  })

  it('uses absolute overlay host styles that do not join flex rows', () => {
    const chip = createTrustChip({
      title: 'AttentionX author trust',
      onClick: () => undefined,
      variant: 'overlay',
      role: 'author',
    })
    expect(chip.host.dataset.attentionxChip).toBe('author')
    expect(chip.host.style.position).toBe('absolute')
    expect(chip.host.style.flexGrow).toBe('')
    const style = chip.host.shadowRoot?.querySelector('style')?.textContent ?? ''
    expect(style).toContain('width: 18px')
    expect(style).toContain('height: 18px')
    chip.destroy()
  })

  it('caps compact inline chips to the headline line-box', () => {
    const chip = createTrustChip({
      title: 'AttentionX author trust',
      onClick: () => undefined,
      variant: 'inline',
      compact: true,
      role: 'author',
    })
    expect(chip.host.style.position).toBe('relative')
    expect(chip.host.style.maxHeight).toBe('16px')
    expect(chip.host.style.marginTop).toBe('0px')
    expect(chip.host.style.marginBottom).toBe('0px')
    const style = chip.host.shadowRoot?.querySelector('style')?.textContent ?? ''
    expect(style).toContain('width: 16px')
    expect(style).toContain('height: 16px')
    chip.destroy()
  })

  it('swaps the inner glyph when the tone changes', () => {
    const chip = createTrustChip({
      title: 'AttentionX author trust',
      onClick: () => undefined,
    })
    document.body.append(chip.host)
    const svgAt = (tone: string) =>
      chip.host.shadowRoot?.querySelector(`svg[data-tone="${tone}"]`)

    expect(svgAt('neutral')).toBeTruthy()
    expect(svgAt('neutral')?.querySelectorAll('circle').length).toBe(3)

    chip.setTone('trust')
    expect(svgAt('trust')?.querySelector('path')).toBeTruthy()
    expect(svgAt('trust')?.querySelector('circle')).toBeNull()

    chip.setTone('question')
    expect(svgAt('question')?.querySelector('path')).toBeTruthy()

    chip.setTone('misleading')
    expect(svgAt('misleading')?.querySelector('circle')).toBeTruthy()
    expect(svgAt('misleading')?.querySelector('path')).toBeTruthy()
    chip.destroy()
  })
})
