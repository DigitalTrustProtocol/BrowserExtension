/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it } from 'vitest'
import { cloneAuthorVerifiedBadge } from './verified-badge'

beforeEach(() => {
  document.body.replaceChildren()
})

describe('cloneAuthorVerifiedBadge', () => {
  it('bakes the live verified badge color onto clones for currentColor fills', () => {
    const article = document.createElement('article')
    const nameRow = document.createElement('div')
    nameRow.dataset.testid = 'User-Name'
    const badge = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    badge.setAttribute('data-testid', 'icon-verified')
    badge.style.color = 'rgb(29, 155, 240)'
    nameRow.append(badge)
    article.append(nameRow)
    document.body.append(article)

    const clone = cloneAuthorVerifiedBadge(article)
    expect(clone?.style.color).toBe('rgb(29, 155, 240)')
  })
})
