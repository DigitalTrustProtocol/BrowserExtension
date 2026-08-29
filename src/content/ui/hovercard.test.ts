/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { identitiesByHandle } from '../scanner'
import { HoverCardAugmentor } from './hovercard'

function buildHoverCard(options: {
  handle: string
  twitterId?: string
}): HTMLElement {
  const card = document.createElement('div')
  card.dataset.testid = 'HoverCard'
  const followTestId = options.twitterId
    ? `${options.twitterId}-follow`
    : `${options.handle}-follow`
  card.innerHTML = `
    <div>
      <a href="/${options.handle}">${options.handle}</a>
      <button data-testid="${followTestId}">Follow</button>
    </div>
  `
  document.body.append(card)
  return card
}

function trustUserButton(card: HTMLElement): HTMLButtonElement | null {
  return card.querySelector<HTMLButtonElement>(
    '[data-attentionx-hovercard] .ax-open-dialog',
  )
}

afterEach(() => {
  document.body.replaceChildren()
  identitiesByHandle.clear()
})

describe('HoverCardAugmentor', () => {
  it('enables Trust this user from the HoverCard Follow id', () => {
    const card = buildHoverCard({ handle: 'newbie', twitterId: '424242' })
    const augmentor = new HoverCardAugmentor()
    augmentor.start()

    const button = trustUserButton(card)
    expect(button).toBeTruthy()
    expect(button?.disabled).toBe(false)
    expect(identitiesByHandle.get('newbie')?.twitterId).toBe('424242')

    augmentor.stop()
  })

  it('keeps Trust this user disabled until a numeric id is known', () => {
    const card = buildHoverCard({ handle: 'newbie' })
    const augmentor = new HoverCardAugmentor()
    augmentor.start()

    expect(trustUserButton(card)?.disabled).toBe(true)

    augmentor.stop()
  })

  it('enables Trust this user from a prior handle observation (timeline)', () => {
    identitiesByHandle.set('nasa', {
      twitterId: '11348282',
      handle: 'nasa',
      observedAt: 1,
    })
    const card = buildHoverCard({ handle: 'nasa' })
    const augmentor = new HoverCardAugmentor()
    augmentor.start()

    expect(trustUserButton(card)?.disabled).toBe(false)

    augmentor.stop()
  })

  it('enables Trust this user when the Follow id is inserted later', async () => {
    const card = buildHoverCard({ handle: 'newbie' })
    const augmentor = new HoverCardAugmentor()
    augmentor.start()
    expect(trustUserButton(card)?.disabled).toBe(true)

    const follow = card.querySelector('button')
    expect(follow).toBeTruthy()
    follow!.setAttribute('data-testid', '424242-follow')
    card.append(document.createElement('span'))

    await vi.waitFor(() => {
      expect(trustUserButton(card)?.disabled).toBe(false)
    })

    augmentor.stop()
  })

  it('enables Trust this user from a HoverCard Subscribe id', () => {
    const card = document.createElement('div')
    card.dataset.testid = 'HoverCard'
    card.innerHTML = `
      <div>
        <a href="/creator">creator</a>
        <button data-testid="1369570257384345607-subscribe">Subscribe</button>
      </div>
    `
    document.body.append(card)

    const augmentor = new HoverCardAugmentor()
    augmentor.start()

    const button = trustUserButton(card)
    expect(button).toBeTruthy()
    expect(button?.disabled).toBe(false)
    expect(identitiesByHandle.get('creator')?.twitterId).toBe(
      '1369570257384345607',
    )

    augmentor.stop()
  })
})
