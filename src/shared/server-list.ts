/**
 * One selected graph resolver. Built-ins cannot be removed.
 * Stored URLs are http(s); the socket is the same origin with ws(s).
 */

export const DEFAULT_GRAPH_SERVER_URL = 'https://graph.trust.dance'
export const PERSONAL_GRAPH_SERVER_URL = 'http://localhost:32009'

export const BUILTIN_GRAPH_SERVERS = [
  DEFAULT_GRAPH_SERVER_URL,
  PERSONAL_GRAPH_SERVER_URL,
] as const

export const SERVER_READ_ONLY_ERROR = 'This server is read-only for this key'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

export interface GraphServerSelection {
  selected: string
  custom: string[]
}

export interface GraphServerRow {
  url: string
  builtin: boolean
}

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '')
  return LOOPBACK_HOSTS.has(host)
}

export function isBuiltinGraphServer(url: string): boolean {
  return (BUILTIN_GRAPH_SERVERS as readonly string[]).includes(url)
}

/**
 * Accept https, http on loopback, and ws(s) (stored as http(s)).
 * A bare host becomes https, except localhost / 127.0.0.1 which become http.
 */
export function normalizeGraphServerUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed || /\s/.test(trimmed)) return null
  let candidate = trimmed
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
    const host = candidate.split('/')[0]?.replace(/^\[|\]$/g, '') ?? ''
    const hostname = host.split(':')[0] ?? ''
    candidate = isLoopbackHost(hostname)
      ? `http://${candidate}`
      : `https://${candidate}`
  } else if (/^wss:\/\//i.test(candidate)) {
    candidate = `https://${candidate.slice('wss://'.length)}`
  } else if (/^ws:\/\//i.test(candidate)) {
    candidate = `http://${candidate.slice('ws://'.length)}`
  }
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return null
  }
  if (url.username || url.password || url.hash) return null
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) return null
  if (!url.hostname) return null
  url.search = ''
  url.hash = ''
  let href = url.toString()
  if (href.endsWith('/')) href = href.slice(0, -1)
  return href
}

export function graphServerWebSocketUrl(httpUrl: string): string {
  const url = new URL(httpUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

export function graphServerHost(httpUrl: string): string {
  try {
    return new URL(httpUrl).host
  } catch {
    return httpUrl
  }
}

/** Origin pattern for chrome.permissions. */
export function graphServerPermissionOrigin(httpUrl: string): string {
  const url = new URL(httpUrl)
  return `${url.origin}/*`
}

function normalizeCustomList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const url = normalizeGraphServerUrl(item)
    if (!url || isBuiltinGraphServer(url) || out.includes(url)) continue
    out.push(url)
  }
  return out
}

export function parseGraphServerSelection(
  selected: unknown,
  custom: unknown,
): GraphServerSelection {
  const customs = normalizeCustomList(custom)
  const picked =
    typeof selected === 'string' ? normalizeGraphServerUrl(selected) : null
  const known =
    picked !== null && (isBuiltinGraphServer(picked) || customs.includes(picked))
  return {
    selected: known && picked ? picked : DEFAULT_GRAPH_SERVER_URL,
    custom: customs,
  }
}

export function graphServerRows(selection: GraphServerSelection): GraphServerRow[] {
  return [
    ...BUILTIN_GRAPH_SERVERS.map((url) => ({ url, builtin: true })),
    ...selection.custom.map((url) => ({ url, builtin: false })),
  ]
}

export function selectGraphServer(
  selection: GraphServerSelection,
  raw: string,
): GraphServerSelection | null {
  const url = normalizeGraphServerUrl(raw)
  if (!url) return null
  if (!isBuiltinGraphServer(url) && !selection.custom.includes(url)) return null
  return { selected: url, custom: selection.custom }
}

/** Add a custom URL and select it. Built-ins are only selected. */
export function addGraphServer(
  selection: GraphServerSelection,
  raw: string,
): GraphServerSelection | null {
  const url = normalizeGraphServerUrl(raw)
  if (!url) return null
  if (isBuiltinGraphServer(url)) {
    return { selected: url, custom: selection.custom }
  }
  const custom = selection.custom.includes(url)
    ? selection.custom
    : [...selection.custom, url]
  return { selected: url, custom }
}

export function removeGraphServer(
  selection: GraphServerSelection,
  raw: string,
): GraphServerSelection | null {
  const url = normalizeGraphServerUrl(raw)
  if (!url || isBuiltinGraphServer(url)) return null
  if (!selection.custom.includes(url)) return null
  return {
    selected:
      selection.selected === url ? DEFAULT_GRAPH_SERVER_URL : selection.selected,
    custom: selection.custom.filter((item) => item !== url),
  }
}
