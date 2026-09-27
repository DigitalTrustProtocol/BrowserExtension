import type { Event } from 'nostr-tools'
import { TestRelayCluster, type ClusterOptions } from './cluster.ts'
import type { CommandResult } from './control/commands.ts'
import type { RelayStats } from './server/relay.ts'

export type { ClusterOptions, CommandResult, RelayStats }
export { TestRelayCluster }

/** Start an in-process cluster. Port 0 asks the OS for a free port. */
export function startTestRelay(
  options: ClusterOptions = {},
): Promise<TestRelayCluster> {
  return TestRelayCluster.start(options)
}

export interface RemoteWait {
  kind?: number
  author?: string
  /** `name:value`, for example `i:user:id:44196397`. */
  tag?: string
  timeoutMs?: number
  fresh?: boolean
  relay?: number
}

/**
 * Admin client for a relay that is already running, including one started
 * with `npm run relay`.
 */
export class RemoteRelay {
  readonly adminUrl: string

  constructor(adminUrl: string) {
    this.adminUrl = adminUrl
  }

  static fromPort(port: number): RemoteRelay {
    return new RemoteRelay(`http://127.0.0.1:${port}`)
  }

  command(line: string): Promise<CommandResult> {
    return this.#post('/admin/command', { line })
  }

  stats(): Promise<RelayStats[]> {
    return this.#get('/admin/stats').then((body) => {
      const record = body as { relays: RelayStats[] }
      return record.relays
    })
  }

  received(query: Omit<RemoteWait, 'timeoutMs' | 'fresh'> = {}): Promise<Event[]> {
    return this.#get(`/admin/received${queryString(query)}`).then((body) => {
      const record = body as { events: Event[] }
      return record.events
    })
  }

  waitFor(query: RemoteWait = {}): Promise<Event> {
    return this.#get(`/admin/wait${queryString(query)}`).then((body) => {
      const record = body as { event: Event }
      return record.event
    })
  }

  async #post(pathname: string, body: unknown): Promise<CommandResult> {
    const response = await fetch(`${this.adminUrl}${pathname}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return (await response.json()) as CommandResult
  }

  async #get(pathname: string): Promise<unknown> {
    const response = await fetch(`${this.adminUrl}${pathname}`)
    const body = (await response.json()) as { ok?: boolean; lines?: string[] }
    if (!response.ok || body.ok === false) {
      throw new Error(body.lines?.join('; ') || `Admin request failed (${response.status})`)
    }
    return body
  }
}

function queryString(query: RemoteWait): string {
  const params = new URLSearchParams()
  if (query.kind !== undefined) params.set('kind', String(query.kind))
  if (query.author) params.set('author', query.author)
  if (query.tag) params.set('tag', query.tag)
  if (query.timeoutMs !== undefined) params.set('timeout', String(query.timeoutMs))
  if (query.fresh) params.set('fresh', '1')
  if (query.relay !== undefined) params.set('relay', String(query.relay))
  const text = params.toString()
  return text ? `?${text}` : ''
}
