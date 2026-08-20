import { describe, expect, it } from 'vitest'
import {
  emptySelectedSubjectHistory,
  isSelectedSubjectHistory,
  moveSelectedSubjectHistory,
  pushSelectedSubjectHistory,
  SELECTED_SUBJECT_HISTORY_MAX,
  selectedSubjectHistoryFlags,
  selectedSubjectIdentity,
  type SelectedSubject,
} from './selected-subject'

const nasa: SelectedSubject = { subject: { type: 'i', value: 'user:id:11348282' } }
const elon: SelectedSubject = { subject: { type: 'i', value: 'user:id:44196397' } }
const post: SelectedSubject = {
  subject: { type: 'i', value: 'post:id:2080659774136291424' },
}

describe('selectedSubjectIdentity', () => {
  it('ignores context so the same user is one history slot', () => {
    expect(selectedSubjectIdentity(nasa)).toBe('i:user:id:11348282')
    expect(
      selectedSubjectIdentity({ ...nasa, context: 'identity' }),
    ).toBe('i:user:id:11348282')
  })
})

describe('selectedSubjectHistoryFlags', () => {
  it('disables both buttons when there is no stack to move through', () => {
    expect(selectedSubjectHistoryFlags(emptySelectedSubjectHistory())).toEqual({
      canBack: false,
      canForward: false,
    })
    expect(
      selectedSubjectHistoryFlags({ entries: [nasa], index: 0 }),
    ).toEqual({ canBack: false, canForward: false })
  })

  it('enables back at the latest entry and forward at the oldest', () => {
    const two = { entries: [nasa, elon], index: 1 }
    expect(selectedSubjectHistoryFlags(two)).toEqual({
      canBack: true,
      canForward: false,
    })
    expect(selectedSubjectHistoryFlags({ ...two, index: 0 })).toEqual({
      canBack: false,
      canForward: true,
    })
  })
})

describe('pushSelectedSubjectHistory', () => {
  it('does not duplicate the currently selected subject', () => {
    const once = pushSelectedSubjectHistory(emptySelectedSubjectHistory(), nasa)
    const again = pushSelectedSubjectHistory(once, {
      ...nasa,
      context: 'identity',
    })
    expect(again.entries).toHaveLength(1)
    expect(again.index).toBe(0)
    expect(again.entries[0]?.context).toBe('identity')
  })

  it('drops forward entries when selecting something new from the middle', () => {
    let history = emptySelectedSubjectHistory()
    history = pushSelectedSubjectHistory(history, nasa)
    history = pushSelectedSubjectHistory(history, elon)
    history = pushSelectedSubjectHistory(history, post)
    history = moveSelectedSubjectHistory(history, 'back')!
    history = moveSelectedSubjectHistory(history, 'back')!
    history = pushSelectedSubjectHistory(history, elon)
    expect(history.entries.map(selectedSubjectIdentity)).toEqual([
      'i:user:id:11348282',
      'i:user:id:44196397',
    ])
    expect(history.index).toBe(1)
  })

  it('caps the stack at the history max', () => {
    let history = emptySelectedSubjectHistory()
    for (let i = 0; i < SELECTED_SUBJECT_HISTORY_MAX + 5; i += 1) {
      history = pushSelectedSubjectHistory(history, {
        subject: { type: 'i', value: `user:id:${i}` },
      })
    }
    expect(history.entries).toHaveLength(SELECTED_SUBJECT_HISTORY_MAX)
    expect(history.index).toBe(SELECTED_SUBJECT_HISTORY_MAX - 1)
    expect(history.entries[0]?.subject.value).toBe('user:id:5')
  })
})

describe('moveSelectedSubjectHistory', () => {
  it('walks back and forward without mutating skipped entries', () => {
    let history = pushSelectedSubjectHistory(
      pushSelectedSubjectHistory(emptySelectedSubjectHistory(), nasa),
      elon,
    )
    history = moveSelectedSubjectHistory(history, 'back')!
    expect(history.index).toBe(0)
    expect(history.entries[0]).toEqual(nasa)
    history = moveSelectedSubjectHistory(history, 'forward')!
    expect(history.index).toBe(1)
    expect(moveSelectedSubjectHistory(history, 'forward')).toBeUndefined()
    history = moveSelectedSubjectHistory(history, 'back')!
    expect(moveSelectedSubjectHistory(history, 'back')).toBeUndefined()
  })
})

describe('isSelectedSubjectHistory', () => {
  it('rejects corrupt or oversized session payloads', () => {
    expect(isSelectedSubjectHistory(emptySelectedSubjectHistory())).toBe(true)
    expect(isSelectedSubjectHistory({ entries: [nasa], index: 0 })).toBe(true)
    expect(isSelectedSubjectHistory({ entries: [nasa], index: 1 })).toBe(false)
    expect(isSelectedSubjectHistory({ entries: [], index: 1 })).toBe(false)
    expect(isSelectedSubjectHistory({ entries: 'nope', index: 0 })).toBe(false)
  })
})
