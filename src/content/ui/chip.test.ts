/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from 'vitest'
import { createTrustChip } from './chip'

describe('createTrustChip', () => {
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
})
