/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest'
import { readVisibleXBioText } from './read-x-bio'

describe('readVisibleXBioText', () => {
  it('reads UserDescription innerText', () => {
    const doc = document.implementation.createHTMLDocument('x')
    const el = doc.createElement('div')
    el.setAttribute('data-testid', 'UserDescription')
    el.textContent = 'Hello bio'
    doc.body.appendChild(el)
    expect(readVisibleXBioText(doc)).toBe('Hello bio')
  })

  it('reads settings bio textarea value', () => {
    const doc = document.implementation.createHTMLDocument('x')
    const el = doc.createElement('textarea')
    el.name = 'description'
    el.value = 'Settings bio'
    doc.body.appendChild(el)
    expect(readVisibleXBioText(doc)).toBe('Settings bio')
  })

  it('returns undefined when no bio node exists', () => {
    const doc = document.implementation.createHTMLDocument('x')
    expect(readVisibleXBioText(doc)).toBeUndefined()
  })

  it('returns empty string when the bio node is empty', () => {
    const doc = document.implementation.createHTMLDocument('x')
    const el = doc.createElement('div')
    el.setAttribute('data-testid', 'UserDescription')
    el.textContent = ''
    doc.body.appendChild(el)
    expect(readVisibleXBioText(doc)).toBe('')
  })

  it('preserves blank lines from UserDescription innerText', () => {
    const doc = document.implementation.createHTMLDocument('x')
    const el = doc.createElement('div')
    el.setAttribute('data-testid', 'UserDescription')
    el.appendChild(doc.createTextNode('Hello'))
    el.appendChild(doc.createElement('br'))
    el.appendChild(doc.createElement('br'))
    el.appendChild(doc.createTextNode('World'))
    doc.body.appendChild(el)
    expect(readVisibleXBioText(doc)).toBe('Hello\n\nWorld')
  })
})
