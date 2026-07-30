/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it } from 'vitest'
import { closePopover, destroyPopover, openPopover } from './popover'

beforeEach(() => {
  destroyPopover()
  document.body.replaceChildren()
})

describe('openPopover', () => {
  it('toggles closed when the same anchor is clicked again', () => {
    const anchor = document.createElement('span')
    document.body.append(anchor)

    openPopover(anchor, (container) => {
      container.textContent = 'trust card'
    })
    const host = document.querySelector('[data-attentionx-popover]')
    const shell = host?.shadowRoot?.querySelector('.shell') as HTMLElement | null
    expect(shell?.style.display).toBe('block')

    openPopover(anchor, () => {})
    expect(shell?.style.display).toBe('none')
  })

  it('closes when clicking outside the anchor', async () => {
    const anchor = document.createElement('span')
    const outside = document.createElement('button')
    document.body.append(anchor, outside)

    openPopover(anchor, (container) => {
      container.textContent = 'trust card'
    })
    const host = document.querySelector('[data-attentionx-popover]')
    const shell = host?.shadowRoot?.querySelector('.shell') as HTMLElement | null
    expect(shell?.style.display).toBe('block')

    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(shell?.style.display).toBe('none')
  })

  it('closes on Escape', () => {
    const anchor = document.createElement('span')
    document.body.append(anchor)

    openPopover(anchor, (container) => {
      container.textContent = 'trust card'
    })
    const host = document.querySelector('[data-attentionx-popover]')
    const shell = host?.shadowRoot?.querySelector('.shell') as HTMLElement | null

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(shell?.style.display).toBe('none')
  })

  it('runs mount cleanup when closed', () => {
    const anchor = document.createElement('span')
    document.body.append(anchor)
    let cleaned = false

    openPopover(anchor, () => () => {
      cleaned = true
    })
    closePopover()
    expect(cleaned).toBe(true)
  })
})
