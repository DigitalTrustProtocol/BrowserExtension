import { describe, expect, it } from 'vitest'
import {
  buildGraphPageUrl,
  GRAPH_FOCUS_MESSAGE,
  GRAPH_VIEW_MESSAGE,
  isGraphChromeTabUrl,
  isGraphDeepLink,
  isGraphFocusMessage,
  isGraphViewMessage,
  parseGraphPageUrl,
  parseNodeId,
  subjectNodeId,
} from './graph-deeplink'

describe('graph-deeplink', () => {
  it('builds operator Application shell with empty search by default', () => {
    expect(buildGraphPageUrl()).toBe('')
    expect(buildGraphPageUrl({ baseUrl: 'chrome-extension://x/src/cockpit/index.html' })).toBe(
      'chrome-extension://x/src/cockpit/index.html',
    )
    expect(isGraphDeepLink(parseGraphPageUrl(''))).toBe(false)
  })

  it('builds explicit graph mode as a deep link', () => {
    const url = buildGraphPageUrl({
      mode: 'graph',
      baseUrl: 'chrome-extension://x/src/cockpit/index.html',
    })
    expect(url).toBe('chrome-extension://x/src/cockpit/index.html?mode=graph')
    const parsed = parseGraphPageUrl(new URL(url).search)
    expect(parsed).toEqual({ mode: 'graph', linked: true })
    expect(isGraphDeepLink(parsed)).toBe(true)
  })

  it('round-trips path mode with subject and context', () => {
    const url = buildGraphPageUrl({
      mode: 'path',
      subject: { type: 'i', value: 'user:id:42' },
      context: 'identity',
      baseUrl: 'https://ext/app.html',
    })
    expect(url).toContain('mode=path')
    expect(url).toContain('subjectType=i')
    expect(url).toContain('subjectValue=user%3Aid%3A42')
    expect(url).toContain('context=identity')

    const parsed = parseGraphPageUrl(new URL(url).search)
    expect(parsed).toEqual({
      mode: 'path',
      linked: true,
      subject: { type: 'i', value: 'user:id:42' },
      context: 'identity',
    })
    expect(isGraphDeepLink(parsed)).toBe(true)
  })

  it('parses focus for graph mode', () => {
    const search = buildGraphPageUrl({
      mode: 'graph',
      focus: 'i:post:id:99',
    })
    expect(parseGraphPageUrl(search)).toEqual({
      mode: 'graph',
      linked: true,
      focus: 'i:post:id:99',
    })
  })

  it('maps subject node ids', () => {
    const subject = { type: 'i' as const, value: 'user:id:1' }
    expect(subjectNodeId(subject)).toBe('i:user:id:1')
    expect(parseNodeId('i:user:id:1')).toEqual(subject)
    expect(parseNodeId('p:abc')).toEqual({ type: 'p', value: 'abc' })
    expect(parseNodeId('bad')).toBeUndefined()
  })

  it('accepts a well-formed GRAPH_FOCUS message', () => {
    expect(
      isGraphFocusMessage({
        type: GRAPH_FOCUS_MESSAGE,
        focus: 'i:user:id:11348282',
      }),
    ).toBe(true)
    expect(isGraphFocusMessage({ type: GRAPH_FOCUS_MESSAGE, focus: 'bad' })).toBe(
      false,
    )
  })

  it('accepts a well-formed GRAPH_VIEW message', () => {
    expect(
      isGraphViewMessage({
        type: GRAPH_VIEW_MESSAGE,
        mode: 'graph',
        tabId: 42,
        focus: 'i:user:id:11348282',
      }),
    ).toBe(true)
    expect(
      isGraphViewMessage({
        type: GRAPH_VIEW_MESSAGE,
        mode: 'path',
        subject: { type: 'i', value: 'user:id:2385654727' },
      }),
    ).toBe(true)
    expect(
      isGraphViewMessage({
        type: GRAPH_VIEW_MESSAGE,
        mode: 'graph',
      }),
    ).toBe(true)
    expect(
      isGraphViewMessage({ type: GRAPH_VIEW_MESSAGE, mode: 'other' }),
    ).toBe(false)
    expect(
      isGraphViewMessage({
        type: GRAPH_VIEW_MESSAGE,
        mode: 'graph',
        focus: 'bad',
      }),
    ).toBe(false)
  })

  it('recognizes fullscreen Graph tabs and skips Application / Outbox URLs', () => {
    const expected = {
      origin: 'https://ext',
      pathname: '/src/cockpit/index.html',
    }
    expect(
      isGraphChromeTabUrl(
        'https://ext/src/cockpit/index.html?mode=graph',
        expected,
      ),
    ).toBe(true)
    expect(
      isGraphChromeTabUrl(
        'https://ext/src/cockpit/index.html?page=outbox',
        expected,
      ),
    ).toBe(false)
    expect(
      isGraphChromeTabUrl('https://ext/src/cockpit/index.html', expected),
    ).toBe(false)
  })

  it('drops malformed or oversized deep-link values', () => {
    expect(
      parseGraphPageUrl(
        `?mode=path&focus=bad&subjectType=i&subjectValue=${'x'.repeat(1_025)}&context=${'x'.repeat(129)}`,
      ),
    ).toEqual({ mode: 'path', linked: true })
  })
})
