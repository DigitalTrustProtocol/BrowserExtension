import { describe, expect, it, vi } from 'vitest'
import {
  buildSearchTimelineVariables,
  createXGraphqlSession,
  fetchSearchTimeline,
  findOperationQueryIdInText,
  noteGraphqlRequest,
  parseGraphqlUrl,
  readCt0Cookie,
} from './x-graphql-session'

describe('x graphql session', () => {
  it('reads ct0 from document cookies', () => {
    expect(readCt0Cookie('guest_id=x; ct0=abc%2Fdef; twid=u%3D1')).toBe(
      'abc/def',
    )
    expect(readCt0Cookie('auth_token=nope')).toBeUndefined()
  })

  it('parses graphql URLs and notes auth + query ids', () => {
    const session = createXGraphqlSession()
    const url =
      'https://x.com/i/api/graphql/VhUd6vHVmLBcw0uX-6jMLA/SearchTimeline?variables=%7B%7D&features=%7B%22responsive_web_graphql_timeline_navigation_enabled%22%3Atrue%7D'
    expect(parseGraphqlUrl(url)).toMatchObject({
      queryId: 'VhUd6vHVmLBcw0uX-6jMLA',
      operationName: 'SearchTimeline',
    })
    noteGraphqlRequest(session, url, {
      authorization: 'Bearer test-bearer',
      'x-csrf-token': 'csrf-token',
    })
    expect(session.bearer).toBe('test-bearer')
    expect(session.csrf).toBe('csrf-token')
    expect(session.queryIds.get('SearchTimeline')).toBe(
      'VhUd6vHVmLBcw0uX-6jMLA',
    )
    expect(session.features?.responsive_web_graphql_timeline_navigation_enabled).toBe(
      true,
    )
  })

  it('finds SearchTimeline query ids in client bundle text', () => {
    const source =
      'queryId:"ML-n2SfAxx5S_9QMqNejbg",operationName:"SearchTimeline",operationType:"query"'
    expect(findOperationQueryIdInText(source, 'SearchTimeline')).toBe(
      'ML-n2SfAxx5S_9QMqNejbg',
    )
  })

  it('builds Latest search variables', () => {
    expect(buildSearchTimelineVariables('from:keutmann "proof"', 10)).toEqual({
      rawQuery: 'from:keutmann "proof"',
      count: 10,
      querySource: 'typed_query',
      product: 'Latest',
      withGrokTranslatedBio: false,
    })
  })

  it('POSTs SearchTimeline with session csrf and query id', async () => {
    const session = createXGraphqlSession()
    session.csrf = 'csrf'
    session.queryIds.set('SearchTimeline', 'QueryId123')
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ data: {} }), { status: 200 }),
    )
    const target = {
      document: { cookie: 'ct0=csrf', scripts: [] },
      fetch: fetchImpl,
    } as unknown as Window

    const payload = await fetchSearchTimeline(
      target,
      session,
      'from:keutmann "proof"',
      fetchImpl as unknown as typeof fetch,
    )
    expect(payload).toEqual({ data: {} })
    expect(fetchImpl).toHaveBeenCalled()
    const call = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit | undefined,
    ]
    expect(call[0]).toBe(
      'https://x.com/i/api/graphql/QueryId123/SearchTimeline',
    )
    expect(call[1]).toMatchObject({
      method: 'POST',
      credentials: 'include',
      headers: expect.objectContaining({
        'x-csrf-token': 'csrf',
        authorization: expect.stringMatching(/^Bearer /),
      }),
    })
  })
})
