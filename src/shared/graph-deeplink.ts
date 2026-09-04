import type { TrustSubject } from '../graph/types'

export type GraphPageMode = 'graph' | 'path'

export interface GraphDeepLink {
  mode: GraphPageMode
  /**
   * True when the URL explicitly requested Graph chrome (`mode`, focus,
   * subject, or context). Bare Application URLs are not Graph deep links.
   */
  linked: boolean
  /** Node id to center (`p:<hex>`, `i:user:id:…`, …). */
  focus?: string
  subject?: TrustSubject
  context?: string
}

export interface BuildGraphPageUrlOptions {
  mode?: GraphPageMode
  focus?: string
  subject?: TrustSubject
  context?: string
  /**
   * Absolute extension page URL for `src/cockpit/index.html`.
   * When omitted, only the search string is returned (leading `?`).
   */
  baseUrl?: string
}

/** Build Application Graph deep-link search params or full URL. */
export function buildGraphPageUrl(options: BuildGraphPageUrlOptions = {}): string {
  const params = new URLSearchParams()
  const mode = options.mode ?? 'graph'
  const isLink =
    options.mode !== undefined ||
    Boolean(options.focus) ||
    Boolean(options.subject) ||
    Boolean(options.context)
  if (isLink) {
    params.set('mode', mode)
  }
  if (options.focus) params.set('focus', options.focus)
  if (options.subject) {
    params.set('subjectType', options.subject.type)
    params.set('subjectValue', options.subject.value)
  }
  if (options.context) params.set('context', options.context)

  const search = params.toString()
  if (!options.baseUrl) return search ? `?${search}` : ''
  return search ? `${options.baseUrl}?${search}` : options.baseUrl
}

/** Parse Application Graph deep-link from `location.search` or a query string. */
export function parseGraphPageUrl(search: string): GraphDeepLink {
  const raw = search.startsWith('?') ? search.slice(1) : search
  const params = new URLSearchParams(raw)
  const modeRaw = params.get('mode')
  const mode: GraphPageMode = modeRaw === 'path' ? 'path' : 'graph'
  const focusRaw = params.get('focus')
  const focus =
    focusRaw &&
    focusRaw.length <= 1_100 &&
    parseNodeId(focusRaw)
      ? focusRaw
      : undefined
  const subjectType = params.get('subjectType')
  const subjectValue = params.get('subjectValue')
  const contextRaw = params.get('context')
  const context =
    contextRaw && contextRaw.length <= 128 ? contextRaw : undefined

  let subject: TrustSubject | undefined
  if (
    (subjectType === 'p' || subjectType === 'e' || subjectType === 'i') &&
    subjectValue &&
    subjectValue.length <= 1_024
  ) {
    subject = { type: subjectType, value: subjectValue }
  }

  const linked =
    modeRaw === 'graph' ||
    modeRaw === 'path' ||
    Boolean(focus) ||
    Boolean(subject) ||
    Boolean(context)

  return {
    mode,
    linked,
    ...(focus ? { focus } : {}),
    ...(subject ? { subject } : {}),
    ...(context ? { context } : {}),
  }
}

/** True when the URL carries Graph deep-link params (fullscreen Graph chrome). */
export function isGraphDeepLink(link: GraphDeepLink): boolean {
  return link.linked
}

/** Runtime message: recenter an already-open Graph page on a node. */
export const GRAPH_FOCUS_MESSAGE = 'GRAPH_FOCUS' as const

export interface GraphFocusMessage {
  type: typeof GRAPH_FOCUS_MESSAGE
  focus: string
}

export function isGraphFocusMessage(value: unknown): value is GraphFocusMessage {
  if (!value || typeof value !== 'object') return false
  const record = value as { type?: unknown; focus?: unknown }
  return (
    record.type === GRAPH_FOCUS_MESSAGE &&
    typeof record.focus === 'string' &&
    record.focus.length > 0 &&
    record.focus.length <= 1_100 &&
    Boolean(parseNodeId(record.focus))
  )
}

/**
 * Runtime message: apply a Graph/Path view on an already-open Graph tab
 * without navigating (avoids a white remount flash).
 */
export const GRAPH_VIEW_MESSAGE = 'GRAPH_VIEW' as const

export interface GraphViewMessage {
  type: typeof GRAPH_VIEW_MESSAGE
  mode: GraphPageMode
  /** Target Graph tab; listeners ignore the message when it does not match. */
  tabId?: number
  focus?: string
  subject?: TrustSubject
  context?: string
}

export function graphViewMessageFromDeepLink(
  tabId: number,
  link: GraphDeepLink,
): GraphViewMessage {
  return {
    type: GRAPH_VIEW_MESSAGE,
    mode: link.mode,
    tabId,
    ...(link.focus ? { focus: link.focus } : {}),
    ...(link.subject ? { subject: link.subject } : {}),
    ...(link.context ? { context: link.context } : {}),
  }
}

export function isGraphViewMessage(value: unknown): value is GraphViewMessage {
  if (!value || typeof value !== 'object') return false
  const record = value as {
    type?: unknown
    mode?: unknown
    tabId?: unknown
    focus?: unknown
    subject?: unknown
    context?: unknown
  }
  if (record.type !== GRAPH_VIEW_MESSAGE) return false
  if (record.mode !== 'graph' && record.mode !== 'path') return false
  if (
    record.tabId !== undefined &&
    (typeof record.tabId !== 'number' ||
      !Number.isInteger(record.tabId) ||
      record.tabId < 0)
  ) {
    return false
  }
  if (record.focus !== undefined) {
    if (
      typeof record.focus !== 'string' ||
      record.focus.length === 0 ||
      record.focus.length > 1_100 ||
      !parseNodeId(record.focus)
    ) {
      return false
    }
  }
  const subject = parseTrustSubject(record.subject)
  if (record.subject !== undefined && !subject) return false
  if (
    record.context !== undefined &&
    (typeof record.context !== 'string' ||
      record.context.length === 0 ||
      record.context.length > 128)
  ) {
    return false
  }
  return true
}

function parseTrustSubject(value: unknown): TrustSubject | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as { type?: unknown; value?: unknown }
  if (
    (record.type === 'p' || record.type === 'e' || record.type === 'i') &&
    typeof record.value === 'string' &&
    record.value.length > 0 &&
    record.value.length <= 1_024
  ) {
    return { type: record.type, value: record.value }
  }
  return undefined
}

/** True when an Application tab is fullscreen Graph chrome (not Outbox / Users). */
export function isGraphChromeTabUrl(
  href: string,
  expected: { origin: string; pathname: string },
): boolean {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return false
  }
  if (
    url.origin !== expected.origin ||
    url.pathname !== expected.pathname ||
    url.hash
  ) {
    return false
  }
  if (url.searchParams.has('page')) return false
  return isGraphDeepLink(parseGraphPageUrl(url.search))
}

/** Stable node id for a trust subject (matches heap Graph View ids). */
export function subjectNodeId(subject: TrustSubject): string {
  return `${subject.type}:${subject.value}`
}

/** Parse a graph node id back into a TrustSubject when possible. */
export function parseNodeId(nodeId: string): TrustSubject | undefined {
  const colon = nodeId.indexOf(':')
  if (colon <= 0) return undefined
  const type = nodeId.slice(0, colon)
  const value = nodeId.slice(colon + 1)
  if ((type === 'p' || type === 'e' || type === 'i') && value) {
    return { type, value }
  }
  return undefined
}
