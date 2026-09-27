import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Event } from 'nostr-tools'
import type { CommandResult } from './commands.ts'
import type { ReceivedQuery, RelayStats, WaitQuery } from '../server/relay.ts'

export interface RelayControl {
  command(line: string): Promise<CommandResult>
  stats(): RelayStats[]
  received(query: ReceivedQuery & { relay?: number }): Event[]
  waitFor(query: WaitQuery & { relay?: number }): Promise<Event>
}

export async function handleAdmin(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  control: RelayControl,
): Promise<void> {
  response.setHeader('access-control-allow-origin', '*')
  response.setHeader('content-type', 'application/json')
  try {
    if (request.method === 'POST' && url.pathname === '/admin/command') {
      const body = (await readJson(request)) as { line?: unknown }
      if (typeof body.line !== 'string') {
        send(response, 400, { ok: false, lines: ['JSON body needs a line string'] })
        return
      }
      send(response, 200, await control.command(body.line))
      return
    }
    if (request.method === 'GET' && url.pathname === '/admin/stats') {
      send(response, 200, { ok: true, relays: control.stats() })
      return
    }
    if (request.method === 'GET' && url.pathname === '/admin/received') {
      send(response, 200, {
        ok: true,
        events: control.received(receivedQuery(url)),
      })
      return
    }
    if (request.method === 'GET' && url.pathname === '/admin/wait') {
      const query = waitQuery(url)
      const event = await control.waitFor(query)
      send(response, 200, { ok: true, event })
      return
    }
    send(response, 404, { ok: false, lines: ['Not found'] })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status = message.startsWith('Timed out') ? 408 : 500
    send(response, status, { ok: false, lines: [message] })
  }
}

function receivedQuery(url: URL): ReceivedQuery & { relay?: number } {
  return {
    ...tagQuery(url),
    limit: queryNumber(url, 'limit') ?? 50,
    acceptedOnly: url.searchParams.get('accepted') !== '0',
    ...(queryNumber(url, 'relay') === undefined
      ? {}
      : { relay: queryNumber(url, 'relay') }),
  }
}

function waitQuery(url: URL): WaitQuery & { relay?: number } {
  return {
    ...receivedQuery(url),
    timeoutMs: Math.min(60_000, queryNumber(url, 'timeout') ?? 5_000),
    fresh: url.searchParams.get('fresh') === '1',
  }
}

function tagQuery(url: URL): ReceivedQuery {
  const author = url.searchParams.get('author') ?? undefined
  const kind = queryNumber(url, 'kind')
  const tag = url.searchParams.get('tag') ?? undefined
  let tagName: string | undefined
  let tagValue: string | undefined
  if (tag) {
    const split = tag.indexOf(':')
    tagName = split < 0 ? tag : tag.slice(0, split)
    tagValue = split < 0 ? undefined : tag.slice(split + 1)
  }
  return {
    ...(author ? { author } : {}),
    ...(kind === undefined ? {} : { kind }),
    ...(tagName ? { tagName } : {}),
    ...(tagValue ? { tagValue } : {}),
  }
}

function queryNumber(url: URL, name: string): number | undefined {
  const raw = url.searchParams.get(name)
  if (raw === null || raw === '') return undefined
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return undefined
  return parsed
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text) return {}
  return JSON.parse(text) as unknown
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status
  response.end(JSON.stringify(body))
}
