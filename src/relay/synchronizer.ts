import type { Event, Filter } from 'nostr-tools'
import { activePositivePubkeyEdges, TRUST_STATEMENT_KIND } from './graph'
import {
  assertRetryPolicy,
  DEFAULT_RETRY_POLICY,
  retryDelayMs,
} from './retry'
import {
  systemClock,
  type Clock,
  type EventIngestResult,
  type RelayEventRepository,
  type RelayProvenance,
  type RelayQueryClient,
  type RetryNotice,
  type RetryPolicy,
  type SyncCursorRepository,
} from './types'

const HEX_64 = /^[0-9a-f]{64}$/
const FULL_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1_000

export interface GraphSyncLimits {
  maxDepth: number
  maxAuthorsPerLevel: number
  maxTotalAuthors: number
  maxEvents: number
}

export const DEFAULT_GRAPH_SYNC_LIMITS: GraphSyncLimits = {
  maxDepth: 2,
  maxAuthorsPerLevel: 50,
  maxTotalAuthors: 150,
  maxEvents: 2_000,
}

export interface RelaySynchronizerDependencies {
  client: RelayQueryClient
  cursors: SyncCursorRepository
  events: RelayEventRepository
  onProvenance?: (observation: RelayProvenance) => void | Promise<void>
  onRetry?: (notice: RetryNotice) => void | Promise<void>
  clock?: Clock
  random?: () => number
}

export interface SynchronizeOptions {
  relayUrls: readonly string[]
  rootPubkeys: readonly string[]
  scope: string
  overlapSeconds: number
  limits?: GraphSyncLimits
  retryPolicy?: RetryPolicy
  signal?: AbortSignal
}

export interface RelayQueryOutcome {
  relayUrl: string
  author: string
  scope: string
  attempts: number
  completed: boolean
  error?: string
}

export type SyncTruncationReason =
  | 'maxDepth'
  | 'maxAuthorsPerLevel'
  | 'maxTotalAuthors'
  | 'maxEvents'

export interface SynchronizeResult {
  authors: string[]
  eventsProcessed: number
  eventsStored: number
  duplicates: number
  rejected: number
  queries: RelayQueryOutcome[]
  truncated: boolean
  truncationReasons: SyncTruncationReason[]
}

class EventLimitReachedError extends Error {
  constructor() {
    super('Relay synchronization reached maxEvents')
    this.name = 'EventLimitReachedError'
  }
}

function assertLimits(limits: GraphSyncLimits): void {
  if (
    !Number.isInteger(limits.maxDepth) ||
    limits.maxDepth < 0 ||
    !Number.isInteger(limits.maxAuthorsPerLevel) ||
    limits.maxAuthorsPerLevel < 1 ||
    !Number.isInteger(limits.maxTotalAuthors) ||
    limits.maxTotalAuthors < 1 ||
    !Number.isInteger(limits.maxEvents) ||
    limits.maxEvents < 1
  ) {
    throw new Error('Invalid graph synchronization limits')
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)]
}

export function authorSyncScope(scope: string, author: string): string {
  return `${scope}:kind:${TRUST_STATEMENT_KIND}:author:${author}`
}

export class RelaySynchronizer {
  private readonly dependencies: RelaySynchronizerDependencies
  private readonly clock: Clock
  private readonly random: () => number

  constructor(dependencies: RelaySynchronizerDependencies) {
    this.dependencies = dependencies
    this.clock = dependencies.clock ?? systemClock
    this.random = dependencies.random ?? Math.random
  }

  async synchronize(options: SynchronizeOptions): Promise<SynchronizeResult> {
    const limits = options.limits ?? DEFAULT_GRAPH_SYNC_LIMITS
    const retryPolicy = options.retryPolicy ?? DEFAULT_RETRY_POLICY
    assertLimits(limits)
    assertRetryPolicy(retryPolicy)
    if (!options.scope) {
      throw new Error('Synchronization scope is required')
    }
    if (
      !Number.isFinite(options.overlapSeconds) ||
      options.overlapSeconds < 0
    ) {
      throw new Error('overlapSeconds must be non-negative')
    }

    const relayUrls = unique(options.relayUrls.filter(Boolean))
    const requestedRoots = unique(options.rootPubkeys)
    for (const pubkey of requestedRoots) {
      if (!HEX_64.test(pubkey)) {
        throw new Error(`Invalid root pubkey: ${pubkey}`)
      }
    }

    const reasons = new Set<SyncTruncationReason>()
    let currentLevel = requestedRoots
    if (currentLevel.length > limits.maxAuthorsPerLevel) {
      currentLevel = currentLevel.slice(0, limits.maxAuthorsPerLevel)
      reasons.add('maxAuthorsPerLevel')
    }
    if (currentLevel.length > limits.maxTotalAuthors) {
      currentLevel = currentLevel.slice(0, limits.maxTotalAuthors)
      reasons.add('maxTotalAuthors')
    }

    const discovered = new Set(currentLevel)
    const seenOutcomes = new Map<string, EventIngestResult>()
    const queries: RelayQueryOutcome[] = []
    let eventsStored = 0
    let duplicates = 0
    let rejected = 0
    let stoppedByEventLimit = false
    const activeAt = Math.floor(this.clock.now() / 1_000)

    for (
      let depth = 0;
      depth <= limits.maxDepth && currentLevel.length > 0;
      depth += 1
    ) {
      const nextCandidates = new Set<string>()

      for (const author of currentLevel) {
        for (const relayUrl of relayUrls) {
          const outcome = await this.syncAuthorFromRelay({
            relayUrl,
            author,
            baseScope: options.scope,
            overlapSeconds: options.overlapSeconds,
            retryPolicy,
            signal: options.signal,
            seenOutcomes,
            maxEvents: limits.maxEvents,
            onStored: () => {
              eventsStored += 1
            },
            onDuplicate: () => {
              duplicates += 1
            },
            onRejected: () => {
              rejected += 1
            },
          })
          queries.push(outcome)
          if (outcome.error === 'Relay synchronization reached maxEvents') {
            reasons.add('maxEvents')
            stoppedByEventLimit = true
            break
          }
        }

        if (stoppedByEventLimit) {
          break
        }

        const authorEvents = await this.dependencies.events.listEventsByAuthor(
          author,
          TRUST_STATEMENT_KIND,
        )
        for (const pubkey of activePositivePubkeyEdges(authorEvents, activeAt)) {
          if (!discovered.has(pubkey)) {
            nextCandidates.add(pubkey)
          }
        }
      }

      if (stoppedByEventLimit) {
        break
      }

      const sortedCandidates = [...nextCandidates].sort()
      if (depth === limits.maxDepth) {
        if (sortedCandidates.length > 0) {
          reasons.add('maxDepth')
        }
        break
      }

      let nextLevel = sortedCandidates
      if (nextLevel.length > limits.maxAuthorsPerLevel) {
        nextLevel = nextLevel.slice(0, limits.maxAuthorsPerLevel)
        reasons.add('maxAuthorsPerLevel')
      }

      const remainingAuthors = limits.maxTotalAuthors - discovered.size
      if (nextLevel.length > remainingAuthors) {
        nextLevel = nextLevel.slice(0, Math.max(0, remainingAuthors))
        reasons.add('maxTotalAuthors')
      }

      for (const pubkey of nextLevel) {
        discovered.add(pubkey)
      }
      currentLevel = nextLevel
    }

    return {
      authors: [...discovered],
      eventsProcessed: seenOutcomes.size,
      eventsStored,
      duplicates,
      rejected,
      queries,
      truncated: reasons.size > 0,
      truncationReasons: [...reasons],
    }
  }

  private async syncAuthorFromRelay(input: {
    relayUrl: string
    author: string
    baseScope: string
    overlapSeconds: number
    retryPolicy: RetryPolicy
    signal?: AbortSignal
    seenOutcomes: Map<string, EventIngestResult>
    maxEvents: number
    onStored: () => void
    onDuplicate: () => void
    onRejected: () => void
  }): Promise<RelayQueryOutcome> {
    const scope = authorSyncScope(input.baseScope, input.author)
    const cursor = await this.dependencies.cursors.getCursor(
      input.relayUrl,
      scope,
    )
    const since =
      cursor === undefined
        ? undefined
        : Math.floor(cursor.lastEoseAt / FULL_REFRESH_INTERVAL_MS) ===
            Math.floor(this.clock.now() / FULL_REFRESH_INTERVAL_MS)
          ? Math.max(0, cursor.lastSeenCreatedAt - input.overlapSeconds)
          : undefined
    // lastEoseAt is durable, so crossing a refresh slot forces one bounded full
    // query even when maintenance runs often; later runs in the slot resume.
    const filter: Filter = {
      kinds: [TRUST_STATEMENT_KIND],
      authors: [input.author],
      ...(since === undefined ? {} : { since }),
    }
    let maxSeenCreatedAt = cursor?.lastSeenCreatedAt ?? 0

    for (let attempt = 1; attempt <= input.retryPolicy.maxAttempts; attempt += 1) {
      try {
        const remainingEvents = input.maxEvents - input.seenOutcomes.size
        if (remainingEvents < 1) throw new EventLimitReachedError()
        await this.dependencies.client.query({
          relayUrl: input.relayUrl,
          filter: { ...filter, limit: remainingEvents },
          signal: input.signal,
          onEvent: async (event: Event) => {
            let ingestResult = input.seenOutcomes.get(event.id)
            if (ingestResult !== undefined) {
              input.onDuplicate()
            } else {
              if (input.seenOutcomes.size >= input.maxEvents) {
                throw new EventLimitReachedError()
              }

              if (
                event.kind !== TRUST_STATEMENT_KIND ||
                event.pubkey !== input.author
              ) {
                ingestResult = 'rejected'
              } else {
                ingestResult =
                  await this.dependencies.events.ingestEvent(event)
              }
              input.seenOutcomes.set(event.id, ingestResult)

              if (ingestResult === 'stored') {
                input.onStored()
              } else if (ingestResult === 'duplicate') {
                input.onDuplicate()
              } else {
                input.onRejected()
              }
            }

            if (ingestResult !== 'rejected') {
              maxSeenCreatedAt = Math.max(
                maxSeenCreatedAt,
                event.created_at,
              )
            }
            await this.dependencies.onProvenance?.({
              relayUrl: input.relayUrl,
              eventId: event.id,
              observedAt: this.clock.now(),
              ingestResult,
            })
          },
        })

        await this.dependencies.cursors.setCursor({
          relayUrl: input.relayUrl,
          scope,
          lastSeenCreatedAt: maxSeenCreatedAt,
          lastEoseAt: this.clock.now(),
        })
        return {
          relayUrl: input.relayUrl,
          author: input.author,
          scope,
          attempts: attempt,
          completed: true,
        }
      } catch (error) {
        if (
          error instanceof EventLimitReachedError ||
          attempt >= input.retryPolicy.maxAttempts
        ) {
          return {
            relayUrl: input.relayUrl,
            author: input.author,
            scope,
            attempts: attempt,
            completed: false,
            error: errorMessage(error),
          }
        }

        const delayMs = retryDelayMs(
          input.retryPolicy,
          attempt,
          this.random,
        )
        await this.dependencies.onRetry?.({
          relayUrl: input.relayUrl,
          scope,
          attempt,
          delayMs,
          error,
        })
        await this.clock.sleep(delayMs)
      }
    }

    throw new Error('Unreachable relay retry state')
  }
}
