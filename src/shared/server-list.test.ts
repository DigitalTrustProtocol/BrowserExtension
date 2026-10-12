import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GRAPH_SERVER_URL,
  PERSONAL_GRAPH_SERVER_URL,
  addGraphServer,
  graphServerPermissionOrigin,
  graphServerRows,
  graphServerWebSocketUrl,
  normalizeGraphServerUrl,
  parseGraphServerSelection,
  removeGraphServer,
  selectGraphServer,
} from './server-list'

describe('normalizeGraphServerUrl', () => {
  it('defaults a bare host to the public https server', () => {
    expect(normalizeGraphServerUrl('graph.trust.dance')).toBe(
      DEFAULT_GRAPH_SERVER_URL,
    )
    expect(normalizeGraphServerUrl('https://graph.trust.dance/')).toBe(
      DEFAULT_GRAPH_SERVER_URL,
    )
    expect(normalizeGraphServerUrl('wss://graph.trust.dance')).toBe(
      DEFAULT_GRAPH_SERVER_URL,
    )
  })

  it('keeps localhost on http and port 32009', () => {
    expect(normalizeGraphServerUrl('localhost:32009')).toBe(
      PERSONAL_GRAPH_SERVER_URL,
    )
    expect(normalizeGraphServerUrl('http://127.0.0.1:32009')).toBe(
      'http://127.0.0.1:32009',
    )
    expect(graphServerWebSocketUrl(PERSONAL_GRAPH_SERVER_URL)).toBe(
      'ws://localhost:32009/',
    )
  })

  it('rejects public http and junk', () => {
    expect(normalizeGraphServerUrl('http://example.com')).toBeNull()
    expect(normalizeGraphServerUrl('ftp://graph.trust.dance')).toBeNull()
    expect(normalizeGraphServerUrl('')).toBeNull()
  })
})

describe('graph server selection', () => {
  it('selects the public server when nothing is stored', () => {
    const selection = parseGraphServerSelection(undefined, undefined)
    expect(selection.selected).toBe(DEFAULT_GRAPH_SERVER_URL)
    expect(graphServerRows(selection).map((row) => row.url)).toEqual([
      DEFAULT_GRAPH_SERVER_URL,
      PERSONAL_GRAPH_SERVER_URL,
    ])
  })

  it('keeps one custom URL and will not drop a built-in', () => {
    const added = addGraphServer(
      parseGraphServerSelection(undefined, undefined),
      'https://scores.example',
    )
    expect(added).toEqual({
      selected: 'https://scores.example',
      custom: ['https://scores.example'],
    })
    expect(removeGraphServer(added!, DEFAULT_GRAPH_SERVER_URL)).toBeNull()
    const removed = removeGraphServer(added!, 'https://scores.example')
    expect(removed).toEqual({
      selected: DEFAULT_GRAPH_SERVER_URL,
      custom: [],
    })
  })

  it('selects only a URL already on the list', () => {
    const selection = parseGraphServerSelection(undefined, [
      'https://scores.example',
    ])
    expect(selectGraphServer(selection, PERSONAL_GRAPH_SERVER_URL)?.selected).toBe(
      PERSONAL_GRAPH_SERVER_URL,
    )
    expect(selectGraphServer(selection, 'https://other.example')).toBeNull()
    expect(graphServerPermissionOrigin('https://scores.example')).toBe(
      'https://scores.example/*',
    )
  })
})
