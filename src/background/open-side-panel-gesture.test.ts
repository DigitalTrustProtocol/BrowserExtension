import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  openSidePanelFromUserGesture,
  parseSelectedSubjectFromOpenRequest,
} from './open-side-panel-gesture.ts'

const originalOpen = chrome.sidePanel.open
const originalSet = chrome.storage.session.set

afterEach(() => {
  chrome.sidePanel.open = originalOpen
  chrome.storage.session.set = originalSet
})

describe('openSidePanelFromUserGesture', () => {
  it('calls sidePanel.open in the same turn with no await before it', () => {
    let openCalled = false
    const open = vi.fn(() => {
      openCalled = true
      return Promise.resolve()
    })
    ;(chrome as unknown as { sidePanel: { open: typeof open } }).sidePanel = {
      open,
    }
    const set = vi.fn(() => Promise.resolve())
    chrome.storage.session.set = set as typeof chrome.storage.session.set

    openSidePanelFromUserGesture({
      tabId: 7,
      selected: { subject: { type: 'i', value: 'user:id:99' } },
    })

    expect(openCalled).toBe(true)
    expect(open).toHaveBeenCalledWith({ tabId: 7 })
    expect(set).toHaveBeenCalled()
  })

  it('swallows sidePanel.open rejections so they are not uncaught', async () => {
    const open = vi.fn(() =>
      Promise.reject(
        new Error(
          'sidePanel.open() may only be called in response to a user gesture.',
        ),
      ),
    )
    ;(chrome as unknown as { sidePanel: { open: typeof open } }).sidePanel = {
      open,
    }
    chrome.storage.session.set = vi.fn(() =>
      Promise.resolve(),
    ) as typeof chrome.storage.session.set

    expect(() =>
      openSidePanelFromUserGesture({
        tabId: 7,
        selected: { subject: { type: 'i', value: 'user:id:99' } },
      }),
    ).not.toThrow()
    await Promise.resolve()
  })

  it('parses a raw OPEN_SIDE_PANEL subject for the first snapshot', () => {
    expect(
      parseSelectedSubjectFromOpenRequest({
        type: 'OPEN_SIDE_PANEL',
        version: 1,
        subject: { type: 'i', value: 'user:id:99' },
        context: 'identity',
      }),
    ).toEqual({
      subject: { type: 'i', value: 'user:id:99' },
      context: 'identity',
    })
    expect(parseSelectedSubjectFromOpenRequest({ type: 'GET_STATE' })).toBeUndefined()
  })
})
