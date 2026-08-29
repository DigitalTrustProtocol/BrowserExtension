/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { identitiesByHandle } from '../scanner'
import { trustStore } from '../trust-store'
import { ProfileHeaderAugmentor } from './profile-header'

const NASA_FIXTURE = `
  <main role="main">
    <div data-testid="UserName">
      <a href="/NASA">
        <div class="name-line">
          <div class="name-text"><span><span>NASA</span></span></div>
          <div class="badge">
            <svg data-testid="icon-verified" aria-label="Verified account"></svg>
          </div>
        </div>
      </a>
      <a href="/NASA">@NASA</a>
    </div>
    <div data-testid="userActions">
      <button data-testid="11348282-follow">Follow</button>
    </div>
  </main>
`

afterEach(() => {
  document.body.replaceChildren()
  window.history.replaceState({}, '', '/')
  identitiesByHandle.clear()
  vi.restoreAllMocks()
})

describe('ProfileHeaderAugmentor', () => {
  it('places score and chip last on the name line after verified icons', () => {
    window.history.replaceState({}, '', '/NASA')
    document.body.innerHTML = `
      <main role="main">
        <div data-testid="UserName">
          <a href="/NASA">
            <div class="name-line">
              <div class="name-text"><span><span>NASA</span></span></div>
              <div class="badge">
                <svg data-testid="icon-verified" aria-label="Verified account"></svg>
              </div>
            </div>
          </a>
          <a href="/NASA">@NASA</a>
        </div>
        <div data-testid="userActions">
          <button data-testid="11348282-follow">Follow</button>
        </div>
      </main>
    `

    const augmentor = new ProfileHeaderAugmentor()
    augmentor.start({
      chip: true,
      ambient: true,
      detailText: true,
      detailDegree: true,
    })

    const line = document.querySelector('.name-line')
    const kids = [...(line?.children ?? [])]
    expect(kids[0]?.className).toBe('name-text')
    expect(kids[1]?.className).toBe('badge')
    expect(kids[2]?.hasAttribute('data-attentionx-profile-score')).toBe(true)
    expect(kids[3]?.hasAttribute('data-attentionx-profile-chip')).toBe(true)
    expect(
      document.querySelector(
        '[data-testid="userActions"] [data-attentionx-profile-chip]',
      ),
    ).toBeNull()

    augmentor.stop()
  })

  it('keeps one trust subscription across repeat syncs for the same handle', () => {
    window.history.replaceState({}, '', '/NASA')
    document.body.innerHTML = NASA_FIXTURE
    identitiesByHandle.set('nasa', {
      twitterId: '11348282',
      handle: 'nasa',
      observedAt: 1,
    })
    identitiesByHandle.set('elonmusk', {
      twitterId: '44196397',
      handle: 'elonmusk',
      observedAt: 1,
    })

    const subscribeSpy = vi.spyOn(trustStore, 'subscribe')
    const augmentor = new ProfileHeaderAugmentor()
    augmentor.start({
      chip: true,
      ambient: true,
      detailText: true,
      detailDegree: true,
    })
    expect(subscribeSpy).toHaveBeenCalledTimes(1)

    augmentor.sync()
    augmentor.sync()
    expect(subscribeSpy).toHaveBeenCalledTimes(1)

    // A handle change re-watches.
    window.history.replaceState({}, '', '/elonmusk')
    augmentor.sync()
    expect(subscribeSpy).toHaveBeenCalledTimes(2)

    augmentor.stop()
  })
})
