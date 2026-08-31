/**
 * Session storage for signed-in X account reports.
 * Tab-scoped registry is the routing authority; the legacy global key is a
 * projection of the focused product tab for non-routing callers.
 *
 * @module shared/active-x-session
 */

import type { ActiveXAccountReport } from './proof-composer.ts'
import { isDigitsTwitterId } from '../accounts/x-binding.ts'

export const ACTIVE_X_ACCOUNT_SESSION_KEY = 'attentionxActiveXAccount'
export const ACTIVE_X_TAB_REGISTRY_KEY = 'attentionxActiveXTabRegistry'

export const ACTIVE_X_TAB_REGISTRY_MAX = 32
export const ACTIVE_X_TAB_TTL_MS = 24 * 60 * 60 * 1000

export type ActiveXTabStatus = 'unknown' | 'loggedOut' | 'identified'

export interface ActiveXTabObservation {
  tabId: number
  windowId: number
  status: ActiveXTabStatus
  account?: ActiveXAccountReport
  observedAt: number
  navigationEpoch: number
}

export interface ActiveXTabRegistry {
  version: 1
  byTabId: Record<string, ActiveXTabObservation>
}

export function activeXAccountFromUnknown(
  value: unknown,
): ActiveXAccountReport | undefined {
  if (!value || typeof value !== 'object') return undefined
  const row = value as Record<string, unknown>
  if (typeof row.detectedAt !== 'number' || !Number.isFinite(row.detectedAt)) {
    return undefined
  }
  const twitterId =
    typeof row.twitterId === 'string' && /^[0-9]+$/.test(row.twitterId)
      ? row.twitterId
      : undefined
  const handle =
    typeof row.handle === 'string' ? row.handle.trim().replace(/^@/, '') : ''
  if (!handle && !twitterId) return undefined
  if (handle && !/^[A-Za-z0-9_]{1,15}$/.test(handle)) return undefined
  return {
    handle,
    detectedAt: row.detectedAt,
    ...(twitterId ? { twitterId } : {}),
    ...(typeof row.displayName === 'string'
      ? { displayName: row.displayName }
      : {}),
    ...(typeof row.iconPath === 'string' ? { iconPath: row.iconPath } : {}),
  }
}

export function emptyActiveXTabRegistry(): ActiveXTabRegistry {
  return { version: 1, byTabId: {} }
}

export function activeXTabRegistryFromUnknown(
  value: unknown,
): ActiveXTabRegistry {
  if (!value || typeof value !== 'object') return emptyActiveXTabRegistry()
  const row = value as Record<string, unknown>
  if (row.version !== 1 || !row.byTabId || typeof row.byTabId !== 'object') {
    return emptyActiveXTabRegistry()
  }
  const byTabId: Record<string, ActiveXTabObservation> = {}
  for (const [key, raw] of Object.entries(
    row.byTabId as Record<string, unknown>,
  )) {
    const parsed = activeXTabObservationFromUnknown(raw)
    if (parsed) byTabId[String(parsed.tabId)] = parsed
    else if (/^\d+$/.test(key)) {
      /* skip corrupt */
    }
  }
  return { version: 1, byTabId }
}

export function activeXTabObservationFromUnknown(
  value: unknown,
): ActiveXTabObservation | undefined {
  if (!value || typeof value !== 'object') return undefined
  const row = value as Record<string, unknown>
  if (typeof row.tabId !== 'number' || !Number.isFinite(row.tabId)) {
    return undefined
  }
  if (typeof row.windowId !== 'number' || !Number.isFinite(row.windowId)) {
    return undefined
  }
  if (
    row.status !== 'unknown' &&
    row.status !== 'loggedOut' &&
    row.status !== 'identified'
  ) {
    return undefined
  }
  if (typeof row.observedAt !== 'number' || !Number.isFinite(row.observedAt)) {
    return undefined
  }
  const navigationEpoch =
    typeof row.navigationEpoch === 'number' && Number.isFinite(row.navigationEpoch)
      ? Math.max(0, Math.floor(row.navigationEpoch))
      : 0
  const account = activeXAccountFromUnknown(row.account)
  if (row.status === 'identified') {
    const twitterId = account?.twitterId
    if (!twitterId || !isDigitsTwitterId(twitterId)) return undefined
  }
  return {
    tabId: row.tabId,
    windowId: row.windowId,
    status: row.status,
    observedAt: row.observedAt,
    navigationEpoch,
    ...(account ? { account } : {}),
  }
}

export function upsertActiveXTabObservation(
  registry: ActiveXTabRegistry,
  observation: ActiveXTabObservation,
  now: number,
): ActiveXTabRegistry {
  const next: ActiveXTabRegistry = {
    version: 1,
    byTabId: { ...registry.byTabId, [String(observation.tabId)]: observation },
  }
  return pruneActiveXTabRegistry(next, now)
}

export function removeActiveXTabObservation(
  registry: ActiveXTabRegistry,
  tabId: number,
): ActiveXTabRegistry {
  if (!(String(tabId) in registry.byTabId)) return registry
  const byTabId = { ...registry.byTabId }
  delete byTabId[String(tabId)]
  return { version: 1, byTabId }
}

export function bumpTabNavigationEpoch(
  registry: ActiveXTabRegistry,
  tabId: number,
  windowId: number,
  now: number,
): ActiveXTabRegistry {
  const current = registry.byTabId[String(tabId)]
  const observation: ActiveXTabObservation = current
    ? {
        ...current,
        windowId,
        navigationEpoch: current.navigationEpoch + 1,
        observedAt: now,
      }
    : {
        tabId,
        windowId,
        status: 'unknown',
        observedAt: now,
        navigationEpoch: 1,
      }
  return upsertActiveXTabObservation(registry, observation, now)
}

export function pruneActiveXTabRegistry(
  registry: ActiveXTabRegistry,
  now: number,
): ActiveXTabRegistry {
  const entries = Object.values(registry.byTabId).filter(
    (row) => now - row.observedAt <= ACTIVE_X_TAB_TTL_MS,
  )
  entries.sort((a, b) => b.observedAt - a.observedAt)
  const kept = entries.slice(0, ACTIVE_X_TAB_REGISTRY_MAX)
  const byTabId: Record<string, ActiveXTabObservation> = {}
  for (const row of kept) byTabId[String(row.tabId)] = row
  return { version: 1, byTabId }
}

export function observationForTab(
  registry: ActiveXTabRegistry,
  tabId: number,
): ActiveXTabObservation | undefined {
  return registry.byTabId[String(tabId)]
}

export function ensureCommitMatches(input: {
  capturedTabId: number
  capturedEpoch: number
  liveTabId: number | undefined
  liveEpoch: number | undefined
}): boolean {
  return (
    input.liveTabId === input.capturedTabId &&
    input.liveEpoch === input.capturedEpoch
  )
}
