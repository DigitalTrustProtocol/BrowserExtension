/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./ui/card-title', () => ({
  readPostHeadline: vi.fn(() => 'cached headline'),
}))

import { noteDomPostChrome, startPostChromeBridge } from './post-chrome-bridge'
import { readPostHeadline } from './ui/card-title'

const readPostHeadlineMock = vi.mocked(readPostHeadline)

describe('noteDomPostChrome', () => {
  let bridge: { stop(): void }

  beforeEach(() => {
    readPostHeadlineMock.mockClear()
    bridge = startPostChromeBridge({ subscribeInbound: () => () => {} })
  })

  afterEach(() => {
    bridge.stop()
  })

  it('reads the headline once per post and reuses it on repeat scans', () => {
    const article = document.createElement('article')

    noteDomPostChrome('123', article)
    noteDomPostChrome('123', article)
    noteDomPostChrome('123', article)
    expect(readPostHeadlineMock).toHaveBeenCalledTimes(1)

    noteDomPostChrome('456', article)
    expect(readPostHeadlineMock).toHaveBeenCalledTimes(2)
  })
})
