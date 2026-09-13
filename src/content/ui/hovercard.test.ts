/** @vitest-environment happy-dom */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { TrustQueryResult } from '../../graph'
import { resetContentI18nForTests } from '../i18n'
import { identitiesByHandle } from '../scanner'
import { trustDescriptor } from '../trust-helpers'
import { descriptorKey, trustStore } from '../trust-store'
import { HoverCardAugmentor } from './hovercard'
import { profileTargetForHandle } from './profile-target'

beforeAll(() => {
  resetContentI18nForTests()
})

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

function seedUserTrust(
  twitterId: string,
  handle: string,
  overrides: Partial<TrustQueryResult>,
): void {
  const target = profileTargetForHandle(handle, twitterId)
  const descriptor = trustDescriptor(target)
  if (!descriptor) throw new Error('expected descriptor')
  const result: TrustQueryResult = {
    subject: descriptor.subject,
    context: descriptor.context ?? '',
    resolution: 'none',
    trust: 0,
    distrust: 0,
    trustValue: 0,
    degree: 0,
    connected: false,
    statements: [],
    paths: [],
    truncated: false,
    computedAt: 0,
    sourceEventIds: [],
    graphVersion: 1,
    followTrustRed: 25,
    followTrustThreshold: 75,
    ...overrides,
  }
  trustStore.seed([
    { key: descriptorKey(descriptor), descriptor, result },
  ])
}

afterEach(() => {
  document.body.replaceChildren()
  identitiesByHandle.clear()
  trustStore.invalidateAll()
  resetContentI18nForTests()
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

  it('does not scan on unrelated DOM mutations', async () => {
    vi.useFakeTimers()
    const augmentor = new HoverCardAugmentor()
    augmentor.start()

    const querySpy = vi.spyOn(document, 'querySelector')
    document.body.append(document.createElement('div'))
    document.body.append(document.createElement('article'))
    await vi.advanceTimersByTimeAsync(500)

    expect(querySpy).not.toHaveBeenCalled()

    querySpy.mockRestore()
    augmentor.stop()
    vi.useRealTimers()
  })

  it('mounts the strip after a HoverCard subtree is inserted', async () => {
    vi.useFakeTimers()
    const augmentor = new HoverCardAugmentor()
    augmentor.start()

    const card = buildHoverCard({ handle: 'newbie', twitterId: '424242' })
    // Debounced: not mounted synchronously on insert.
    expect(card.querySelector('[data-attentionx-hovercard]')).toBeNull()

    await vi.advanceTimersByTimeAsync(200)
    expect(trustUserButton(card)?.disabled).toBe(false)

    augmentor.stop()
    vi.useRealTimers()
  })

  it('paints percent, bars, Total, and Neutral footnote', () => {
    seedUserTrust('424242', 'newbie', {
      resolution: 'mixed',
      connected: true,
      trust: 3,
      distrust: 1,
      trustValue: 2,
      degree: 2,
      neutral: 2,
    })
    const card = buildHoverCard({ handle: 'newbie', twitterId: '424242' })
    const augmentor = new HoverCardAugmentor()
    augmentor.start()

    const strip = card.querySelector('[data-attentionx-hovercard]')
    expect(strip?.textContent).toContain('75%')
    expect(strip?.textContent).toContain('Mixed trust · 2°')
    expect(strip?.textContent).toContain('Total 4')
    expect(strip?.textContent).toContain(
      'Neutral 2 — not counted in the score',
    )

    augmentor.stop()
  })

  it('shows No connection when the observer has no path', () => {
    seedUserTrust('424242', 'newbie', {
      resolution: 'none',
      connected: false,
    })
    const card = buildHoverCard({ handle: 'newbie', twitterId: '424242' })
    const augmentor = new HoverCardAugmentor()
    augmentor.start()

    const strip = card.querySelector('[data-attentionx-hovercard]')
    expect(strip?.textContent).toContain('No connection')
    expect(strip?.textContent).not.toContain('Total')

    augmentor.stop()
  })
})
