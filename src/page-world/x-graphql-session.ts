/**
 * Page-world helpers for authenticated X GraphQL calls using the signed-in
 * browser session. Credentials stay in MAIN world; only proof match results
 * cross the content boundary.
 */

/** Public X web client bearer (same token the site embeds). */
export const X_WEB_BEARER =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'

/** Minimal feature flags accepted by recent SearchTimeline builds. */
export const DEFAULT_SEARCH_TIMELINE_FEATURES: Record<string, boolean> = {
  rweb_tipjar_consumption_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  creator_subscriptions_quote_tweet_preview_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  rweb_video_timestamps_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_enhance_cards_enabled: false,
}

export interface XGraphqlSession {
  bearer?: string
  csrf?: string
  queryIds: Map<string, string>
  features?: Record<string, boolean>
}

export function createXGraphqlSession(): XGraphqlSession {
  return { queryIds: new Map() }
}

export function readCt0Cookie(cookie: string): string | undefined {
  const match = /(?:^|;\s*)ct0=([^;]+)/.exec(cookie)
  if (!match?.[1]) return undefined
  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

export function noteGraphqlRequest(
  session: XGraphqlSession,
  requestUrl: string,
  headers?: HeadersInit,
  body?: unknown,
): void {
  const headerMap = normalizeHeaders(headers)
  const authorization = headerMap.authorization ?? headerMap.Authorization
  if (typeof authorization === 'string') {
    const bearer = authorization.replace(/^Bearer\s+/i, '').trim()
    if (bearer) session.bearer = bearer
  }
  const csrf =
    headerMap['x-csrf-token'] ??
    headerMap['X-Csrf-Token'] ??
    headerMap['x-csrf-token'.toLowerCase()]
  if (typeof csrf === 'string' && csrf.trim()) session.csrf = csrf.trim()

  const parsed = parseGraphqlUrl(requestUrl)
  if (parsed) {
    session.queryIds.set(parsed.operationName, parsed.queryId)
    if (parsed.features) session.features = parsed.features
  }

  if (body && typeof body === 'string') {
    try {
      const json = JSON.parse(body) as {
        features?: Record<string, boolean>
        queryId?: string
        operationName?: string
      }
      if (json.features && typeof json.features === 'object') {
        session.features = json.features
      }
      if (
        typeof json.queryId === 'string' &&
        typeof json.operationName === 'string'
      ) {
        session.queryIds.set(json.operationName, json.queryId)
      }
    } catch {
      /* ignore non-JSON bodies */
    }
  }
}

export function parseGraphqlUrl(
  value: string,
  baseUrl = 'https://x.com/',
):
  | {
      queryId: string
      operationName: string
      features?: Record<string, boolean>
    }
  | undefined {
  let url: URL
  try {
    url = new URL(value, baseUrl)
  } catch {
    return undefined
  }
  if (!url.pathname.includes('/graphql/')) return undefined
  const segments = url.pathname.split('/').filter(Boolean)
  const graphqlIndex = segments.indexOf('graphql')
  const queryId = graphqlIndex >= 0 ? segments[graphqlIndex + 1] : undefined
  const operationName =
    graphqlIndex >= 0
      ? segments[graphqlIndex + 2]
      : url.searchParams.get('operationName') ?? undefined
  if (!queryId || !operationName) return undefined

  let features: Record<string, boolean> | undefined
  const featuresParam = url.searchParams.get('features')
  if (featuresParam) {
    try {
      const parsed = JSON.parse(featuresParam) as Record<string, unknown>
      features = {}
      for (const [key, flag] of Object.entries(parsed)) {
        if (typeof flag === 'boolean') features[key] = flag
      }
    } catch {
      features = undefined
    }
  }

  return { queryId, operationName, ...(features ? { features } : {}) }
}

export function findOperationQueryIdInText(
  source: string,
  operationName: string,
): string | undefined {
  const escaped = operationName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    new RegExp(
      `queryId:"([A-Za-z0-9_-]+)",operationName:"${escaped}"`,
    ),
    new RegExp(
      `operationName:"${escaped}"[^\\n]{0,80}queryId:"([A-Za-z0-9_-]+)"`,
    ),
    new RegExp(
      `"${escaped}"\\s*,\\s*"queryId"\\s*:\\s*"([A-Za-z0-9_-]+)"`,
    ),
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(source)
    if (match?.[1]) return match[1]
  }
  return undefined
}

export async function resolveOperationQueryId(
  session: XGraphqlSession,
  operationName: string,
  target: Window,
): Promise<string | undefined> {
  const cached = session.queryIds.get(operationName)
  if (cached) return cached

  const doc = target.document
  for (const script of Array.from(doc.scripts)) {
    if (script.src) continue
    const text = script.textContent ?? ''
    if (!text.includes(operationName)) continue
    const id = findOperationQueryIdInText(text, operationName)
    if (id) {
      session.queryIds.set(operationName, id)
      return id
    }
  }

  const candidates = Array.from(doc.scripts)
    .map((script) => script.src)
    .filter(
      (src) =>
        Boolean(src) &&
        /(?:responsive-web|client-web|api|main|bundle)/i.test(src),
    )
    .slice(0, 20)

  for (const src of candidates) {
    try {
      const response = await target.fetch(src, { credentials: 'omit' })
      if (!response.ok) continue
      const text = await response.text()
      if (!text.includes(operationName)) continue
      const id = findOperationQueryIdInText(text, operationName)
      if (id) {
        session.queryIds.set(operationName, id)
        return id
      }
    } catch {
      /* ignore fetch failures */
    }
  }
  return undefined
}

export function buildSearchTimelineVariables(
  rawQuery: string,
  count = 20,
): Record<string, unknown> {
  return {
    rawQuery,
    count,
    querySource: 'typed_query',
    product: 'Latest',
    withGrokTranslatedBio: false,
  }
}

export async function fetchSearchTimeline(
  target: Window,
  session: XGraphqlSession,
  rawQuery: string,
  fetchImpl: typeof fetch = target.fetch.bind(target),
): Promise<unknown | undefined> {
  const csrf = session.csrf ?? readCt0Cookie(target.document.cookie)
  if (csrf) session.csrf = csrf
  if (!session.csrf) return undefined

  const queryId = await resolveOperationQueryId(
    session,
    'SearchTimeline',
    target,
  )
  if (!queryId) return undefined

  const bearer = session.bearer ?? X_WEB_BEARER
  const features = session.features ?? DEFAULT_SEARCH_TIMELINE_FEATURES
  const variables = buildSearchTimelineVariables(rawQuery)
  const endpoint = `https://x.com/i/api/graphql/${queryId}/SearchTimeline`

  const headers: Record<string, string> = {
    authorization: `Bearer ${bearer}`,
    'x-csrf-token': session.csrf,
    'x-twitter-auth-type': 'OAuth2Session',
    'x-twitter-active-user': 'yes',
    'x-twitter-client-language': 'en',
    'content-type': 'application/json',
  }

  // Prefer POST (current X client); fall back to GET if rejected.
  const postBody = JSON.stringify({
    variables,
    features,
    queryId,
  })
  let response = await fetchImpl(endpoint, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: postBody,
  })
  if (!response.ok) {
    const getUrl = new URL(endpoint)
    getUrl.searchParams.set('variables', JSON.stringify(variables))
    getUrl.searchParams.set('features', JSON.stringify(features))
    response = await fetchImpl(getUrl.toString(), {
      method: 'GET',
      credentials: 'include',
      headers,
    })
  }
  if (!response.ok) return undefined
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

function normalizeHeaders(
  headers?: HeadersInit,
): Record<string, string> {
  const out: Record<string, string> = {}
  if (!headers) return out
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      out[key] = value
      out[key.toLowerCase()] = value
    })
    return out
  }
  if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      out[key] = value
      out[key.toLowerCase()] = value
    }
    return out
  }
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      out[key] = value
      out[key.toLowerCase()] = value
    }
  }
  return out
}
