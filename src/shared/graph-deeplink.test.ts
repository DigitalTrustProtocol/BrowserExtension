import { describe, expect, it } from 'vitest'
import {
  buildGraphPageUrl,
  isGraphDeepLink,
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
      subject: { type: 'i', value: 'ext:twitter_id:42' },
      context: 'identity',
      baseUrl: 'https://ext/app.html',
    })
    expect(url).toContain('mode=path')
    expect(url).toContain('subjectType=i')
    expect(url).toContain('subjectValue=ext%3Atwitter_id%3A42')
    expect(url).toContain('context=identity')

    const parsed = parseGraphPageUrl(new URL(url).search)
    expect(parsed).toEqual({
      mode: 'path',
      linked: true,
      subject: { type: 'i', value: 'ext:twitter_id:42' },
      context: 'identity',
    })
    expect(isGraphDeepLink(parsed)).toBe(true)
  })

  it('parses focus for graph mode', () => {
    const search = buildGraphPageUrl({
      mode: 'graph',
      focus: 'i:ext:twitter_post:99',
    })
    expect(parseGraphPageUrl(search)).toEqual({
      mode: 'graph',
      linked: true,
      focus: 'i:ext:twitter_post:99',
    })
  })

  it('maps subject node ids', () => {
    const subject = { type: 'i' as const, value: 'ext:twitter_id:1' }
    expect(subjectNodeId(subject)).toBe('i:ext:twitter_id:1')
    expect(parseNodeId('i:ext:twitter_id:1')).toEqual(subject)
    expect(parseNodeId('p:abc')).toEqual({ type: 'p', value: 'abc' })
    expect(parseNodeId('bad')).toBeUndefined()
  })

  it('drops malformed or oversized deep-link values', () => {
    expect(
      parseGraphPageUrl(
        `?mode=path&focus=bad&subjectType=i&subjectValue=${'x'.repeat(1_025)}&context=${'x'.repeat(129)}`,
      ),
    ).toEqual({ mode: 'path', linked: true })
  })
})
