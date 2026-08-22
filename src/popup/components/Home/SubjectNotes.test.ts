import { describe, expect, it } from 'vitest'
import type { SerializableTrustSubject } from '../../../shared/contracts'
import {
  isUserPanelSubject,
  keepNotesSubject,
  notesPanelKind,
} from './SubjectNotes'

const account: SerializableTrustSubject = {
  type: 'i',
  value: 'user:id:11348282',
}
const post: SerializableTrustSubject = {
  type: 'i',
  value: 'post:id:2080659774136291424',
}
const pubkey: SerializableTrustSubject = {
  type: 'p',
  value: 'ab'.repeat(32),
}
const event: SerializableTrustSubject = {
  type: 'e',
  value: 'cd'.repeat(32),
}

describe('notesPanelKind', () => {
  it('routes user:id and Graph pubkeys to the User panel', () => {
    expect(notesPanelKind(account)).toBe('user')
    expect(notesPanelKind(pubkey)).toBe('user')
    expect(isUserPanelSubject(account)).toBe(true)
    expect(isUserPanelSubject(pubkey)).toBe(true)
  })

  it('routes post:id to the Post panel', () => {
    expect(notesPanelKind(post)).toBe('post')
    expect(isUserPanelSubject(post)).toBe(false)
  })

  it('does not open a third chrome for e: or unknown i subjects', () => {
    expect(notesPanelKind(event)).toBeNull()
    expect(notesPanelKind({ type: 'i', value: 'note:id:1' })).toBeNull()
    expect(isUserPanelSubject(event)).toBe(false)
  })
})

describe('keepNotesSubject', () => {
  it('prefers a newly resolved User or Post subject', () => {
    expect(keepNotesSubject(post, account)).toEqual(post)
    expect(keepNotesSubject(account, post)).toEqual(account)
  })

  it('keeps the current panel when the snapshot is empty', () => {
    expect(keepNotesSubject(null, post)).toEqual(post)
    expect(keepNotesSubject(event, post)).toEqual(post)
  })

  it('does not keep e: or unknown subjects', () => {
    expect(keepNotesSubject(null, event)).toBeNull()
    expect(keepNotesSubject(null, null)).toBeNull()
  })
})
