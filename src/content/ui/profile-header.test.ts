/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it } from 'vitest'
import { ProfileHeaderAugmentor } from './profile-header'

afterEach(() => {
  document.body.replaceChildren()
  window.history.replaceState({}, '', '/')
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
})
