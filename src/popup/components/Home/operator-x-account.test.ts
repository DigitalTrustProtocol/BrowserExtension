import { describe, expect, it } from 'vitest'
import {
  unavailablePanelSnapshot,
  type PanelSessionSnapshot,
} from '../../../shared/panel-session'
import {
  operatorXAccountFromSnapshot,
  operatorXIdentityLine,
  operatorXIdentityPending,
} from './operator-x-account'

function withX(
  x: PanelSessionSnapshot['x'],
): PanelSessionSnapshot {
  return { ...unavailablePanelSnapshot(), x }
}

describe('operatorXAccountFromSnapshot', () => {
  it('returns twitterId and handle from an identified snapshot', () => {
    expect(
      operatorXAccountFromSnapshot(
        withX({
          kind: 'identified',
          tabId: 7,
          twitterId: '44196397',
          handle: 'elonmusk',
        }),
      ),
    ).toEqual({
      handle: 'elonmusk',
      twitterId: '44196397',
      detectedAt: 0,
    })
  })

  it('uses an empty handle when identified without one', () => {
    expect(
      operatorXAccountFromSnapshot(
        withX({ kind: 'identified', tabId: 1, twitterId: '42' }),
      ),
    ).toEqual({
      handle: '',
      twitterId: '42',
      detectedAt: 0,
    })
  })

  it('returns undefined when X is not identified', () => {
    expect(operatorXAccountFromSnapshot(undefined)).toBeUndefined()
    expect(operatorXAccountFromSnapshot(null)).toBeUndefined()
    expect(
      operatorXAccountFromSnapshot(unavailablePanelSnapshot()),
    ).toBeUndefined()
    expect(
      operatorXAccountFromSnapshot(withX({ kind: 'unknown', tabId: 3 })),
    ).toBeUndefined()
    expect(
      operatorXAccountFromSnapshot(withX({ kind: 'loggedOut', tabId: 3 })),
    ).toBeUndefined()
  })
})

describe('operatorXIdentityLine', () => {
  it('is pending until the snapshot identifies or rules out X', () => {
    expect(operatorXIdentityLine(undefined)).toEqual({ kind: 'pending' })
    expect(operatorXIdentityLine(null)).toEqual({ kind: 'pending' })
    expect(operatorXIdentityLine(withX({ kind: 'unknown', tabId: 1 }))).toEqual({
      kind: 'pending',
    })
    expect(operatorXIdentityPending(withX({ kind: 'unknown', tabId: 1 }))).toBe(
      true,
    )
  })

  it('paints handle and twitterId from an identified snapshot', () => {
    expect(
      operatorXIdentityLine(
        withX({
          kind: 'identified',
          tabId: 1,
          twitterId: '44196397',
          handle: 'elonmusk',
        }),
      ),
    ).toEqual({ kind: 'ready', text: '@elonmusk · 44196397' })
    expect(
      operatorXIdentityLine(
        withX({ kind: 'identified', tabId: 1, twitterId: '42' }),
      ),
    ).toEqual({ kind: 'ready', text: '42' })
  })

  it('explains logged-out and off-X snapshots', () => {
    expect(operatorXIdentityLine(withX({ kind: 'loggedOut', tabId: 1 }))).toEqual(
      {
        kind: 'ready',
        text: 'Sign in on x.com to detect your account',
      },
    )
    expect(operatorXIdentityLine(unavailablePanelSnapshot())).toEqual({
      kind: 'ready',
      text: 'Open x.com while signed in to detect your account',
    })
    expect(
      operatorXIdentityLine(unavailablePanelSnapshot(), 'Worker error'),
    ).toEqual({ kind: 'ready', text: 'Worker error' })
  })
})
