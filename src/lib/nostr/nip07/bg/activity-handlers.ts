/**
 * Single generic activity log (chrome.storage.local `activityLog`).
 *
 * Minimal durable rows for any Attention activity — no event content/tags,
 * no separate per-feature log tables. Signed event actions may store `eventId`;
 * unsuccessful actions may store a short `reason`.
 */

import browser from '../../../../vault/browser.ts'
import { config, type HandlerFn } from './state.ts'
import {
  ACTIVITY_LOG_GLOBAL_MAX,
  ACTIVITY_LOG_MAX_PER_DOMAIN,
} from '../../../../vault/constants.ts'
import { AsyncLock } from '../../../../vault/utils/async-lock.ts'

/** Max characters persisted in `reason`. */
export const ACTIVITY_REASON_MAX_CHARS = 200

export interface ActivityLogInput {
  domain?: string
  method: string
  decision: string
  kind?: number
  /** Nostr event id (64-hex) when a signed event exists. */
  eventId?: string
  /** Why the action did not succeed (unsigned / blocked / failed). */
  reason?: string
  /** Local account pubkey that acted. */
  pubkey?: string
}

export interface StoredActivityEntry {
  timestamp: number
  domain: string
  method: string
  decision: string
  kind?: number
  eventId?: string
  reason?: string
  pubkey?: string
}

const activityLogLock = new AsyncLock()

const EVENT_ID_RE = /^[0-9a-f]{64}$/i

function trimReason(reason: string | undefined): string | undefined {
  if (typeof reason !== 'string') return undefined
  const trimmed = reason.trim()
  if (!trimmed) return undefined
  return trimmed.length > ACTIVITY_REASON_MAX_CHARS
    ? trimmed.slice(0, ACTIVITY_REASON_MAX_CHARS)
    : trimmed
}

function normalizeEventId(eventId: string | undefined): string | undefined {
  if (typeof eventId !== 'string') return undefined
  const id = eventId.trim().toLowerCase()
  return EVENT_ID_RE.test(id) ? id : undefined
}

/** Normalize any legacy or partial row into the minimal generic shape. */
export function normalizeActivityEntry(
  entry: Record<string, unknown>,
): StoredActivityEntry {
  const summary =
    entry.eventSummary &&
    typeof entry.eventSummary === 'object' &&
    !Array.isArray(entry.eventSummary)
      ? (entry.eventSummary as Record<string, unknown>)
      : undefined
  const legacyEvent =
    entry.event && typeof entry.event === 'object' && !Array.isArray(entry.event)
      ? (entry.event as Record<string, unknown>)
      : undefined

  const kind =
    typeof entry.kind === 'number' && Number.isInteger(entry.kind)
      ? entry.kind
      : typeof summary?.kind === 'number' && Number.isInteger(summary.kind)
        ? summary.kind
        : typeof legacyEvent?.kind === 'number' &&
            Number.isInteger(legacyEvent.kind)
          ? legacyEvent.kind
          : undefined

  const eventId =
    normalizeEventId(
      typeof entry.eventId === 'string' ? entry.eventId : undefined,
    ) ??
    normalizeEventId(
      typeof summary?.eventId === 'string' ? summary.eventId : undefined,
    ) ??
    normalizeEventId(
      typeof legacyEvent?.id === 'string' ? legacyEvent.id : undefined,
    )

  const reason =
    trimReason(typeof entry.reason === 'string' ? entry.reason : undefined) ??
    trimReason(
      typeof legacyEvent?.reason === 'string' ? legacyEvent.reason : undefined,
    )

  const domain =
    (typeof entry.domain === 'string' && entry.domain) ||
    (typeof entry.origin === 'string' && entry.origin) ||
    'unknown'

  const method =
    (typeof entry.method === 'string' && entry.method) ||
    (typeof entry.action === 'string' && entry.action) ||
    'activity'

  const decision =
    typeof entry.decision === 'string' && entry.decision
      ? entry.decision
      : 'unknown'

  const pubkey =
    typeof entry.pubkey === 'string' && entry.pubkey
      ? entry.pubkey
      : undefined

  const timestamp =
    typeof entry.timestamp === 'number' && Number.isFinite(entry.timestamp)
      ? entry.timestamp
      : typeof entry.ts === 'number' && Number.isFinite(entry.ts)
        ? entry.ts
        : Date.now()

  const normalized: StoredActivityEntry = {
    timestamp,
    domain,
    method,
    decision,
  }
  if (kind !== undefined) normalized.kind = kind
  if (eventId) normalized.eventId = eventId
  if (reason) normalized.reason = reason
  if (pubkey) normalized.pubkey = pubkey
  return normalized
}

function entryNeedsMigration(entry: Record<string, unknown>): boolean {
  if ('event' in entry || 'eventSummary' in entry || 'theirPubkey' in entry) {
    return true
  }
  if ('origin' in entry || 'action' in entry || 'ts' in entry) return true
  if (entry.kind === null) return true
  if (entry.pubkey === null) return true
  return false
}

function trimActivityLog(log: StoredActivityEntry[]): StoredActivityEntry[] {
  const domainCounts: Record<string, number> = {}
  const perDomain = log.filter((entry) => {
    const domain = entry.domain || '?'
    domainCounts[domain] = (domainCounts[domain] || 0) + 1
    return domainCounts[domain] <= ACTIVITY_LOG_MAX_PER_DOMAIN
  })
  return perDomain.slice(0, ACTIVITY_LOG_GLOBAL_MAX)
}

async function readActivityLogRaw(): Promise<Array<Record<string, unknown>>> {
  const data = (await browser.storage.local.get(['activityLog'])) as {
    activityLog?: Array<Record<string, unknown>>
  }
  return Array.isArray(data.activityLog) ? data.activityLog : []
}

async function writeActivityLog(log: StoredActivityEntry[]): Promise<void> {
  await browser.storage.local.set({ activityLog: trimActivityLog(log) })
}

export function activityReasonFromError(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'error'
  return trimReason(message) ?? 'error'
}

// ── Activity Log ──

export async function logActivity(entry: ActivityLogInput): Promise<void> {
  try {
    await activityLogLock.run(async () => {
      const log = (await readActivityLogRaw()).map((row) =>
        normalizeActivityEntry(row),
      )
      const next = normalizeActivityEntry({
        timestamp: Date.now(),
        domain: entry.domain ?? 'unknown',
        method: entry.method,
        decision: entry.decision,
        kind: entry.kind,
        eventId: entry.eventId,
        reason: entry.reason,
        pubkey: entry.pubkey || config.myPubkey || undefined,
      })
      log.unshift(next)
      await writeActivityLog(log)
    })
  } catch {
    /* ignored */
  }
}

// ── Handler Map ──

export const handlers = new Map<string, HandlerFn>([
  [
    'getActivityLog',
    async () => {
      return activityLogLock.run(async () => {
        const raw = await readActivityLogRaw()
        const dirty = raw.some(entryNeedsMigration)
        const normalized = raw.map((row) => normalizeActivityEntry(row))
        if (dirty) {
          await writeActivityLog(normalized)
        }
        return normalized
      })
    },
  ],

  [
    'clearActivityLog',
    async (params) => {
      return activityLogLock.run(async () => {
        const hasFilter =
          params.domain ||
          params.accountPubkey ||
          params.typeFilter ||
          params.pubkeyFilter
        if (!hasFilter) {
          await browser.storage.local.remove('activityLog')
          return { ok: true }
        }

        const allLog = (await readActivityLogRaw()).map((row) =>
          normalizeActivityEntry(row),
        )
        const typeMethods: Record<string, string[]> = {
          signEvent: ['signEvent'],
          getPublicKey: ['getPublicKey'],
          encrypt: ['nip04Encrypt', 'nip44Encrypt'],
          decrypt: ['nip04Decrypt', 'nip44Decrypt'],
          nip04Encrypt: ['nip04Encrypt'],
          nip04Decrypt: ['nip04Decrypt'],
          nip44Encrypt: ['nip44Encrypt'],
          nip44Decrypt: ['nip44Decrypt'],
        }
        const kept = allLog.filter((entry) => {
          if (params.accountPubkey && entry.pubkey !== params.accountPubkey) {
            return true
          }
          if (params.domain && entry.domain !== params.domain) return true
          if (params.typeFilter) {
            const methods = typeMethods[params.typeFilter as string]
            if (methods && !methods.includes(entry.method)) return true
          }
          if (params.pubkeyFilter) {
            const q = (params.pubkeyFilter as string).toLowerCase()
            const matches = Boolean(
              entry.pubkey?.toLowerCase().includes(q) ||
                entry.eventId?.toLowerCase().includes(q),
            )
            if (!matches) return true
          }
          return false
        })
        await writeActivityLog(kept)
        return { ok: true }
      })
    },
  ],
])
