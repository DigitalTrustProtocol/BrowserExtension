import type { TrustSubject } from '../graph/types'

export type GraphPageMode = 'graph' | 'path'

export interface GraphDeepLink {
  mode: GraphPageMode
  /**
   * True when the URL explicitly requested Graph chrome (`mode`, focus,
   * subject, or context). Bare Application URLs are not Graph deep links.
   */
  linked: boolean
  /** Node id to center (`p:<hex>`, `i:ext:twitter_id:…`, …). */
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

/** Stable node id for a trust subject (matches LocalTrustGraph snapshot ids). */
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
