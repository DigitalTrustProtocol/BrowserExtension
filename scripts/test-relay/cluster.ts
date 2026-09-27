import type { Event } from 'nostr-tools'
import { handleAdmin, type RelayControl } from './control/admin.ts'
import {
  executeCommand,
  type CommandResult,
} from './control/commands.ts'
import {
  RelayHost,
  type ReceivedQuery,
  type RelayStats,
  type WaitQuery,
} from './server/relay.ts'
import { SimWorld } from './sim/world.ts'

export interface ClusterOptions {
  port?: number
  relays?: number
  seed?: string
  verify?: boolean
  personas?: number
}

/**
 * One or more local relays plus the shared simulator.
 * Admin HTTP on every port controls the whole cluster.
 */
export class TestRelayCluster implements RelayControl {
  readonly hosts: RelayHost[]
  readonly world: SimWorld
  readonly seed: string
  log: (line: string) => void = (line) => console.log(line)
  onQuit: (() => void) | undefined
  #stopRequested = false

  private constructor(options: ClusterOptions) {
    this.seed = options.seed ?? 'attentionx'
    this.world = new SimWorld(this.seed, options.personas ?? 16)
    const verify = options.verify !== false
    this.hosts = Array.from({ length: options.relays ?? 1 }, () => {
      return new RelayHost({
        verify,
        handleAdmin: (request, response, url) =>
          handleAdmin(request, response, url, this),
      })
    })
  }

  static async start(options: ClusterOptions = {}): Promise<TestRelayCluster> {
    const cluster = new TestRelayCluster(options)
    let port = options.port ?? 7777
    for (const host of cluster.hosts) {
      port = (await host.listen(port)) + 1
    }
    return cluster
  }

  get urls(): string[] {
    return this.hosts.map((host) => host.url)
  }

  async close(): Promise<void> {
    this.world.stopStream()
    await Promise.all(this.hosts.map((host) => host.close()))
  }

  command(line: string): Promise<CommandResult> {
    return executeCommand(
      {
        hosts: this.hosts,
        world: this.world,
        seed: this.seed,
        log: (row) => this.log(row),
        requestStop: () => {
          this.#stopRequested = true
          this.onQuit?.()
        },
      },
      line,
    )
  }

  get stopRequested(): boolean {
    return this.#stopRequested
  }

  stats(): RelayStats[] {
    return this.hosts.map((host) => host.stats())
  }

  received(query: ReceivedQuery & { relay?: number }): Event[] {
    return this.#selected(query.relay).flatMap((host) =>
      host.received(query).map((row) => row.event),
    )
  }

  async waitFor(query: WaitQuery & { relay?: number }): Promise<Event> {
    const timeoutMs = query.timeoutMs ?? 5_000
    const started = Date.now()
    const hosts = this.#selected(query.relay)
    if (!query.fresh) {
      const existing = this.#match(hosts, query, 0)
      if (existing) return existing
    }
    const deadline = started + timeoutMs
    while (Date.now() < deadline) {
      const found = this.#match(hosts, query, query.fresh ? started : 0)
      if (found) return found
      await delay(20)
    }
    throw new Error('Timed out waiting for a relay event')
  }

  #selected(relay: number | undefined): RelayHost[] {
    if (relay === undefined) return this.hosts
    const host = this.hosts[relay - 1]
    if (!host) throw new Error(`Relay ${relay} is not running`)
    return [host]
  }

  #match(hosts: readonly RelayHost[], query: ReceivedQuery, after: number): Event | undefined {
    for (const host of hosts) {
      for (const row of host.received({ ...query, limit: 50 })) {
        if (!row.accepted) continue
        if (row.at < after) continue
        return row.event
      }
    }
    return undefined
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
