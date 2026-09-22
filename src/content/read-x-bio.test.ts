/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest'
import {
  isProfileEditSaveTarget,
  openProfileEditDialog,
  readVisibleXBioText,
} from './read-x-bio'

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

  it('ignores the edit textarea when only the saved description is requested', () => {
    const doc = document.implementation.createHTMLDocument('x')
    const draft = doc.createElement('textarea')
    draft.name = 'description'
    draft.value = 'Draft paste'
    doc.body.appendChild(draft)
    expect(readVisibleXBioText(doc, { savedOnly: true })).toBeUndefined()
    expect(readVisibleXBioText(doc)).toBe('Draft paste')
  })

  it('prefers the saved description over the edit textarea', () => {
    const doc = document.implementation.createHTMLDocument('x')
    const saved = doc.createElement('div')
    saved.setAttribute('data-testid', 'UserDescription')
    saved.textContent = 'Saved bio'
    const draft = doc.createElement('textarea')
    draft.name = 'description'
    draft.value = 'Draft paste'
    doc.body.append(saved, draft)
    expect(readVisibleXBioText(doc, { savedOnly: true })).toBe('Saved bio')
  })

  it('clicks Edit profile when the dialog is closed', () => {
    const doc = document.implementation.createHTMLDocument('x')
    const button = doc.createElement('button')
    button.setAttribute('data-testid', 'editProfileButton')
    let clicks = 0
    button.click = () => {
      clicks += 1
    }
    doc.body.appendChild(button)
    expect(openProfileEditDialog(doc)).toBe('opened')
    expect(clicks).toBe(1)
  })

  it('does not click Edit profile when the draft field is already open', () => {
    const doc = document.implementation.createHTMLDocument('x')
    const draft = doc.createElement('textarea')
    draft.name = 'description'
    const button = doc.createElement('button')
    button.setAttribute('data-testid', 'editProfileButton')
    let clicks = 0
    button.click = () => {
      clicks += 1
    }
    doc.body.append(draft, button)
    expect(openProfileEditDialog(doc)).toBe('already-open')
    expect(clicks).toBe(0)
  })

  it('recognizes Save inside the profile edit dialog', () => {
    const doc = document.implementation.createHTMLDocument('x')
    const dialog = doc.createElement('div')
    dialog.setAttribute('role', 'dialog')
    const draft = doc.createElement('textarea')
    draft.name = 'description'
    const save = doc.createElement('button')
    save.setAttribute('data-testid', 'Profile_Save_Button')
    const cancel = doc.createElement('button')
    cancel.setAttribute('data-testid', 'Profile_Cancel_Button')
    dialog.append(draft, save, cancel)
    doc.body.appendChild(dialog)
    expect(isProfileEditSaveTarget(save, doc)).toBe(true)
    expect(isProfileEditSaveTarget(cancel, doc)).toBe(false)
  })

  it('ignores Save outside the profile edit dialog', () => {
    const doc = document.implementation.createHTMLDocument('x')
    const save = doc.createElement('button')
    save.setAttribute('data-testid', 'Profile_Save_Button')
    doc.body.appendChild(save)
    expect(isProfileEditSaveTarget(save, doc)).toBe(false)
  })

  it('reports a missing Edit profile control', () => {
    const doc = document.implementation.createHTMLDocument('x')
    expect(openProfileEditDialog(doc)).toBe('not-found')
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
